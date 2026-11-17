"""
CDM-OS — Policy Engine

Loads YAML policy definitions from disk, evaluates agent tool call proposals
against the active rule set, and returns ALLOW / DENY / ESCALATE decisions.

This is the core security gatekeeper: no tool call executes without passing
through evaluate_proposal().
"""

import re
import yaml
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field

from control_plane.config import settings
from control_plane.models import ToolTier

logger = logging.getLogger("cdm.policy")


# ── Known condition keys (anything else is a schema error) ───
_KNOWN_CONDITION_KEYS = frozenset({
    "deny_if",
    "max_operations_per_run",
    "time_window",
    "always",
    "on_violation",
})

_KNOWN_DENY_KEYS = frozenset({
    "is_custom_field",
    "is_managed_package",
    "field_name_matches",
    "object_name_matches",
    "protected_objects",
})


# ── Parsed Rule Representation ────────────────────────────────

@dataclass
class ParsedRule:
    """In-memory representation of a single policy rule from YAML."""
    rule_id: str
    action: str  # Tool ID pattern (or "all_tools")
    source_file: str
    conditions: dict = field(default_factory=dict)
    enforcement: dict = field(default_factory=dict)
    tier: Optional[str] = None

    @property
    def requires_hitl(self) -> bool:
        return self.enforcement.get("require_hitl_approval", False)

    @property
    def on_violation(self) -> str:
        return self.enforcement.get("on_violation", self.conditions.get("on_violation", "REJECT"))

    @property
    def max_operations(self) -> Optional[int]:
        return self.conditions.get("max_operations_per_run")

    @property
    def time_window(self) -> Optional[dict]:
        return self.conditions.get("time_window")


# ── Evaluation Result ─────────────────────────────────────────

@dataclass
class PolicyDecision:
    """The output of evaluating a proposal against the policy engine."""
    allowed: bool
    requires_human_approval: bool = False
    matched_rules: list[str] = field(default_factory=list)
    denial_reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "requires_human_approval": self.requires_human_approval,
            "matched_rules": self.matched_rules,
            "denial_reasons": self.denial_reasons,
        }


# ── Policy Engine ─────────────────────────────────────────────

class PolicyEngine:
    """
    Loads policy YAML files and evaluates tool-call proposals.

    Usage:
        engine = PolicyEngine()
        engine.load_policies()           # Load all YAML files from policy/definitions/
        decision = engine.evaluate(tool_id, tier, input_payload)
    """

    def __init__(self, definitions_path: Optional[str] = None):
        target_path = Path(definitions_path or settings.POLICY_DEFINITIONS_PATH)
        if not target_path.exists():
            project_root = Path(__file__).resolve().parent.parent
            candidate = project_root / target_path
            if candidate.exists():
                target_path = candidate

        self.definitions_path = target_path
        self.rules: list[ParsedRule] = []
        self._mode = settings.POLICY_MODE  # enforce | audit_only | dry_run

    def load_policies(self) -> int:
        """
        Load all .yaml files from the definitions directory.
        Returns the number of rules loaded.
        Raises ValueError for invalid YAML schemas so the app can refuse to start.
        """
        self.rules.clear()
        errors: list[str] = []

        if not self.definitions_path.exists():
            logger.warning(f"Policy definitions path does not exist: {self.definitions_path}")
            return 0

        for yaml_file in self.definitions_path.glob("*.yaml"):
            try:
                with open(yaml_file, "r") as f:
                    policy_doc = yaml.safe_load(f)

                if not policy_doc or "rules" not in policy_doc:
                    errors.append(f"{yaml_file.name}: no 'rules' key found")
                    continue

                for rule_data in policy_doc["rules"]:
                    # Validate condition keys
                    conditions = rule_data.get("condition", {})
                    unknown_keys = set(conditions.keys()) - _KNOWN_CONDITION_KEYS
                    if unknown_keys:
                        errors.append(
                            f"{yaml_file.name}, rule '{rule_data.get('id', '?')}': "
                            f"unknown condition key(s): {unknown_keys}"
                        )
                        continue

                    # Validate deny_if entries
                    for deny_entry in conditions.get("deny_if", []):
                        if isinstance(deny_entry, dict):
                            unknown_deny = set(deny_entry.keys()) - _KNOWN_DENY_KEYS
                            if unknown_deny:
                                errors.append(
                                    f"{yaml_file.name}, rule '{rule_data.get('id', '?')}': "
                                    f"unknown deny_if key(s): {unknown_deny}"
                                )

                    parsed = ParsedRule(
                        rule_id=rule_data.get("id", f"unnamed_{yaml_file.stem}"),
                        action=rule_data.get("action", "all_tools"),
                        source_file=yaml_file.name,
                        conditions=conditions,
                        enforcement=rule_data.get("enforcement", {}),
                        tier=rule_data.get("tier"),
                    )
                    self.rules.append(parsed)

                logger.info(f"Loaded {len(policy_doc['rules'])} rules from {yaml_file.name}")

            except yaml.YAMLError as e:
                errors.append(f"{yaml_file.name}: YAML parse error — {e}")
            except Exception as e:
                errors.append(f"{yaml_file.name}: {e}")

        if errors:
            msg = "Policy validation failed:\n  " + "\n  ".join(errors)
            logger.error(msg)
            raise ValueError(msg)

        logger.info(f"Policy Engine loaded {len(self.rules)} total rules")
        return len(self.rules)

    def evaluate(self, tool_id: str, tier: ToolTier, input_payload: dict) -> PolicyDecision:
        """
        Evaluate a proposed tool call against all loaded policy rules.

        Logic:
        1. Tier-1 tools → always allowed (read-only, no side effects)
        2. Tier-2 tools → allowed but logged as reversible operations
        3. Tier-3 tools → check rules; if any rule requires HITL, escalate
        4. If any rule explicitly denies the action, deny it outright

        Args:
            tool_id: The tool being called
            tier: The tool's permission tier
            input_payload: The tool call arguments

        Returns:
            PolicyDecision with allow/deny/escalate result
        """
        decision = PolicyDecision(allowed=True)

        # Deletion execution accepts either name. Never approve one identifier
        # while the gateway executes a different one.
        if tool_id == "salesforce_delete_field":
            identifiers = [
                input_payload[key].strip()
                for key in ("field_name", "field_api_name")
                if isinstance(input_payload.get(key), str) and input_payload[key].strip()
            ]
            if len(set(identifiers)) > 1:
                decision.allowed = False
                decision.denial_reasons.append(
                    "Conflicting field_name and field_api_name; both must identify the same field."
                )

        # ── Tier-1 tools are always allowed ───────────────────
        if tier == ToolTier.TIER_1:
            decision.matched_rules.append("implicit_tier1_allow")
            return decision

        # ── Find applicable rules ─────────────────────────────
        applicable_rules = [
            r for r in self.rules
            if r.action == "all_tools" or r.action == tool_id
        ]

        for rule in applicable_rules:
            decision.matched_rules.append(rule.rule_id)

            # Check time_window restriction
            if rule.time_window:
                if not self._check_time_window(rule.time_window):
                    decision.allowed = False
                    decision.denial_reasons.append(
                        f"Rule {rule.rule_id}: outside allowed time window"
                    )

            # Check for deny conditions (e.g., protected fields, objects)
            deny_conditions = rule.conditions.get("deny_if", [])
            for condition in deny_conditions:
                if self._check_deny_condition(condition, input_payload):
                    decision.allowed = False
                    decision.denial_reasons.append(
                        f"Rule {rule.rule_id}: deny condition matched — {condition}"
                    )

            # Check rate limits — fail closed on DB error
            if rule.max_operations is not None:
                try:
                    from control_plane.database import SessionLocal
                    from control_plane.models import Proposal, ProposalStatus

                    with SessionLocal() as rate_db:
                        window_start = datetime.now(timezone.utc) - timedelta(hours=1)
                        recent_count = (
                            rate_db.query(Proposal)
                            .filter(
                                Proposal.tool_id == tool_id,
                                Proposal.status.in_([
                                    ProposalStatus.COMPLETED,
                                    ProposalStatus.EXECUTING,
                                ]),
                                Proposal.executed_at >= window_start,
                            )
                            .count()
                        )

                    if recent_count >= rule.max_operations:
                        decision.allowed = False
                        decision.denial_reasons.append(
                            f"Rule {rule.rule_id}: rate limit exceeded — "
                            f"{recent_count}/{rule.max_operations} executions in last hour"
                        )
                except Exception as exc:
                    # Fail closed: deny if we can't verify the rate limit
                    logger.error(f"Rate limit check failed for rule {rule.rule_id}: {exc} — denying")
                    decision.allowed = False
                    decision.denial_reasons.append(
                        f"Rule {rule.rule_id}: rate limit check failed (fail-closed) — {exc}"
                    )

            # Check HITL requirement
            if rule.requires_hitl:
                decision.requires_human_approval = True

        # ── Tier-3 always requires HITL even without explicit rules ──
        if tier == ToolTier.TIER_3 and not decision.requires_human_approval:
            decision.requires_human_approval = True
            decision.matched_rules.append("implicit_tier3_hitl_requirement")

        # ── Audit-only mode: allow everything but log ─────────
        # Tier-3 HITL requirement is preserved even in audit_only
        if self._mode == "audit_only":
            if not decision.allowed:
                logger.warning(
                    f"AUDIT_ONLY: Would have denied {tool_id} — {decision.denial_reasons}"
                )
            decision.allowed = True
            # Do NOT clear requires_human_approval — Tier-3 always needs a human

        # ── Dry-run mode: always deny ─────────────────────────
        if self._mode == "dry_run":
            decision.allowed = False
            decision.denial_reasons.append("Policy mode is dry_run — no executions permitted")

        return decision

    @staticmethod
    def _check_time_window(time_window: dict) -> bool:
        """Check if the current time falls within the allowed window."""
        import zoneinfo

        tz_name = time_window.get("timezone", "UTC")
        try:
            tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            logger.warning(f"Invalid timezone '{tz_name}' in time_window; treating as UTC")
            tz = zoneinfo.ZoneInfo("UTC")

        now = datetime.now(tz)

        allowed_days = time_window.get("allowed_days", [])
        if allowed_days:
            day_abbr = now.strftime("%a")  # Mon, Tue, ...
            if day_abbr not in allowed_days:
                return False

        allowed_start = time_window.get("start_hour")
        allowed_end = time_window.get("end_hour")
        if allowed_start is not None and allowed_end is not None:
            current_hour = now.hour
            if not (int(allowed_start) <= current_hour < int(allowed_end)):
                return False

        return True

    @staticmethod
    def _check_deny_condition(condition: dict, payload: dict) -> bool:
        """
        Evaluate a single deny condition against the tool input payload.

        Supported condition types:
        - is_custom_field: false  → deny if field is not custom (no __c suffix)
        - is_managed_package: true → deny if field belongs to a managed package
        - field_name_matches: <regex> → deny if field name matches pattern
        - object_name_matches: <regex> → deny if object name matches pattern
        - protected_objects: [list] → deny if object is in the protected list
        """
        field_name = next(
            (payload[key].strip() for key in ("field_name", "field_api_name")
             if isinstance(payload.get(key), str) and payload[key].strip()),
            "",
        )

        object_name = next(
            (payload[key].strip() for key in ("object_name", "object_api_name", "object", "sobject", "target")
             if isinstance(payload.get(key), str) and payload[key].strip()),
            "",
        )

        if "is_custom_field" in condition:
            if condition["is_custom_field"] is False and field_name.endswith("__c"):
                return False  # It IS custom, so this deny doesn't apply
            if condition["is_custom_field"] is False and not field_name.endswith("__c"):
                return True  # Not custom → deny

        if "is_managed_package" in condition:
            # Managed package fields have namespace__FieldName__c pattern
            if condition["is_managed_package"] is True and "__" in field_name.removesuffix("__c"):
                return True

        if "field_name_matches" in condition:
            pattern = condition["field_name_matches"]
            if re.match(pattern, field_name):
                return True

        if "object_name_matches" in condition:
            pattern = condition["object_name_matches"]
            if re.match(pattern, object_name):
                return True

        if "protected_objects" in condition:
            protected = [o.strip().casefold() for o in condition["protected_objects"]]
            if object_name.casefold() in protected:
                return True

        return False


# ── Module-level singleton ────────────────────────────────────
policy_engine = PolicyEngine()
