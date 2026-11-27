"""
CDM-OS — API Routes: Proposals

Handles the full lifecycle of agent tool-call proposals:
1. Agent submits a proposal (POST)
2. Policy Engine evaluates it
3. If Tier-3 → status becomes PENDING_HUMAN_APPROVAL
4. Human approves/rejects via Governance UI (PUT)
5. Approved proposals are released for tool execution
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from control_plane.auth import Identity, Role, get_identity, require_role, require_human
from control_plane.database import get_db
from control_plane.models import Proposal, ToolDefinition, Agent, ProposalStatus, ToolTier
from control_plane.schemas import (
    ProposalCreate,
    ProposalResponse,
    HumanDecision,
    ProposalStatusEnum,
)
from control_plane.policy_engine import policy_engine
from control_plane.audit import record_event
from control_plane.execution_grant import GRANT_HEADER, MUTATING_TOOLS, issue_grant

logger = logging.getLogger("cdm.api.proposals")

router = APIRouter(prefix="/proposals", tags=["Proposals"])


def _payload_identifier(payload: dict, keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().casefold()
    return None


def _has_pending_field_proposal(
    db: Session, object_name: str, field_name: str
) -> bool:
    pending_proposals = (
        db.query(Proposal)
        .filter(Proposal.status == ProposalStatus.PENDING_HUMAN_APPROVAL)
        .all()
    )

    requested_object = object_name.strip().casefold()
    requested_field = field_name.strip().casefold()
    for proposal in pending_proposals:
        payload = proposal.input_payload or {}
        existing_object = _payload_identifier(
            payload, ("object_name", "object", "sobject", "target")
        )
        existing_field = _payload_identifier(
            payload, ("field_api_name", "field_name", "target_field", "field")
        )
        if existing_object == requested_object and existing_field == requested_field:
            return True
    return False


# ── POST /proposals — Agent submits a new proposal ────────────
@router.post("", response_model=ProposalResponse, status_code=201, include_in_schema=False)
@router.post("/", response_model=ProposalResponse, status_code=201)
def create_proposal(
    body: ProposalCreate,
    identity: Identity = Depends(require_role(Role.PROPOSER)),
    db: Session = Depends(get_db),
):
    """
    Accept a tool-call proposal from an agent.

    Flow:
    1. Validate agent and tool exist
    2. Run Policy Engine evaluation
    3. Set status based on policy result
    4. Record audit log entry
    """
    # Verify agent is registered
    agent = db.query(Agent).filter(Agent.agent_id == body.agent_id).first()
    if not agent:
        raise HTTPException(404, f"Agent '{body.agent_id}' not registered")

    # Verify tool is registered
    tool = db.query(ToolDefinition).filter(ToolDefinition.tool_id == body.tool_id).first()
    if not tool:
        raise HTTPException(404, f"Tool '{body.tool_id}' not registered")

    if (
        body.tool_id == "salesforce_delete_field"
        and body.input_payload.get("confirm_delete") is not True
    ):
        raise HTTPException(
            400,
            "Explicit confirmation (confirm_delete=true) is required for field deletion.",
        )

    if body.tool_id == "salesforce_rollback_field":
        backup_id = body.input_payload.get("backup_id")
        if not isinstance(backup_id, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_-]{0,199}", backup_id
        ):
            raise HTTPException(400, "A valid backup_id is required for description restoration.")

    # ── Run Policy Engine ─────────────────────────────────────
    decision = policy_engine.evaluate(
        tool_id=body.tool_id,
        tier=ToolTier(tool.tier.value),
        input_payload=body.input_payload,
    )

    # Determine status based on policy result
    if not decision.allowed:
        status = ProposalStatus.POLICY_DENIED
    elif decision.requires_human_approval:
        status = ProposalStatus.PENDING_HUMAN_APPROVAL
    else:
        status = ProposalStatus.POLICY_APPROVED

    if status == ProposalStatus.PENDING_HUMAN_APPROVAL:
        object_name = _payload_identifier(
            body.input_payload, ("object_name", "object", "sobject", "target")
        )
        field_name = _payload_identifier(
            body.input_payload,
            ("field_api_name", "field_name", "target_field", "field"),
        )
        if (
            object_name
            and field_name
            and _has_pending_field_proposal(db, object_name, field_name)
        ):
            raise HTTPException(
                409,
                "This field is already present in the Approval Queue.",
            )

    # Create proposal record
    proposal = Proposal(
        agent_id=body.agent_id,
        org_id=body.org_id,
        tool_id=body.tool_id,
        tier=tool.tier,
        input_payload=body.input_payload,
        status=status,
        policy_result=decision.to_dict(),
    )
    db.add(proposal)
    db.flush()

    # Audit: record the proposal creation and policy check
    record_event(db, "PROPOSAL_CREATED", body.agent_id, {
        "tool_id": body.tool_id,
        "org_id": body.org_id,
        "tier": tool.tier.value,
        "input_payload": body.input_payload,
    }, proposal_id=proposal.id)

    record_event(db, "POLICY_CHECK", "system", {
        "decision": decision.to_dict(),
        "resulting_status": status.value,
    }, proposal_id=proposal.id)

    db.commit()
    db.refresh(proposal)

    logger.info(f"Proposal {proposal.id} created: tool={body.tool_id} status={status.value}")
    return proposal


# ── GET /proposals — List proposals with optional filters ─────
@router.get("", response_model=list[ProposalResponse], include_in_schema=False)
@router.get("/", response_model=list[ProposalResponse])
def list_proposals(
    status: Optional[ProposalStatusEnum] = Query(None, description="Filter by status"),
    agent_id: Optional[str] = Query(None, description="Filter by agent"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    identity: Identity = Depends(require_role(Role.VIEWER)),
    db: Session = Depends(get_db),
):
    """List all proposals with optional filtering."""
    query = db.query(Proposal)

    if status:
        query = query.filter(Proposal.status == status.value)
    if agent_id:
        query = query.filter(Proposal.agent_id == agent_id)

    proposals = query.order_by(Proposal.created_at.desc()).offset(offset).limit(limit).all()
    return proposals


# ── GET /proposals/{id} — Get a single proposal ──────────────
@router.get("/{proposal_id}", response_model=ProposalResponse)
def get_proposal(
    proposal_id: UUID,
    identity: Identity = Depends(require_role(Role.VIEWER)),
    db: Session = Depends(get_db),
):
    """Retrieve a specific proposal by ID."""
    proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    return proposal


# ── PUT /proposals/{id}/decide — Human approves or rejects ────
@router.put("/{proposal_id}/decide", response_model=ProposalResponse)
def human_decide(
    proposal_id: UUID,
    body: HumanDecision,
    identity: Identity = Depends(require_role(Role.APPROVER)),
    db: Session = Depends(get_db),
):
    """
    Accept a human approval or rejection for a pending proposal.

    Only proposals in PENDING_HUMAN_APPROVAL status can be decided.
    The reviewer identity is taken from the bearer token — agents cannot decide.
    Separation of duties: the approver of a Tier-3 proposal must differ from its proposer.
    """
    if identity.is_agent:
        raise HTTPException(403, "Agents cannot approve or reject proposals.")

    proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
    if not proposal:
        raise HTTPException(404, "Proposal not found")

    if proposal.status != ProposalStatus.PENDING_HUMAN_APPROVAL:
        raise HTTPException(
            409,
            f"Proposal is in '{proposal.status.value}' state — "
            f"only PENDING_HUMAN_APPROVAL proposals can be decided",
        )

    # Separation of duties: for Tier-3, approver must differ from proposer
    if proposal.tier == ToolTier.TIER_3 and proposal.agent_id == identity.sub:
        raise HTTPException(
            403,
            "Separation of duties: you cannot approve your own Tier-3 proposal.",
        )

    reviewer_email = identity.email
    now = datetime.now(timezone.utc)
    if body.decision == "APPROVED":
        proposal.status = ProposalStatus.HUMAN_APPROVED
    else:
        proposal.status = ProposalStatus.HUMAN_REJECTED

    proposal.human_decision = {
        "decision": body.decision,
        "reviewer_email": reviewer_email,
        "reason": body.reason,
        "decided_at": now.isoformat(),
    }
    proposal.decided_at = now

    # Audit: record human decision — identity from token, not request body
    record_event(db, "HUMAN_DECISION", reviewer_email, {
        "decision": body.decision,
        "reason": body.reason,
        "proposal_tool": proposal.tool_id,
    }, proposal_id=proposal.id)

    db.commit()
    db.refresh(proposal)

    logger.info(f"Proposal {proposal.id} {body.decision} by {reviewer_email}")
    return proposal


# ── GET /proposals/pending — Shortcut for Governance UI ───────
@router.get("/queue/pending", response_model=list[ProposalResponse])
@router.get("/queue/pending/", response_model=list[ProposalResponse], include_in_schema=False)
@router.get("/pending", response_model=list[ProposalResponse], include_in_schema=False)
@router.get("/pending/", response_model=list[ProposalResponse], include_in_schema=False)
def get_pending_approvals(
    identity: Identity = Depends(require_role(Role.VIEWER)),
    db: Session = Depends(get_db),
):
    """Get all proposals waiting for human approval."""

    proposals = (
        db.query(Proposal)
        .filter(
            Proposal.status
            == ProposalStatus.PENDING_HUMAN_APPROVAL
        )
        .order_by(
            Proposal.created_at.asc()
        )
        .all()
    )

    return proposals


# ── POST /proposals/{id}/execute — Trigger tool execution ─────
from fastapi import BackgroundTasks
import httpx
from control_plane.config import settings

@router.post("/{proposal_id}/execute", response_model=ProposalResponse)
def execute_proposal(
    proposal_id: UUID,
    background_tasks: BackgroundTasks,
    identity: Identity = Depends(require_role(Role.APPROVER)),
    db: Session = Depends(get_db),
):
    """
    Execute an approved proposal via the Tool Gateway.
    Only proposals in HUMAN_APPROVED or POLICY_APPROVED can be executed.

    Uses a conditional UPDATE to prevent double-execution from concurrent requests.
    """
    from sqlalchemy import update

    # Atomic conditional update: only transition if still in an approved state
    result = db.execute(
        update(Proposal)
        .where(
            Proposal.id == proposal_id,
            Proposal.status.in_([
                ProposalStatus.HUMAN_APPROVED,
                ProposalStatus.POLICY_APPROVED,
            ]),
        )
        .values(status=ProposalStatus.EXECUTING)
    )

    if result.rowcount == 0:  # type: ignore[union-attr]
        # Either not found or already in a non-approved state
        proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
        if not proposal:
            raise HTTPException(404, "Proposal not found")
        raise HTTPException(
            409,
            f"Proposal is in '{proposal.status.value}' state — "
            f"only HUMAN_APPROVED or POLICY_APPROVED proposals can be executed",
        )

    db.commit()

    proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
    record_event(db, "EXECUTION_STARTED", "system", {
        "tool_id": proposal.tool_id,
        "input_payload": proposal.input_payload,
    }, proposal_id=proposal.id)
    db.commit()
    db.refresh(proposal)

    # Dispatch to Tool Gateway in background
    background_tasks.add_task(
        _run_tool_execution,
        proposal_id=proposal.id,
        tool_id=proposal.tool_id,
        org_id=proposal.org_id,
        input_payload=proposal.input_payload,
    )

    logger.info(f"Proposal {proposal.id} dispatched for execution")
    return proposal


async def _run_tool_execution(
    proposal_id: UUID,
    tool_id: str,
    org_id: str,
    input_payload: dict,
):
    """Background task: call Tool Gateway and update proposal status."""
    from control_plane.database import SessionLocal

    gateway_url = settings.MCP_GATEWAY_URL.rstrip("/")
    timeout = float(settings.MCP_REQUEST_TIMEOUT_SEC)
    if tool_id == "salesforce_full_field_assessment":
        timeout = float(settings.FIELD_ASSESSMENT_TIMEOUT_SEC)

    endpoint_map = {
        "salesforce_full_field_assessment": "/tools/salesforce/full-assessment",
        "salesforce_describe_object": "/tools/salesforce/describe",
        "salesforce_query_field_usage": "/tools/salesforce/field-usage",
        "salesforce_scan_apex_references": "/tools/salesforce/scan-references",
        "salesforce_deprecate_field": "/tools/salesforce/deprecate",
        "salesforce_backup_field_def": "/tools/salesforce/backup",
        "salesforce_delete_field": "/tools/salesforce/delete",
        "salesforce_rollback_field": "/tools/salesforce/rollback",
        "salesforce_health_check": "/health",
    }

    endpoint = endpoint_map.get(tool_id)
    if not endpoint:
        with SessionLocal() as db:
            proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
            if proposal:
                proposal.status = ProposalStatus.FAILED
                proposal.error_message = f"No gateway endpoint mapped for tool: {tool_id}"
                proposal.executed_at = datetime.now(timezone.utc)
                record_event(db, "EXECUTION_FAILED", "system", {
                    "error": proposal.error_message,
                }, proposal_id=proposal.id)
                db.commit()
        return

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if tool_id in {
                "salesforce_deprecate_field",
                "salesforce_backup_field_def",
                "salesforce_delete_field",
                "salesforce_full_field_assessment",
            }:
                input_payload = {
                    "object_name": input_payload.get(
                        "object_name", input_payload.get("object_api_name", "")
                    ),
                    "field_name": input_payload.get(
                        "field_name", input_payload.get("field_api_name", "")
                    ),
                    **(
                        {"confirm_delete": input_payload.get("confirm_delete") is True}
                        if tool_id == "salesforce_delete_field"
                        else {}
                    ),
                    **(
                        {"reason": input_payload.get("reason")}
                        if tool_id
                        in {"salesforce_deprecate_field", "salesforce_delete_field"}
                        else {}
                    ),
                }
            headers = {"X-Service-Key": settings.GATEWAY_SERVICE_KEY}
            if tool_id in MUTATING_TOOLS:
                # One-time grant bound to this proposal and this exact body.
                grant = issue_grant(proposal_id, tool_id, org_id, input_payload)
                if grant:
                    headers[GRANT_HEADER] = grant
                else:
                    logger.warning(
                        "EXECUTION_GRANT_SECRET is not set — dispatching %s for %s "
                        "without an execution grant (development only)",
                        tool_id, proposal_id,
                    )
            response = await client.post(
                f"{gateway_url}{endpoint}",
                json=input_payload,
                headers=headers,
            )
            if not response.is_success:
                detail = response.text.strip() or response.reason_phrase
                raise RuntimeError(
                    f"Tool Gateway returned HTTP {response.status_code}: {detail[:1000]}"
                )
            result = response.json()

        with SessionLocal() as db:
            proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
            if proposal:
                proposal.status = ProposalStatus.COMPLETED
                proposal.execution_result = result
                proposal.executed_at = datetime.now(timezone.utc)
                record_event(db, "TOOL_EXECUTED", "system", {
                    "tool_id": tool_id,
                    "result_summary": str(result)[:500],
                }, proposal_id=proposal.id)
                db.commit()

    except httpx.TimeoutException as exc:
        # Timeout does NOT mean failure — the Metadata API may have succeeded.
        # Mark as UNKNOWN so a reconciliation job can check the org state.
        with SessionLocal() as db:
            proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
            if proposal:
                proposal.status = ProposalStatus.UNKNOWN
                proposal.error_message = (
                    f"Tool Gateway timed out after {timeout:g}s executing {tool_id}. "
                    f"The operation may have completed — reconciliation required."
                )
                proposal.executed_at = datetime.now(timezone.utc)
                record_event(db, "EXECUTION_TIMEOUT", "system", {
                    "error": str(exc),
                    "tool_id": tool_id,
                    "note": "Needs reconciliation — field may already be changed in org.",
                }, proposal_id=proposal.id)
                db.commit()

    except Exception as exc:
        with SessionLocal() as db:
            proposal = db.query(Proposal).filter(Proposal.id == proposal_id).first()
            if proposal:
                proposal.status = ProposalStatus.FAILED
                proposal.error_message = str(exc) or type(exc).__name__
                proposal.executed_at = datetime.now(timezone.utc)
                record_event(db, "EXECUTION_FAILED", "system", {
                    "error": str(exc),
                }, proposal_id=proposal.id)
                db.commit()
