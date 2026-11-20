"use client";

import Link from "next/link";
import { useStore } from "@/app/lib/merchant/store";
import { IconDone } from "../icons";
import { Card, linkClass } from "./ui";

/**
 * What's left after the setup wizard, worked out from the live data so it ticks itself off.
 * The last item is the real finish line: the first payout that actually went through.
 */
export function SetupChecklist() {
  const { workers, transactions, today, attendance } = useStore();
  const active = workers.filter((w) => w.status === "active");
  const markedToday = attendance.some((r) => r.date === today);

  const items = [
    { done: active.length > 0, label: "Add your workers", hint: "Import from Zoho, upload a sheet, or add them by hand.", href: "/workers", cta: "Workers" },
    { done: active.length > 0 && active.every((w) => w.payoutUpi), label: "Give everyone a UPI id", hint: "A worker can't be paid without one.", href: "/workers", cta: "Workers" },
    { done: workers.some((w) => w.supervisorId), label: "Put a supervisor in charge", hint: "Invite one, then assign workers to them.", href: "/workers", cta: "Invite" },
    { done: markedToday, label: "Mark today's attendance", hint: "Tap, or just say it.", href: "/attendance", cta: "Attendance" },
    { done: transactions.some((t) => t.status === "completed"), label: "Send your first payout", hint: "Approve a period's pay and watch it land.", href: "/payouts", cta: "Approvals" },
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <Card title="Finish setting up" actions={<span className="text-xs tabular-nums text-slate-500">{doneCount} of {items.length}</span>} className="mb-5">
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={items.length} aria-label="Setup progress">
        <div className="h-full rounded-full bg-teal-600 transition-[width] duration-700" style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-3 py-2.5">
            <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${i.done ? "bg-emerald-500 text-white" : "border border-slate-300"}`}>
              {i.done && <IconDone className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-medium ${i.done ? "text-slate-400 line-through" : "text-slate-900"}`}>{i.label}</span>
              {!i.done && <span className="block text-xs text-slate-500">{i.hint}</span>}
            </span>
            {!i.done && <Link href={i.href} className={`text-xs ${linkClass}`}>{i.cta}</Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
