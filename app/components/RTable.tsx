"use client";

import { useEffect, useRef, type TableHTMLAttributes } from "react";

/**
 * A normal table on wide screens; on phones each row becomes a card with "Column: value" lines (styles in
 * globals.css under .rtable), so nothing is cut off or needs sideways scrolling. Column names are copied from the
 * header cells onto each body cell, so callers write ordinary table markup.
 */
export function RTable({ className = "", children, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    // Headers that only exist for screen readers, or that name the card's title column, don't need a label.
    const skip = new Set(["", "actions", "details", "worker", "open"]);
    const labels = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    for (const row of table.querySelectorAll("tbody tr")) {
      [...row.children].forEach((cell, i) => {
        const label = labels[i] ?? "";
        if (cell.hasAttribute("colspan") || skip.has(label.toLowerCase())) cell.removeAttribute("data-label");
        else cell.setAttribute("data-label", label);
      });
    }
  });
  return (
    <table ref={ref} className={`rtable ${className}`} {...rest}>
      {children}
    </table>
  );
}
