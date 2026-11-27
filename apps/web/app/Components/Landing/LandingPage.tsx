"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type Lenis from "lenis";
import gsap from "gsap";
import {
  ArrowUpRight,
  FileSearch,
  History,
  Network,
  OctagonX,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import FlowField from "./FlowField";
import IsoScene from "./IsoScene";
import { useLandingMotion } from "./useLandingMotion";
import s from "./landing.module.css";

/* ───────────── Content (sourced from README.md + docs/roadmap.md) ───────────── */

const NAV = [
  { id: "home", label: "Home" },
  { id: "problem", label: "Problem" },
  { id: "solutions", label: "Solutions" },
  { id: "process", label: "Process" },
  { id: "platform", label: "Platform" },
] as const;

const PROBLEMS: {
  title: [string, string];
  text: string;
  tags: string[];
  meta: string[];
  variant: 0 | 1 | 2;
}[] = [
  {
    title: ["Thousands of fields,", "nobody owns them"],
    text: "Custom fields pile up on Account, Contact and Lead. Nobody knows which are populated, which feed a Flow, and which are safe to retire.",
    tags: ["Account", "Contact", "Lead"],
    meta: ["Population %", "Flow refs", "Layouts"],
    variant: 0,
  },
  {
    title: ["Agents shouldn’t", "hold the keys"],
    text: "An LLM can find cleanup candidates fast — but letting it call the Metadata API directly turns a suggestion into an irreversible delete.",
    tags: ["Agent", "Policy", "Delete"],
    meta: ["Unbounded", "Unsigned", "Unreviewed"],
    variant: 1,
  },
  {
    title: ["Deletes with", "no paper trail"],
    text: "When a field disappears, admins can’t answer who proposed it, who approved it, what the evidence was — or how to put it back.",
    tags: ["Field__c", "Audit", "Who?"],
    meta: ["No backup", "No approver", "No log"],
    variant: 2,
  },
];

const ORBIT = [
  "Policy Engine",
  "Approval Queue",
  "Audit Log",
  "Execution Grants",
  "Dependency Viewer",
  "Salesforce MCP",
  "Field Backups",
  "Kill Switch",
];

const SOLUTIONS: {
  title: string;
  tier: string;
  text: string;
  icon: LucideIcon;
  cta: string;
  href: string;
}[] = [
  {
    title: "Assess every field",
    tier: "Tier 1 · auto-approved",
    text: "Describe, scan references and query usage across objects. Each field is graded SAFE, REVIEW or BLOCKED before anyone touches it.",
    icon: FileSearch,
    cta: "Open Field Tools",
    href: "/console?view=FieldTools",
  },
  {
    title: "Trace every dependency",
    tier: "Tier 1 · read-only",
    text: "Flows, validation rules, layouts, Apex and reports that reference a field are surfaced as evidence — attached to the proposal, not buried in a log.",
    icon: Network,
    cta: "Open Dependency Viewer",
    href: "/console?view=DependencyViewer",
  },
  {
    title: "Deprecate before you delete",
    tier: "Tier 2 · human approval",
    text: "Back up the definition, then mark the description [DEPRECATED] with a timestamp. Data stays intact and rollback is one click away.",
    icon: History,
    cta: "Review proposals",
    href: "/console?view=Proposals",
  },
  {
    title: "Delete, under control",
    tier: "Tier 3 · approval + grant",
    text: "Deletion requires a human decision and an HMAC-signed, single-use execution grant from the Control Plane to the Tool Gateway.",
    icon: Trash2,
    cta: "Open Approval Queue",
    href: "/approvals",
  },
  {
    title: "Stop everything, instantly",
    tier: "Policy · always on",
    text: "Rate limits, change windows and deny rules are evaluated deterministically from YAML — and the kill switch halts agent execution in one move.",
    icon: OctagonX,
    cta: "Open Policy Manager",
    href: "/console?view=PolicyManager",
  },
];

const BENEFITS = [
  { title: "Nothing deletes without a human", text: "Tier-2 and Tier-3 actions wait in the approval queue with the evidence attached." },
  { title: "Every step is signed", text: "Proposals, decisions and executions land in an HMAC-signed, hash-chained audit log." },
  { title: "Deterministic, not vibes", text: "The model proposes; YAML policy decides. Same input, same verdict, every time." },
  { title: "Reversible by default", text: "Definitions are backed up before change, so deprecations roll back cleanly." },
];

const PROCESS = [
  { title: "Propose", text: "An agent or an admin submits a proposal: assess, deprecate or delete Account.Legacy_Field__c." },
  { title: "Evaluate", text: "The Policy Engine checks tier, rate limits, time windows and deny rules — no model in the loop." },
  { title: "Approve", text: "Tier-2 and Tier-3 actions route to the governance UI, where a human reviews population stats and dependencies." },
  { title: "Execute", text: "The Control Plane issues a signed execution grant; the Tool Gateway calls Salesforce through MCP." },
  { title: "Audit", text: "Every step is written to the tamper-evident audit trail, exportable as CSV or a printable report." },
];

const PLATFORM = [
  { title: "Control Plane", port: ":8000", text: "FastAPI service holding proposals, the policy engine, the approval workflow and the audit log." },
  { title: "Tool Gateway", port: ":8080", text: "Governed Salesforce access — service-key auth, execution grants, metadata, scanner and backups." },
  { title: "PostgreSQL 17", port: "pgvector", text: "Proposals, approvals and the hash-chained audit log, with pgvector ready for the knowledge plane." },
  { title: "Governance UI", port: "Next.js", text: "Approval queue, proposals, dependency viewer, field tools and audit trail — the console you’re about to open." },
];

const LAYERS = [
  "Human & Governance",
  "Agent Control Plane",
  "Agent Runtime",
  "Model Gateway",
  "Knowledge & Precedents",
  "Tool & Infrastructure",
  "Observability & FinOps",
];
const LIVE_LAYERS = new Set([0, 1, 5]);

/* ───────────── Text scramble on hover (like the reference's nav/CTAs) ───────────── */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ*#%&/<>";

function scramble(node: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (node.dataset.scrambling) return;
  const original = node.dataset.text ?? node.textContent ?? "";
  node.dataset.text = original;
  node.dataset.scrambling = "1";
  const state = { p: 0 };
  gsap.to(state, {
    p: 1,
    duration: 0.45,
    ease: "none",
    onUpdate: () => {
      const reveal = Math.floor(state.p * original.length);
      node.textContent = original
        .split("")
        .map((ch, i) => (i < reveal || ch === " " ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
        .join("");
    },
    onComplete: () => {
      node.textContent = original;
      delete node.dataset.scrambling;
    },
  });
}

/* ───────────── Small building blocks ───────────── */

function Corners() {
  return (
    <>
      <span data-corner className={`${s.corner} ${s.tl}`} aria-hidden="true" />
      <span data-corner className={`${s.corner} ${s.tr}`} aria-hidden="true" />
      <span data-corner className={`${s.corner} ${s.bl}`} aria-hidden="true" />
      <span data-corner className={`${s.corner} ${s.br}`} aria-hidden="true" />
    </>
  );
}

function Num({ n }: { n: number }) {
  return (
    <span className={s.num}>
      <span className={s.numLead} aria-hidden="true" />
      <span className={s.numBox}>{String(n).padStart(2, "0")}</span>
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className={s.chip} data-fade>
      {children}
    </span>
  );
}

/** Heading whose lines reveal one by one. */
function Lines({ lines, dimFrom = 1, className = "" }: { lines: string[]; dimFrom?: number; className?: string }) {
  return (
    <h2 className={`${s.h2} ${className}`} data-lines>
      {lines.map((line, i) => (
        <span key={line} className={s.lineMask}>
          <span data-line className={`${s.line} ${i >= dimFrom ? s.dim : ""}`}>
            {line}
          </span>
        </span>
      ))}
    </h2>
  );
}

function CtaLink({
  href,
  children,
  className = "",
  ...rest
}: {
  href: string;
  children: string;
  className?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <Link
      href={href}
      className={`${s.cta} ${className}`}
      onPointerEnter={(e) => {
        const label = e.currentTarget.querySelector<HTMLElement>("[data-scramble]");
        if (label) scramble(label);
      }}
      {...rest}
    >
      <span data-scramble>{children}</span>
      <ArrowUpRight className={s.ctaIcon} aria-hidden="true" />
    </Link>
  );
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M11 13.5h7M11 17h10M11 20.5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Logo(props: Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <Link href="/" className={s.logo} aria-label="CDM-OS home" {...props}>
      <LogoMark className={s.logoMark} />
      <span className={s.logoName}>CDM-OS</span>
    </Link>
  );
}

/** Hero centrepiece: glass hexagon with radiating arrows. */
function HexHub() {
  const rays: [number, number][] = [
    [-210, -135],
    [170, -205],
    [140, -80],
    [-55, -80],
    [195, 105],
    [-130, 160],
    [-140, 80],
  ];
  return (
    <div className={s.hubWrap} data-hub aria-hidden="true">
      <svg viewBox="-260 -240 520 480" className={s.hub}>
        <defs>
          <marker id="hub-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </marker>
          <linearGradient id="hub-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {rays.map(([x, y], i) => (
          <line key={i} data-hub-ray x1="0" y1="0" x2={x} y2={y} className={s.hubRay} markerEnd="url(#hub-arrow)" />
        ))}
        <g data-hub-hex>
          <polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="url(#hub-glass)" className={s.hubHex} />
          <path d="M0 -46V0L40 23M0 0l-40 23" className={s.hubEdge} />
          <path d="M-9 -2h13M-9 5h18M-9 12h13" className={s.hubGlyph} transform="translate(2 4) skewY(-30)" />
        </g>
      </svg>
    </div>
  );
}

function Preloader() {
  const rays: [number, number][] = [
    [-160, -100],
    [130, -150],
    [150, 60],
    [-120, 120],
    [-40, -170],
    [40, 160],
  ];
  return (
    <div className={s.preloader} data-preloader aria-hidden="true">
      <svg viewBox="-200 -200 400 400" className={s.preRays}>
        {rays.map(([x, y], i) => (
          <line key={i} data-preloader-ray x1="0" y1="0" x2={x} y2={y} />
        ))}
      </svg>
      <LogoMark className={s.preLogo} />
      <span className={s.preCount} data-preloader-count>
        000%
      </span>
    </div>
  );
}

/* ───────────── Page ───────────── */

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string>("home");
  const [openSolution, setOpenSolution] = useState(0);

  useLandingMotion(rootRef, {
    onLenis: (l) => {
      lenisRef.current = l;
    },
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Highlight the nav item for the section in view.
  useEffect(() => {
    const sections = NAV.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Accordion: animate panel heights.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelRefs.current.forEach((panel, i) => {
      if (!panel) return;
      const open = i === openSolution;
      const inner = panel.firstElementChild as HTMLElement | null;
      if (reduced) {
        gsap.set(panel, { height: open ? "auto" : 0 });
        return;
      }
      gsap.to(panel, {
        height: open ? (inner?.offsetHeight ?? "auto") : 0,
        duration: 0.7,
        ease: "power3.inOut",
        overwrite: true,
        onComplete: () => {
          if (open) gsap.set(panel, { height: "auto" });
        },
      });
      if (inner && open) {
        gsap.fromTo(
          inner.children,
          { opacity: 0, y: 12, filter: "blur(6px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, delay: 0.25, stagger: 0.08, ease: "power2.out", clearProps: "filter" },
        );
      }
    });
  }, [openSolution]);

  const goTo = useCallback((id: string) => (e: React.MouseEvent) => {
    const target = id === "home" ? 0 : document.getElementById(id);
    setMenuOpen(false);
    if (!lenisRef.current || target === null) return;
    e.preventDefault();
    lenisRef.current.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
  }, []);

  const navLinks = (intro: boolean) =>
    NAV.map((n) => (
      <a
        key={n.id}
        href={`#${n.id}`}
        className={`${s.navItem} ${active === n.id ? s.navActive : ""}`}
        aria-current={active === n.id ? "true" : undefined}
        onClick={goTo(n.id)}
        onPointerEnter={(e) => {
          const label = e.currentTarget.querySelector<HTMLElement>("[data-scramble]");
          if (label) scramble(label);
        }}
        {...(intro ? { "data-intro": true } : {})}
      >
        <span data-scramble>{n.label}</span>
        {active === n.id && <span className={s.navStar}>*</span>},
      </a>
    ));

  return (
    <div className={s.page} ref={rootRef} data-motion="pending">
      <noscript>
        <style>{`[data-motion="pending"] [data-preloader]{display:none} [data-motion="pending"] *{opacity:1!important;visibility:visible!important}`}</style>
      </noscript>
      <Preloader />

      {/* ── Header ── */}
      <header className={`${s.header} ${scrolled ? s.headerSolid : ""}`}>
        <Logo data-intro />
        <nav className={`${s.navLinks} ${scrolled ? s.navHidden : ""}`} aria-label="Sections">
          {navLinks(true)}
        </nav>
        <button
          type="button"
          className={`${s.burger} ${scrolled ? s.burgerShown : ""}`}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="landing-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
        <CtaLink href="/console" className={s.headerCta} data-intro>
          Open console
        </CtaLink>
      </header>

      {menuOpen && (
        <div id="landing-menu" className={s.menu} role="dialog" aria-label="Navigation">
          <span className={s.menuLabel}>Navigation</span>
          <nav className={s.menuLinks}>{navLinks(false)}</nav>
          <CtaLink href="/console">Open console</CtaLink>
        </div>
      )}

      <main>
        {/* ── Hero ── */}
        <section id="home" className={s.hero} data-hero>
          <div className={s.heroBg} data-hero-bg>
            <FlowField className={s.flow} interactive crest={0.4} />
          </div>
          <div className={s.heroVignette} aria-hidden="true" />
          <div className={`${s.axis} ${s.axisH}`} data-hero-axis="h" aria-hidden="true" />
          <div className={`${s.axis} ${s.axisV}`} data-hero-axis="v" aria-hidden="true" />
          <HexHub />
          <div className={s.heroContent} data-hero-content>
            <p className={s.heroLabel} data-hero-fade>
              The model proposes. CDM-OS decides.
            </p>
            <h1 className={s.heroTitle}>
              <span className={s.lineMask}>
                <span data-hero-line className={s.line}>
                  Governed field cleanup
                </span>
              </span>
              <span className={s.lineMask}>
                <span data-hero-line className={s.line}>
                  for Salesforce orgs
                </span>
              </span>
            </h1>
          </div>
          <div className={s.heroFoot}>
            <p className={s.heroText} data-hero-fade>
              A policy-driven control plane for assessing, deprecating and deleting custom
              fields — with deterministic policy, tiered human approval and an immutable
              audit trail.
            </p>
            <Link href="/approvals" className={s.heroContact} data-hero-fade>
              Review pending approvals <span aria-hidden="true">﹂</span>
            </Link>
          </div>
        </section>

        {/* ── Problem ── */}
        <section id="problem" className={s.section}>
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Chip>The Problem</Chip>
              <Lines lines={["The gap between a stale field", "and a safe delete"]} />
            </div>
            <div className={s.problemList}>
              {PROBLEMS.map((p, i) => (
                <article key={p.title.join(" ")} className={`${s.pcard} ${i % 2 ? s.pcardFlip : ""}`} data-card data-frame>
                  <Corners />
                  <div className={s.pcardCopy}>
                    <div data-fade>
                      <Num n={i + 1} />
                    </div>
                    <h3 className={s.h3} data-lines>
                      {p.title.map((t) => (
                        <span key={t} className={s.lineMask}>
                          <span data-line className={s.line}>
                            {t}
                          </span>
                        </span>
                      ))}
                    </h3>
                    <div className={s.pcardBody}>
                      <p className={s.body} data-fade>
                        {p.text}
                      </p>
                      {i === PROBLEMS.length - 1 && (
                        <>
                          <p className={s.body} data-fade>
                            Sounds familiar? CDM-OS closes the gap.
                          </p>
                          <CtaLink href="/console" data-fade>
                            Open console
                          </CtaLink>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={s.pcardArt}>
                    <IsoScene variant={p.variant} labels={p.tags} />
                    <ul className={s.metaTags} data-meta>
                      {p.meta.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Solutions ── */}
        <section id="solutions" className={`${s.section} ${s.solutions}`}>
          <div className={s.sectionBg}>
            <FlowField className={s.flow} seed={2.3} intensity={0.85} crest={0.3} interactive />
          </div>
          <div className={s.container}>
            <div className={`${s.frame} ${s.solHead}`} data-frame>
              <Corners />
              <Chip>Solutions</Chip>
              <Lines lines={["One control plane.", "Every change governed."]} className={s.center} />
              <div className={s.orbit} data-orbit aria-hidden="true">
                <div className={s.orbitInner} data-orbit-parallax>
                  <div className={s.orbitRing} data-orbit-ring />
                  <div className={`${s.orbitRing} ${s.orbitRing2}`} data-orbit-ring />
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`${s.runner} ${i === 1 ? s.runnerInner : ""}`} data-runner>
                      <span />
                    </div>
                  ))}
                  <div className={s.orbitCore} data-orbit-core>
                    CDM-OS
                  </div>
                  {ORBIT.map((label, i) => {
                    const angle = Math.PI + ((i + 0.5) / ORBIT.length) * Math.PI;
                    const r = i % 2 ? 0.29 : 0.46;
                    return (
                      <span
                        key={label}
                        className={s.orbitChip}
                        data-orbit-chip
                        style={{
                          left: `${(50 + Math.cos(angle) * r * 100).toFixed(2)}%`,
                          top: `${(100 + Math.sin(angle) * r * 200).toFixed(2)}%`,
                        }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className={s.accordion}>
              {SOLUTIONS.map((sol, i) => {
                const Icon = sol.icon;
                const open = openSolution === i;
                return (
                  <div key={sol.title} className={`${s.accItem} ${open ? s.accOpen : ""}`}>
                    <span className={s.accCorners} aria-hidden="true" />
                    <button
                      type="button"
                      className={s.accHead}
                      aria-expanded={open}
                      aria-controls={`sol-${i}`}
                      onClick={() => setOpenSolution(i)}
                    >
                      <Num n={i + 1} />
                      <span className={s.accTitle}>
                        {sol.title}
                        <span className={s.accTier}>{sol.tier}</span>
                      </span>
                      <Icon className={s.accIcon} aria-hidden="true" />
                    </button>
                    <div
                      id={`sol-${i}`}
                      className={s.accPanel}
                      ref={(node) => {
                        panelRefs.current[i] = node;
                      }}
                      style={i === 0 ? undefined : { height: 0 }}
                      aria-hidden={!open}
                      inert={!open}
                    >
                      <div className={s.accBody}>
                        <span aria-hidden="true" />
                        <p className={s.body}>{sol.text}</p>
                        <CtaLink href={sol.href}>{sol.cta}</CtaLink>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Benefits ── */}
        <section className={s.section}>
          <div className={s.container}>
            <div className={s.benHead}>
              <Lines lines={["What you actually", "get back"]} />
              <div className={s.benIntro}>
                <p className={s.body} data-fade>
                  A cleaner org, a defensible process, and an auditor who stops asking.
                </p>
                <CtaLink href="/audit" data-fade>
                  See the audit trail
                </CtaLink>
              </div>
            </div>
            <div className={s.benGrid}>
              {BENEFITS.map((b) => (
                <article key={b.title} className={s.bcard} data-ben>
                  <ShieldCheck className={s.bcardIcon} aria-hidden="true" />
                  <h3 className={s.bcardTitle}>{b.title}</h3>
                  <p className={s.bodySm}>{b.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Process ── */}
        <section id="process" className={s.section}>
          <div className={s.container}>
            <div className={s.proc} data-proc>
              <div className={s.sectionHead}>
                <Chip>Process</Chip>
                <Lines lines={["From proposal", "to signed audit entry"]} />
              </div>
              <div className={s.procTrack} aria-hidden="true">
                <span className={s.procFill} data-proc-fill />
              </div>
              <ol className={s.steps}>
                {PROCESS.map((p, i) => (
                  <li key={p.title} className={s.step} data-step data-active={i === 0}>
                    <div data-step-anim>
                      <Num n={i + 1} />
                    </div>
                    <h3 className={s.stepTitle} data-step-anim>
                      {p.title}
                    </h3>
                    <p className={s.bodySm} data-step-anim>
                      {p.text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── Platform ── */}
        <section id="platform" className={s.section}>
          <div className={s.container}>
            <div className={`${s.frame} ${s.build}`} data-frame>
              <Corners />
              <div className={s.buildMain}>
                <Chip>Platform</Chip>
                <Lines lines={["What’s actually", "running"]} />
                <div className={s.buildList}>
                  {PLATFORM.map((p) => (
                    <div key={p.title} className={s.buildItem} data-build-item>
                      <div className={s.buildItemHead}>
                        <h3 className={s.bcardTitle}>{p.title}</h3>
                        <code className={s.port}>{p.port}</code>
                      </div>
                      <p className={s.bodySm}>{p.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className={s.layers} aria-label="Seven-layer target architecture">
                <span className={s.layersLabel} data-fade>
                  Seven-layer architecture
                </span>
                <ol>
                  {LAYERS.map((l, i) => (
                    <li key={l} className={LIVE_LAYERS.has(i) ? s.layerLive : ""} data-layer>
                      <span className={s.layerNum}>{i + 1}</span>
                      {l}
                      <span className={s.layerState}>{LIVE_LAYERS.has(i) ? "Live" : "Roadmap"}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className={s.ctaBand} data-cta>
          <div className={s.sectionBg}>
            <FlowField className={s.flow} seed={4.1} intensity={0.9} crest={0.36} interactive />
          </div>
          <span className={`${s.ctaLine} ${s.ctaLineL}`} data-cta-line aria-hidden="true" />
          <span className={`${s.ctaLine} ${s.ctaLineR}`} data-cta-line aria-hidden="true" />
          <div className={s.ctaInner}>
            <Lines lines={["Stop guessing which fields", "are safe to delete"]} dimFrom={2} className={s.center} />
            <CtaLink href="/console" data-fade>
              Open console
            </CtaLink>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className={s.foot}>
        <div className={s.footMain}>
          <div className={s.footBrand}>
            <Logo data-foot />
            <p className={s.bodySm} data-foot>
              Salesforce admins retire custom fields safely — every change proposed, evaluated,
              approved, executed and audited.
            </p>
            <CtaLink href="/console" data-foot>
              Open console
            </CtaLink>
          </div>
          <div className={s.footCols}>
            <div>
              <span className={s.footCap} data-foot>
                Navigation
              </span>
              <ul className={s.footList}>
                {NAV.map((n) => (
                  <li key={n.id} data-foot>
                    <a href={`#${n.id}`} onClick={goTo(n.id)}>
                      {n.label}*,
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <span className={s.footCap} data-foot>
                Console
              </span>
              <ul className={s.footList}>
                <li data-foot><Link href="/console">Overview*,</Link></li>
                <li data-foot><Link href="/approvals">Approvals*,</Link></li>
                <li data-foot><Link href="/console?view=FieldTools">Field Tools*,</Link></li>
                <li data-foot><Link href="/audit">Audit Trail*,</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div className={s.footBar}>
          <span data-foot>© {new Date().getFullYear()} CDM-OS. Salesforce Field Cleanup.</span>
          <span className={s.footLegal} data-foot>
            <span>Policy-driven</span>
            <span>Human-approved</span>
            <span>Audit-signed</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
