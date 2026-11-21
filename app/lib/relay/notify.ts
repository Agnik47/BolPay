import "server-only";
import { calculatePay } from "@/app/lib/merchant/incentives";
import { getPeriod } from "@/app/lib/server/context";
import { getDb, logAudit } from "@/app/lib/server/db";

/**
 * BolPay -> Cashfree Relay "Payroll alert" agent. The agent is built on the Relay canvas with an Inbound Webhook
 * trigger; BolPay POSTs a JSON summary to that trigger's URL (RELAY_WEBHOOK_PAYROLL) and Relay does the rest
 * (for example, sends an email). Only totals and counts go out: no UPI ids, bank details or secrets, and
 * nothing here asks Relay to move money.
 */
export const payrollWebhook = () => process.env.RELAY_WEBHOOK_PAYROLL?.trim() || "";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function payrollReadyEvent() {
  const db = getDb();
  const period = getPeriod();
  const records = db.attendance.filter((a) => a.date >= period.start && a.date <= period.end);
  const active = db.workers.filter((w) => w.status === "active");
  const pending = db.payouts.filter((p) => p.periodId === period.id && p.status === "pending");
  const review = db.payouts.filter((p) => p.periodId === period.id && p.status === "needs_review");
  const pendingAmount = r2(pending.reduce((s, p) => s + p.amount, 0));
  return {
    event: "payroll.ready",
    period: period.label,
    workers: active.length,
    calculatedTotal: r2(active.reduce((s, w) => s + calculatePay(w, records, db.rules).total, 0)),
    awaitingApproval: { count: pending.length, amount: pendingAmount },
    needsReview: { count: review.length },
    summary: `${pending.length} payouts (₹${pendingAmount}) are waiting for approval${review.length ? `, ${review.length} need review` : ""}.`,
  };
}

export interface RelayResult {
  sent: boolean;
  status?: number;
  reason?: string;
}

export async function sendPayrollToRelay(actor = "owner"): Promise<RelayResult & { event: ReturnType<typeof payrollReadyEvent> }> {
  const event = payrollReadyEvent();
  const url = payrollWebhook();
  if (!url) return { sent: false, reason: "RELAY_WEBHOOK_PAYROLL is not set in .env.", event };
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: "BolPay", sentAt: new Date().toISOString(), ...event }), signal: AbortSignal.timeout(15_000), cache: "no-store" });
    logAudit("relay.event", `payroll.ready -> ${res.status}`, undefined, actor);
    if (res.ok) return { sent: true, status: res.status, event };
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    return { sent: false, status: res.status, reason: `Relay answered ${res.status}${body?.detail ? `: ${body.detail}` : ""}. ${res.status === 404 ? "Switch the agent to Active in Relay and check the URL is the current one." : ""}`.trim(), event };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Could not reach Relay.", event };
  }
}
