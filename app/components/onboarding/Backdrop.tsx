"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

const BLOBS = [
  { c: "#ffc46b", cls: "left-[-12%] top-[-18%] size-[58vmax]", o: 0.55 },
  { c: "#ff9a8b", cls: "right-[-16%] top-[6%] size-[50vmax]", o: 0.42 },
  { c: "#7fe0d0", cls: "left-[18%] bottom-[-30%] size-[56vmax]", o: 0.45 },
  { c: "#c4b5ff", cls: "right-[10%] bottom-[-22%] size-[40vmax]", o: 0.4 },
];

/**
 * The world behind every sign-up screen: warm paper with four soft colour fields drifting slowly,
 * and a fine grain so the gradients don't band. Fixed, so it stays put while the steps change.
 */
export function Backdrop() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The drift re-creates itself from onComplete, outside what ctx.revert() tracks, so it is stopped by hand.
    let stopped = false;
    const blobs: HTMLElement[] = [];
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-blob]").forEach((el) => {
        blobs.push(el);
        const drift = () =>
          !stopped &&
          gsap.to(el, {
            x: gsap.utils.random(-90, 90),
            y: gsap.utils.random(-70, 70),
            scale: gsap.utils.random(0.9, 1.22),
            duration: gsap.utils.random(9, 15),
            ease: "sine.inOut",
            onComplete: drift,
          });
        drift();
      });
    }, root);
    return () => {
      stopped = true;
      gsap.killTweensOf(blobs);
      ctx.revert();
    };
  }, []);

  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-[#fbf7ef]">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          data-blob
          className={`absolute rounded-full will-change-transform ${b.cls}`}
          style={{ background: `radial-gradient(circle at 50% 50%, ${b.c} 0%, ${b.c}00 68%)`, opacity: b.o, filter: "blur(30px)" }}
        />
      ))}
      <svg className="absolute inset-0 size-full opacity-[0.07] mix-blend-multiply">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
}
