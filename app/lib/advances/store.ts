import "server-only";
import { randomBytes } from "node:crypto";
import { calculatePay } from "@/app/lib/merchant/incentives";
import { dateRange, formatDate } from "@/app/lib/merchant/format";
import type { Transaction, Worker } from "@/app/lib/merchant/types";
import { UPI_ID } from "@/app/lib/cashfree/payouts";
import { isLiveCashfree } from "@/app/lib/cashfree/rest";
import { getPeriod, getToday } from "@/app/lib/server/context";
import type { Db } from "@/app/lib/server/db";
import { ADVANCE_RULES, evaluateEligibility, rupees } from "./policy";
import type {
  Actor,
  AdvanceConfig,
  AdvanceRequest,
  EligibilityResult,
  OwnerAdvanceView,
  PurposeCheck,
  WorkerAdvanceSummary,
  WorkerAdvanceView,
} from "./types";

/**
 * Database-level helpers for emergency advances. These only read and write the workspace data (no Cashfree, no
 * agents), so both the agents and the salary payout code can use them without importing each other.
 */

export const advancesOf = (db: Db): AdvanceRequest[] => (db.advances ??= []);

export function configOf(db: Db): AdvanceConfig {
  return (db.advanceConfig ??= { policyPercent: ADVANCE_RULES.policyPercent, ownerAvailable: true, delegation: null });
}

export function addTrail(a: AdvanceRequest, actor: Actor, action: string, detail: string) {
  a.trail.push({ at: new Date().toISOString(), actor, action, detail });
}

export const remainingOf = (a: AdvanceRequest) => Math.max(0, a.amount - a.recovered);

export const transactionOf = (db: Db, a: AdvanceRequest): Transaction | undefined =>
  a.transactionId ? db.transactions.find((t) => t.id === a.transactionId) : undefined;

/** An advance is "open" while it waits for a decision, or was approved but its money has not arrived yet. */
export function isOpen(db: Db, a: AdvanceRequest): boolean {
  if (a.status === "awaiting_approval" || a.status === "escalated" || a.status === "checking") return true;
  return a.status === "approved" && transactionOf(db, a)?.status !== "completed";
}

/** Money paid (or on its way) that has not been taken back from salary yet, oldest first. */
export function outstandingAdvances(db: Db, workerId: string, excludeId?: string) {
  return advancesOf(db)
    .filter((a) => a.workerId === workerId && a.id !== excludeId && a.status === "approved" && remainingOf(a) > 0)
    .filter((a) => {
      const s = transactionOf(db, a)?.status;
      return s === "completed" || s === "processing";
    })
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    .map((a) => ({ id: a.id, remaining: remainingOf(a) }));
}

const sum = (xs: { remaining: number }[]) => xs.reduce((s, x) => s + x.remaining, 0);
export const outstandingTotal = (db: Db, workerId: string, excludeId?: string) => sum(outstandingAdvances(db, workerId, excludeId));

/** What the Manager Agent has already approved on its own today (counts against the daily delegated limit). */
export function agentApprovedToday(db: Db, day: string, excludeId?: string): number {
  return advancesOf(db)
    .filter((a) => a.id !== excludeId && a.status === "approved" && a.approval?.by === "manager_agent" && a.approval.day === day)
    .reduce((s, a) => s + a.amount, 0);
}

const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Runs the Financial Eligibility rules on this worker's real records. `excludeId` leaves one advance out of the
 * counts, so the same request can be checked again (at approval and at payment) without blocking itself.
 */
export function evaluateForWorker(db: Db, worker: Worker, amount: number, excludeId?: string, purposeIn?: PurposeCheck): EligibilityResult {
  const period = getPeriod();
  const today = getToday();
  const records = db.attendance.filter((r) => r.workerId === worker.id && r.date >= period.start && r.date <= period.end && r.date <= today);
  const pay = calculatePay(worker, records, db.rules);
  const salaryAlreadyApproved = db.payouts.some((p) => p.workerId === worker.id && p.periodId === period.id && p.status === "approved");

  const have = new Set(records.map((r) => r.date));
  const missing = dateRange(period.start, period.end).filter((d) => d < today && d >= worker.joinedOn && !have.has(d) && !(worker.source === "zoho" && isWeekend(d)));
  const conflicts = records
    .filter((r) => (r.status === "absent" || r.status === "leave") && (r.units > 0 || r.overtimeHours > 0))
    .map((r) => `${formatDate(r.date)} is marked ${r.status} but deliveries are logged`);

  const mine = advancesOf(db).filter((a) => a.workerId === worker.id && a.id !== excludeId);
  const counted = mine.filter((a) => a.status === "awaiting_approval" || a.status === "escalated" || a.status === "approved" || a.status === "checking");
  const now = Date.now();

  return evaluateEligibility({
    amount,
    earnedWages: salaryAlreadyApproved ? 0 : pay.total,
    salaryAlreadyApproved,
    workerActive: worker.status === "active",
    hasValidUpi: UPI_ID.test(worker.payoutUpi),
    daysWorked: Math.ceil(pay.payDays),
    daysSinceJoined: daysBetween(worker.joinedOn, today),
    outstanding: outstandingTotal(db, worker.id, excludeId),
    openRequests: mine.filter((a) => isOpen(db, a)).length,
    recentDuplicate: counted.some((a) => a.amount === Math.round(amount) && now - Date.parse(a.createdAt) < ADVANCE_RULES.duplicateWindowMs),
    requestsThisPeriod: counted.filter((a) => a.periodId === period.id).length,
    conflicts,
    missingDays: missing.length,
    policyPercent: configOf(db).policyPercent,
    // Re-checks of an existing request reuse the purpose recorded when it was made.
    purpose: purposeIn ?? (excludeId ? advancesOf(db).find((a) => a.id === excludeId)?.purpose : undefined),
  });
}

/** The worker's headline numbers: what they have earned and how much of it they could still ask for. */
export function summaryFor(db: Db, worker: Worker): WorkerAdvanceSummary {
  const probe = evaluateForWorker(db, worker, ADVANCE_RULES.minAmount);
  const blocker = probe.checks.find((c) => !c.passed && c.id !== "within_limit" && c.id !== "amount_valid");
  const { calc } = probe;
  const blocked = blocker ? blocker.detail : calc.availableLimit < ADVANCE_RULES.minAmount ? `Less than ${rupees(ADVANCE_RULES.minAmount)} is available right now.` : null;
  return {
    periodLabel: getPeriod().label,
    earnedWages: calc.earnedWages,
    policyPercent: calc.policyPercent,
    policyLimit: calc.policyLimit,
    outstanding: calc.outstanding,
    availableLimit: calc.availableLimit,
    blocked,
  };
}

/** Writes each payment outcome into the trail once (completed or failed), whichever path learned it first: sync, webhook or retry. */
export function noteAdvancePayment(db: Db, tx: Transaction) {
  if (!tx.advanceId) return;
  const a = advancesOf(db).find((x) => x.id === tx.advanceId);
  if (!a) return;
  if (tx.status === "completed" && a.paymentRecorded !== "completed") {
    a.paymentRecorded = "completed";
    addTrail(a, "payout_agent", "Payment completed", `${rupees(a.amount)} reached the worker by UPI${tx.reference && tx.reference !== "—" ? ` (reference ${tx.reference})` : ""}.`);
  } else if (tx.status === "failed" && a.paymentRecorded !== "failed") {
    a.paymentRecorded = "failed";
    addTrail(a, "payout_agent", "Payment failed", tx.failureReason ?? "Cashfree could not complete the transfer.");
  } else if (tx.status === "processing" && a.paymentRecorded === "failed") {
    a.paymentRecorded = undefined;
    addTrail(a, "payout_agent", "Payment retried", "A new transfer was sent after the failure.");
  }
}

/* --------------------------------- views --------------------------------- */

function paymentView(db: Db, a: AdvanceRequest) {
  const tx = transactionOf(db, a);
  return {
    payment: tx?.status,
    paymentReference: tx && tx.reference && tx.reference !== "—" && tx.reference !== "Submitting…" ? tx.reference : undefined,
    paymentFailure: tx?.status === "failed" ? tx.failureReason : undefined,
  };
}

export function toWorkerView(db: Db, a: AdvanceRequest): WorkerAdvanceView {
  return {
    id: a.id,
    amount: a.amount,
    reasonText: a.reasonText,
    status: a.status,
    ...paymentView(db, a),
    message: a.workerMessage?.text,
    createdAt: a.createdAt,
    explanation: a.eligibility.explanation,
    calc: a.eligibility.calc,
    recovered: a.recovered,
    trail: a.trail,
  };
}

export function toOwnerView(db: Db, a: AdvanceRequest): OwnerAdvanceView {
  return {
    ...toWorkerView(db, a),
    workerId: a.workerId,
    workerName: db.workers.find((w) => w.id === a.workerId)?.name ?? "Unknown worker",
    urgency: a.urgency,
    language: a.language,
    requestText: a.requestText,
    checks: a.eligibility.checks,
    flags: a.eligibility.flags,
    approvedBy: a.approval?.by,
    approvedAt: a.approval?.at,
    cashfree: cashfreeProof(db, a),
  };
}

function cashfreeProof(db: Db, a: AdvanceRequest): OwnerAdvanceView["cashfree"] {
  const tx = transactionOf(db, a);
  if (!tx) return undefined;
  const ref = tx.reference && tx.reference !== "—" && tx.reference !== "Submitting…" && tx.reference !== tx.cfTransferId ? tx.reference : undefined;
  return {
    transferId: tx.transferId,
    cfTransferId: tx.cfTransferId,
    utr: ref,
    status: tx.status,
    mode: "UPI",
    environment: isLiveCashfree ? "production" : "sandbox",
    attempt: tx.attempt ?? 1,
    createdAt: tx.createdAt,
  };
}

/** Unguessable: a Relay agent identifies a request only by this id. */
export const newAdvanceId = () => `adv-${randomBytes(12).toString("hex")}`;
