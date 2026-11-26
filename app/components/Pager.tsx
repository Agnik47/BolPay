"use client";

import { useCallback, useMemo, useState } from "react";

export const PAGE_SIZE = 10;

/**
 * Client-side pagination over an already-loaded list. Pass `resetKey` (the active search or filter) to jump back to
 * page 1 when it changes. The page is clamped, so a list that shrinks never leaves you on an empty page.
 */
export function usePaged<T>(items: T[], size = PAGE_SIZE, resetKey = "") {
  const [state, setState] = useState({ key: resetKey, page: 0 });
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = state.key === resetKey ? Math.min(state.page, pages - 1) : 0;
  const rows = useMemo(() => items.slice(page * size, page * size + size), [items, page, size]);
  const setPage = useCallback((next: number) => setState({ key: resetKey, page: Math.max(0, next) }), [resetKey]);
  return { rows, page, pages, size, total: items.length, setPage };
}

const BTN =
  "h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 sm:h-7";

/** "1–10 of 27" with Previous and Next. Renders nothing when everything fits on one page. */
export function Pager({ page, pages, size, total, setPage, label = "items" }: {
  page: number;
  pages: number;
  size: number;
  total: number;
  setPage: (p: number) => void;
  label?: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
      <span className="tabular-nums">
        {page * size + 1}–{Math.min(total, (page + 1) * size)} of {total}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className={BTN} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="tabular-nums">{page + 1} / {pages}</span>
        <button type="button" className={BTN} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
      </span>
    </nav>
  );
}
