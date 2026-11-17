# Contributing to CDM-OS Salesforce Field Cleanup

Thank you for contributing to **CDM-OS** — an enterprise-grade Salesforce field lifecycle management system.

---

## Architecture Principles

1. **No raw credentials in agents**: Salesforce credentials are managed by the Tool Gateway. The Control Plane never touches them directly.
2. **Policy enforcement at the control plane**: Every mutating tool call requires an approved proposal that passes policy evaluation.
3. **Human-in-the-loop for destructive actions**: Tier-3 operations (delete, deprecate) require signed human approval.
4. **Tamper-evident audit logging**: Every proposal, approval, and execution produces an HMAC-signed, hash-chained audit entry.

---

## Repository Layout

| Directory | Purpose |
|---|---|
| `services/control_plane/` | Proposals, policy engine, approvals, audit, auth |
| `services/tool_gateway/` | Salesforce MCP client, field assessment, lifecycle operations |
| `apps/web/` | Next.js governance UI |
| `policy/definitions/` | YAML policy rules validated at startup |
| `deploy/` | Docker Compose (production) and dev overrides |
| `scripts/` | Smoke tests and utility scripts |
| `docs/` | Architecture docs, roadmap |

---

## Local Development

1. **Clone & configure**:
   ```bash
   cp .env.example .env
   # Fill in Salesforce credentials, or set SF_MOCK_MODE=true
   ```
2. **Start the stack**:
   ```bash
   docker compose up --build
   ```
3. **Run tests**:
   ```bash
   cd services/control_plane && pip install -e ".[dev]" && pytest
   cd services/tool_gateway && pip install -e ".[dev]" && pytest
   ```

---

## Pull Request Checklist

- [ ] PR title starts with the CR ID (e.g. `CR-P1-02: Close policy engine gaps`).
- [ ] New tool integrations have a corresponding policy rule in `policy/definitions/`.
- [ ] Tier-3 tools require human approval — no auto-approve path.
- [ ] No hardcoded secrets or API tokens in code or commit history.
- [ ] Unit tests cover the new behaviour.
- [ ] Safety-related changes (deletion, policy, auth, audit) reviewed by two people.
- [ ] `ruff check` and `mypy` pass clean.
