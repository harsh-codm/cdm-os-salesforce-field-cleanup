# CDM-OS — Vision & Roadmap

> This file holds the long-term vision for CDM-OS.  The README covers what
> exists today; this document covers where the project is headed.

## Seven-Layer Architecture (Target State)

```
┌─────────────────────────────────────┐
│ 1. Human & Governance Layer         │  Approval UI, Guardian dashboard
├─────────────────────────────────────┤
│ 2. Agent Control Plane              │  Policy engine, proposals, audit
├─────────────────────────────────────┤
│ 3. Agent Runtime                    │  Sandboxed agent execution
├─────────────────────────────────────┤
│ 4. Intelligence / Model Gateway     │  Hot-swappable LLM abstraction
├─────────────────────────────────────┤
│ 5. Knowledge / Memory / Precedents  │  RAG, vector store, runbooks
├─────────────────────────────────────┤
│ 6. Tool & Infrastructure Layer      │  MCP servers, Terraform, IAM
├─────────────────────────────────────┤
│ 7. Observability / Security / FinOps│  Metrics, cost tracking, drift
└─────────────────────────────────────┘
```

**Currently implemented:** Layers 1 (partial — Next.js approval UI), 2 (Control Plane), and 6 (Tool Gateway for Salesforce).

## Future Capabilities

- **Agent Runtime** — sandboxed execution environment with resource limits
- **Model Gateway** — hot-swappable LLM abstraction with rate limiting and cost budgets
- **Knowledge Plane** — RAG pipeline, agent memory, precedent store
- **Multi-domain Tool Servers** — AWS, GitHub, Jira, Kubernetes MCP servers
- **Digital Boardroom** — arbitration when agents disagree
- **Kill Switch** — centralized emergency stop (agent, pod, capability, or global)
- **Agent Graduation** — Tier 1 → 2 → 3 with evaluation tests and shadow mode
- **Drift Detection** — regression tests for behavioral changes from model/prompt updates

## Key Concepts (Target)

| Concept | Definition |
|---|---|
| **Guardian** | Human responsible for an individual agent or agent pod |
| **Skill Lead** | Human responsible for a domain (e.g., SRE Skill Lead) |
| **AIGB** | AI Governance Board — approves Tier 3 graduation, high-risk capabilities |
| **Digital Boardroom** | Arbitration mechanism when agents disagree |
| **Kill Switch** | Centralized stop — individual agent, pod, capability, or global |
| **Hot-Swappable Brain** | Model Gateway abstraction — change provider without touching agents |
| **Agent Multiplier** | Metric: does the agent save more value than it costs? |
| **Drift** | Behavioral change from model/prompt/knowledge updates |
| **Precedent** | Historical decision with TTL — agents reference but don't blindly follow |
