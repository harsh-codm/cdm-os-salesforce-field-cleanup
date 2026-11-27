"""Execution grants: Control Plane issuer <-> Tool Gateway verifier.

Uses the real issuer (control_plane.execution_grant) so the two services can't
drift apart on canonicalisation or hashing.
"""

import pytest
from fastapi import HTTPException
from tool_gateway import auth

grants = pytest.importorskip("control_plane.execution_grant")

SECRET = "test-grant-secret"
DELETE = "salesforce_delete_field"


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setattr(auth.settings, "EXECUTION_GRANT_SECRET", SECRET)
    auth._used_nonces.clear()


def _body(**overrides):
    body = {"object_name": "Account", "field_name": "Old__c", "confirm_delete": True, "reason": None}
    body.update(overrides)
    return body


def _gateway_view(body):
    # What the gateway hashes: request.model_dump(exclude_none=True)
    return {k: v for k, v in body.items() if v is not None}


def _issue(body, tool=DELETE, **kw):
    return grants.issue_grant("p-1", tool, "00D000000000001", body, secret=SECRET, **kw)


def test_grant_from_control_plane_is_accepted():
    body = _body()
    grant = auth.enforce_execution_grant(_issue(body), _gateway_view(body), DELETE)
    assert grant["proposal_id"] == "p-1"
    assert grant["tool_id"] == DELETE


def test_missing_grant_is_rejected_when_secret_is_configured():
    with pytest.raises(HTTPException) as exc:
        auth.enforce_execution_grant(None, _gateway_view(_body()), DELETE)
    assert exc.value.status_code == 403


def test_grant_for_a_different_body_is_rejected():
    grant = _issue(_body(field_name="Old__c"))
    with pytest.raises(HTTPException) as exc:
        auth.enforce_execution_grant(grant, _gateway_view(_body(field_name="Revenue__c")), DELETE)
    assert exc.value.status_code == 401


def test_grant_cannot_be_replayed():
    body = _body()
    grant = _issue(body)
    auth.enforce_execution_grant(grant, _gateway_view(body), DELETE)
    with pytest.raises(HTTPException) as exc:
        auth.enforce_execution_grant(grant, _gateway_view(body), DELETE)
    assert "already used" in exc.value.detail


def test_grant_for_another_tool_is_rejected():
    body = {"object_name": "Account", "field_name": "Old__c"}
    grant = _issue(body, tool="salesforce_deprecate_field")
    with pytest.raises(HTTPException) as exc:
        auth.enforce_execution_grant(grant, body, DELETE)
    assert exc.value.status_code == 403


def test_grant_signed_with_another_secret_is_rejected():
    body = _body()
    forged = grants.issue_grant("p-1", DELETE, "00D000000000001", body, secret="not-the-secret")
    with pytest.raises(HTTPException) as exc:
        auth.enforce_execution_grant(forged, _gateway_view(body), DELETE)
    assert "signature" in exc.value.detail


def test_expired_grant_is_rejected():
    body = _body()
    old = _issue(body, ttl_sec=1, now=1_000_000.0)
    with pytest.raises(HTTPException) as exc:
        auth.enforce_execution_grant(old, _gateway_view(body), DELETE)
    assert "expired" in exc.value.detail


def test_without_a_secret_development_calls_pass_with_a_warning(monkeypatch):
    monkeypatch.setattr(auth.settings, "EXECUTION_GRANT_SECRET", "")
    assert auth.enforce_execution_grant(None, _gateway_view(_body()), DELETE) == {}


def test_control_plane_issues_nothing_without_a_secret():
    assert grants.issue_grant("p-1", DELETE, "00D", _body(), secret="") is None
