"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

export type OrbState = "idle" | "listening" | "processing" | "translating" | "speaking" | "error";

/** BolPay teal, mirrored from the --color-voice-* tokens in globals.css (a canvas can't read CSS variables cheaply). */
const C = { deep: [0, 107, 98], teal: [0, 133, 119], bright: [0, 191, 165], cyan: [101, 230, 210], bg: [13, 48, 52], dark: [7, 31, 37] } as const;
const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Where each state wants the animation to settle. Everything below eases toward these, so state changes never jump. */
const TARGET: Record<OrbState, { energy: number; speed: number; glow: number; spin: number; scale: number }> = {
  idle: { energy: 0.18, speed: 0.55, glow: 0.45, spin: 0, scale: 1 },
  listening: { energy: 0.5, speed: 1.3, glow: 0.85, spin: 0.1, scale: 1 },
  processing: { energy: 0.4, speed: 1, glow: 0.7, spin: 1, scale: 0.96 },
  translating: { energy: 0.4, speed: 0.9, glow: 0.65, spin: 0.7, scale: 0.97 },
  speaking: { energy: 0.45, speed: 1.1, glow: 0.8, spin: 0.15, scale: 1 },
  error: { energy: 0.06, speed: 0.25, glow: 0.22, spin: 0, scale: 0.94 },
};

// Each flowing layer: orbit speed, phase, orbit radius, size, colour.
const BLOBS = [
  { sp: 0.31, ph: 0.0, or: 0.5, sz: 0.85, col: C.teal, a: 0.9 },
  { sp: -0.43, ph: 2.1, or: 0.46, sz: 0.7, col: C.bright, a: 0.75 },
  { sp: 0.57, ph: 4.0, or: 0.36, sz: 0.55, col: C.cyan, a: 0.5 },
  { sp: -0.23, ph: 5.3, or: 0.58, sz: 0.78, col: C.deep, a: 0.85 },
  { sp: 0.71, ph: 1.2, or: 0.28, sz: 0.42, col: C.bright, a: 0.55 },
];

interface Ripple { born: number; power: number }

/**
 * An original fluid orb drawn on a canvas. `levelRef` carries the live loudness (0 to 1) from the real microphone or
 * the real audio being played; it is read every frame, so React never re-renders for it. With prefers-reduced-motion
 * the orb drifts very slowly and does not pulse or ripple.
 */
export function VoiceOrb({ state, levelRef, className }: { state: OrbState; levelRef: MutableRefObject<number>; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now(), t = 0, nextRing = 0, loud = 0;
    const cur = { ...TARGET[stateRef.current] };
    let spinAngle = 0;
    const ripples: Ripple[] = [];

    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2); // 2x is plenty and keeps mid-range phones smooth
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      const calm = reduced.matches;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = TARGET[stateRef.current];
      const ease = 1 - Math.exp(-dt * 3.2); // smooth, frame-rate independent
      for (const k of Object.keys(target) as (keyof typeof target)[]) cur[k] += (target[k] - cur[k]) * ease;
      const level = calm ? 0 : levelRef.current;
      loud += (level - loud) * (1 - Math.exp(-dt * 14));
      t += dt * cur.speed * (calm ? 0.15 : 1);
      spinAngle += dt * cur.spin * (calm ? 0.1 : 1);

      const live = stateRef.current === "listening" || stateRef.current === "speaking";
      const energy = cur.energy + (live ? loud * 0.55 : 0);
      const cx = w / 2, cy = h / 2;
      const base = Math.min(w, h) * 0.27 * cur.scale;
      const breathe = 1 + Math.sin(t * 1.1) * 0.012 * (calm ? 0 : 1) + (live ? loud * 0.2 : 0);
      const R = base * breathe;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Outer glow
      const gr = Math.min(R * (2.1 + (live ? loud * 0.5 : 0)), Math.min(w, h) / 2); // never reach the canvas edge, or it shows as a hard band
      const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, gr);
      glow.addColorStop(0, rgba(C.bright, 0.34 * cur.glow + (live ? loud * 0.3 : 0)));
      glow.addColorStop(0.45, rgba(C.teal, 0.14 * cur.glow));
      glow.addColorStop(1, rgba(C.teal, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Ripples: on real loudness peaks while live, on a slow timer while processing
      if (!calm) {
        if (live && loud > 0.32 && now > nextRing) { ripples.push({ born: now, power: Math.min(1, loud) }); nextRing = now + 320; }
        if ((stateRef.current === "processing" || stateRef.current === "translating") && now > nextRing) { ripples.push({ born: now, power: 0.35 }); nextRing = now + 1100; }
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const age = (now - ripples[i].born) / 1700;
        if (age >= 1) { ripples.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.04 + age * 0.7), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.cyan, (1 - age) * 0.4 * ripples[i].power);
        ctx.lineWidth = 1.5 + (1 - age) * 1.5;
        ctx.stroke();
      }

      // Organic outline: a circle gently deformed by a few slow waves
      const path = new Path2D();
      const steps = 72;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const wob = 1 + energy * 0.05 * Math.sin(a * 3 + t * 1.7) + energy * 0.035 * Math.sin(a * 5 - t * 2.3) + (live ? loud * 0.05 * Math.sin(a * 7 + t * 4) : 0);
        const x = cx + Math.cos(a) * R * wob, y = cy + Math.sin(a) * R * wob;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();

      ctx.save();
      ctx.clip(path);
      // Body
      const body = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.1, cx, cy, R * 1.1);
      body.addColorStop(0, rgba(C.deep, 1));
      body.addColorStop(0.7, rgba(C.bg, 1));
      body.addColorStop(1, rgba(C.dark, 1));
      ctx.fillStyle = body;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);

      // Flowing translucent light layers
      ctx.globalCompositeOperation = "lighter";
      for (const b of BLOBS) {
        const ang = t * b.sp * (1 + energy) + b.ph;
        const orbit = R * b.or * (0.7 + energy * 0.7);
        const bx = cx + Math.cos(ang) * orbit, by = cy + Math.sin(ang * 1.13) * orbit;
        const br = R * b.sz * (0.85 + 0.15 * Math.sin(t * 0.9 + b.ph) + (live ? loud * 0.25 : 0));
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, rgba(b.col, b.a * (0.55 + energy * 0.6)));
        g.addColorStop(0.55, rgba(b.col, b.a * 0.18));
        g.addColorStop(1, rgba(b.col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      // Processing: a soft rotating sweep of light
      if (cur.spin > 0.05 && typeof ctx.createConicGradient === "function") {
        const sweep = ctx.createConicGradient(spinAngle * 2.2, cx, cy);
        const a = 0.42 * Math.min(1, cur.spin);
        sweep.addColorStop(0, rgba(C.cyan, 0));
        sweep.addColorStop(0.18, rgba(C.cyan, a));
        sweep.addColorStop(0.4, rgba(C.bright, 0));
        sweep.addColorStop(0.62, rgba(C.teal, a * 0.7));
        sweep.addColorStop(1, rgba(C.cyan, 0));
        ctx.fillStyle = sweep;
        ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      }
      ctx.globalCompositeOperation = "source-over";

      // Depth: shade the lower right, brighten the upper left
      const shade = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.35, cx, cy, R * 1.12);
      shade.addColorStop(0, rgba(C.dark, 0));
      shade.addColorStop(1, rgba(C.dark, 0.62));
      ctx.fillStyle = shade;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      const spec = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.46, 0, cx - R * 0.38, cy - R * 0.46, R * 0.55);
      spec.addColorStop(0, "rgba(255,255,255,0.34)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      ctx.restore();

      // Rim light
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, rgba(C.cyan, 0.75));
      rim.addColorStop(0.5, rgba(C.bright, 0.12));
      rim.addColorStop(1, rgba(C.teal, 0.4));
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.6;
      ctx.stroke(path);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [levelRef]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
