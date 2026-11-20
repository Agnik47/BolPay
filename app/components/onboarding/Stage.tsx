"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Backdrop } from "./Backdrop";
import { Flag } from "./art";
import { display } from "./fonts";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The frame for every sign-up screen. One centred column on the living backdrop: a round back button, a thin
 * progress line and the language chip across the top, and the current step in the middle. No side panels,
 * no boxes: the step is the page.
 */
export function Stage({
  stepKey,
  index,
  total,
  onBack,
  right,
  wide = false,
  bare = false,
  children,
}: {
  /** Changes with the step; drives the transition. */
  stepKey: string;
  /** Zero-based step number and how many there are. Omit `total` to hide the progress line. */
  index?: number;
  total?: number;
  onBack?: () => void;
  right?: ReactNode;
  /** A wider column for screens that show a grid of choices. */
  wide?: boolean;
  /** No centring box: the child lays out the whole screen (the welcome scene). */
  bare?: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const shift = reduce ? 0 : 1;

  return (
    <div className={`${display.variable} relative min-h-dvh overflow-x-hidden text-[#16152b]`}>
      <Backdrop />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4 sm:px-7 sm:pt-6">
        <div className="pointer-events-auto flex w-24 justify-start">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex size-11 items-center justify-center rounded-full bg-white/70 text-[#16152b] shadow-[0_6px_20px_-8px_rgba(22,21,43,0.3)] backdrop-blur transition hover:-translate-x-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16152b]"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 10H4M9 5l-5 5 5 5" />
              </svg>
            </button>
          )}
        </div>

        {total ? (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={(index ?? 0) + 1} aria-label="Setup progress" className="h-1.5 w-[min(46vw,240px)] overflow-hidden rounded-full bg-[#16152b]/10">
            <motion.span
              className="block h-full origin-left rounded-full bg-gradient-to-r from-[#ffb020] via-[#ff5d73] to-[#7c5cff]"
              initial={false}
              animate={{ scaleX: Math.min(1, ((index ?? 0) + 1) / total) }}
              transition={{ duration: reduce ? 0 : 0.8, ease: EASE }}
            />
          </div>
        ) : (
          <span />
        )}

        <div className="pointer-events-auto flex w-24 justify-end">
          {right ?? (
            <span className="flex items-center gap-2 rounded-full bg-white/70 py-1.5 pl-1.5 pr-3 font-mono text-[11px] font-semibold tracking-widest text-[#16152b]/70 shadow-[0_6px_20px_-8px_rgba(22,21,43,0.3)] backdrop-blur">
              <Flag className="size-5" />
              EN
            </span>
          )}
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={stepKey}
          initial={{ opacity: 0, y: 34 * shift, filter: reduce ? "none" : "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -22 * shift, filter: reduce ? "none" : "blur(8px)" }}
          transition={{ duration: 0.5, ease: EASE }}
          className={bare ? "relative z-10 min-h-dvh" : "relative z-10 flex min-h-dvh flex-col items-center justify-center px-5 pb-20 pt-28"}
        >
          {bare ? children : <div className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"}`}>{children}</div>}
        </motion.main>
      </AnimatePresence>

      <footer className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center gap-3 text-[11px] text-[#16152b]/45">
        <Link href="/terms" className="pointer-events-auto hover:text-[#16152b]">Terms</Link>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="pointer-events-auto hover:text-[#16152b]">Privacy</Link>
      </footer>
    </div>
  );
}
