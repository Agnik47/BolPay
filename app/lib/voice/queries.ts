import "server-only";
import { formatDate, formatMoney } from "@/app/lib/merchant/format";
import { calculatePay } from "@/app/lib/merchant/incentives";
import { getPeriod, getToday } from "@/app/lib/server/context";
import { getDb, getViewDb } from "@/app/lib/server/db";
import { advanceAmount } from "@/app/lib/advance/recovery";
import { myAdvanceState } from "@/app/lib/server/advance-service";
import type { Who } from "./knowledge";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const some = (names: string[], max = 6) => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`);

/** What the assistant says when asked what it can do. Kept short because it is read aloud; the screen has a fuller Help view. */
export const HELP_ANSWER =
  "I can mark attendance, record overtime and deliveries, calculate and approve payouts, retry failed payments, add or edit workers, change pay rules, open screens, and answer questions about attendance and payments. Anything that moves money asks you to confirm first. You can speak in any language and chain steps in one sentence. Tap Help for examples.";

export const HELP_ANSWER_WORKER =
  "I can tell you how much you've earned this period, check your emergency advance limit and request, send an advance request to your employer, and explain how BolPay works. Just ask in your own language.";

export const HELP_ANSWER_SUPERVISOR =
  "I can mark attendance, record overtime and deliveries, calculate pay for your team, open screens, and answer questions about attendance. Approving payouts, editing workers and changing pay rules are for the owner. You can speak in any language and chain steps in one sentence. Tap Help for examples.";

/**
 * Read-only answers computed from stored records. Everything here is deterministic: the model only
 * picks which question is being asked.
 */
export function answerQuery(kind: string, o: { workerIds: string[] | null; date: string; n: number | null; role?: "owner" | "supervisor" | "worker"; who?: Who }): string {
  // A worker only ever gets their own information; staff never get the worker-only kinds.
  if (o.role === "worker" && kind !== "help" && !kind.startsWith("my_")) return "I can only tell you about your own pay and advances. Ask your employer for anything else.";
  if (kind.startsWith("my_") && (o.role !== "worker" || !o.who?.workerId)) return "That question is for workers asking about their own pay.";
  const db = getViewDb();
  const nameOf = (id: string) => db.workers.find((w) => w.id === id)?.name ?? "Unknown";
  const txs = db.transactions.filter((t) => t.kind !== "advance" && t.periodLabel === getPeriod().label);
  const payouts = db.payouts.filter((p) => p.periodId === getPeriod().id);
  const active = db.workers.filter((w) => w.status === "active");
  const records = db.attendance.filter((r) => r.date >= getPeriod().start && r.date <= getPeriod().end);
  const pay = (id: string) => {
    const w = db.workers.find((x) => x.id === id)!;
    return calculatePay(w, records, db.rules).total;
  };
  const by = (s: string) => txs.filter((t) => t.status === s);
  const pending = payouts.filter((p) => p.status === "pending");
  const review = payouts.filter((p) => p.status === "needs_review");
  const dateLabel = o.date === getToday() ? "today" : formatDate(o.date);
  /** The workers a question is about: the selection when one was given, otherwise everyone active. */
  const chosen = o.workerIds ? active.filter((w) => o.workerIds!.includes(w.id)) : active;
  const inCity = (() => {
    const cities = new Set(chosen.map((w) => w.city));
    return o.workerIds && cities.size === 1 ? ` in ${[...cities][0]}` : "";
  })();
  const breakdown = (id: string) => {
    const w = db.workers.find((x) => x.id === id)!;
    return calculatePay(w, records, db.rules);
  };
  const describePay = (b: ReturnType<typeof breakdown>) => {
    const parts = [`base ${formatMoney(b.basePay)} for ${b.payDays} day${b.payDays === 1 ? "" : "s"}`];
    if (b.overtimePay) parts.push(`overtime ${formatMoney(b.overtimePay)} (${b.overtimeHours} hours)`);
    if (b.tierBonus) parts.push(`delivery tier bonus ${formatMoney(b.tierBonus)}`);
    if (b.performanceIncentive) parts.push(`extra-delivery incentive ${formatMoney(b.performanceIncentive)} (${b.extraUnits} extra)`);
    if (b.attendanceBonus) parts.push(`attendance bonus ${formatMoney(b.attendanceBonus)}`);
    return parts.join(", ");
  };

  switch (kind) {
    case "payout_summary": {
      if (txs.length === 0 && pending.length === 0 && review.length === 0) return "There are no payouts for this period yet.";
      const parts = [`${by("completed").length} completed`, `${by("processing").length} processing`, `${by("failed").length} failed`];
      const extra = [pending.length ? `${pending.length} awaiting approval` : "", review.length ? `${review.length} need review` : ""].filter(Boolean);
      return `This period: ${parts.join(", ")}${extra.length ? `, and ${extra.join(" and ")}` : ""}.`;
    }
    case "failed_payments": {
      const f = by("failed");
      return f.length ? `${plural(f.length, "payment")} failed: ${some(f.map((t) => `${nameOf(t.workerId)} (${t.failureReason ?? "unknown reason"})`), 4)}.` : "No payments have failed.";
    }
    case "completed_payments":
      return `${plural(by("completed").length, "payment")} completed.`;
    case "processing_payments": {
      const p = by("processing");
      return p.length ? `${plural(p.length, "payment")} still processing: ${some(p.map((t) => nameOf(t.workerId)))}.` : "Nothing is processing.";
    }
    case "pending_payouts": {
      const proc = by("processing");
      if (!pending.length && !proc.length) return "Nothing is pending.";
      const sum = pending.reduce((s, p) => s + p.amount, 0);
      return `${plural(pending.length, "payout")} awaiting your approval (${formatMoney(sum)})${pending.length ? `: ${some(pending.map((p) => nameOf(p.workerId)))}` : ""}; ${proc.length} processing.`;
    }
    case "needs_review":
      return review.length
        ? `${plural(review.length, "worker")} need review: ${some(review.map((p) => `${nameOf(p.workerId)} (${p.reviewReasons?.[0] ?? "records need checking"})`), 3)}.`
        : "No payouts are flagged for review.";
    case "missing_attendance": {
      const ids = new Set(db.attendance.filter((r) => r.date === o.date).map((r) => r.workerId));
      const missing = active.filter((w) => !ids.has(w.id) && (!o.workerIds || o.workerIds.includes(w.id)));
      return missing.length ? `${plural(missing.length, "worker")} with no attendance ${dateLabel}: ${some(missing.map((w) => w.name))}.` : `Everyone has attendance recorded ${dateLabel}.`;
    }
    case "attendance_summary": {
      const day = db.attendance.filter((r) => r.date === o.date && active.some((w) => w.id === r.workerId));
      const c = (s: string) => day.filter((r) => r.status === s).length;
      const unmarked = active.length - day.length;
      return `${dateLabel}: ${c("present")} present, ${c("half")} half day, ${c("absent")} absent, ${c("leave")} on leave, ${unmarked} not marked.`;
    }
    case "worker_pay": {
      const ids = (o.workerIds ?? []).slice(0, 3);
      if (!ids.length) return "Which worker's pay do you want?";
      return ids.map((id) => `${nameOf(id)}: ${formatMoney(pay(id))} so far this period`).join("; ") + ".";
    }
    case "totals": {
      const total = chosen.reduce((s, w) => s + pay(w.id), 0);
      const ids = new Set(chosen.map((w) => w.id));
      const waiting = pending.filter((p) => ids.has(p.workerId)).reduce((s, p) => s + p.amount, 0);
      return `Calculated payout for the period is ${formatMoney(total)} across ${plural(chosen.length, "worker")}${inCity}. ${formatMoney(waiting)} is waiting for approval.`;
    }
    case "top_earners": {
      const n = Math.min(Math.max(Math.round(o.n ?? 3), 1), 10);
      const ranked = active.map((w) => ({ name: w.name, total: pay(w.id) })).sort((a, b) => b.total - a.total).slice(0, n);
      return `Top ${n}: ${ranked.map((r) => `${r.name} ${formatMoney(r.total)}`).join(", ")}.`;
    }
    case "worker_list": {
      const list = o.workerIds ? active.filter((w) => o.workerIds!.includes(w.id)) : active;
      return `${plural(list.length, "active worker")}: ${some(list.map((w) => w.name), 10)}.`;
    }
    case "rules_summary": {
      const r = db.rules;
      const tiers = r.deliveryTiers.map((t) => `${t.minUnits}+ deliveries ₹${t.bonus}`).join(", ") || "none";
      return `Rules v${r.version}: daily tiers ${tiers}; overtime ${r.overtimeMultiplier} times hourly; attendance bonus ₹${r.attendanceBonus} at ${Math.round(r.attendanceThreshold * 100)} percent; ₹${r.ratePerExtraUnit} per delivery above ${r.dailyUnitTarget} a day.`;
    }
    case "worker_count":
      return `${plural(chosen.length, "active worker")}${inCity}.`;
    case "worker_details": {
      const list = (o.workerIds ? chosen : []).slice(0, 3);
      if (!list.length) return "Which worker do you mean?";
      return list.map((w) => `${w.name}: ${w.role} in ${w.city}, daily wage ${formatMoney(w.dailyWage)}, ${w.status}`).join("; ") + ".";
    }
    case "pay_breakdown": {
      const ids = (o.workerIds ?? []).slice(0, 2);
      if (!ids.length) return "Which worker's pay should I explain?";
      return ids.map((id) => { const b = breakdown(id); return `${nameOf(id)} has earned ${formatMoney(b.total)} so far this period: ${describePay(b)}.`; }).join(" ");
    }
    case "absent_list": {
      const day = db.attendance.filter((r) => r.date === o.date && active.some((w) => w.id === r.workerId));
      const absent = day.filter((r) => r.status === "absent").map((r) => nameOf(r.workerId));
      const leave = day.filter((r) => r.status === "leave").map((r) => nameOf(r.workerId));
      if (!day.length) return `No attendance has been recorded ${dateLabel}.`;
      if (!absent.length && !leave.length) return `Nobody was absent ${dateLabel}.`;
      return [absent.length ? `Absent ${dateLabel}: ${some(absent, 8)} (${absent.length})` : "", leave.length ? `on leave: ${some(leave, 8)}` : ""].filter(Boolean).join("; ") + ".";
    }
    case "total_paid": {
      const done = by("completed");
      return done.length ? `${formatMoney(done.reduce((s, t) => s + t.amount, 0))} has been paid out this period across ${plural(done.length, "completed payment")}.` : "Nothing has been paid out yet this period.";
    }
    case "incentive_total": {
      const rows = chosen.map((w) => breakdown(w.id));
      const tier = rows.reduce((s, b) => s + b.tierBonus, 0);
      const extra = rows.reduce((s, b) => s + b.performanceIncentive, 0);
      const att = rows.reduce((s, b) => s + b.attendanceBonus, 0);
      return `Incentives this period total ${formatMoney(tier + extra + att)} across ${plural(chosen.length, "worker")}${inCity}: delivery tiers ${formatMoney(tier)}, extra deliveries ${formatMoney(extra)}, attendance bonuses ${formatMoney(att)}.`;
    }
    case "worker_payment_status": {
      const ids = (o.workerIds ?? []).slice(0, 4);
      if (!ids.length) return "Which worker's payment do you mean?";
      return ids.map((id) => {
        const po = payouts.filter((p) => p.workerId === id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
        const tx = txs.filter((t) => t.workerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (!po && !tx) return `${nameOf(id)}: no payout has been prepared this period`;
        if (tx) return `${nameOf(id)}: ${formatMoney(tx.amount)} ${tx.status === "completed" ? "paid" : tx.status === "failed" ? `failed (${tx.failureReason ?? "reason not given"})` : "is processing, not confirmed by Cashfree yet"}`;
        return `${nameOf(id)}: ${formatMoney(po!.amount)} ${po!.status === "pending" ? "is waiting for approval" : po!.status === "needs_review" ? "needs review before it can be approved" : po!.status === "rejected" ? "was rejected" : "was approved"}`;
      }).join("; ") + ".";
    }
    case "advance_summary": {
      const visible = new Set(db.workers.map((w) => w.id));
      const adv = (getDbAdvances()).filter((a) => visible.has(a.workerId));
      if (!adv.length) return "There are no emergency advance requests.";
      const n = (s: string) => adv.filter((a) => a.status === s).length;
      const owed = adv.filter((a) => a.status === "paid").reduce((s, a) => s + Math.max(0, advanceAmount(a) - (a.recovery?.recovered ?? 0)), 0);
      return `${n("pending_review")} advance request${n("pending_review") === 1 ? "" : "s"} waiting for approval, ${n("paying")} being paid, ${n("paid")} paid, ${n("payment_failed")} with a failed payment. ${formatMoney(owed)} is still to be recovered from payroll.`;
    }
    case "my_pay": {
      const id = o.who!.workerId!;
      if (!db.workers.some((w) => w.id === id)) return "I couldn't find your worker record.";
      const b = breakdown(id);
      if (b.periodDays === 0) return "No attendance has been recorded for you this period yet, so there is nothing earned to show.";
      return `So far this period you have earned ${formatMoney(b.total)}: ${describePay(b)}. This is calculated from your attendance and is not yet paid out.`;
    }
    case "my_advance": {
      const s = myAdvanceState(o.who!.workerId!);
      const latest = s.requests[0];
      const status = latest
        ? ({ pending_review: "is waiting for your employer's answer", paying: "was approved and the payment is being sent", paid: "was paid", rejected: "was not approved", cancelled: "was cancelled", expired: "expired without an answer", payment_failed: "was approved but the payment didn't go through" } as Record<string, string>)[latest.status] ?? latest.status
        : null;
      const limit = s.blocks.length ? `You can't request an advance right now: ${s.blocks[0]}` : `You can request up to ${formatMoney(s.limit.available)} right now.`;
      return `${limit}${latest ? ` Your latest request for ${formatMoney(latest.amount)} ${status}.` : " You have no advance requests yet."}`;
    }
    case "help":
      return o.role === "worker" ? HELP_ANSWER_WORKER : o.role === "supervisor" ? HELP_ANSWER_SUPERVISOR : HELP_ANSWER;
    default:
      return "I can't answer that yet.";
  }
}

/** Advance requests of the current dataset (the voice layer filters them to the people the caller may see). */
function getDbAdvances() {
  return getDb().advances ?? [];
}
