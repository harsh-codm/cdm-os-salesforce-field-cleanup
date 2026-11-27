"""
CDM-OS — Execution grants

A grant is the Control Plane's signed statement that one specific, approved
proposal may perform one mutating Tool Gateway call. The gateway verifies it
(tool_gateway.auth) before deleting, deprecating or rolling back a field:

    signature  HMAC-SHA256 over the canonical grant (EXECUTION_GRANT_SECRET)
    binding    proposal_id, tool_id, org_id and the SHA-256 of the exact body
    lifetime   short expiry + a one-time nonce (replays are rejected)

A valid service key alone is therefore not enough to change Salesforce.
"""

import hashlib
import hmac
import json
import time
import uuid
from collections.abc import Mapping
from typing import Any

from control_plane.config import settings

GRANT_HEADER = "X-Execution-Grant"

# Tools that change Salesforce and must carry a grant.
MUTATING_TOOLS = frozenset({
    "salesforce_deprecate_field",
    "salesforce_delete_field",
    "salesforce_rollback_field",
})


def _canonical(obj: Mapping[str, Any]) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def payload_hash(body: Mapping[str, Any]) -> str:
    """Hash the request body exactly as the gateway sees it (None fields dropped)."""
    cleaned = {k: v for k, v in body.items() if v is not None}
    return hashlib.sha256(_canonical(cleaned).encode()).hexdigest()


def issue_grant(
    proposal_id: Any,
    tool_id: str,
    org_id: str,
    body: Mapping[str, Any],
    *,
    secret: str | None = None,
    ttl_sec: int | None = None,
    now: float | None = None,
) -> str | None:
    """Return the X-Execution-Grant header value, or None when grants are disabled."""
    secret = settings.EXECUTION_GRANT_SECRET if secret is None else secret
    if not secret:
        return None
    issued = time.time() if now is None else now
    grant = {
        "proposal_id": str(proposal_id),
        "tool_id": tool_id,
        "org_id": org_id,
        "payload_hash": payload_hash(body),
        "exp": int(issued + (settings.EXECUTION_GRANT_TTL_SEC if ttl_sec is None else ttl_sec)),
        "nonce": uuid.uuid4().hex,
    }
    grant["sig"] = hmac.new(secret.encode(), _canonical(grant).encode(), hashlib.sha256).hexdigest()
    return json.dumps(grant, separators=(",", ":"))
