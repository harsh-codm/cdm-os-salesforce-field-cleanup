"""
CDM-OS Control Plane — Authentication & Authorization

Validates JWT bearer tokens and enforces role-based access control.
Roles:
  - Viewer:   read scans and audit
  - Proposer: create proposals (agent or human)
  - Approver: decide Tier-2/Tier-3 proposals
  - Admin:    policy management, kill switch
"""

import enum
import logging
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthScheme, HTTPBearer

from control_plane.config import settings

logger = logging.getLogger("control_plane.auth")

_bearer_scheme = HTTPBearer(auto_error=False)


class Role(str, enum.Enum):
    VIEWER = "viewer"
    PROPOSER = "proposer"
    APPROVER = "approver"
    ADMIN = "admin"


# Role hierarchy — higher roles inherit lower ones
_ROLE_RANK = {
    Role.VIEWER: 0,
    Role.PROPOSER: 1,
    Role.APPROVER: 2,
    Role.ADMIN: 3,
}


class Identity:
    """Decoded token identity attached to the request."""

    def __init__(
        self,
        sub: str,
        email: str,
        role: Role,
        *,
        is_agent: bool = False,
        raw_claims: Optional[dict] = None,
    ):
        self.sub = sub
        self.email = email
        self.role = role
        self.is_agent = is_agent
        self.raw_claims = raw_claims or {}

    def has_role(self, minimum: Role) -> bool:
        return _ROLE_RANK[self.role] >= _ROLE_RANK[minimum]

    def __repr__(self) -> str:
        kind = "agent" if self.is_agent else "user"
        return f"Identity({kind} {self.email!r}, role={self.role.value})"


def _decode_token(token: str) -> dict:
    """Decode and verify a JWT using the configured secret."""
    try:
        return jwt.decode(
            token,
            settings.CDM_JWT_SECRET,
            algorithms=["HS256"],
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(401, f"Invalid token: {exc}")


async def get_identity(
    request: Request,
    credentials=Depends(_bearer_scheme),
) -> Identity:
    """
    FastAPI dependency — extracts and validates the bearer token.

    When CDM_AUTH_ENABLED=false (local dev), returns a default admin identity
    so endpoints work without a token.
    """
    if not settings.CDM_AUTH_ENABLED:
        return Identity(
            sub="dev-user",
            email="dev@localhost",
            role=Role.ADMIN,
            is_agent=False,
        )

    if credentials is None:
        raise HTTPException(401, "Bearer token required")

    claims = _decode_token(credentials.credentials)

    sub = claims.get("sub", "")
    email = claims.get("email", sub)
    role_str = claims.get("role", "viewer")
    is_agent = claims.get("is_agent", False)

    try:
        role = Role(role_str)
    except ValueError:
        raise HTTPException(401, f"Unknown role: {role_str}")

    return Identity(
        sub=sub,
        email=email,
        role=role,
        is_agent=is_agent,
        raw_claims=claims,
    )


def require_role(minimum: Role):
    """
    Return a FastAPI dependency that enforces a minimum role level.

    Usage:
        @router.post("/execute", dependencies=[Depends(require_role(Role.APPROVER))])
    """
    async def _check(identity: Identity = Depends(get_identity)):
        if not identity.has_role(minimum):
            raise HTTPException(
                403,
                f"Requires role '{minimum.value}' or higher; you have '{identity.role.value}'.",
            )
        return identity
    return _check


def require_human(identity: Identity = Depends(get_identity)) -> Identity:
    """Dependency that rejects agent tokens — only human users may call the endpoint."""
    if identity.is_agent:
        raise HTTPException(403, "This endpoint requires a human user, not an agent.")
    return identity
