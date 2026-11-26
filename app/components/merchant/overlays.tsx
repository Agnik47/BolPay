"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./ui";

/** Traps Tab inside `root`, closes on Escape, and returns focus to whatever opened it. */
function useOverlay(open: boolean, onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  // Callers pass a new onClose on every render. It must not be a dependency of the effect below, or each
  // keystroke would re-run it and yank focus back to the first field (typing a note would edit the amount).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = root.current;
    node?.querySelector<HTMLElement>("[data-autofocus], button, a[href], input, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !node) return;
      const f = [...node.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")];
      if (!f.length) return;
      const [first, last] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [open]);
  return root;
}

/** Confirmation for destructive or financial actions. Keep `children` to the exact facts being confirmed. */
export function ConfirmDialog({ open, title, children, confirmLabel, tone = "primary", busy = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const root = useOverlay(open, busy ? () => {} : onCancel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div ref={root} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]">
        <h2 id={`${id}-t`} className="text-lg font-semibold text-slate-900">{title}</h2>
        <div id={`${id}-d`} className="mt-2 text-sm text-slate-600">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy} data-autofocus>Cancel</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

