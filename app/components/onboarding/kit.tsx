"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { IconAlert, IconDone } from "@/app/components/icons";

const EASE = [0.22, 1, 0.36, 1] as const;
const INK = "text-[#16152b]";

/* ----------------------------------------------------------------- headings */

/** A big centred headline that rises in word by word. `accent` is a word that gets the colour wash. */
export function Title({ children, accent, className = "" }: { children: string; accent?: string; className?: string }) {
  const reduce = useReducedMotion();
  const words = children.split(" ");
  return (
    <h1 className={`text-balance text-center font-[family-name:var(--font-display)] text-[clamp(2rem,5.4vw,3.5rem)] font-semibold leading-[1.08] tracking-tight ${INK} ${className}`}>
      {words.map((w, i) => {
        const hot = accent && w.replace(/[.,!?]/g, "") === accent;
        return (
          <span key={i} className="inline-block overflow-hidden pb-[0.12em] align-top">
            <motion.span
              className={`inline-block ${hot ? "bg-gradient-to-r from-[#ff7a45] via-[#ff4f6d] to-[#7c5cff] bg-clip-text text-transparent" : ""}`}
              initial={reduce ? false : { y: "110%" }}
              animate={{ y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.08 + i * 0.06 }}
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </motion.span>
          </span>
        );
      })}
    </h1>
  );
}

export function Sub({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mx-auto mt-4 max-w-md text-balance text-center text-[0.98rem] leading-relaxed text-[#16152b]/55 ${className}`}>{children}</p>;
}

export function Caps({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[#16152b]/45">{children}</p>;
}

/* ------------------------------------------------------------------- inputs */

/**
 * A borderless input in the centre of the page, with a single line under it that lights up when you focus.
 * No box: the line is the field.
 */
export function LineInput({ className = "", wrapClass = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { wrapClass?: string }) {
  return (
    <div className={`group relative mx-auto w-full max-w-lg ${wrapClass}`}>
      <input
        {...props}
        className={`w-full bg-transparent py-5 text-center font-[family-name:var(--font-display)] text-[clamp(1.5rem,4vw,2.25rem)] font-medium ${INK} outline-none placeholder:text-[#16152b]/22 [&:-webkit-autofill]:[transition:background-color_99999s_ease-in-out_0s] [&:-webkit-autofill]:[-webkit-text-fill-color:#16152b] ${className}`}
      />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#16152b]/30 to-transparent" />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-center scale-x-0 bg-gradient-to-r from-[#ffb020] via-[#ff4f6d] to-[#7c5cff] transition-transform duration-500 group-focus-within:scale-x-100" />
      <span aria-hidden className="pointer-events-none absolute inset-x-6 -bottom-6 h-16 origin-top scale-y-0 bg-[radial-gradient(ellipse_at_top,rgba(255,93,115,0.28),transparent_70%)] opacity-0 blur-md transition duration-500 group-focus-within:scale-y-100 group-focus-within:opacity-100" />
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mx-auto mt-5 flex max-w-md items-start justify-center gap-2 text-center text-sm font-medium text-[#d7263d]">
      <IconAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </motion.p>
  );
}

/* ------------------------------------------------------------------ buttons */

const PILL =
  "relative inline-flex h-14 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full px-10 text-base font-semibold text-white transition-[transform,box-shadow,opacity] duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f766e] disabled:cursor-not-allowed disabled:opacity-35 enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 bg-gradient-to-r from-[#0b6b63] via-[#0e8a7f] to-[#16a394] shadow-[0_14px_34px_-12px_rgba(15,118,110,0.7)] enabled:hover:shadow-[0_20px_40px_-12px_rgba(15,118,110,0.85)]";
const SHEEN = "pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover/btn:translate-x-full";

/** The main button: a teal gradient pill with a sheen that sweeps across on hover. */
export function Pill({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={`group/btn ${PILL} ${className}`}>
      <span aria-hidden className={SHEEN} />
      <span className="relative flex items-center gap-2">{children}</span>
    </button>
  );
}

export function PillLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`group/btn ${PILL} ${className}`}>
      <span aria-hidden className={SHEEN} />
      <span className="relative flex items-center gap-2">{children}</span>
    </Link>
  );
}

/** A quiet text button, for Skip and secondary actions. */
export function TextButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={`rounded-full px-5 py-3 text-sm font-medium text-[#16152b]/55 transition hover:text-[#16152b] focus-visible:outline-2 focus-visible:outline-[#16152b] disabled:opacity-40 ${className}`}>
      {children}
    </button>
  );
}

/** The step's action row: the main button, with an optional skip underneath, both centred. */
export function Actions({ children, onSkip, skipLabel = "Skip for now", busy }: { children: ReactNode; onSkip?: () => void; skipLabel?: string; busy?: boolean }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-1">
      {children}
      {onSkip && (
        <TextButton onClick={onSkip} disabled={busy}>
          {skipLabel}
        </TextButton>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- tiles */

const TILE_BASE =
  "group relative flex min-h-[148px] w-full flex-col items-start justify-start overflow-hidden rounded-[30px] p-6 text-left transition-[transform,box-shadow,background-color] duration-500 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#16152b]";

function TileBody({ title, caption, art, selected, tall }: { title: string; caption?: string; art?: ReactNode; selected?: boolean; tall?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <>
      <span aria-hidden className={`absolute inset-0 bg-gradient-to-br from-[#ffe9c9] via-[#ffd9cf] to-[#e6dcff] transition-opacity duration-500 ${selected ? "opacity-100" : "opacity-0"}`} />
      <span className={`relative z-10 ${tall ? "pr-2" : "pr-16"}`}>
        <span className={`block font-[family-name:var(--font-display)] text-[1.35rem] font-semibold leading-tight ${INK}`}>{title}</span>
        {caption && <span className="mt-1.5 block font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#16152b]/45">{caption}</span>}
      </span>
      {art && <span aria-hidden className={`pointer-events-none absolute -bottom-3 -right-3 origin-bottom-right transition-transform duration-500 group-hover:-rotate-3 group-hover:scale-[1.07] ${tall ? "w-32" : "w-[8.5rem] sm:w-36"}`}>{art}</span>}
      <AnimatePresence>
        {selected && (
          <motion.span
            initial={reduce ? false : { scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={reduce ? undefined : { scale: 0 }}
            transition={{ type: "spring", stiffness: 480, damping: 22 }}
            className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full bg-[#16152b] text-white"
          >
            <IconDone className="size-5" />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

const TILE_SURFACE = (selected?: boolean, tall?: boolean) =>
  `${TILE_BASE} ${tall ? "min-h-[212px]" : ""} ${selected ? "-translate-y-1 bg-white shadow-[0_28px_60px_-26px_rgba(255,93,115,0.6)]" : "bg-white/70 shadow-[0_18px_46px_-28px_rgba(22,21,43,0.4)] backdrop-blur hover:-translate-y-1 hover:bg-white/90"}`;

/** A big illustrated choice. No outline: a selected tile lifts and washes with colour. */
export function Tile({ title, caption, art, selected, onClick, tall }: { title: string; caption?: string; art?: ReactNode; selected?: boolean; onClick: () => void; tall?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={!!selected} onClick={onClick} className={TILE_SURFACE(selected, tall)}>
      <TileBody title={title} caption={caption} art={art} selected={selected} tall={tall} />
    </button>
  );
}

/** The same tile as a link (for choices that leave the page). */
export function TileLink({ href, title, caption, art, tall }: { href: string; title: string; caption?: string; art?: ReactNode; tall?: boolean }) {
  return (
    <Link href={href} className={TILE_SURFACE(false, tall)}>
      <TileBody title={title} caption={caption} art={art} tall={tall} />
    </Link>
  );
}

/** Staggered entrance for a grid of tiles. `lastSpan` lets an odd last tile stretch across both columns. */
export function Stagger({ children, className = "", role, label, lastSpan = false }: { children: ReactNode[]; className?: string; role?: string; label?: string; lastSpan?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div role={role} aria-label={label} className={className}>
      {children.map((c, i) => (
        <motion.div key={i} className={lastSpan && i === children.length - 1 ? "sm:col-span-2" : ""} initial={reduce ? false : { opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.25 + i * 0.07 }}>
          {c}
        </motion.div>
      ))}
    </div>
  );
}

/** A round-cornered option for short values (team size). */
export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`h-14 rounded-full px-7 font-[family-name:var(--font-display)] text-lg font-semibold transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#16152b] ${
        selected ? "-translate-y-0.5 bg-[#16152b] text-white shadow-[0_16px_30px_-14px_rgba(22,21,43,0.7)]" : "bg-white/70 text-[#16152b]/70 shadow-[0_10px_26px_-18px_rgba(22,21,43,0.5)] backdrop-blur hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

/** A filled (not outlined) field for forms inside a panel. */
export function FillInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full rounded-2xl bg-[#16152b]/[0.05] px-4 text-base ${INK} outline-none transition placeholder:text-[#16152b]/30 focus:bg-white focus:shadow-[0_0_0_3px_rgba(255,93,115,0.28)] ${className}`}
    />
  );
}

export function FieldCaption({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 ml-1 block text-xs font-medium text-[#16152b]/50">{children}</span>;
}

/** A compact button for actions inside a panel. */
export function SoftButton({ tone = "dark", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "dark" | "light" }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full px-6 text-sm font-semibold transition enabled:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16152b] disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "dark" ? "bg-[#16152b] text-white" : "bg-[#16152b]/[0.07] text-[#16152b] hover:bg-[#16152b]/[0.12]"
      } ${className}`}
    />
  );
}

/** The white panel that holds a small form under a row of tiles. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-xl rounded-[28px] bg-white/85 p-6 shadow-[0_24px_60px_-30px_rgba(22,21,43,0.5)] backdrop-blur ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ flourish */

/** A burst of paper confetti that plays once. Skipped for reduced motion. */
export function Celebrate() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const colors = ["#ffb020", "#ff5d73", "#12a594", "#7c5cff", "#ff8a5c"];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
      {Array.from({ length: 44 }, (_, i) => {
        const angle = (i / 44) * Math.PI * 2 + (i % 3) * 0.2;
        const dist = 120 + (i % 7) * 34;
        return (
          <motion.span
            key={i}
            className="absolute h-3 w-2 rounded-[2px]"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.8 + 90, opacity: 0, scale: 0.5, rotate: 300 + i * 23 }}
            transition={{ duration: 1.6 + (i % 5) * 0.15, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          />
        );
      })}
    </div>
  );
}

/** A link the owner hands out: shown with Copy and a WhatsApp share. */
export function InviteLinkCard({ path, name, businessLabel }: { path: string; name: string; businessLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  const text = `${name ? `Hi ${name.split(" ")[0]}, ` : ""}you've been invited to ${businessLabel || "our team"} on BolPay. Set up your login here: ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is still selectable */
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE, duration: 0.5 }} className="mx-auto w-full max-w-lg rounded-[28px] bg-white/85 p-6 text-center shadow-[0_24px_60px_-28px_rgba(22,21,43,0.5)] backdrop-blur">
      <p className={`font-[family-name:var(--font-display)] text-lg font-semibold ${INK}`}>Link for {name || "your invitee"}</p>
      <p className="mt-0.5 text-xs text-[#16152b]/50">Works once. Expires in 7 days.</p>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="mt-4 w-full bg-[#16152b]/[0.04] px-4 py-3 text-center font-mono text-xs text-[#16152b]/75 outline-none" />
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={copy} className="h-11 rounded-full bg-[#16152b] px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5">
          {copied ? "Copied" : "Copy link"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center rounded-full bg-[#25d366]/15 px-6 text-sm font-semibold text-[#0b7a3b] transition hover:-translate-y-0.5 hover:bg-[#25d366]/25">
          Share on WhatsApp
        </a>
      </div>
    </motion.div>
  );
}
