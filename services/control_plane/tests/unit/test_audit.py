"""
CDM-OS — Audit Logger Unit Tests

Entries are produced with record_event (the real writer) so the tests exercise
the same signing scheme the database rows use.
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from control_plane.audit import _compute_hmac, record_event, verify_chain, verify_entry
from control_plane.models import AuditLog
from control_plane.routes.audit import AuditVerificationRequest, verify_audit_logs


def _writer_db(prev_signature=None):
    """A session stub whose 'latest entry' is prev_signature (None = genesis)."""
    db = MagicMock()
    db.query.return_value.order_by.return_value.first.return_value = (
        (prev_signature,) if prev_signature else None
    )
    return db


def _write(payload, prev=None, event="TEST_EVENT"):
    entry = record_event(_writer_db(prev), event, "test-agent", payload, proposal_id=uuid4())
    entry.id = uuid4()
    return entry


def _chain_db(entries):
    db = MagicMock()
    db.query.return_value.order_by.return_value.limit.return_value.all.return_value = entries
    return db


def test_hmac_computation():
    message = b'{"action": "delete_field"}'
    sig1 = _compute_hmac(message)
    sig2 = _compute_hmac(message)

    assert sig1 == sig2
    assert len(sig1) == 64  # SHA256 hex digest length


def test_entry_written_by_record_event_verifies():
    # Regression: verify_entry re-added _prev_hash to the signed payload, so no
    # entry written by record_event could ever verify.
    entry = _write({"event": "TEST", "value": 123})
    assert verify_entry(entry) is True


def test_verify_entry_detects_payload_tampering():
    entry = _write({"event": "TEST", "value": 123})
    entry.payload = {**entry.payload, "value": 999}
    assert verify_entry(entry) is False


def test_verify_entry_detects_column_tampering():
    entry = _write({"event": "TEST"})
    entry.actor = "someone-else"
    assert verify_entry(entry) is False


def test_chain_of_record_event_entries_verifies():
    first = _write({"n": 1})
    second = _write({"n": 2}, prev=first.hmac_signature)
    third = _write({"n": 3}, prev=second.hmac_signature)
    result = verify_chain(_chain_db([first, second, third]))
    assert result == {"valid": True, "checked": 3, "legacy_unverified": 0, "broken_at": None}


def test_chain_detects_a_deleted_entry():
    first = _write({"n": 1})
    second = _write({"n": 2}, prev=first.hmac_signature)
    third = _write({"n": 3}, prev=second.hmac_signature)
    result = verify_chain(_chain_db([first, third]))
    assert result["valid"] is False
    assert result["broken_at"] == str(third.id)


def test_legacy_rows_before_the_chain_are_skipped_but_reported():
    legacy = AuditLog(
        id=uuid4(), event_type="OLD", actor="system", payload={"old": True},
        hmac_signature="a" * 64, created_at=datetime.now(UTC),
    )
    chained = _write({"n": 1}, prev=legacy.hmac_signature)
    result = verify_chain(_chain_db([legacy, chained]))
    assert result == {"valid": True, "checked": 2, "legacy_unverified": 1, "broken_at": None}


def test_unchained_row_after_the_chain_started_is_a_break():
    first = _write({"n": 1})
    stripped = _write({"n": 2}, prev=first.hmac_signature)
    stripped.payload = {k: v for k, v in stripped.payload.items() if k != "_prev_hash"}
    result = verify_chain(_chain_db([first, stripped]))
    assert result["valid"] is False
    assert result["broken_at"] == str(stripped.id)


def test_audit_verification_reports_each_requested_record():
    valid = _write({"action": "deprecate"})
    invalid = _write({"action": "deprecate"})
    invalid.payload = {**invalid.payload, "action": "delete"}
    missing = _write({"action": "deprecate"})
    missing.hmac_signature = None
    absent_id = uuid4()
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = [valid, invalid, missing]
    result = verify_audit_logs(
        AuditVerificationRequest(ids=[valid.id, invalid.id, missing.id, absent_id]), identity=None, db=db
    )
    assert [entry["status"] for entry in result["results"]] == ["Verified", "Invalid", "Missing", "Not found"]
    assert result["scope"] == "Full row (all columns + hash chain link)"
    assert all(set(entry) == {"id", "status"} for entry in result["results"])


def test_audit_verification_request_is_bounded():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        AuditVerificationRequest(ids=[])
    with pytest.raises(ValidationError):
        AuditVerificationRequest(ids=[uuid4() for _ in range(501)])
