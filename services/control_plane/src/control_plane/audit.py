"""
CDM-OS — Audit Logger

Writes HMAC-signed, hash-chained audit log entries to the database.
Every significant action in the system (proposal created, policy check,
human decision, tool execution) must be recorded via this module.

The HMAC covers ALL columns (event_type, actor, proposal_id, payload,
created_at, prev_hash) — not just the payload — so tampering with any
column is detectable.  Each entry includes the hash of the previous
entry, forming a hash chain that detects deletions and re-ordering.
"""

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from control_plane.config import settings
from control_plane.models import AuditLog

logger = logging.getLogger("cdm.audit")


def _canonical_message(
    event_type: str,
    actor: str,
    proposal_id: Optional[UUID],
    payload: dict,
    created_at: datetime,
    prev_hash: str,
) -> bytes:
    """Build a deterministic byte string from all auditable columns."""
    obj = {
        "event_type": event_type,
        "actor": actor,
        "proposal_id": str(proposal_id) if proposal_id else None,
        "payload": payload,
        "created_at": created_at.isoformat(),
        "prev_hash": prev_hash,
    }
    return json.dumps(obj, sort_keys=True, default=str).encode("utf-8")


def _compute_hmac(message: bytes) -> str:
    """Compute HMAC-SHA256 signature over the canonical message."""
    return hmac.new(
        settings.AUDIT_HMAC_SECRET.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()


def _get_prev_hash(db: Session) -> str:
    """Return the HMAC signature of the most recent audit entry, or a genesis value."""
    last = (
        db.query(AuditLog.hmac_signature)
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    if last and last[0]:
        return last[0]
    return "0" * 64  # Genesis hash — no prior entries


def record_event(
    db: Session,
    event_type: str,
    actor: str,
    payload: dict,
    proposal_id: Optional[UUID] = None,
) -> AuditLog:
    """
    Record an immutable, HMAC-signed, hash-chained audit log entry.

    The HMAC signs ALL columns: event_type, actor, proposal_id, payload,
    created_at, and the previous entry's hash. This makes it possible to
    detect any edit or deletion.

    Args:
        db: Active database session
        event_type: e.g. PROPOSAL_CREATED, POLICY_CHECK, HUMAN_DECISION, TOOL_EXECUTED
        actor: agent_id, user email, or 'system'
        payload: Arbitrary JSON data describing the event
        proposal_id: Optional link to the proposal this event relates to

    Returns:
        The created AuditLog record
    """
    created_at = datetime.now(timezone.utc)
    prev_hash = _get_prev_hash(db)

    message = _canonical_message(
        event_type, actor, proposal_id, payload, created_at, prev_hash,
    )
    signature = _compute_hmac(message)

    entry = AuditLog(
        event_type=event_type,
        actor=actor,
        proposal_id=proposal_id,
        payload={**payload, "_prev_hash": prev_hash},
        hmac_signature=signature,
        created_at=created_at,
    )
    db.add(entry)
    db.flush()  # Assign ID without committing (caller controls transaction)
    return entry


def verify_entry(entry: AuditLog, expected_prev_hash: Optional[str] = None) -> bool:
    """
    Verify that an audit log entry has not been tampered with.

    Args:
        entry: The AuditLog row to verify.
        expected_prev_hash: If provided, also verify the hash chain link.

    Returns:
        True if the HMAC is valid and the chain link matches (when checked).
    """
    prev_hash = (entry.payload or {}).get("_prev_hash", "0" * 64)

    # Reconstruct the payload without the internal chain key for signing
    clean_payload = {k: v for k, v in (entry.payload or {}).items() if k != "_prev_hash"}
    clean_payload["_prev_hash"] = prev_hash

    message = _canonical_message(
        entry.event_type,
        entry.actor,
        entry.proposal_id,
        clean_payload,
        entry.created_at,
        prev_hash,
    )
    expected_sig = _compute_hmac(message)

    if not hmac.compare_digest(expected_sig, entry.hmac_signature or ""):
        return False

    if expected_prev_hash is not None and prev_hash != expected_prev_hash:
        return False

    return True


def verify_chain(db: Session, limit: int = 1000) -> dict:
    """
    Walk the audit log and verify the hash chain.

    Returns a dict with:
        valid: bool — True if the entire scanned range is intact
        checked: int — number of entries checked
        broken_at: Optional[str] — the ID of the first broken entry
    """
    entries = (
        db.query(AuditLog)
        .order_by(AuditLog.created_at.asc())
        .limit(limit)
        .all()
    )

    prev_hash = "0" * 64  # Genesis
    for entry in entries:
        if not verify_entry(entry, expected_prev_hash=prev_hash):
            return {
                "valid": False,
                "checked": entries.index(entry) + 1,
                "broken_at": str(entry.id),
            }
        prev_hash = entry.hmac_signature

    return {"valid": True, "checked": len(entries), "broken_at": None}
