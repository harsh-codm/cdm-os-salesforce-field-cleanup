"use client";

import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);
// scene variants share one choreography; parts missing from a variant are expected
gsap.config({ nullTargetWarn: false });

/**
 * All landing-page motion, modeled on the reference site's choreography:
 * Lenis smooth scroll driven by the GSAP ticker; a short preloader; a staged
 * hero intro (blurred line reveals, axes drawing out, rays shooting from the
 * hub); scroll-triggered line reveals for every heading; per-card isometric
 * scenes that play once in view and then idle-loop; an orbit diagram with
 * runners; a pinned, scroll-scrubbed process timeline; and a drawn-in CTA.
 *
 * Only transforms, opacity and (briefly) filter are animated so the work stays
 * on the compositor. Idle loops pause while their section is off screen.
 */
export function useLandingMotion(
  root: RefObject<HTMLElement | null>,
  opts: { onLenis?: (lenis: Lenis | null) => void } = {},
) {
  const { onLenis } = opts;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      el.setAttribute("data-motion", "ready");
      onLenis?.(null);
      return;
    }

    /* ── Smooth scroll ── */
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    onLenis?.(lenis);

    const cleanups: Array<() => void> = [];
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const mm = gsap.matchMedia();
      cleanups.push(() => mm.revert());

      /* ── Preloader → hero intro ── */
      const pre = q("[data-preloader]")[0] as HTMLElement | undefined;
      const count = q("[data-preloader-count]")[0] as HTMLElement | undefined;
      lenis.stop();
      if (pre) gsap.set(pre, { autoAlpha: 1 });
      gsap.set(q("[data-preloader-ray]"), { scale: 0, opacity: 0, svgOrigin: "0 0" });

      // initial states (set before first paint, then data-motion flips to ready)
      gsap.set(q("[data-intro]"), { opacity: 0, filter: "blur(12px)" });
      gsap.set(q("[data-hero-line]"), { opacity: 0, yPercent: 60, filter: "blur(10px)" });
      gsap.set(q("[data-hero-fade]"), { opacity: 0, y: 18, filter: "blur(8px)" });
      gsap.set(q("[data-hero-axis='h']"), { scaleX: 0 });
      gsap.set(q("[data-hero-axis='v']"), { scaleY: 0 });
      gsap.set(q("[data-hub-hex]"), { scale: 0.4, opacity: 0, transformOrigin: "50% 50%" });
      gsap.set(q("[data-hub-ray]"), { strokeDasharray: 400, strokeDashoffset: 400 });
      gsap.set(q("[data-hero-bg]"), { opacity: 0, scale: 1.08 });
      el.setAttribute("data-motion", "ready");

      const counter = { v: 0 };
      const intro = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
      intro
        .to(q("[data-hero-bg]"), { opacity: 1, scale: 1, duration: 2.2, ease: "power2.out" }, 0)
        .to(q("[data-intro]"), { opacity: 1, filter: "blur(0px)", duration: 1.1, stagger: 0.06, clearProps: "filter" }, 0.3)
        .to(q("[data-hero-axis='h']"), { scaleX: 1, duration: 2.4 }, 0.5)
        .to(q("[data-hero-axis='v']"), { scaleY: 1, duration: 2.4 }, 0.5)
        .to(q("[data-hub-hex]"), { scale: 1, opacity: 1, duration: 1, ease: "back.out(2.2)" }, 0.8)
        .to(q("[data-hub-ray]"), { strokeDashoffset: 0, duration: 1.4, stagger: 0.07, ease: "power3.out" }, 1)
        .to(q("[data-hero-line]"), { opacity: 1, yPercent: 0, filter: "blur(0px)", duration: 1.4, stagger: 0.14, clearProps: "filter" }, 0.7)
        .to(q("[data-hero-fade]"), { opacity: 1, y: 0, filter: "blur(0px)", duration: 1.2, stagger: 0.12, clearProps: "filter" }, 1.3)
        .add(() => {
          lenis.start();
        }, 1.2);

      if (pre && count) {
        gsap
          .timeline()
          .to(counter, {
            v: 100,
            duration: 1.1,
            ease: "power2.inOut",
            onUpdate: () => {
              count.textContent = `${String(Math.round(counter.v)).padStart(3, "0")}%`;
            },
          })
          .to(q("[data-preloader-ray]"), { scale: 1, opacity: 1, svgOrigin: "0 0", duration: 0.9, stagger: 0.05, ease: "power3.out" }, 0)
          .to(pre, { opacity: 0, duration: 0.6, ease: "power2.inOut" }, "+=0.1")
          .add(() => {
            intro.play();
          }, "-=0.45")
          .set(pre, { display: "none" });
      } else {
        intro.play();
      }

      /* ── Hub idle: gentle float + mouse parallax ── */
      const hub = q("[data-hub]")[0];
      if (hub) {
        gsap.to(q("[data-hub-hex]"), { y: -6, duration: 2.6, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 2 });
        const hx = gsap.quickTo(hub, "x", { duration: 1.2, ease: "power3.out" });
        const hy = gsap.quickTo(hub, "y", { duration: 1.2, ease: "power3.out" });
        const onMove = (e: PointerEvent) => {
          hx(((e.clientX / innerWidth) - 0.5) * 24);
          hy(((e.clientY / innerHeight) - 0.5) * 18);
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        cleanups.push(() => window.removeEventListener("pointermove", onMove));
      }

      /* ── Hero scroll-out parallax ── */
      gsap
        .timeline({
          scrollTrigger: { trigger: q("[data-hero]")[0], start: "top top", end: "bottom top", scrub: true },
        })
        .to(q("[data-hero-content]"), { y: -120, opacity: 0.2, ease: "none" }, 0)
        .to(q("[data-hub]"), { yPercent: -30, ease: "none" }, 0)
        .to(q("[data-hero-bg]"), { yPercent: 12, ease: "none" }, 0);

      /* ── Line reveals for headings ── */
      q("[data-lines]").forEach((heading) => {
        const lines = heading.querySelectorAll("[data-line]");
        gsap.fromTo(
          lines,
          { opacity: 0, yPercent: 55, filter: "blur(10px)" },
          {
            opacity: 1,
            yPercent: 0,
            filter: "blur(0px)",
            duration: 1.3,
            stagger: 0.12,
            ease: "power2.out",
            clearProps: "filter",
            scrollTrigger: { trigger: heading, start: "top 85%", once: true },
          },
        );
      });

      /* ── Generic fades (body copy, chips, CTAs) ── */
      q("[data-fade]").forEach((node) => {
        gsap.fromTo(
          node,
          { opacity: 0, y: 16, filter: "blur(8px)" },
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 1.1,
            ease: "power3.out",
            clearProps: "filter",
            scrollTrigger: { trigger: node, start: "top 88%", once: true },
          },
        );
      });

      /* ── Frames: corner brackets snap in, hairline borders draw ── */
      q("[data-frame]").forEach((frame) => {
        const corners = frame.querySelectorAll(":scope > [data-corner]");
        gsap.fromTo(
          corners,
          { scale: 0, opacity: 0 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.7,
            stagger: 0.06,
            ease: "back.out(3)",
            scrollTrigger: { trigger: frame, start: "top 85%", once: true },
          },
        );
      });

      /* ── Problem cards: isometric scenes ── */
      q("[data-card]").forEach((card) => {
        const scene = card.querySelector<SVGSVGElement>("[data-scene]");
        if (!scene) return;
        const variant = Number(scene.dataset.scene);
        const sq = gsap.utils.selector(scene);
        const cubes = (i: number) => sq(`[data-cube='${i}']`);
        const loops: gsap.core.Animation[] = [];

        gsap.set(sq("[data-axis]"), { strokeDasharray: 400, strokeDashoffset: 400 });
        gsap.set(sq("[data-cube]"), { opacity: 0, y: 24 });
        gsap.set(sq("[data-redline]"), { strokeDashoffset: 160, opacity: 0 });
        gsap.set(sq("[data-mark], [data-tag]"), { scale: 0, opacity: 0, transformOrigin: "50% 50%" });
        gsap.set(sq("[data-ring], [data-ring-pulse]"), { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" });
        gsap.set(card.querySelectorAll("[data-meta] li"), { opacity: 0, x: 14 });

        const enter = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
        enter
          .to(sq("[data-axis]"), { strokeDashoffset: 0, duration: 1.2, stagger: 0.1, ease: "power2.inOut" }, 0)
          .to(sq("[data-cube]"), { opacity: 1, y: 0, duration: 0.9, stagger: 0.12, ease: "back.out(1.8)" }, 0.2)
          .to(card.querySelectorAll("[data-meta] li"), { opacity: 1, x: 0, duration: 0.6, stagger: 0.08 }, 0.5);

        if (variant === 0) {
          // fused systems split apart along the iso axis, then the broken link draws
          enter
            .to(cubes(0), { x: -52, y: 30, duration: 1.2, ease: "power3.inOut" }, 1.1)
            .to(cubes(2), { x: 52, y: -30, duration: 1.2, ease: "power3.inOut" }, 1.1)
            .to(sq("[data-redline]"), { opacity: 1, strokeDashoffset: 0, duration: 1, ease: "power2.out" }, 1.9)
            .to(sq("[data-mark]"), { scale: 1, opacity: 1, duration: 0.5, stagger: 0.12, ease: "back.out(3)" }, 2.3);
          enter.eventCallback("onComplete", () => {
            [0, 1, 2].forEach((i) =>
              loops.push(gsap.to(cubes(i), { y: `-=5`, duration: 1.6 + i * 0.35, ease: "sine.inOut", yoyo: true, repeat: -1 })),
            );
            loops.push(gsap.to(sq("[data-redline]"), { strokeDashoffset: -24, duration: 1.2, ease: "none", repeat: -1 }));
          });
        } else if (variant === 1) {
          enter
            .to(sq("[data-ring]"), { opacity: 1, scale: 1, duration: 1.1 }, 0.9)
            .to(sq("[data-ring-pulse]"), { opacity: 0.8, scale: 1, duration: 1 }, 1);
          enter.eventCallback("onComplete", () => {
            loops.push(gsap.to(sq("[data-ring] ellipse"), { rotation: 360, svgOrigin: "150 140", duration: 40, ease: "none", repeat: -1 }));
            loops.push(gsap.to(sq("[data-ring-pulse]"), { scale: 1.3, opacity: 0.25, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1 }));
            // the agent lunges at the delete cube; policy is skipped; a spark flashes
            loops.push(
              gsap
                .timeline({ repeat: -1, repeatDelay: 0.9 })
                .to(cubes(0), { x: 16, y: -9, duration: 0.55, ease: "power2.in" })
                .to(sq("[data-mark]"), { scale: 1.6, opacity: 1, duration: 0.14, ease: "power2.out" }, ">-0.05")
                .to(cubes(2), { x: 5, y: -3, duration: 0.12, ease: "power2.out" }, "<")
                .to(cubes(0), { x: 0, y: 0, duration: 0.7, ease: "back.out(3)" }, "<")
                .to(cubes(2), { x: 0, y: 0, duration: 0.5, ease: "back.out(3)" }, "<")
                .to(sq("[data-mark]"), { scale: 0, opacity: 0, duration: 0.4, ease: "power2.out" }, "<0.1"),
            );
          });
        } else {
          enter
            .to(cubes(0), { x: -26, y: 15, duration: 1.1, ease: "power3.inOut" }, 1.1)
            .to(cubes(1), { x: 26, y: -15, duration: 1.1, ease: "power3.inOut" }, 1.1)
            .to(sq("[data-redline]"), { opacity: 1, strokeDashoffset: 0, duration: 0.9 }, 1.8);
          enter.eventCallback("onComplete", () => {
            const tags = sq("[data-tag]");
            const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6 });
            tags.forEach((tag, i) => {
              tl.fromTo(
                tag,
                { scale: 0.6, opacity: 0, y: 10 },
                { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: "back.out(2.4)" },
                i * 0.45,
              );
            });
            tl.to(tags, { opacity: 0, y: -8, duration: 0.5, stagger: 0.08, ease: "power2.in" }, "+=1.6");
            loops.push(tl);
            [0, 1].forEach((i) =>
              loops.push(gsap.to(cubes(i), { y: `-=4`, duration: 1.8 + i * 0.4, ease: "sine.inOut", yoyo: true, repeat: -1 })),
            );
          });
        }

        ScrollTrigger.create({
          trigger: card,
          start: "top 70%",
          once: true,
          onEnter: () => enter.play(),
        });
        // pause idle loops when the card is off screen
        ScrollTrigger.create({
          trigger: card,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => loops.forEach((l) => (self.isActive ? l.resume() : l.pause())),
        });
      });

      /* ── Solutions orbit ── */
      const orbit = q("[data-orbit]")[0];
      if (orbit) {
        const oq = gsap.utils.selector(orbit);
        gsap.set(oq("[data-orbit-ring]"), { scale: 0.7, opacity: 0 });
        gsap.set(oq("[data-orbit-chip]"), { scale: 0.4, opacity: 0 });
        gsap.set(oq("[data-orbit-core]"), { scale: 0.3, opacity: 0 });
        gsap.set(oq("[data-runner]"), { opacity: 0 });
        const loops: gsap.core.Animation[] = [];
        const otl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
        otl
          .to(oq("[data-orbit-ring]"), { scale: 1, opacity: 1, duration: 1.4, stagger: 0.15 }, 0)
          .to(oq("[data-orbit-core]"), { scale: 1, opacity: 1, duration: 0.9, ease: "back.out(2)" }, 0.4)
          .to(oq("[data-orbit-chip]"), { scale: 1, opacity: 1, duration: 0.6, stagger: 0.07, ease: "back.out(2.4)" }, 0.6)
          .to(oq("[data-runner]"), { opacity: 1, duration: 0.6, stagger: 0.1 }, 1);
        otl.eventCallback("onComplete", () => {
          oq("[data-runner]").forEach((r, i) => {
            loops.push(
              // full turns; the lower half of each ring is clipped away
              gsap.fromTo(
                r,
                { rotation: i * 70 },
                { rotation: 360 + i * 70, duration: 9 + i * 3, ease: "none", repeat: -1 },
              ),
            );
          });
          loops.push(
            gsap.to(oq("[data-orbit-core]"), { scale: 1.12, duration: 1.6, ease: "sine.inOut", yoyo: true, repeat: -1 }),
          );
        });
        ScrollTrigger.create({ trigger: orbit, start: "top 80%", once: true, onEnter: () => otl.play() });
        ScrollTrigger.create({
          trigger: orbit,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => loops.forEach((l) => (self.isActive ? l.resume() : l.pause())),
        });
        gsap.fromTo(
          oq("[data-orbit-parallax]"),
          { y: 50 },
          { y: -30, ease: "none", scrollTrigger: { trigger: orbit, start: "top bottom", end: "bottom top", scrub: true } },
        );
      }

      /* ── Benefit cards ── */
      const ben = q("[data-ben]");
      if (ben.length) {
        gsap.fromTo(
          ben,
          { opacity: 0, y: 40, filter: "blur(8px)" },
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 1.1,
            stagger: 0.1,
            ease: "power3.out",
            clearProps: "filter",
            scrollTrigger: { trigger: ben[0], start: "top 85%", once: true },
          },
        );
        gsap.fromTo(
          q("[data-ben] svg"),
          { rotation: -90, scale: 0.5, opacity: 0 },
          {
            rotation: 0,
            scale: 1,
            opacity: 1,
            duration: 0.9,
            stagger: 0.1,
            delay: 0.3,
            ease: "back.out(2)",
            scrollTrigger: { trigger: ben[0], start: "top 85%", once: true },
          },
        );
      }

      /* ── Process: pinned + scrubbed on desktop, simple reveal on small screens ── */
      const proc = q("[data-proc]")[0] as HTMLElement | undefined;
      if (proc) {
        const steps = gsap.utils.toArray<HTMLElement>(proc.querySelectorAll("[data-step]"));
        const fill = proc.querySelector("[data-proc-fill]");
        mm.add("(min-width: 961px)", () => {
          gsap.set(steps, { opacity: 0.28 });
          gsap.set(fill, { scaleX: 0, transformOrigin: "0 50%" });
          let current = -1;
          const activate = (i: number) => {
            if (i === current) return;
            current = i;
            steps.forEach((s, n) => {
              s.dataset.active = String(n === i);
              gsap.to(s, { opacity: n <= i ? 1 : 0.28, duration: 0.5, overwrite: "auto" });
            });
            const body = steps[i]?.querySelectorAll("[data-step-anim]");
            if (body) {
              gsap.fromTo(
                body,
                { opacity: 0, y: 14, filter: "blur(8px)" },
                { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, stagger: 0.08, ease: "power2.out", clearProps: "filter" },
              );
            }
          };
          activate(0);
          ScrollTrigger.create({
            trigger: proc,
            start: "top 12%",
            end: () => `+=${steps.length * window.innerHeight * 0.45}`,
            pin: true,
            anticipatePin: 1,
            scrub: true,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              gsap.set(fill, { scaleX: self.progress });
              activate(Math.min(steps.length - 1, Math.floor(self.progress * steps.length * 0.999)));
            },
          });
        });
        mm.add("(max-width: 960px)", () => {
          gsap.fromTo(
            steps,
            { opacity: 0, x: -20 },
            {
              opacity: 1,
              x: 0,
              duration: 0.9,
              stagger: 0.12,
              ease: "power3.out",
              scrollTrigger: { trigger: proc, start: "top 80%", once: true },
            },
          );
        });
      }

      /* ── Platform layers ── */
      const layers = q("[data-layer]");
      if (layers.length) {
        gsap.fromTo(
          layers,
          { opacity: 0, x: -28 },
          {
            opacity: 1,
            x: 0,
            duration: 0.8,
            stagger: 0.07,
            ease: "power3.out",
            scrollTrigger: { trigger: layers[0], start: "top 85%", once: true },
          },
        );
      }
      const buildItems = q("[data-build-item]");
      if (buildItems.length) {
        gsap.fromTo(
          buildItems,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            stagger: 0.1,
            ease: "power3.out",
            scrollTrigger: { trigger: buildItems[0], start: "top 88%", once: true },
          },
        );
      }

      /* ── CTA band: hairlines draw from the centre ── */
      const cta = q("[data-cta]")[0];
      if (cta) {
        gsap.fromTo(
          q("[data-cta-line]"),
          { scaleX: 0 },
          {
            scaleX: 1,
            duration: 1.6,
            stagger: 0.2,
            ease: "power2.inOut",
            scrollTrigger: { trigger: cta, start: "top 80%", once: true },
          },
        );
      }

      /* ── Footer stagger ── */
      const foot = q("[data-foot]");
      if (foot.length) {
        gsap.fromTo(
          foot,
          { opacity: 0, y: 14, filter: "blur(6px)" },
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 0.9,
            stagger: 0.05,
            ease: "power3.out",
            clearProps: "filter",
            scrollTrigger: { trigger: foot[0], start: "top 95%", once: true },
          },
        );
      }
    }, el);

    // fonts change line heights → recompute trigger positions once they land
    void document.fonts?.ready.then(() => ScrollTrigger.refresh());

    return () => {
      cleanups.forEach((fn) => fn());
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
      onLenis?.(null);
      el.removeAttribute("data-motion");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
