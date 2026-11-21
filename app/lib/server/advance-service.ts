import "server-only";
import { calculatePay } from "@/app/lib/merchant/incentives";
import { UPI_ID } from "@/app/lib/cashfree/payouts";
import { isLiveCashfree } from "@/app/lib/cashfree/rest";
import { isTestVpa } from "@/app/lib/cashfree/test-upi";
import { DEFAULT_ADVANCE_POLICY, evaluateEligibility } from "@/app/lib/advance/eligibility";
import { reconcileAmount } from "@/app/lib/advance/amounts";
import { advanceAmount, reservedByAdvance } from "@/app/lib/advance/recovery";
import { extractAdvance } from "@/app/lib/ai/advance-intent";
import { translateToEnglish } from "@/app/lib/sarvam/client";
import { translateReply } from "@/app/lib/ai/translate";
import type { AdvanceEligibility, AdvancePolicy, AdvanceReason, AdvanceRequest, Transaction } from "@/app/lib/merchant/types";
import { getPeriod, getToday } from "./context";
import { canActOnWorker, getDb, logAudit, saveDb } from "./db";
import { refreshTransaction, resubmitFailedTransaction, ServiceError, submitToCashfree } from "./service";

const REASONS: AdvanceReason[] = ["vehicle_repair", "medical", "family_event", "housing", "education", "other"];
const REASON_LABEL: Record<AdvanceReason, string> = {
  vehicle_repair: "bike or vehicle repair", medical: "a medical expense", family_event: "a family event", housing: "housing", education: "education", other: "another urgent need",
};
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export function advances() {
  const db = getDb();
  return (db.advances ??= []);
}
export function advancePolicy(): AdvancePolicy {
  const db = getDb();
  return (db.advancePolicy ??= { ...DEFAULT_ADVANCE_POLICY });
}

/** One request as the worker who made it sees it. */
export function ownRequest(workerId: string, id: string) {
  const a = advances().find((x) => x.id === id && x.workerId === workerId);
  if (!a) throw new ServiceError("Request not found.", 404);
  return ownView(a);
}

/** Marks stale pending requests expired. Called before reads and writes so a status is never stale. */
function expireStale(now = Date.now()) {
  const maxAge = advancePolicy().expireAfterHours * 3_600_000;
  let changed = false;
  for (const a of advances()) {
    if ((a.status === "pending_review" || a.status === "submitted") && now - Date.parse(a.createdAt) > maxAge) {
      a.status = "expired";
      a.statusNote = "No answer within the allowed time. You can ask again.";
      a.updatedAt = new Date(now).toISOString();
      changed = true;
    }
  }
  if (changed) saveDb();
}

/** The server's own eligibility check for one worker. Wages come from the existing payroll engine. */
export function eligibilityFor(workerId: string, opts: { amount?: number; excludeId?: string } = {}): AdvanceEligibility {
  const db = getDb();
  const period = getPeriod();
  const worker = db.workers.find((w) => w.id === workerId);
  const records = db.attendance.filter((r) => r.workerId === workerId && r.date >= period.start && r.date <= period.end);
  const pay = calculatePay(worker ?? ({ id: workerId, dailyWage: 0 } as never), records, db.rules);
  return evaluateEligibility({
    worker,
    upiValid: !!worker && UPI_ID.test(worker.payoutUpi) && !(isLiveCashfree && isTestVpa(worker.payoutUpi)),
    pay,
    payouts: db.payouts.filter((p) => p.workerId === workerId),
    advances: advances().filter((a) => a.workerId === workerId),
    recovered: Object.fromEntries(advances().filter((a) => a.workerId === workerId).map((a) => [a.id, a.recovery?.recovered ?? 0])),
    policy: advancePolicy(),
    periodId: period.id,
    rulesVersion: db.rules.version,
    today: getToday(),
    now: new Date().toISOString(),
    amount: opts.amount,
    excludeId: opts.excludeId,
  });
}

/** Public view of a request for the worker who made it: no internal ids of other people, nothing about others. */
function ownView(a: AdvanceRequest) {
  return {
    id: a.id, amount: a.approvedAmount ?? a.amount, reasonText: a.reasonText, reasonCategory: a.reasonCategory, status: a.status,
    // Provider error text is for the owner; the worker gets a plain message.
    statusNote: a.status === "payment_failed" ? "The payment didn't go through. Your employer has been told and can try again." : a.status === "paying" ? "Approved. The payment is being sent and will show as paid once your bank confirms it." : a.statusNote,
    createdAt: a.createdAt, updatedAt: a.updatedAt, source: a.source,
    ...(a.status === "paid" ? { owed: Math.max(0, advanceAmount(a) - (a.recovery?.recovered ?? 0)), recovered: a.recovery?.recovered ?? 0 } : {}),
  };
}

export function myAdvanceState(workerId: string) {
  expireStale();
  const policy = advancePolicy();
  const e = eligibilityFor(workerId);
  const mine = advances().filter((a) => a.workerId === workerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    // Only what the worker needs: never other workers' data, never internal policy beyond what applies to them.
    limit: { available: e.available, earnedLimit: e.limit, outstanding: e.outstanding, maxAmount: policy.maxAmount, percent: policy.percentLimit },
    blocks: e.blocks,
    requests: mine.map(ownView),
  };
}

/** Interprets what the worker said or typed. Persists nothing; the worker must confirm before anything is saved. */
export async function previewAdvance(workerId: string, transcript: string, opts: { languageCode?: string | null } = {}) {
  const text = transcript.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600);
  if (!text) throw new ServiceError("Say or type what you need.");
  // The language Sarvam heard (or the worker chose) decides the translation; the model's guess is the fallback.
  const known = opts.languageCode ? opts.languageCode.split("-")[0].toLowerCase() : null;
  let extracted = known ? null : await extractAdvance(text);
  const language = known ?? extracted?.language ?? "en";
  const english = await translateToEnglish(text, language);
  if (known) extracted = await extractAdvance(text, english);
  // The amount must appear in the worker's own words (or their translation); otherwise the worker types it.
  const { amount, source, mismatch } = reconcileAmount(extracted?.amount ?? null, english ? `${text} ${english}` : text, extracted !== null);
  const reason = extracted?.reason ?? "other";
  const e = eligibilityFor(workerId, { amount: amount ?? undefined });

  // Read-back in the worker's language, from server facts only. Falls back to English if translation can't preserve the numbers.
  let readBack: string | null = null;
  if (amount !== null) {
    const english = `You are asking for ₹${amount} for ${REASON_LABEL[reason]}. The money would be deducted from your next payroll. Is this right?`;
    readBack = (await translateReply(english, language)) ?? english;
  }
  return {
    transcript: text,
    englishTranslation: english,
    translationFailed: language !== "en" && !english,
    urgency: extracted?.urgency ?? "normal",
    language,
    amount,
    amountSource: source,
    amountMismatch: mismatch,
    modelAvailable: extracted !== null,
    reasonCategory: reason,
    summary: extracted?.summary ?? "",
    readBack,
    available: e.available,
    blocks: e.blocks,
  };
}

export interface SubmitInput {
  idempotencyKey: string;
  amount: number;
  reasonText: string;
  reasonCategory: string;
  language: string;
  source: string;
  transcript: string;
  urgency?: string;
  confirmed: boolean;
  recoveryAck: boolean;
}

/** Saves a worker-confirmed request. The amount is re-checked here; nothing is paid, and nothing is approved. */
export async function submitAdvance(workerId: string, input: SubmitInput) {
  expireStale();
  if (input.confirmed !== true) throw new ServiceError("Please confirm the amount and reason first.");
  if (input.recoveryAck !== true) throw new ServiceError("Please confirm that the advance is deducted from your next payroll.");
  if (!KEY.test(input.idempotencyKey)) throw new ServiceError("Invalid request key.");
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 1_000_000) throw new ServiceError("Enter a whole number of rupees.");
  const reasonText = input.reasonText.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  if (!reasonText) throw new ServiceError("Please tell us the reason.");

  // A retried submit with the same key returns the same request, never a second one.
  const existing = advances().find((a) => a.workerId === workerId && a.idempotencyKey === input.idempotencyKey);
  if (existing) return { request: ownView(existing), duplicate: true };

  // The English version for managers is made here from the saved original, never taken from the client.
  const language = /^[a-z]{2,3}$/.test(input.language) ? input.language : "en";
  const transcript = input.transcript.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600);
  const transcriptEnglish = transcript ? await translateToEnglish(transcript, language) : null;
  // Re-check after the await: a retried submit may have saved this request meanwhile.
  const raced = advances().find((a) => a.workerId === workerId && a.idempotencyKey === input.idempotencyKey);
  if (raced) return { request: ownView(raced), duplicate: true };

  const eligibility = eligibilityFor(workerId, { amount: input.amount });
  const now = new Date().toISOString();
  const rejected = eligibility.blocks.length > 0;
  const request: AdvanceRequest = {
    id: `adv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    workerId,
    amount: input.amount,
    reasonText,
    reasonCategory: REASONS.includes(input.reasonCategory as AdvanceReason) ? (input.reasonCategory as AdvanceReason) : "other",
    language,
    transcript: transcript || undefined,
    transcriptEnglish: transcriptEnglish ?? undefined,
    urgency: input.urgency === "urgent" ? "urgent" : "normal",
    source: input.source === "voice" ? "voice" : "text",
    idempotencyKey: input.idempotencyKey,
    status: rejected ? "rejected" : "pending_review",
    statusNote: rejected ? eligibility.blocks.join(" ") : undefined,
    eligibility,
    recoveryAck: true,
    createdAt: now,
    updatedAt: now,
  };
  advances().push(request);
  logAudit(rejected ? "advance.auto_rejected" : "advance.request", `${request.id}: ₹${request.amount} (${request.reasonCategory})${rejected ? `, blocked: ${eligibility.blocks.join(" ")}` : ""}`, undefined, `worker:${workerId}`);
  saveDb();
  return { request: ownView(request), duplicate: false };
}

/** The worker withdraws their own request while it still waits for an answer. */
export function cancelAdvance(workerId: string, id: string) {
  expireStale();
  const a = advances().find((x) => x.id === id && x.workerId === workerId);
  if (!a) throw new ServiceError("Request not found.", 404);
  if (a.status !== "pending_review" && a.status !== "submitted") throw new ServiceError("This request can no longer be cancelled.", 409);
  a.status = "cancelled";
  a.statusNote = "Cancelled by you.";
  a.updatedAt = new Date().toISOString();
  logAudit("advance.cancel", a.id, undefined, `worker:${workerId}`);
  saveDb();
  return { request: ownView(a) };
}

/* ------------------------------ staff side ------------------------------ */

export interface Actor {
  id: string;
  name: string;
}

const findAdvance = (id: string) => {
  const a = advances().find((x) => x.id === id);
  if (!a) throw new ServiceError("Request not found.", 404);
  return a;
};
const note = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

/** Everything an approver needs. Pending requests also get a fresh eligibility check (the numbers may have changed since submit). */
export function staffAdvances() {
  expireStale();
  const db = getDb();
  // A supervisor only sees requests from workers on their own team (the owner sees everyone's).
  return advances().filter((a) => canActOnWorker(a.workerId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => {
      const w = db.workers.find((x) => x.id === a.workerId);
      const tx = a.transactionId ? db.transactions.find((t) => t.id === a.transactionId) : undefined;
      // idempotencyKey is the worker's own retry token, not for staff.
      const { idempotencyKey: _key, ...rest } = a;
      void _key;
      return {
        ...rest,
        worker: w ? { id: w.id, name: w.name, city: w.city, role: w.role, dailyWage: w.dailyWage, hasUpi: !!w.payoutUpi } : null,
        owed: a.status === "paid" ? Math.max(0, advanceAmount(a) - (a.recovery?.recovered ?? 0)) : 0,
        inRecovery: a.status === "paid" ? (reservedByAdvance(db.payouts)[a.id] ?? 0) : 0,
        current: a.status === "pending_review" ? eligibilityFor(a.workerId, { amount: a.amount, excludeId: a.id }) : null,
        payment: tx ? { status: tx.status, reference: tx.reference, failureReason: tx.failureReason, attempt: tx.attempt ?? 1, createdAt: tx.createdAt } : null,
      };
    });
}

/** A staff member's advice on a waiting request. It never moves money or changes the request's status. */
export function recommendAdvance(id: string, actor: Actor, verdict: unknown, text: unknown) {
  expireStale();
  const a = findAdvance(id);
  if (!canActOnWorker(a.workerId)) throw new ServiceError("Request not found.", 404);
  if (a.status !== "pending_review") throw new ServiceError("This request is no longer waiting for review.", 409);
  if (verdict !== "approve" && verdict !== "reject") throw new ServiceError("Choose approve or reject.");
  a.recommendation = { by: actor.id, byName: actor.name, at: new Date().toISOString(), verdict, note: note(text) };
  a.updatedAt = a.recommendation.at;
  logAudit("advance.recommend", `${a.id}: ${verdict}${a.recommendation.note ? `, ${a.recommendation.note}` : ""}`, undefined, actor.id);
  saveDb();
}

/**
 * Owner approval: re-checks eligibility now, then in one synchronous step marks the request, records the
 * decision and creates the transfer, before any network call. A concurrent second approval therefore finds the
 * request already decided. Only then is the existing Cashfree path called; "paid" comes only from Cashfree.
 */
export async function approveAdvance(id: string, actor: Actor, input: { approvedAmount?: unknown; note?: unknown }) {
  expireStale();
  const db = getDb();
  const a = findAdvance(id);
  if (a.status !== "pending_review") throw new ServiceError(`This request is already ${a.status.replace("_", " ")}.`, 409);

  const approved = input.approvedAmount === undefined || input.approvedAmount === "" ? a.amount : Number(input.approvedAmount);
  if (!Number.isInteger(approved) || approved < 1 || approved > a.amount) throw new ServiceError("The approved amount must be a whole number of rupees, no more than the request.");
  const fresh = eligibilityFor(a.workerId, { amount: approved, excludeId: a.id });
  if (fresh.blocks.length) throw new ServiceError(`Can't approve: ${fresh.blocks.join(" ")}`, 409);

  const now = new Date().toISOString();
  const tx: Transaction = {
    id: `tx-${a.id}`,
    payoutId: a.id, // namespaces the Cashfree transfer id away from payroll payouts
    workerId: a.workerId,
    periodLabel: "Emergency advance",
    amount: approved,
    status: "processing",
    createdAt: now,
    reference: "Submitting…",
    attempt: 1,
    kind: "advance",
    advanceId: a.id,
  };
  a.status = "paying";
  a.approvedAmount = approved;
  a.decision = { by: actor.id, byName: actor.name, at: now, verdict: "approved", note: note(input.note) };
  a.decisionEligibility = fresh;
  a.transactionId = tx.id;
  a.updatedAt = now;
  db.transactions.push(tx);
  logAudit("advance.approved", `${a.id}: ₹${approved}${approved !== a.amount ? ` of ₹${a.amount} requested` : ""}`, undefined, actor.id);
  saveDb();

  await submitToCashfree([tx.id]);
}

export function rejectAdvance(id: string, actor: Actor, text: unknown) {
  expireStale();
  const a = findAdvance(id);
  if (a.status !== "pending_review") throw new ServiceError(`This request is already ${a.status.replace("_", " ")}.`, 409);
  const now = new Date().toISOString();
  const reason = note(text);
  a.status = "rejected";
  a.statusNote = reason || "Your employer did not approve this request.";
  a.decision = { by: actor.id, byName: actor.name, at: now, verdict: "rejected", note: reason };
  a.updatedAt = now;
  logAudit("advance.rejected", `${a.id}${reason ? `: ${reason}` : ""}`, undefined, actor.id);
  saveDb();
}

/**
 * Retries a failed advance transfer. First asks Cashfree about the earlier attempt: if it actually went
 * through (a timeout can look like a failure), the advance is marked paid and nothing is sent again.
 */
export async function retryAdvancePayment(id: string, actor: Actor) {
  const db = getDb();
  const a = findAdvance(id);
  if (a.status !== "payment_failed" || !a.transactionId) throw new ServiceError("Only an advance whose payment failed can be retried.", 409);
  const tx = db.transactions.find((t) => t.id === a.transactionId);
  if (!tx || tx.status !== "failed") throw new ServiceError("The payment is not in a failed state.", 409);

  await refreshTransaction(tx.id);
  if (tx.status !== "failed") return { alreadyProcessed: true as const };
  // Re-check status after the await: another retry may have started meanwhile.
  if (a.status !== "payment_failed") throw new ServiceError("This payment is already being retried.", 409);

  a.status = "paying";
  a.updatedAt = new Date().toISOString();
  logAudit("advance.retry", `${a.id}: attempt ${(tx.attempt ?? 1) + 1}`, undefined, actor.id);
  await resubmitFailedTransaction(tx.id);
  return { alreadyProcessed: false as const };
}

/**
 * Owner-only: closes part or all of what a worker still owes without a payroll deduction. "repay" records money
 * the worker paid back some other way; "write_off" forgives the rest. Both are audited and never move money.
 * Refused while a payroll deduction for the advance is in flight, so the same rupees can't be recovered twice.
 */
export function settleAdvance(id: string, actor: Actor, input: { action?: unknown; amount?: unknown; note?: unknown }) {
  const db = getDb();
  const a = findAdvance(id);
  if (a.status !== "paid") throw new ServiceError("Only an advance that was paid can be settled.", 409);
  const owed = advanceAmount(a) - (a.recovery?.recovered ?? 0);
  if (owed <= 0) throw new ServiceError("Nothing is owed on this advance.", 409);
  if (reservedByAdvance(db.payouts)[a.id]) throw new ServiceError("A payroll deduction for this advance is in progress. Wait for it to finish or be rejected.", 409);
  const reason = note(input.note);
  if (input.action !== "repay" && input.action !== "write_off") throw new ServiceError("Choose repaid or write off.");
  if (!reason) throw new ServiceError("A note is required so the audit log says why.");
  const amount = input.action === "write_off" ? owed : Number(input.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > owed) throw new ServiceError(`Enter a whole number of rupees, up to ₹${owed}.`);

  const now = new Date().toISOString();
  a.recovery = { ...(a.recovery ?? { recovered: 0 }), recovered: (a.recovery?.recovered ?? 0) + amount };
  if (input.action === "write_off") a.recovery.writtenOff = (a.recovery.writtenOff ?? 0) + amount;
  if (amount === owed || input.action === "write_off") a.recovery.closed = { kind: input.action === "write_off" ? "written_off" : "repaid", by: actor.id, at: now, amount, note: reason };
  a.updatedAt = now;
  logAudit(input.action === "write_off" ? "advance.written_off" : "advance.repaid", `${a.id}: ₹${amount}, ${reason}`, undefined, actor.id);
  saveDb();
}

/** The line spoken to a worker once their request is really saved, in their language when it can be translated safely. */
export async function submittedReply(language: string) {
  const english = "Your emergency advance request has been submitted. Please wait for your employer to approve it.";
  return { text: (await translateReply(english, language)) ?? english, language };
}
