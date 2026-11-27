"""
Execution grant verification for mutating tool-gateway endpoints.

The control plane issues short-lived, signed execution grants.  The gateway
verifies the signature, checks expiry, confirms the payload hash matches
the request, and rejects replays via a one-time nonce stored in a set.
"""

import hashlib
import hmac
import json
import logging
import time
from typing import Any, Dict, Optional, Set

from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from tool_gateway.settings import settings

logger = logging.getLogger("tool_gateway.auth")

# ---------- service credential (shared secret between CP ↔ GW) ----------

_SERVICE_KEY_HEADER = APIKeyHeader(name="X-Service-Key", auto_error=False)
_GRANT_HEADER = "X-Execution-Grant"


def _get_service_key() -> str:
    return settings.GATEWAY_SERVICE_KEY


async def verify_service_key(
    api_key: Optional[str] = Security(_SERVICE_KEY_HEADER),
) -> str:
    """FastAPI dependency — rejects requests without a valid service key."""
    expected = _get_service_key()
    if not expected:
        # No key configured — allow in development (log warning)
        logger.warning("GATEWAY_SERVICE_KEY is not set — skipping service-key check")
        return "dev-no-key"
    if not api_key or not hmac.compare_digest(api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing service key")
    return api_key


# ---------- execution grant (signed, one-time-use token from CP) ----------

_used_nonces: Set[str] = set()  # In production, back this with Redis


def _get_grant_secret() -> str:
    return settings.EXECUTION_GRANT_SECRET


def _verify_grant(grant_json: str, request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Verify an execution grant token.

    Grant format (JSON):
        {
            "proposal_id": "...",
            "tool_id": "...",
            "org_id": "...",
            "object_name": "...",
            "field_name": "...",
            "payload_hash": "<sha256 of canonical request body>",
            "exp": <unix timestamp>,
            "nonce": "<unique id>",
            "sig": "<HMAC-SHA256 hex>"
        }
    """
    secret = _get_grant_secret()
    if not secret:
        logger.warning("EXECUTION_GRANT_SECRET is not set — skipping grant check")
        return {}

    try:
        grant = json.loads(grant_json)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=401, detail=f"Malformed execution grant: {exc}")

    # Check required fields
    for key in ("proposal_id", "tool_id", "payload_hash", "exp", "nonce", "sig"):
        if key not in grant:
            raise HTTPException(status_code=401, detail=f"Execution grant missing '{key}'")

    # Verify signature
    sig = grant.pop("sig")
    canonical = json.dumps(grant, sort_keys=True, separators=(",", ":"))
    expected_sig = hmac.new(
        secret.encode(), canonical.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(status_code=401, detail="Execution grant signature invalid")

    # Check expiry
    if time.time() > grant["exp"]:
        raise HTTPException(status_code=401, detail="Execution grant expired")

    # Reject replay
    nonce = grant["nonce"]
    if nonce in _used_nonces:
        raise HTTPException(status_code=401, detail="Execution grant already used")
    _used_nonces.add(nonce)

    # Verify payload hash matches the actual request
    body_canonical = json.dumps(request_body, sort_keys=True, separators=(",", ":"))
    body_hash = hashlib.sha256(body_canonical.encode()).hexdigest()
    if not hmac.compare_digest(grant["payload_hash"], body_hash):
        raise HTTPException(
            status_code=401,
            detail="Execution grant payload hash does not match request body",
        )

    return grant


def enforce_execution_grant(
    grant_header: Optional[str],
    request_body: Dict[str, Any],
    tool_id: str,
) -> Dict[str, Any]:
    """Require a valid grant, issued for this tool, before a mutating call.

    Previously grants were verified only *if* the header was present, so any
    caller holding the service key could delete a field. Without a configured
    secret (allowed only when CDM_ENV=development — settings refuses to start
    otherwise) the check is skipped with a warning.
    """
    if not _get_grant_secret():
        logger.warning(
            "EXECUTION_GRANT_SECRET is not set — %s allowed without a grant (development only)",
            tool_id,
        )
        return {}
    if not grant_header:
        raise HTTPException(
            status_code=403,
            detail=f"Execution grant required for mutating tool '{tool_id}'.",
        )
    grant = _verify_grant(grant_header, request_body)
    if grant.get("tool_id") != tool_id:
        raise HTTPException(
            status_code=403,
            detail=f"Execution grant was issued for '{grant.get('tool_id')}', not '{tool_id}'.",
        )
    return grant


# Mutating tools that require an execution grant
MUTATING_TOOLS = {
    "salesforce_deprecate_field",
    "salesforce_delete_field",
    "salesforce_rollback_field",
}
