/**
 * Advance recovery from payroll. Pure (no runtime imports), so it runs on the server and in
 * scripts/advance-check.mjs. Decides how much of a payout is withheld to repay advances; the server
 * applies the result and only counts an advance as recovered once the payroll transfer completes.
 */
import type { AdvanceRequest, Payout, PayoutDeduction } from "../merchant/types.ts";

/** What was actually sent for an advance. */
export const advanceAmount = (a: Pick<AdvanceRequest, "amount" | "approvedAmount">) => a.approvedAmount ?? a.amount;

export interface OutstandingAdvance {
  id: string;
  /** Paid amount minus recovered, minus what other live payouts already set aside. Always >= 0. */
  remaining: number;
  /** Oldest first, so advances are repaid in the order they were paid. */
  paidAt: string;
}

/** Money set aside for an advance by payouts that haven't finished (pending or approved, recovery not yet applied). */
export function reservedByAdvance(payouts: Pick<Payout, "id" | "status" | "deductions" | "recoveryApplied">[], exceptPayoutId?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of payouts) {
    if (p.id === exceptPayoutId || p.recoveryApplied) continue;
    if (p.status !== "pending" && p.status !== "approved") continue;
    for (const d of p.deductions ?? []) out[d.advanceId] = (out[d.advanceId] ?? 0) + d.amount;
  }
  return out;
}

/** Advances that are paid and still owe something, after subtracting reservations. */
export function outstandingAdvances(
  advances: Pick<AdvanceRequest, "id" | "status" | "amount" | "approvedAmount" | "updatedAt" | "recovery">[],
  reserved: Record<string, number> = {},
): OutstandingAdvance[] {
  return advances
    .filter((a) => a.status === "paid")
    .map((a) => ({
      id: a.id,
      remaining: Math.max(0, advanceAmount(a) - (a.recovery?.recovered ?? 0) - (reserved[a.id] ?? 0)),
      paidAt: a.recovery?.paidAt ?? a.updatedAt,
    }))
    .filter((a) => a.remaining > 0)
    .sort((x, y) => x.paidAt.localeCompare(y.paidAt));
}

export interface RecoveryPlan {
  deductions: PayoutDeduction[];
  total: number;
  /** What is sent to the worker. */
  net: number;
  /** Still owed after this payout; carries to the next payroll. */
  carried: number;
}

/**
 * Withholds from `gross`, oldest advance first. The cap is the smaller of maxRecoveryPercent of gross and
 * gross minus 1 (the worker always receives at least ₹1, which is also Cashfree's minimum). Whole rupees only.
 */
export function planRecovery(gross: number, outstanding: OutstandingAdvance[], maxPercent: number): RecoveryPlan {
  const owed = outstanding.reduce((s, a) => s + a.remaining, 0);
  const pct = Number.isFinite(maxPercent) ? Math.min(100, Math.max(0, maxPercent)) : 100;
  let room = Math.max(0, Math.min(Math.floor((gross * pct) / 100), Math.floor(gross) - 1));
  const deductions: PayoutDeduction[] = [];
  for (const a of outstanding) {
    if (room <= 0) break;
    const take = Math.min(a.remaining, room);
    if (take > 0) {
      deductions.push({ advanceId: a.id, amount: take });
      room -= take;
    }
  }
  const total = deductions.reduce((s, d) => s + d.amount, 0);
  // Round to paise: gross has decimals, and a plain subtraction can leave noise (2.11 - 1 = 1.1099999999999999).
  return { deductions, total, net: Math.round((gross - total) * 100) / 100, carried: owed - total };
}
