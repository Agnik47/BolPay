import "server-only";
import { calculatePay } from "@/app/lib/merchant/incentives";
import { getPeriod } from "@/app/lib/server/context";
import { getDb } from "@/app/lib/server/db";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What this business owes its workers right now, from BolPay's own records (INR). The agent never computes this itself. */
export function payrollPosition() {
  const db = getDb();
  const period = getPeriod();
  const active = db.workers.filter((w) => w.status === "active");
  const records = db.attendance.filter((a) => a.date >= period.start && a.date <= period.end);
  const txs = db.transactions.filter((t) => t.kind !== "advance" && t.periodLabel === period.label);
  const sum = (xs: { amount: number }[]) => r2(xs.reduce((s, x) => s + x.amount, 0));
  const pending = db.payouts.filter((p) => p.periodId === period.id && p.status === "pending");
  const failed = txs.filter((t) => t.status === "failed");
  const processing = txs.filter((t) => t.status === "processing");
  const completed = txs.filter((t) => t.status === "completed");
  return {
    currency: "INR",
    period: period.label,
    activeWorkers: active.length,
    calculatedPeriodTotal: r2(active.reduce((s, w) => s + calculatePay(w, records, db.rules).total, 0)),
    awaitingApproval: { count: pending.length, amount: sum(pending) },
    failedNeedingRetry: { count: failed.length, amount: sum(failed) },
    processing: { count: processing.length, amount: sum(processing) },
    alreadyPaid: { count: completed.length, amount: sum(completed) },
    /** Money still to be sent this period if every pending and failed payout goes out. */
    stillToSend: r2(sum(pending) + sum(failed)),
  };
}
