"use client";

import type { ReactNode } from "react";
import { Pager, usePaged } from "./Pager";
import { RTable } from "./RTable";

/** For server components: pass the header row and every body row, and this pages and stacks them. */
export function PagedTable({ head, rows, label, className }: { head: ReactNode; rows: ReactNode[]; label: string; className?: string }) {
  const paged = usePaged(rows);
  return (
    <>
      <RTable className={className}>
        <thead>{head}</thead>
        <tbody className="divide-y divide-slate-100">{paged.rows}</tbody>
      </RTable>
      <Pager {...paged} label={label} />
    </>
  );
}
