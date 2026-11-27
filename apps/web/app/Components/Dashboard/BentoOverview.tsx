"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Clock3,
  FileSearch,
  Link2,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApiResource } from "@/app/lib/api/useApiResource";
import { useRealtime } from "@/app/lib/ws/RealtimeProvider";
import { useConsoleNav } from "@/app/Components/Main/ConsoleNav";
import type { NavId } from "@/app/Components/Main/navigation";
import FlowField from "@/app/Components/Landing/FlowField";
import type {
  Agent as ControlPlaneAgent,
  AuditLogEntry,
  Proposal,
  ProposalStatus,
  ToolDefinition,
} from "@/types/governance";
import s from "./bento.module.css";

/* ───────────── helpers ───────────── */

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ago(iso: string | undefined, now: number) {
  if (!iso || !now) return "";
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fieldLabel(p: Proposal) {
  const obj = p.input_payload?.object_name ?? p.input_payload?.object_api_name;
  const fld = p.input_payload?.field_name ?? p.input_payload?.field_api_name;
  if (typeof obj === "string" && typeof fld === "string") return `${obj}.${fld}`;
  if (typeof p.input_payload?.backup_id === "string") return String(p.input_payload.backup_id);
  return p.tool_id;
}

const ACTION: Record<string, string> = {
  salesforce_delete_field: "Delete",
  salesforce_deprecate_field: "Deprecate",
  salesforce_rollback_field: "Rollback",
  salesforce_backup_field_def: "Backup",
  salesforce_full_field_assessment: "Assess",
};

const PIPELINE: { key: string; label: string; tone: string; statuses: (ProposalStatus | "UNKNOWN")[] }[] = [
  { key: "pending", label: "Awaiting decision", tone: s.toneAmber, statuses: ["PENDING_HUMAN_APPROVAL", "PROPOSED"] },
  { key: "approved", label: "Approved", tone: s.toneBlue, statuses: ["HUMAN_APPROVED", "POLICY_APPROVED", "DECIDED", "EXECUTING"] },
  { key: "done", label: "Completed", tone: s.toneGreen, statuses: ["COMPLETED", "ROLLED_BACK"] },
  { key: "stopped", label: "Rejected / denied", tone: s.toneMuted, statuses: ["HUMAN_REJECTED", "POLICY_DENIED"] },
  { key: "failed", label: "Failed / unknown", tone: s.toneRed, statuses: ["FAILED", "UNKNOWN"] },
];

/* ───────────── small pieces ───────────── */

/** Number that counts up to its value whenever the value changes. */
function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      el.textContent = String(value);
      shown.current = value;
      return;
    }
    const state = { v: shown.current };
    const tween = gsap.to(state, {
      v: value,
      duration: 1.1,
      ease: "power3.out",
      onUpdate: () => {
        el.textContent = String(Math.round(state.v));
      },
      onComplete: () => {
        shown.current = value;
      },
    });
    return () => {
      tween.kill();
    };
  }, [value]);
  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}

function Corners() {
  return (
    <span className={s.corners} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Tile({
  className,
  label,
  icon: Icon,
  open,
  openLabel,
  children,
}: {
  className: string;
  label: string;
  icon: LucideIcon;
  open?: NavId;
  openLabel?: string;
  children: ReactNode;
}) {
  const navigate = useConsoleNav();
  const ref = useRef<HTMLElement>(null);
  return (
    <section
      ref={ref}
      data-tile
      className={`${s.tile} ${open ? s.clickable : ""} ${className}`}
      aria-label={label}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      onClick={(e) => {
        // whole tile is a convenience target; nested buttons handle themselves
        if (!open || (e.target as HTMLElement).closest("button, a")) return;
        navigate(open);
      }}
    >
      <Corners />
      <header className={s.tileHead}>
        <span className={s.tileLabel}>
          <Icon aria-hidden="true" />
          {label}
        </span>
        {open && (
          <button type="button" className={s.open} onClick={() => navigate(open)} aria-label={openLabel ?? `Open ${label}`}>
            <ArrowUpRight aria-hidden="true" />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/** Three chained blocks; the link pulses while the chain verifies. */
function ChainStack({ state }: { state: "valid" | "broken" | "unknown" }) {
  const cube = (x: number, y: number, i: number) => {
    const S = 26;
    const dx = S * 0.866;
    const dy = S * 0.5;
    return (
      <g key={i} className={s.block} style={{ animationDelay: `${i * 0.35}s` }}>
        <polygon points={`${x - dx},${y - dy} ${x},${y} ${x},${y + S} ${x - dx},${y + dy}`} className={s.faceL} />
        <polygon points={`${x},${y} ${x + dx},${y - dy} ${x + dx},${y + dy} ${x},${y + S}`} className={s.faceR} />
        <polygon points={`${x},${y - S} ${x + dx},${y - dy} ${x},${y} ${x - dx},${y - dy}`} className={s.faceT} />
      </g>
    );
  };
  return (
    <svg viewBox="0 0 160 150" className={`${s.chain} ${state === "broken" ? s.chainBroken : ""}`} aria-hidden="true">
      <path d="M80 26 V124" className={s.chainLink} />
      {[cube(80, 112, 2), cube(80, 72, 1), cube(80, 32, 0)]}
    </svg>
  );
}

/* ───────────── page ───────────── */

export default function BentoOverview() {
  const root = useRef<HTMLDivElement>(null);
  const { status: realtime, last } = useRealtime();
  const agentsSource = useApiResource<ControlPlaneAgent[]>("/agents/", []);
  const proposalsSource = useApiResource<Proposal[]>("/proposals/", []);
  const toolsSource = useApiResource<ToolDefinition[]>("/tools/", []);
  const auditSource = useApiResource<AuditLogEntry[]>("/audit/", []);
  const chainSource = useApiResource<{ valid?: boolean; checked?: number; legacy_unverified?: number } | null>(
    "/audit/verify-chain",
    null,
  );
  const navigate = useConsoleNav();

  // Clock for relative times ("5m ago"); ticks so labels stay fresh.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 30000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const agents = agentsSource.data;
  const proposals = proposalsSource.data;
  const tools = toolsSource.data;
  const events = auditSource.data;

  const online = agents.filter((a) => ["active", "running"].includes(a.status.toLowerCase())).length;
  const pending = proposals.filter((p) => p.status === "PENDING_HUMAN_APPROVAL");
  const tier3Pending = pending.filter((p) => p.tier === "Tier-3").length;

  const pipeline = PIPELINE.map((group) => ({
    ...group,
    count: proposals.filter((p) => (group.statuses as string[]).includes(p.status)).length,
  }));
  const pipelineTotal = Math.max(1, pipeline.reduce((n, g) => n + g.count, 0));

  // proposals created per day, last 14 days
  const spark = useMemo(() => {
    const days = Array.from({ length: 14 }, () => 0);
    const dayMs = 86400000;
    const start = Math.floor(now / dayMs) - 13;
    for (const p of proposals) {
      const d = Math.floor(new Date(p.created_at).getTime() / dayMs) - start;
      if (d >= 0 && d < 14) days[d] += 1;
    }
    const max = Math.max(1, ...days);
    return { days, max };
  }, [proposals, now]);

  const tiers = (["Tier-1", "Tier-2", "Tier-3"] as const).map((t) => ({
    tier: t,
    count: tools.filter((tool) => tool.tier === t).length,
  }));

  const chain = chainSource.data;
  const chainState: "valid" | "broken" | "unknown" =
    chain && typeof chain.valid === "boolean" ? (chain.valid ? "valid" : "broken") : "unknown";

  const gaugeCirc = 2 * Math.PI * 42;
  const gaugeRatio = agents.length ? online / agents.length : 0;

  const loading = [agentsSource, proposalsSource, toolsSource, auditSource].some((r) => r.loading);
  const error = [agentsSource, proposalsSource, toolsSource, auditSource].find((r) => r.error)?.error ?? null;
  const reloadAll = () => {
    agentsSource.reload();
    proposalsSource.reload();
    toolsSource.reload();
    auditSource.reload();
    chainSource.reload();
  };

  // Entrance: tiles rise out of a blur, staggered, like the landing page.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-tile]",
        { opacity: 0, y: 24, filter: "blur(8px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.9, stagger: 0.06, ease: "power3.out", clearProps: "filter,transform" },
      );
      gsap.fromTo(
        "[data-line]",
        { yPercent: 70, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.1, stagger: 0.12, ease: "power3.out", delay: 0.2 },
      );
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <div className={s.root} ref={root}>
      {(loading || error) && (
        <div className={`${s.notice} ${error ? s.noticeError : ""}`} role="status">
          {error ? (
            <>
              <span>Live data unavailable ({error}).</span>
              <button type="button" onClick={reloadAll}>
                Retry
              </button>
            </>
          ) : (
            <span>Connecting to the control plane…</span>
          )}
        </div>
      )}

      <div className={s.grid}>
        {/* ── Hero ── */}
        <section data-tile className={`${s.tile} ${s.hero}`} aria-label="Overview">
          <div className={s.heroBg} aria-hidden="true">
            <FlowField className={s.flow} seed={1.7} intensity={0.75} crest={0.3} interactive />
          </div>
          <Corners />
          <div className={s.heroTop}>
            <span className={s.chip}>Guardian overview</span>
            <span className={s.live}>
              <i className={realtime === "connected" ? s.dotOn : s.dotIdle} />
              Realtime {realtime}
            </span>
          </div>
          <h1 className={s.heroTitle}>
            <span className={s.lineMask}>
              <span data-line>The model proposes.</span>
            </span>
            <span className={s.lineMask}>
              <span data-line className={s.dim}>
                You decide.
              </span>
            </span>
          </h1>
          <div className={s.heroFoot}>
            <div className={s.heroStat}>
              <CountUp value={pending.length} className={s.heroNum} />
              <span>
                awaiting your decision
                {tier3Pending > 0 && <em> · {tier3Pending} Tier-3</em>}
              </span>
            </div>
            <div className={s.heroActions}>
              <button type="button" className={s.cta} onClick={() => navigate("ApprovalQueue")}>
                Review queue <ArrowUpRight aria-hidden="true" />
              </button>
              <button type="button" className={s.ctaGhost} onClick={() => navigate("FieldTools")}>
                Scan fields <ArrowUpRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        {/* ── Pending decisions ── */}
        <Tile className={s.pending} label="Pending decisions" icon={Clock3} open="ApprovalQueue">
          <div className={s.bigRow}>
            <CountUp value={pending.length} className={s.big} />
            <span className={s.bigNote}>{pending.length ? "need a human" : "queue is clear"}</span>
          </div>
          <ul className={s.list}>
            {pending.slice(0, 3).map((p) => (
              <li key={p.id} className={s.listItem}>
                <span className={`${s.tier} ${p.tier === "Tier-3" ? s.tier3 : p.tier === "Tier-2" ? s.tier2 : ""}`}>
                  {p.tier.replace("Tier-", "T")}
                </span>
                <span className={s.listMain}>
                  <b>{ACTION[p.tool_id] ?? p.tool_id}</b> {fieldLabel(p)}
                </span>
                <span className={s.listMeta}>{ago(p.created_at, now)}</span>
              </li>
            ))}
            {pending.length === 0 && <li className={s.empty}>Nothing is waiting on you.</li>}
          </ul>
        </Tile>

        {/* ── Agents gauge ── */}
        <Tile className={s.agents} label="Agents online" icon={Bot} open="Agents">
          <div className={s.gaugeWrap}>
            <svg viewBox="0 0 100 100" className={s.gauge} aria-hidden="true">
              <circle cx="50" cy="50" r="42" className={s.gaugeTrack} />
              <circle
                cx="50"
                cy="50"
                r="42"
                className={s.gaugeArc}
                style={{ strokeDasharray: gaugeCirc, strokeDashoffset: gaugeCirc * (1 - gaugeRatio) }}
              />
            </svg>
            <div className={s.gaugeCenter}>
              <CountUp value={online} className={s.gaugeNum} />
              <span>/ {agents.length}</span>
            </div>
          </div>
        </Tile>

        {/* ── Tools by tier ── */}
        <Tile className={s.tools} label="Tools" icon={Wrench} open="FieldTools">
          <CountUp value={tools.length} className={s.big} />
          <div className={s.tierBars}>
            {tiers.map((t) => (
              <div key={t.tier} className={s.tierBar}>
                <span>{t.tier.replace("Tier-", "T")}</span>
                <i>
                  <b
                    className={t.tier === "Tier-3" ? s.toneRed : t.tier === "Tier-2" ? s.toneAmber : s.toneGreen}
                    style={{ transform: `scaleX(${tools.length ? t.count / tools.length : 0})` }}
                  />
                </i>
                <em>{t.count}</em>
              </div>
            ))}
          </div>
        </Tile>

        {/* ── Pipeline ── */}
        <Tile className={s.pipeline} label="Proposal pipeline" icon={FileSearch} open="Proposals">
          <div className={s.pipeTop}>
            <div>
              <CountUp value={proposals.length} className={s.big} />
              <span className={s.bigNote}>latest proposals</span>
            </div>
            <div className={s.spark} role="img" aria-label={`Proposals per day, last 14 days: ${spark.days.join(", ")}`}>
              {spark.days.map((v, i) => (
                <i
                  key={i}
                  title={`${v} proposal${v === 1 ? "" : "s"}`}
                  className={v ? s.sparkOn : undefined}
                  style={{ height: `${Math.max(6, (v / spark.max) * 100)}%`, animationDelay: `${0.2 + i * 0.04}s` }}
                />
              ))}
            </div>
          </div>
          <div className={s.stack} aria-hidden="true">
            {pipeline.map((g) =>
              g.count ? (
                <b key={g.key} className={g.tone} style={{ flexGrow: g.count / pipelineTotal }} title={`${g.label}: ${g.count}`} />
              ) : null,
            )}
          </div>
          <ul className={s.legend}>
            {pipeline.map((g) => (
              <li key={g.key}>
                <i className={g.tone} />
                {g.label}
                <b>{g.count}</b>
              </li>
            ))}
          </ul>
        </Tile>

        {/* ── Audit integrity ── */}
        <Tile className={s.integrity} label="Audit integrity" icon={Link2} open="AuditLog">
          <div className={s.integrityBody}>
            <ChainStack state={chainState} />
            <div className={s.integrityText}>
              <strong className={chainState === "broken" ? s.bad : chainState === "valid" ? s.good : ""}>
                {chainState === "valid" ? "Chain intact" : chainState === "broken" ? "Chain broken" : "Checking…"}
              </strong>
              <span>
                <CountUp value={chain?.checked ?? 0} /> entries checked
              </span>
              {!!chain?.legacy_unverified && <span className={s.muted}>{chain.legacy_unverified} legacy (pre-chain)</span>}
              <span className={s.muted}>HMAC-signed · hash-chained</span>
            </div>
          </div>
        </Tile>

        {/* ── Activity ── */}
        <Tile className={s.activity} label="Recent activity" icon={Activity} open="AuditLog">
          <ol className={s.timeline}>
            {events.slice(0, 6).map((e, i) => (
              <li key={e.id ?? i} className={s.event} style={{ animationDelay: `${0.25 + i * 0.07}s` }}>
                <i
                  className={
                    e.event_type.includes("DENIED") || e.event_type.includes("FAILED")
                      ? s.toneRed
                      : e.event_type.includes("DECISION") || e.event_type.includes("APPROVAL")
                        ? s.toneAmber
                        : e.event_type.includes("EXECUTED")
                          ? s.toneGreen
                          : s.toneBlue
                  }
                />
                <span className={s.eventType}>{e.event_type.replaceAll("_", " ").toLowerCase()}</span>
                <span className={s.eventActor}>{e.actor}</span>
                <time className={s.listMeta}>{ago(e.created_at, now)}</time>
              </li>
            ))}
            {events.length === 0 && <li className={s.empty}>No audit events yet.</li>}
          </ol>
        </Tile>

        {/* ── Fleet ── */}
        <Tile className={s.fleet} label="Agent fleet" icon={ShieldCheck} open="Agents">
          <ul className={s.list}>
            {agents.slice(0, 5).map((a) => (
              <li key={a.id} className={s.listItem}>
                <i className={["active", "running"].includes(a.status.toLowerCase()) ? s.dotOn : s.dotIdle} />
                <span className={s.listMain}>
                  <b>{a.name}</b> {a.model_primary}
                </span>
                <span className={s.listMeta}>{a.status.toLowerCase()}</span>
              </li>
            ))}
            {agents.length === 0 && <li className={s.empty}>No agents registered.</li>}
          </ul>
          {last && <p className={s.muted}>Last event: {last.type}</p>}
        </Tile>
      </div>
    </div>
  );
}
