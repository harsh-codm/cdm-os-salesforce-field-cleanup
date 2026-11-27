"use client";

import { useEffect, useRef } from "react";

/**
 * GPU "ember strands" background.
 *
 * A single full-screen fragment shader draws thousands of thin flowing fibres
 * with a glowing crest, slowly drifting. The pointer leaves a fading wake that
 * pushes the fibres aside (a cheap stand-in for a fluid sim). Everything runs on
 * the GPU, renders only while on screen, and caps resolution so scrolling stays
 * smooth. Without WebGL the CSS fallback gradient on the canvas shows instead.
 */

const TRAIL = 12;

const VERT = `
attribute vec2 a;
varying vec2 vUv;
void main(){ vUv = a * .5 + .5; gl_Position = vec4(a, 0., 1.); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uCrest;
uniform vec4 uTrail[${TRAIL}];
uniform float uTrailK[${TRAIL}];

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; }
  return v;
}

void main(){
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);

  // pointer wake: each trail sample pushes the field along its velocity
  vec2 disp = vec2(0.);
  for (int i = 0; i < ${TRAIL}; i++){
    vec2 d = p - vec2(uTrail[i].x * aspect, uTrail[i].y);
    disp += uTrail[i].zw * exp(-dot(d, d) / .022) * uTrailK[i];
  }
  p -= disp;

  float t = uTime * .035;
  vec2 q = vec2(fbm(p * 1.25 + vec2(t, uSeed)), fbm(p * 1.25 + vec2(5.2 - t, 1.3 + uSeed)));
  vec2 w = p + (q - .5) * .6;

  // the crest the fibres comb over
  float crest = uCrest + .13 * sin(w.x * 1.7 + uSeed + uTime * .05) + .06 * sin(w.x * 4.3 - uTime * .07 + uSeed);
  float dy = w.y - crest;

  // coordinate across the flow -> stripes = fibres
  float across = dy + .05 * fbm(w * vec2(1.5, 6.));
  float f1 = across * 150.;
  float f2 = across * 62. + fbm(w * 3.) * 4.;
  float id1 = floor(f1 / 3.14159);
  float fib = pow(abs(sin(f1)), 10.) * (.35 + .65 * hash(vec2(id1, uSeed)));
  fib += pow(abs(sin(f2)), 6.) * .55;

  // where fibres are lit: a hot band at the crest, a dimmer mass below it
  float band = exp(-dy * dy / .010);
  float mass = smoothstep(.06, -.35, dy) * .55;
  float topFade = smoothstep(.45, .0, dy);
  float lit = (band * 1.15 + mass) * topFade;

  // slow travelling sheen along the fibres
  float sheen = .65 + .35 * sin(w.x * 3. - uTime * .35 + q.y * 6.);

  vec3 base = mix(vec3(.018, .03, .07), vec3(.03, .07, .16), smoothstep(1., .0, vUv.y));
  vec3 deep = vec3(.07, .2, .55);
  vec3 hot = vec3(.38, .88, 1.);
  vec3 fibCol = mix(deep, hot, clamp(band * 1.2 + fib * .25, 0., 1.));

  vec3 col = base;
  col += fibCol * fib * lit * sheen * uIntensity;
  col += vec3(.1, .3, .85) * band * .22 * uIntensity;
  col += vec3(.55, .9, 1.) * length(disp) * 2.2 * lit; // bright rim where the wake stirs

  // film grain
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.) - .5) * .035;
  gl_FragColor = vec4(col, 1.);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) throw new Error("shader alloc failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  }
  return s;
}

export default function FlowField({
  className,
  seed = 0,
  intensity = 1,
  crest = 0.42,
  interactive = false,
}: {
  className?: string;
  seed?: number;
  intensity?: number;
  /** Vertical position of the bright crest, 0 (bottom) – 1 (top). */
  crest?: number;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) {
      canvas.dataset.fallback = "true";
      return;
    }

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link failed");
    } catch (error) {
      console.error("FlowField disabled:", error);
      canvas.dataset.fallback = "true";
      return;
    }
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("uRes");
    const uTime = u("uTime");
    const uTrail = u("uTrail");
    const uTrailK = u("uTrailK");
    gl.uniform1f(u("uSeed"), seed);
    gl.uniform1f(u("uIntensity"), intensity);
    gl.uniform1f(u("uCrest"), crest);

    const trail = new Float32Array(TRAIL * 4);
    const trailK = new Float32Array(TRAIL);
    let head = 0;
    let energy = 0;
    let last: { x: number; y: number; t: number } | null = null;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false;
    let raf = 0;
    const start = performance.now();
    // Freeze time for reduced motion so the picture stays still.
    const timeNow = () => (reduced ? 12 : (performance.now() - start) / 1000 + seed * 7);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Render below device resolution: the fibres are soft enough that 0.75x
      // of CSS pixels looks identical and keeps fill-rate low.
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
      const w = Math.max(1, Math.min(1920, Math.round(rect.width * scale)));
      const h = Math.max(1, Math.round((w * rect.height) / Math.max(1, rect.width)));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const draw = () => {
      for (let i = 0; i < TRAIL; i++) trailK[i] *= 0.955;
      energy *= 0.955;
      gl.uniform1f(uTime, timeNow());
      gl.uniform4fv(uTrail, trail);
      gl.uniform1fv(uTrailK, trailK);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw();
      if (!reduced || energy > 0.01) raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1 - (e.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        last = null;
        return;
      }
      const now = performance.now();
      if (last) {
        const dt = Math.max(8, now - last.t);
        const vx = Math.max(-0.08, Math.min(0.08, ((x - last.x) / dt) * 16 * 0.5));
        const vy = Math.max(-0.08, Math.min(0.08, ((y - last.y) / dt) * 16 * 0.5));
        trail.set([x, y, vx, vy], head * 4);
        trailK[head] = 1;
        head = (head + 1) % TRAIL;
        energy = 1;
        kick();
      }
      last = { x, y, t: now };
    };

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        if (reduced) draw();
        kick();
      }
    });
    io.observe(canvas);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);
    if (interactive) window.addEventListener("pointermove", onPointer, { passive: true });

    resize();
    canvas.dataset.ready = "true";

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointer);
      // Free GPU objects but keep the context: React (StrictMode / fast refresh)
      // can re-run this effect on the same canvas, and getContext would then
      // hand back a lost context whose shaders never compile.
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
    };
  }, [seed, intensity, crest, interactive]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
