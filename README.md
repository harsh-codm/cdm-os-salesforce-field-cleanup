# CDM-OS — Salesforce Field Cleanup

> **The model PROPOSES. CDM-OS DECIDES. The tool EXECUTES.**

A policy-driven control plane for safely managing Salesforce custom field lifecycle — assessment, deprecation, and deletion — with deterministic policy evaluation, tiered human approval, and an immutable audit trail.

```
  Agent / LLM              Control Plane              Tool Gateway
 ┌──────────┐           ┌──────────────────┐        ┌──────────────┐
 │ Propose  │  ──────►  │ Policy Engine    │  ────► │ Salesforce   │
 │ field    │           │ Tier check       │        │ Metadata API │
 │ cleanup  │           │ Human approval?  │        │ via MCP      │
 └──────────┘           │ Audit log        │        └──────────────┘
                        └──────────────────┘
```

---

## Architecture

The system is two FastAPI services behind Docker Compose:

| Service | Port | Responsibility |
|---|---|---|
| **Control Plane** | 8000 | Proposals, policy engine, approval workflow, audit log |
| **Tool Gateway** | 8080 | Governed Salesforce MCP tool execution |

Supporting infrastructure: PostgreSQL 17 (with pgvector), Redis.

### How a Field Cleanup Works

1. **Propose** — An agent (or human) submits a proposal: "assess / deprecate / delete `Account.Legacy_Field__c`"
2. **Evaluate** — The Policy Engine checks tier, rate limits, time windows, deny rules
3. **Approve** — Tier-2 and Tier-3 actions require human approval via the governance UI
4. **Execute** — Control Plane issues an HMAC-signed execution grant to the Tool Gateway
5. **Audit** — Every step is recorded in the HMAC-signed, hash-chained audit log

### Tool Tiers

| Tier | Actions | Approval |
|---|---|---|
| **Tier 1** | Describe, assess, scan references, query usage | Policy auto-approve |
| **Tier 2** | Backup, deprecate (description change), rollback | Human approval required |
| **Tier 3** | Delete custom field | Human approval + execution grant |

---

## Repository Structure

```
cdm-os-salesforce-field-cleanup/
├── services/
│   ├── control_plane/           # FastAPI — the brain
│   │   ├── src/control_plane/
│   │   │   ├── main.py          # App entry point + lifespan
│   │   │   ├── config.py        # Settings (env vars)
│   │   │   ├── database.py      # SQLAlchemy engine + session
│   │   │   ├── models.py        # ORM models (Proposal, Agent, etc.)
│   │   │   ├── schemas.py       # Pydantic request/response DTOs
│   │   │   ├── policy_engine.py # Deterministic YAML-driven rules
│   │   │   ├── audit.py         # HMAC-signed, hash-chained audit log
│   │   │   └── routes/          # API routers
│   │   ├── database/init.sql    # DDL for PostgreSQL
│   │   ├── policies/            # YAML policy definitions
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   │
│   └── tool_gateway/            # FastAPI — governed Salesforce access
│       ├── src/tool_gateway/
│       │   ├── api/             # Endpoints + service layer
│       │   ├── auth.py          # Service-key auth + execution grants
│       │   ├── salesforce/      # SF client, metadata, scanner, etc.
│       │   └── proposals/       # Proposal-specific logic
│       ├── tests/
│       ├── Dockerfile
│       └── pyproject.toml
│
├── apps/web/                    # Next.js governance UI (landing page + console)
├── scripts/                     # Smoke tests & utilities
├── docker-compose.yml
├── Makefile
└── docs/
    └── roadmap.md               # Vision & future architecture
```

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Python 3.11+
- A Salesforce org with API access (connected app or JWT bearer flow)

### Quick Start

```bash
# 1. Clone
git clone https://github.com/harsh-codm/cdm-os-salesforce-field-cleanup.git
cd cdm-os-salesforce-field-cleanup

# 2. Configure
cp .env.example .env
# Edit .env — set Salesforce credentials, JWT secret, service key

# 3. Start everything
docker compose up -d

# Control Plane: http://localhost:8000/docs
# Tool Gateway:  http://localhost:8080/docs
```

### Development (without Docker)

```bash
# Control Plane
cd services/control_plane
pip install -e .
uvicorn control_plane.main:app --reload --port 8000

# Tool Gateway (separate terminal)
cd services/tool_gateway
pip install -e .
uvicorn tool_gateway.api:app --reload --port 8080
```

---

## Environment Variables

### Control Plane

| Variable | Required | Description |
|---|---|---|
| `CDM_ENV` | No | `development` (default) / `staging` / `production` |
| `POSTGRES_HOST` | Yes | PostgreSQL host |
| `POSTGRES_PORT` | No | Default `5432` |
| `POSTGRES_DB` | Yes | Database name |
| `POSTGRES_USER` | Yes | Database user |
| `POSTGRES_PASSWORD` | Yes | Database password (**no defaults in production**) |
| `CDM_JWT_SECRET` | Yes | JWT signing secret (**no defaults in production**) |
| `AUDIT_HMAC_SECRET` | Yes | HMAC key for audit log signing (**no defaults in production**) |
| `GATEWAY_SERVICE_KEY` | Yes | Shared secret for Control Plane → Tool Gateway auth |
| `POLICY_MODE` | No | `enforcing` (default) / `audit_only` |

### Tool Gateway

| Variable | Required | Description |
|---|---|---|
| `GATEWAY_SERVICE_KEY` | Yes | Must match the Control Plane's key |
| `SF_USERNAME` | Yes | Salesforce API user |
| `SF_PASSWORD` | Yes | Salesforce password |
| `SF_SECURITY_TOKEN` | Yes | Salesforce security token |
| `SF_DOMAIN` | No | `login` (default) or `test` for sandbox |
| `SF_CONSUMER_KEY` | No | For JWT bearer flow (preferred in production) |
| `SF_PRIVATE_KEY_PATH` | No | PEM file path for JWT bearer flow |

> **Security:** In non-development environments, the Control Plane refuses to start if any secret still has its default value.

---

## Governance UI

The Next.js app is in `apps/web/` (configure `apps/web/.env.local` from `apps/web/.env.example`):

```bash
cd apps/web
npm ci
npm run dev    # http://localhost:3000  — landing page; console at /console
```

See **[SETUP.md](SETUP.md)** for every environment variable and the full boot sequence.

Features:
- **Approval Queue** — field metadata, population stats, dependency evidence, approve/reject
- **Proposals** — status filtering, pagination, execution controls
- **Audit Trail** — filtered CSV export, printable reports, payload signature verification

---

## Field Lifecycle

```
  Custom Field
       │
       ▼
  ┌─────────┐    Tier-1    ┌───────────┐
  │  ASSESS  │ ──────────► │ Report:   │
  │          │  auto-run   │ SAFE /    │
  └─────────┘              │ REVIEW /  │
                           │ BLOCKED   │
                           └─────┬─────┘
                                 │ if SAFE or REVIEW
                                 ▼
                         ┌──────────────┐    Tier-2
                         │  DEPRECATE   │ ◄── human approval
                         │  (desc only) │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐    Tier-3
                         │   DELETE     │ ◄── human approval
                         │              │     + execution grant
                         └──────────────┘
```

---

## Security Model

- **Service-to-service auth** — `X-Service-Key` header on all Tool Gateway calls
- **Execution grants** — HMAC-SHA256 signed, one-time-use tokens with nonce replay protection
- **Atomic execution** — conditional `UPDATE` prevents double-execution race conditions
- **Fail-closed rate limiting** — DB errors → deny, not allow
- **Audit integrity** — HMAC-signed entries with hash chain; `/audit/verify-chain` endpoint
- **No default secrets** — startup validation blocks production with dev credentials
- **`.dockerignore`** — `.env` and `*.pem` excluded from images

---

## API Quick Reference

### Control Plane (`:8000`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/proposals` | Submit a new proposal |
| GET | `/api/v1/proposals` | List proposals (filterable) |
| POST | `/api/v1/proposals/{id}/approve` | Human approve a proposal |
| POST | `/api/v1/proposals/{id}/reject` | Reject a proposal |
| POST | `/api/v1/proposals/{id}/execute` | Execute an approved proposal |
| GET | `/api/v1/audit` | Query audit log |
| GET | `/api/v1/audit/verify-chain` | Verify audit log integrity |
| GET | `/health` | Liveness check |

### Tool Gateway (`:8080`)

| Method | Path | Description |
|---|---|---|
| POST | `/tools/salesforce/full-assessment` | Full field safety assessment |
| POST | `/tools/salesforce/describe` | Describe SObject metadata |
| POST | `/tools/salesforce/field-usage` | Query field population % |
| POST | `/tools/salesforce/scan-references` | Scan Apex/Flow/Layout references |
| POST | `/tools/salesforce/deprecate` | Deprecate a custom field |
| POST | `/tools/salesforce/delete` | Delete a custom field |
| POST | `/tools/salesforce/rollback` | Rollback a field description |
| POST | `/tools/execute` | Generic governed tool execution |
| GET | `/health` | Liveness check |
| GET | `/health/salesforce` | Deep Salesforce connectivity check |

---

## Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for the long-term vision including agent runtime, model gateway, knowledge plane, and multi-domain tool support.
