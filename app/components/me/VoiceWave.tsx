"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { OrbState } from "./VoiceOrb";

/**
 * The voice visual: a ribbon of fine glowing strands over a flat line, drawn on a canvas. Same inputs as VoiceOrb:
 * `levelRef` carries the live loudness (0 to 1) of the real microphone or the reply being played and is read every
 * frame, so React never re-renders for it. With prefers-reduced-motion it drifts very slowly and ignores loudness.
 */

/** Where each state wants the wave to settle; it eases toward these so state changes never jump. */
const TARGET: Record<OrbState, { height: number; speed: number; glow: number; sweep: number }> = {
  idle: { height: 0.2, speed: 0.5, glow: 0.65, sweep: 0 },
  listening: { height: 0.34, speed: 1.25, glow: 1, sweep: 0 },
  processing: { height: 0.3, speed: 1.1, glow: 0.85, sweep: 1 },
  translating: { height: 0.3, speed: 0.95, glow: 0.85, sweep: 1 },
  speaking: { height: 0.4, speed: 1.15, glow: 1, sweep: 0 },
  error: { height: 0.04, speed: 0.2, glow: 0.3, sweep: 0 },
};

const STRANDS = 26;
/** Share of the width the ribbon occupies; the flat line carries on to the edges. */
const RIBBON = 0.72;

export function VoiceWave({ state, levelRef, className }: { state: OrbState; levelRef: MutableRefObject<number>; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let w = 1, h = 1, dpr = 1, raf = 0, last = performance.now(), t = 0, loud = 0;
    const cur = { ...TARGET[stateRef.current] };

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
      const live = stateRef.current === "listening" || stateRef.current === "speaking";
      const level = calm || !live ? 0 : Math.max(0, Math.min(1, levelRef.current));
      loud += (level - loud) * (1 - Math.exp(-dt * 12));
      t += dt * cur.speed * (calm ? 0.12 : 1);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mid = h / 2;
      // Tall enough to feel alive on a phone, never taller than the space it sits in.
      const amp = Math.min(h * 0.42, w * 0.32) * Math.min(1, cur.height + loud * 0.75);
      const ribbon = Math.max(w * RIBBON, Math.min(w, 320));
      const left = (w - ribbon) / 2;
      const step = Math.max(2, ribbon / 170);
      // While thinking, a bright swell travels along the ribbon.
      const sweepAt = (t * 0.45) % 1.4 - 0.2;

      // The flat line, fading out toward the screen edges.
      const line = ctx.createLinearGradient(0, 0, w, 0);
      line.addColorStop(0, "rgba(101,230,210,0)");
      line.addColorStop(0.18, `rgba(190,250,240,${(0.75 * cur.glow).toFixed(3)})`);
      line.addColorStop(0.82, `rgba(190,250,240,${(0.75 * cur.glow).toFixed(3)})`);
      line.addColorStop(1, "rgba(101,230,210,0)");
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w * 0.04, mid);
      ctx.lineTo(w * 0.96, mid);
      ctx.stroke();

      ctx.globalCompositeOperation = "lighter"; // overlapping strands add up to a white-hot core
      ctx.lineJoin = "round";
      const paint = ctx.createLinearGradient(left, 0, left + ribbon, 0);
      paint.addColorStop(0, "rgba(0,191,165,0)");
      paint.addColorStop(0.22, "rgba(101,230,210,1)");
      paint.addColorStop(0.5, "rgba(235,255,251,1)");
      paint.addColorStop(0.78, "rgba(101,230,210,1)");
      paint.addColorStop(1, "rgba(0,191,165,0)");
      ctx.strokeStyle = paint;

      for (let s = 0; s < STRANDS; s++) {
        const k = s / (STRANDS - 1); // 0..1 across the ribbon's thickness
        const phase = k * 1.9;
        const path = new Path2D();
        for (let x = 0; x <= ribbon + 0.5; x += step) {
          const u = Math.min(1, x / ribbon);
          const envelope = Math.pow(Math.sin(Math.PI * u), 1.7); // pinned to the line at both ends
          // Three waves of different length and direction make uneven, mountain-like peaks.
          const shape =
            0.48 * Math.sin(u * 14 - t * 2.1 + phase) +
            0.34 * Math.sin(u * 31 + t * 1.5 + phase * 1.7) +
            0.27 * Math.sin(u * 53 - t * 3.3 + phase * 2.6);
          const swell = 1 + cur.sweep * 0.9 * Math.exp(-((u - sweepAt) ** 2) / 0.008);
          const y = mid - shape * envelope * amp * swell * (0.45 + 0.55 * Math.sin(Math.PI * (0.12 + k * 0.76)));
          if (x === 0) path.moveTo(left, y);
          else path.lineTo(left + x, y);
        }
        // A wide faint pass for the glow (much cheaper than shadowBlur), then the fine strand.
        if (s % 4 === 0) {
          ctx.globalAlpha = 0.07 * cur.glow;
          ctx.lineWidth = 7;
          ctx.stroke(path);
        }
        ctx.globalAlpha = (0.16 + 0.2 * Math.sin(Math.PI * k)) * cur.glow;
        ctx.lineWidth = 0.8;
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levelRef]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
