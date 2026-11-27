# CDM-OS — Setup & Boot Guide

From `git clone` to a working stack: Postgres + Redis + Control Plane + Tool Gateway
(in Docker) and the governance UI (Next.js, on your machine).

```
 Browser ──► apps/web (Next.js :3000)
               │  NEXT_PUBLIC_CONTROL_PLANE_URL (browser → CP, needs CORS)
               │  /api/salesforce/* server routes ──X-Service-Key──┐
               ▼                                                   ▼
        Control Plane :8000 ──X-Service-Key + X-Execution-Grant──► Tool Gateway :8080
        policy · approvals · audit                                 MCP (stdio) → Salesforce
               │
        Postgres :5432 · Redis :6379
```

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Git | 2.40+ | `git --version` |
| Docker Desktop (WSL2 on Windows) | 4.25+ | `docker compose version` |
| Python | 3.11+ (3.12 used in containers) | `python --version` |
| Node.js | 20 LTS+ | `node --version` |

You need Python on the host only for tests and the E2E script.

---

## 2. Environment variables

### 2.1 Root `.env` (read by Control Plane and Tool Gateway)

```bash
cp .env.example .env
```

Generate secrets with `python -c "import secrets; print(secrets.token_hex(32))"`.

| Variable | Used by | Required | Notes |
|---|---|---|---|
| `CDM_ENV` | both | yes | `development` / `staging` / `production`. Outside `development`, both services **refuse to start** while any secret below is empty or default. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | CP | yes | Must match the `postgres` service in `docker-compose.yml` (`cdm_os_db` / `cdm_admin`). |
| `POSTGRES_HOST`, `POSTGRES_PORT` | CP | no | Compose overrides the host to `postgres`. Use `localhost` when running CP on the host. |
| `REDIS_URL` | CP | no | Compose overrides it to `redis://redis:6379/0`. |
| `CDM_JWT_SECRET` | CP | yes* | Signs API bearer tokens. |
| `CDM_AUTH_ENABLED` | CP | no | `false` (default) = every call is a local dev admin. Set `true` anywhere shared. |
| `CDM_CORS_ORIGINS` | CP | no | Comma-separated UI origins. Default allows `:3000` and `:5173`. |
| `AUDIT_HMAC_SECRET` | CP | yes* | Signs the hash-chained audit log. **Changing it invalidates verification of existing rows.** |
| `GATEWAY_SERVICE_KEY` | CP, GW, web | yes* | Service-to-service key (`X-Service-Key`). The **same value** goes in the root `.env` and `apps/web/.env.local`. Empty = check disabled (dev only). |
| `EXECUTION_GRANT_SECRET` | CP, GW | yes* | Signs the one-time grants that delete, deprecate and rollback require. **Same value** for both. Empty = grants disabled (dev only). |
| `EXECUTION_GRANT_TTL_SEC` | CP | no | Grant lifetime. Default `120`. |
| `MCP_GATEWAY_URL` | CP | no | Compose overrides it to `http://tool-gateway:8080`. |
| `MCP_REQUEST_TIMEOUT_SEC`, `FIELD_ASSESSMENT_TIMEOUT_SEC` | CP | no | `30` / `180`. A timeout marks the proposal `UNKNOWN` (needs reconciliation), not `FAILED`. |
| `POLICY_MODE` | CP | no | `enforce` (default) / `audit_only` / `dry_run`. |
| `SF_MOCK_MODE` | GW | no | `true` = in-memory mock org, no Salesforce needed. Each MCP call starts a fresh mock, so changes don't persist. |
| `SF_USERNAME`, `SF_PASSWORD`, `SF_SECURITY_TOKEN` | GW | yes** | Salesforce login (option 1). |
| `SF_CONSUMER_KEY`, `SF_PRIVATE_KEY_PATH` | GW | yes** | JWT bearer flow (option 2, preferred in production). |
| `SF_DOMAIN` | GW | no | `test` = sandbox, `login` = production / Developer Edition. |
| `SF_ORG_TYPE` | GW | no | Display label override: `Developer`, `UAT`, `Sandbox`, `Production`. |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, … | CP | no | Model gateway (roadmap). Not needed for field cleanup. |

\* Required (non-default) whenever `CDM_ENV` isn't `development`.
\** One Salesforce login option is required unless `SF_MOCK_MODE=true`.

### 2.2 `apps/web/.env.local` (governance UI)

```bash
cp apps/web/.env.example apps/web/.env.local
```

| Variable | Side | Notes |
|---|---|---|
| `NEXT_PUBLIC_CONTROL_PLANE_URL` | browser | e.g. `http://localhost:8000`. The UI calls `<url>/api/v1`. The UI's own origin must be in `CDM_CORS_ORIGINS`. |
| `TOOL_GATEWAY_URL` | server | e.g. `http://localhost:8080`. Used by the `/api/salesforce/*` proxy routes. |
| `GATEWAY_SERVICE_KEY` | server | Same value as the root `.env`. **Never** prefix it with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_WS_URL` | browser | Optional realtime endpoint (no backend route yet). |

---

## 3. Boot everything

```bash
# 1. Backend stack: Postgres, Redis, Control Plane, Tool Gateway
docker compose up -d --build
docker compose ps                       # postgres/redis "healthy", both APIs "Up"

# 2. Existing database? Apply migrations (idempotent; skip on a brand-new volume).
make migrate
#   without make (PowerShell / bash):
#   docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
#     < services/control_plane/database/migrations/001_add_proposals_org_id.sql

# 3. Health checks
curl http://localhost:8000/health                                   # {"status":"ok",...}
curl http://localhost:8080/health                                   # liveness
curl -H "X-Service-Key: $GATEWAY_SERVICE_KEY" http://localhost:8080/health/salesforce
#   → "salesforce_connected": true   ("is_mock": true in mock mode)

# 4. Governance UI
cd apps/web
npm ci
npm run dev                 # http://localhost:3000   (or: npm run build && npm start)
```

- Landing page: `http://localhost:3000/`
- Console: `/console`. Shortcuts: `/approvals`, `/audit`, `/console?view=FieldTools`.
- API docs: `http://localhost:8000/docs`, `http://localhost:8080/docs`.

**No Salesforce credentials yet?** Set `SF_MOCK_MODE=true` in `.env`, then run
`docker compose up -d tool-gateway` to recreate the gateway.

**After editing `.env`**, recreate the services that read it. A plain `restart` keeps
the old environment:

```bash
docker compose up -d --force-recreate control-plane tool-gateway
```

---

## 4. Verify

```bash
# Unit tests (each service separately — both have a `tests` package)
python -m venv .venv && . .venv/bin/activate      # Windows: .\.venv\Scripts\Activate.ps1
pip install -e services/control_plane -e services/tool_gateway pytest
make test                                          # or the two pytest commands in the Makefile

# Frontend
cd apps/web && npm test && npm run lint

# End-to-end field deletion against the running stack
python scripts/e2e_field_deletion.py               # refuses to touch a real org by default
```

The E2E script checks this sequence (27 checks):

propose → Tier-3 policy → approval queue → execute-before-approval refused → duplicate refused →
human approval → second decision refused → execution with a signed grant → `DELETED` + backup →
re-execution refused → reject path → standard-field guard → gateway refuses a delete without a
grant → audit events present, HMAC-signed, hash chain valid.

Against a **real sandbox**, use a disposable custom field you created for the test:

```bash
python scripts/e2e_field_deletion.py --allow-real --object Account --field CDM_E2E_Test__c
```

---

## 5. Services & ports

| Service | URL | Purpose |
|---|---|---|
| Governance UI | `http://localhost:3000` | Landing page + console (approvals, proposals, audit) |
| Control Plane | `http://localhost:8000` (`/docs`) | Proposals, policy engine, approvals, audit, execution grants |
| Tool Gateway | `http://localhost:8080` (`/docs`) | Service-key-protected Salesforce access via MCP |
| PostgreSQL | `localhost:5432` | `cdm_os_db` |
| Redis | `localhost:6379` | Cache / pub-sub |

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `POST /proposals` → 500, log says `column "org_id" … does not exist` | Database created before CR-P1-01. Run `make migrate`. |
| Gateway `/health/salesforce` → 503 `Salesforce unreachable` | Missing `SF_*` credentials (see the gateway log), or set `SF_MOCK_MODE=true`. |
| Gateway → 401 `Invalid or missing service key` | `GATEWAY_SERVICE_KEY` differs between the root `.env`, the containers (recreate them) and `apps/web/.env.local`. |
| Execution `FAILED` with `Execution grant …` | `EXECUTION_GRANT_SECRET` differs between CP and GW, or the clocks are skewed by more than the TTL. |
| UI shows "Live data unavailable (Failed to fetch)" | CORS: add the UI origin to `CDM_CORS_ORIGINS` and recreate `control-plane`. |
| `/audit/verify-chain` reports `legacy_unverified: N` | Rows written before hash-chaining existed. Expected; everything after them is verified. |
