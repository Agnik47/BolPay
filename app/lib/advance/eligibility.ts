/**
 * Emergency-advance eligibility. Pure: no imports of runtime code, so it runs on the server and in
 * scripts/advance-check.mjs. The caller supplies the pay breakdown from the existing payroll engine
 * (calculatePay); nothing here calculates wages, and nothing here trusts the client or a model.
 */
import type { AdvanceEligibility, AdvancePolicy, AdvanceRequest, PayBreakdown, Payout, Worker } from "../merchant/types.ts";

export const DEFAULT_ADVANCE_POLICY: AdvancePolicy = {
  percentLimit: 25,
  maxAmount: 5000,
  minServiceDays: 30,
  maxOutstanding: 1,
  requireHumanApproval: true,
  expireAfterHours: 72,
  maxRecoveryPercentOfPayout: 100,
  version: 1,
};

/** Requests that still need an answer or a payment. */
export const OPEN_STATUSES: AdvanceRequest["status"][] = ["submitted", "pending_review", "approved", "paying"];
/** Money advanced; counts as outstanding until recovered from payroll. */
const OUTSTANDING_STATUSES: AdvanceRequest["status"][] = ["approved", "paying", "paid"];

export interface EligibilityInput {
  worker: Worker | undefined;
  /** Result of the existing UPI_ID check on the worker's payout UPI (kept in one place: cashfree/payouts.ts). */
  upiValid: boolean;
  /** Pay breakdown for this worker and period from calculatePay. */
  pay: PayBreakdown;
  /** Payouts for this worker (any period). */
  payouts: Pick<Payout, "periodId" | "status" | "amount" | "grossAmount">[];
  /** This worker's advance requests. */
  advances: Pick<AdvanceRequest, "id" | "status" | "amount" | "approvedAmount">[];
  /** Amount already recovered from payroll, per advance id. */
  recovered?: Record<string, number>;
  policy: AdvancePolicy;
  periodId: string;
  rulesVersion: number;
  today: string;
  now: string;
  /** Requested amount, if known. Checked against what is available. */
  amount?: number;
  /** Ignore this request id when looking for other open requests (used when re-checking one). */
  excludeId?: string;
}

const dayDiff = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function evaluateEligibility(i: EligibilityInput): AdvanceEligibility {
  const blocks: string[] = [];
  const flags: string[] = [];
  const earnedBase = i.pay.basePay;
  const earnedOvertime = i.pay.overtimePay;
  const paidPayroll = i.payouts.filter((p) => p.periodId === i.periodId && p.status === "approved").reduce((s, p) => s + (p.grossAmount ?? p.amount), 0); // gross: the wages were paid, part of them as advance recovery

  const mine = i.advances.filter((a) => a.id !== i.excludeId);
  const outstandingAdvances = mine.filter((a) => OUTSTANDING_STATUSES.includes(a.status));
  const remaining = (a: (typeof mine)[number]) => Math.max(0, (a.approvedAmount ?? a.amount) - (i.recovered?.[a.id] ?? 0));
  const unrecovered = outstandingAdvances.filter((a) => remaining(a) > 0);
  const outstanding = unrecovered.reduce((s, a) => s + remaining(a), 0);

  const unpaid = Math.max(0, earnedBase + earnedOvertime - paidPayroll);
  const limit = Math.floor((i.policy.percentLimit / 100) * unpaid);
  const available = Math.max(0, Math.min(i.policy.maxAmount, limit - outstanding));

  const w = i.worker;
  if (!w) blocks.push("Worker record not found.");
  else {
    if (w.status !== "active") blocks.push("Your profile is not active.");
    if (!i.upiValid) blocks.push("No valid UPI ID is on file, so money can't be sent to you.");
    const served = dayDiff(w.joinedOn, i.today);
    if (!Number.isFinite(served)) flags.push("Joining date is missing or invalid.");
    else if (served < i.policy.minServiceDays) blocks.push(`Advances are available after ${i.policy.minServiceDays} days of service.`);
  }
  if (mine.some((a) => OPEN_STATUSES.includes(a.status) && (a.status === "submitted" || a.status === "pending_review"))) {
    blocks.push("You already have a request waiting for an answer.");
  }
  if (unrecovered.length >= i.policy.maxOutstanding) {
    blocks.push("A previous advance has not been recovered yet.");
  }
  if (i.pay.periodDays === 0) flags.push("No attendance has been recorded for you this period.");
  if (earnedBase + earnedOvertime <= 0) blocks.push("No wages have been earned yet this period.");
  else if (available <= 0 && !blocks.length) blocks.push("Your available advance limit is ₹0 right now.");

  if (i.amount !== undefined) {
    if (!Number.isInteger(i.amount) || i.amount < 1) blocks.push("The amount must be a whole number of rupees, at least ₹1.");
    else if (i.amount > i.policy.maxAmount) blocks.push(`The most you can request at once is ₹${i.policy.maxAmount}.`);
    else if (i.amount > available && available > 0) blocks.push(`That is more than your available limit of ₹${available}.`);
  }

  return {
    earnedBase,
    earnedOvertime,
    paidPayroll,
    outstanding,
    limit,
    available,
    blocks,
    flags,
    policyVersion: i.policy.version,
    rulesVersion: i.rulesVersion,
    computedAt: i.now,
  };
}
