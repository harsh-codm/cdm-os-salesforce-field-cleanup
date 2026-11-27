"""End-to-end test of the governed Tier-3 field deletion flow.

    propose -> policy evaluation -> human approval -> execution via Tool Gateway
    (MCP -> Salesforce) -> signed, hash-chained audit trail

Also exercises the guard rails: executing before approval, rejecting, executing
twice, and attempting to delete a standard field.

Safety: by default the script refuses to run unless the Tool Gateway reports
SF_MOCK_MODE (is_mock=true). To run against a real org you must pass
--allow-real AND name a throwaway custom field with --field; the script never
picks a real field on its own.

Usage:
    python scripts/e2e_field_deletion.py
    python scripts/e2e_field_deletion.py --allow-real --object Account --field CDM_E2E_Test__c

Exit code is 0 only if every check passes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

CP = "http://localhost:8000/api/v1"
GW = "http://localhost:8080"


def _service_key() -> str:
    """GATEWAY_SERVICE_KEY from the environment, else from the repo's .env."""
    import os
    from pathlib import Path

    if os.environ.get("GATEWAY_SERVICE_KEY"):
        return os.environ["GATEWAY_SERVICE_KEY"]
    env = Path(__file__).resolve().parents[1] / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("GATEWAY_SERVICE_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


SERVICE_KEY = _service_key()
AGENT_NAME = "e2e-field-cleanup-agent"


@dataclass
class Report:
    checks: list[tuple[str, bool, str]] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append((name, ok, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))
        return ok

    @property
    def ok(self) -> bool:
        return all(ok for _, ok, _ in self.checks)


def call(method: str, url: str, body: Any = None, timeout: float = 120) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if url.startswith(GW) and SERVICE_KEY:
        headers["X-Service-Key"] = SERVICE_KEY  # the gateway is service-to-service only
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw


def ensure_agent() -> str:
    status, agents = call("GET", f"{CP}/agents/")
    if status == 200:
        for agent in agents:
            if agent.get("agent_id") == AGENT_NAME:
                return agent["agent_id"]
    status, created = call("POST", f"{CP}/agents/", {"agent_id": AGENT_NAME, "name": AGENT_NAME, "description": "E2E field deletion test agent", "owner": "e2e"})
    if status not in (200, 201):
        raise SystemExit(f"Could not register test agent: HTTP {status} {created}")
    return created["agent_id"]


def propose(agent_id: str, org_id: str, obj: str, fld: str, reason: str) -> tuple[int, Any]:
    return call("POST", f"{CP}/proposals/", {
        "agent_id": agent_id,
        "org_id": org_id,
        "tool_id": "salesforce_delete_field",
        "input_payload": {"object_name": obj, "field_name": fld, "confirm_delete": True, "reason": reason},
    })


def wait_terminal(proposal_id: str, timeout: float = 180) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        _, p = call("GET", f"{CP}/proposals/{proposal_id}")
        if p.get("status") not in ("EXECUTING", "HUMAN_APPROVED", "POLICY_APPROVED"):
            return p
        time.sleep(1.5)
    return p


def field_exists(obj: str, fld: str) -> tuple[bool | None, str]:
    status, body = call("POST", f"{GW}/tools/salesforce/field-metadata", {"object_name": obj, "field_name": fld})
    if status == 200:
        return True, "metadata returned"
    text = json.dumps(body) if not isinstance(body, str) else body
    if "not found" in text.lower():
        return False, "not found"
    return None, f"HTTP {status}: {text[:160]}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="Account")
    ap.add_argument("--field", default=None, help="custom field to delete (required with --allow-real)")
    ap.add_argument("--reject-field", default=None, help="field used for the reject path (default: a mock field)")
    ap.add_argument("--org-id", default="00DE2ETEST0000001")
    ap.add_argument("--allow-real", action="store_true")
    args = ap.parse_args()
    r = Report()

    print("\n== Preflight")
    _, cp_health = call("GET", "http://localhost:8000/health")
    r.check("Control Plane healthy", isinstance(cp_health, dict) and cp_health.get("status") == "ok", json.dumps(cp_health)[:120])
    status, gw = call("GET", f"{GW}/health/salesforce")
    sf = (gw or {}).get("salesforce", {}) if isinstance(gw, dict) else {}
    r.check("Tool Gateway -> MCP -> Salesforce reachable", status == 200 and sf.get("salesforce_connected") is True, f"HTTP {status}, org_type={sf.get('org_type')}")
    is_mock = sf.get("is_mock") is True
    if not is_mock and not args.allow_real:
        print("\nRefusing to run: the gateway is connected to a REAL org. Use --allow-real with --field <throwaway__c>.")
        return 2
    if not is_mock and not args.field:
        print("\n--allow-real requires --field naming a throwaway custom field.")
        return 2
    target = args.field or "Legacy_Cleanup_Test__c"
    reject_target = args.reject_field or ("Legacy_Notes__c" if is_mock else None)
    print(f"   mode={'MOCK' if is_mock else 'REAL ORG'}  target={args.object}.{target}")

    exists, how = field_exists(args.object, target)
    r.check("Target field exists before deletion", exists is True, how)

    agent_id = ensure_agent()
    print(f"   agent_id={agent_id}")

    # ---------------------------------------------------------------- happy path
    print("\n== Happy path: propose -> approve -> execute")
    status, p = propose(agent_id, args.org_id, args.object, target, "E2E: unused legacy field")
    if not r.check("Proposal created (HTTP 201)", status == 201, f"HTTP {status}"):
        print(json.dumps(p, indent=2)[:800])
        return 1
    pid = p["id"]
    r.check("Classified as Tier-3", p.get("tier") in ("Tier-3", "TIER_3"), p.get("tier"))
    r.check("Policy routes it to PENDING_HUMAN_APPROVAL", p.get("status") == "PENDING_HUMAN_APPROVAL", p.get("status"))

    _, queue = call("GET", f"{CP}/proposals/queue/pending")
    r.check("Appears in the human approval queue", any(q["id"] == pid for q in queue))

    status, _ = call("POST", f"{CP}/proposals/{pid}/execute")
    r.check("Execute BEFORE approval is refused", status in (400, 403, 409), f"HTTP {status}")

    status, _ = propose(agent_id, args.org_id, args.object, target, "duplicate")
    r.check("Duplicate pending proposal for same field is refused", status in (400, 409), f"HTTP {status}")

    status, decided = call("PUT", f"{CP}/proposals/{pid}/decide", {"decision": "APPROVED", "reason": "E2E approval"})
    r.check("Human approval accepted", status == 200 and decided.get("status") == "HUMAN_APPROVED", f"HTTP {status} {decided.get('status') if isinstance(decided, dict) else decided}")

    status, _ = call("PUT", f"{CP}/proposals/{pid}/decide", {"decision": "REJECTED"})
    r.check("Second decision on same proposal is refused", status == 409, f"HTTP {status}")

    status, _ = call("POST", f"{CP}/proposals/{pid}/execute")
    r.check("Execution dispatched", status in (200, 202), f"HTTP {status}")
    final = wait_terminal(pid)
    r.check("Proposal reaches COMPLETED", final.get("status") == "COMPLETED", f"{final.get('status')} {final.get('error_message') or ''}"[:200])
    result = final.get("execution_result") or {}
    r.check("Gateway reports field DELETED", result.get("status") == "DELETED", json.dumps(result)[:200])
    r.check("Definition backed up before delete (backup_id)", bool(result.get("backup_id")), str(result.get("backup_id")))

    status, _ = call("POST", f"{CP}/proposals/{pid}/execute")
    r.check("Re-executing a completed proposal is refused", status in (400, 409), f"HTTP {status}")

    if is_mock:
        print("   (mock mode: each MCP call starts a fresh mock org, so post-delete absence is not re-checked)")
    else:
        exists, how = field_exists(args.object, target)
        r.check("Field no longer exists in the org", exists is False, how)

    # ---------------------------------------------------------------- reject path
    if reject_target:
        print("\n== Reject path: propose -> reject")
        status, p2 = propose(agent_id, args.org_id, args.object, reject_target, "E2E: should be rejected")
        if r.check("Second proposal created", status == 201, f"HTTP {status}"):
            pid2 = p2["id"]
            status, d2 = call("PUT", f"{CP}/proposals/{pid2}/decide", {"decision": "REJECTED", "reason": "E2E rejection"})
            r.check("Human rejection accepted", status == 200 and d2.get("status") == "HUMAN_REJECTED", f"HTTP {status}")
            status, _ = call("POST", f"{CP}/proposals/{pid2}/execute")
            r.check("Executing a rejected proposal is refused", status in (400, 409), f"HTTP {status}")
            exists, how = field_exists(args.object, reject_target)
            r.check("Rejected field still exists", exists is True, how)

    # ---------------------------------------------------------------- guard rail
    print("\n== Guard rail: standard field")
    status, p3 = propose(agent_id, args.org_id, args.object, "Name", "E2E: must never delete a standard field")
    if status == 201 and p3.get("status") == "PENDING_HUMAN_APPROVAL":
        call("PUT", f"{CP}/proposals/{p3['id']}/decide", {"decision": "APPROVED", "reason": "E2E guard-rail probe"})
        call("POST", f"{CP}/proposals/{p3['id']}/execute")
        f3 = wait_terminal(p3["id"])
        r.check("Standard field delete fails at the gateway", f3.get("status") == "FAILED", f"{f3.get('status')}: {(f3.get('error_message') or '')[:140]}")
    else:
        r.check("Standard field delete blocked at proposal time", status in (400, 403, 422) or p3.get("status") == "POLICY_DENIED", f"HTTP {status} {p3.get('status') if isinstance(p3, dict) else ''}")

    # ---------------------------------------------------------------- bypass
    print("\n== Guard rail: calling the gateway directly (no Control Plane grant)")
    # A field that does not exist, so even an unguarded gateway cannot delete anything.
    probe = {"object_name": args.object, "field_name": "CDM_E2E_No_Such_Field__c", "confirm_delete": True}
    status, _ = call("POST", f"{GW}/tools/salesforce/delete", probe)
    if status in (401, 403):
        r.check("Gateway refuses a delete without an execution grant", True, f"HTTP {status}")
    else:
        print(f"   WARN: gateway accepted an ungranted delete call (HTTP {status}). "
              "Set EXECUTION_GRANT_SECRET (same value) for both services to enforce grants.")

    # ---------------------------------------------------------------- audit
    print("\n== Audit trail")
    _, events = call("GET", f"{CP}/audit/?proposal_id={pid}&limit=100")
    if isinstance(events, list):
        mine = [e for e in events if str(e.get("proposal_id")) == pid]
        types = [e.get("event_type") for e in sorted(mine, key=lambda e: e.get("created_at", ""))]
        print(f"   events for {pid}: {types}")
        for needed in ("PROPOSAL_CREATED", "TOOL_EXECUTED"):
            r.check(f"Audit has {needed}", needed in types)
        r.check("Audit has the human decision", any("DECI" in (t or "") or "APPROV" in (t or "") for t in types))
        r.check("Every event is HMAC-signed", all(e.get("signature") or e.get("hmac_signature") for e in mine), f"{len(mine)} events")
    else:
        r.check("Audit events readable", False, str(events)[:160])
    status, chain = call("GET", f"{CP}/audit/verify-chain")
    r.check("Audit hash chain verifies", status == 200 and (chain.get("valid") is True or chain.get("status") in ("ok", "valid")), json.dumps(chain)[:200])

    passed = sum(1 for _, ok, _ in r.checks if ok)
    print(f"\n== {passed}/{len(r.checks)} checks passed")
    return 0 if r.ok else 1


if __name__ == "__main__":
    sys.exit(main())
