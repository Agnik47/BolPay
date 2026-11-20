import "server-only";
import { calculatePay } from "@/app/lib/merchant/incentives";
import { dateRange, formatDate } from "@/app/lib/merchant/format";
import { getPeriod, getToday } from "@/app/lib/server/context";
import type {
  AttendanceRecord,
  AttendanceStatus,
  IncentiveRules,
  Payout,
  Transaction,
  Worker,
} from "@/app/lib/merchant/types";
import { createTransfer, getTransfer, transferIdFor, UPI_ID } from "@/app/lib/cashfree/payouts";
import { CashfreeError, isLiveCashfree } from "@/app/lib/cashfree/rest";
import { DEFAULT_ADVANCE_POLICY } from "@/app/lib/advance/eligibility";
import { outstandingAdvances, planRecovery, reservedByAdvance } from "@/app/lib/advance/recovery";
import { parseCsv } from "./csv";
import { getDb, logAudit, saveDb, WORKSPACES } from "./db";

type DbT = ReturnType<typeof getDb>;

export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const STATUSES: AttendanceStatus[] = ["present", "half", "absent", "leave"];
const SUBMIT_CONCURRENCY = 5;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

export function getSnapshot() {
  const { workers, attendance, rules, payouts, transactions } = getDb();
  return { today: getToday(), period: getPeriod(), workers, attendance, rules, payouts, transactions };
}
export type Snapshot = ReturnType<typeof getSnapshot>;

/* ----------------------------- workers ----------------------------- */

function buildWorker(input: Record<string, unknown>): Worker {
  const name = str(input.name, 80);
  const role = str(input.role, 80);
  const dailyWage = num(input.dailyWage);
  const payoutUpi = str(input.payoutUpi).toLowerCase();
  if (!name || !role) throw new ServiceError("Name and role are required");
  if (!Number.isFinite(dailyWage) || dailyWage <= 0 || dailyWage > 100_000) throw new ServiceError("Daily wage must be a positive number");
  if (payoutUpi && !UPI_ID.test(payoutUpi)) throw new ServiceError("UPI ID is not valid (expected name@bank)");
  return {
    id: `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name,
    role,
    city: str(input.city, 60) || "Bengaluru",
    phone: str(input.phone, 40),
    payoutUpi,
    dailyWage,
    joinedOn: getToday(),
    status: "active",
  };
}

export function addWorker(input: Record<string, unknown>) {
  const worker = buildWorker(input);
  getDb().workers.push(worker);
  logAudit("worker.add", `${worker.name} (${worker.city})`);
  saveDb();
}

export function updateWorker(id: string, patch: Record<string, unknown>) {
  const w = getDb().workers.find((x) => x.id === id);
  if (!w) throw new ServiceError("Worker not found", 404);
  if ("name" in patch) {
    const v = str(patch.name, 80);
    if (!v) throw new ServiceError("Name can't be empty");
    w.name = v;
  }
  if ("role" in patch) {
    const v = str(patch.role, 80);
    if (!v) throw new ServiceError("Role can't be empty");
    w.role = v;
  }
  if ("city" in patch) {
    const v = str(patch.city, 60);
    if (!v) throw new ServiceError("City can't be empty");
    w.city = v;
  }
  if ("phone" in patch) w.phone = str(patch.phone, 40);
  if ("payoutUpi" in patch) {
    const v = str(patch.payoutUpi).toLowerCase();
    if (v && !UPI_ID.test(v)) throw new ServiceError("UPI ID is not valid (expected name@bank)");
    w.payoutUpi = v;
  }
  if ("dailyWage" in patch) {
    const v = num(patch.dailyWage);
    if (!Number.isFinite(v) || v <= 0 || v > 100_000) throw new ServiceError("Daily wage must be a positive number");
    w.dailyWage = v;
  }
  if ("status" in patch) {
    if (patch.status !== "active" && patch.status !== "inactive") throw new ServiceError("Invalid status");
    w.status = patch.status;
  }
  saveDb();
}

/* ---------------------------- attendance ---------------------------- */

function applyAttendance(workerId: string, date: string, patch: Record<string, unknown>) {
  const db = getDb();
  if (!db.workers.some((w) => w.id === workerId)) throw new ServiceError("Worker not found", 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < getPeriod().start || date > getToday()) {
    throw new ServiceError("Date must be inside the current pay period and not in the future");
  }
  let rec = db.attendance.find((r) => r.workerId === workerId && r.date === date);
  if (!rec) {
    rec = { workerId, date, status: "present", overtimeHours: 0, units: 0 } satisfies AttendanceRecord;
    db.attendance.push(rec);
  }
  if ("status" in patch) {
    if (!STATUSES.includes(patch.status as AttendanceStatus)) throw new ServiceError("Invalid attendance status");
    rec.status = patch.status as AttendanceStatus;
  }
  if ("overtimeHours" in patch) {
    const v = num(patch.overtimeHours);
    if (!Number.isFinite(v) || v < 0 || v > 24) throw new ServiceError("Overtime must be between 0 and 24 hours");
    rec.overtimeHours = v;
  }
  if ("units" in patch) {
    const v = num(patch.units);
    if (!Number.isFinite(v) || v < 0 || v > 100_000) throw new ServiceError("Units must be zero or more");
    rec.units = Math.round(v);
  }
  if (rec.status === "absent" || rec.status === "leave") {
    rec.overtimeHours = 0;
    rec.units = 0;
  }
}

export function setAttendance(workerId: string, date: string, patch: Record<string, unknown>) {
  applyAttendance(workerId, date, patch);
  saveDb();
}

/* ------------------------------ rules ------------------------------ */

export function setRules(input: Record<string, unknown>) {
  const keys = ["workingHoursPerDay", "overtimeMultiplier", "dailyUnitTarget", "ratePerExtraUnit", "attendanceThreshold", "attendanceBonus"] as const;
  const prev = getDb().rules;
  const next = { ...prev } as IncentiveRules;
  for (const k of keys) {
    const v = num(input[k]);
    if (!Number.isFinite(v) || v < 0) throw new ServiceError(`Rule "${k}" must be zero or more`);
    next[k] = v;
  }
  if (next.workingHoursPerDay <= 0) throw new ServiceError("Working hours per day must be above zero");
  if (next.attendanceThreshold > 1) throw new ServiceError("Attendance threshold must be between 0 and 1");
  if ("deliveryTiers" in input) {
    if (!Array.isArray(input.deliveryTiers) || input.deliveryTiers.length > 10) throw new ServiceError("Provide up to 10 delivery tiers");
    next.deliveryTiers = input.deliveryTiers
      .map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        const minUnits = num(o.minUnits);
        const bonus = num(o.bonus);
        if (!Number.isFinite(minUnits) || minUnits < 1 || !Number.isFinite(bonus) || bonus < 0) throw new ServiceError("Each tier needs deliveries of at least 1 and a bonus of zero or more");
        return { minUnits: Math.round(minUnits), bonus };
      })
      .sort((x, y) => x.minUnits - y.minUnits);
  }
  next.version = (prev.version ?? 1) + 1;
  getDb().rules = next;
  logAudit("rules.update", `version ${next.version}`);
  saveDb();
}

/* ------------------------------ payouts ------------------------------ */

/** How many payouts (any status) this worker already has in the current period; keeps ids unique after a rejection. */
function previousAttempts(payouts: Payout[], workerId: string) {
  return payouts.filter((p) => p.periodId === getPeriod().id && p.workerId === workerId).length;
}

export interface PrepareFilter {
  city?: string | null;
  /** Only workers with at least this many deliveries on `date` are included. */
  minUnits?: number | null;
  /** Defaults to today. */
  date?: string | null;
  /** Restrict to exactly these workers (used by the voice assistant after it resolves names). */
  workerIds?: string[] | null;
}

const normCity = (c: string) => c.normalize("NFKC").toLowerCase().trim();

/** Missing or conflicting records for a worker in the current period (days before today). */
function reviewReasons(w: Worker, records: AttendanceRecord[]): string[] {
  const reasons: string[] = [];
  const mine = records.filter((r) => r.workerId === w.id);
  // Employees synced from an HR system have weekends off, and the HR system leaves them unmarked on purpose.
  const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const days = dateRange(getPeriod().start, getPeriod().end).filter((d) => d < getToday() && d >= w.joinedOn && !(w.source === "zoho" && isWeekend(d)));
  const have = new Set(mine.map((r) => r.date));
  const missing = days.filter((d) => !have.has(d));
  if (missing.length) {
    const list = missing.slice(0, 3).map(formatDate).join(", ");
    reasons.push(`Missing attendance on ${list}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}`);
  }
  for (const r of mine) {
    if ((r.status === "absent" || r.status === "leave") && (r.units > 0 || r.overtimeHours > 0)) {
      reasons.push(`Conflicting record on ${formatDate(r.date)}: marked ${r.status} but ${r.units} deliveries logged`);
    }
  }
  return reasons;
}

/**
 * Withholds paid, unrecovered advances from one pending payout (docs/ADVANCE.md section 8). `amount` becomes the
 * net sent to Cashfree and `grossAmount` keeps the wages. Safe to call again: it recomputes from server state,
 * ignoring this payout's own earlier reservation. Nothing counts as recovered until the transfer completes.
 */
export function applyRecovery(db: DbT, p: Payout) {
  if (p.status !== "pending") return;
  const gross = p.grossAmount ?? p.amount;
  const mine = (db.advances ?? []).filter((a) => a.workerId === p.workerId);
  const plan = planRecovery(gross, outstandingAdvances(mine, reservedByAdvance(db.payouts, p.id)), (db.advancePolicy ?? DEFAULT_ADVANCE_POLICY).maxRecoveryPercentOfPayout);
  if (plan.deductions.length === 0 && p.grossAmount === undefined) return;
  p.grossAmount = gross;
  p.deductions = plan.deductions.length ? plan.deductions : undefined;
  p.amount = plan.net;
}

/** Pending payouts of one worker pick up (or drop) a deduction when an advance is paid or taken back. */
function refreshPendingRecovery(db: DbT, workerId: string) {
  for (const p of db.payouts) if (p.workerId === workerId && p.status === "pending") applyRecovery(db, p);
}

/**
 * Credits a payroll payout's deductions to its advances, but only when that transfer completes, and takes them
 * back if a completed transfer is later reversed. A failed or retried transfer leaves the advances untouched.
 */
function syncRecoveryFromTx(tx: Transaction) {
  if (tx.kind === "advance") return;
  for (const ws of WORKSPACES) {
    const db = getDb(ws);
    const p = db.payouts.find((x) => x.id === tx.payoutId);
    if (!p) continue;
    if (!p.deductions?.length) return;
    const apply = tx.status === "completed" && !p.recoveryApplied;
    const undo = tx.status === "failed" && p.recoveryApplied;
    if (!apply && !undo) return;
    for (const d of p.deductions) {
      const a = db.advances?.find((x) => x.id === d.advanceId);
      if (!a) continue;
      a.recovery ??= { recovered: 0 };
      a.recovery.recovered = Math.max(0, apply ? Math.min(a.recovery.recovered + d.amount, a.approvedAmount ?? a.amount) : a.recovery.recovered - d.amount);
      a.updatedAt = new Date().toISOString();
    }
    p.recoveryApplied = apply;
    const total = p.deductions.reduce((s, d) => s + d.amount, 0);
    logAudit(apply ? "advance.recovered" : "advance.recovery_reversed", `${p.id}: ₹${total} (${p.deductions.map((d) => d.advanceId).join(", ")})`, ws, "system");
    saveDb(ws);
    return;
  }
}

/**
 * Computes the current period and queues payouts for approval. Workers with missing or
 * conflicting records become "needs_review" and can't be approved until the data is fixed
 * (then submit again: stale needs_review payouts are recomputed).
 */
export function submitPeriod(filter: PrepareFilter = {}): { created: number; needsReview: number; skipped: number } {
  const db = getDb();
  db.payouts = db.payouts.filter((p) => !(p.periodId === getPeriod().id && p.status === "needs_review"));
  // Rejected payouts don't block a new submission; pending and approved ones do.
  const done = new Set(db.payouts.filter((p) => p.periodId === getPeriod().id && p.status !== "rejected").map((p) => p.workerId));
  const records = db.attendance.filter((r) => r.date >= getPeriod().start && r.date <= getPeriod().end);
  const filterDate = filter.date ?? getToday();
  const now = new Date().toISOString();
  const created: Payout[] = [];
  let skipped = 0;
  for (const w of db.workers) {
    if (w.status !== "active" || done.has(w.id)) continue;
    if (filter.workerIds && !filter.workerIds.includes(w.id)) {
      skipped++;
      continue;
    }
    if (filter.city && normCity(w.city) !== normCity(filter.city)) {
      skipped++;
      continue;
    }
    if (filter.minUnits != null) {
      const day = records.find((r) => r.workerId === w.id && r.date === filterDate);
      const qualifies = day && (day.status === "present" || day.status === "half") && day.units >= filter.minUnits;
      if (!qualifies) {
        skipped++;
        continue;
      }
    }
    const reasons = reviewReasons(w, records);
    const breakdown = calculatePay(w, records, db.rules);
    if (breakdown.total <= 0 && reasons.length === 0) continue;
    created.push({
      id: previousAttempts(db.payouts, w.id) === 0 ? `po-${getPeriod().id}-${w.id}` : `po-${getPeriod().id}-${w.id}-r${previousAttempts(db.payouts, w.id) + 1}`,
      workerId: w.id,
      periodId: getPeriod().id,
      periodLabel: getPeriod().label,
      breakdown,
      amount: breakdown.total,
      status: reasons.length ? "needs_review" : "pending",
      reviewReasons: reasons.length ? reasons : undefined,
      ruleVersion: db.rules.version,
      rulesSnapshot: structuredClone(db.rules),
      submittedAt: now,
    });
  }
  db.payouts.push(...created);
  for (const p of created) applyRecovery(db, p);
  const needsReview = created.filter((p) => p.status === "needs_review").length;
  logAudit("period.submit", `${created.length} payouts (${needsReview} need review), rules v${db.rules.version}, filter ${JSON.stringify(filter)}`);
  saveDb();
  return { created: created.length - needsReview, needsReview, skipped };
}

/** Approve or reject pending payouts. Approving starts the Cashfree transfers. */
export async function decidePayouts(ids: string[], decision: "approved" | "rejected") {
  const db = getDb();
  const now = new Date().toISOString();
  const pending = db.payouts.filter((p) => ids.includes(p.id) && p.status === "pending");
  if (pending.length === 0) throw new ServiceError("No pending payouts to act on", 409);

  // Mark and create transactions synchronously (before any await) so a concurrent
  // second request for the same payouts finds them already decided.
  const txs: Transaction[] = [];
  for (const p of pending) {
    // Fresh recovery plan at the moment money is committed: an advance may have been paid or repaid since submit.
    if (decision === "approved") applyRecovery(db, p);
    p.status = decision;
    p.decidedAt = now;
    if (decision === "approved") {
      txs.push({
        id: `tx-${p.id}`,
        payoutId: p.id,
        workerId: p.workerId,
        periodLabel: p.periodLabel,
        amount: p.amount,
        status: "processing",
        createdAt: now,
        reference: "Submitting…",
        attempt: 1,
      });
    }
  }
  db.transactions.push(...txs);
  logAudit(`payout.${decision}`, `${pending.length} payout(s): ${pending.map((p) => p.id).join(', ')}`);
  saveDb();
  if (txs.length) await submitToCashfree(txs.map((t) => t.id));
}

/** Retry from the Transactions screen or by voice. Emergency advances have their own owner-only retry, which checks Cashfree first. */
export async function retryTransaction(id: string) {
  if (getDb().transactions.find((t) => t.id === id)?.kind === "advance") throw new ServiceError("Retry an emergency advance from the Advances page.", 409);
  return resubmitFailedTransaction(id);
}

export async function resubmitFailedTransaction(id: string) {
  const db = getDb();
  const tx = db.transactions.find((t) => t.id === id);
  if (!tx) throw new ServiceError("Transaction not found", 404);
  if (tx.status !== "failed") throw new ServiceError("Only failed transactions can be retried", 409);
  tx.status = "processing";
  tx.failureReason = undefined;
  tx.cfTransferId = undefined;
  tx.transferId = undefined;
  tx.reference = "Submitting…";
  tx.attempt = (tx.attempt ?? 1) + 1;
  saveDb();
  await submitToCashfree([tx.id]);
}

function fail(tx: Transaction, reason: string) {
  tx.status = "failed";
  tx.failureReason = reason;
  if (tx.reference === "Submitting…") tx.reference = "—";
  syncAdvanceFromTx(tx);
}

/**
 * Keeps an emergency advance in step with its Cashfree transfer, whichever path updated the transfer
 * (submit, status sync or webhook). Only a confirmed SUCCESS makes an advance "paid". A transfer that
 * later fails (for example reversed) takes a paid advance back to payment_failed, because the money didn't stay.
 */
function syncAdvanceFromTx(tx: Transaction) {
  if (tx.kind !== "advance" || !tx.advanceId) return;
  for (const ws of WORKSPACES) {
    const a = getDb(ws).advances?.find((x) => x.id === tx.advanceId);
    if (!a) continue;
    if (!["paying", "payment_failed", "paid"].includes(a.status)) return;
    const next = tx.status === "completed" ? "paid" : tx.status === "failed" ? "payment_failed" : "paying";
    if (a.status === next) return;
    const wasPaid = a.status === "paid";
    a.status = next;
    if (next === "paid") (a.recovery ??= { recovered: 0 }).paidAt ??= new Date().toISOString();
    if (next === "paid" || wasPaid) refreshPendingRecovery(getDb(ws), a.workerId);
    a.statusNote = next === "paid" ? undefined : next === "payment_failed" ? tx.failureReason ?? "The payment failed." : undefined;
    a.updatedAt = new Date().toISOString();
    logAudit(`advance.${next}`, `${a.id}: ₹${tx.amount}${tx.failureReason && next === "payment_failed" ? `, ${tx.failureReason}` : ""}`, ws, "system");
    saveDb(ws);
    return;
  }
}

/** Sends the given transactions to Cashfree using only amounts and UPI ids stored on the server. */
export async function submitToCashfree(txIds: string[]) {
  const db = getDb();
  const txs = db.transactions.filter((t) => txIds.includes(t.id));

  if (isLiveCashfree && process.env.ALLOW_LIVE_PAYOUTS !== "true") {
    txs.forEach((t) => fail(t, "Live payouts are disabled (set ALLOW_LIVE_PAYOUTS=true)"));
    saveDb();
    return;
  }

  const sendable: { tx: Transaction; worker: Worker }[] = [];
  for (const tx of txs) {
    const worker = db.workers.find((w) => w.id === tx.workerId);
    if (!worker || !UPI_ID.test(worker.payoutUpi)) fail(tx, "Worker has no valid UPI ID on file");
    else if (!(tx.amount >= 1)) fail(tx, "Payout is below the ₹1 minimum");
    else {
      // Same payout + same attempt = same transfer_id, so Cashfree dedupes a repeated submission.
      tx.transferId = transferIdFor(db.batchSalt ?? "", tx.payoutId, tx.attempt ?? 1);
      sendable.push({ tx, worker });
    }
  }
  saveDb();

  for (let i = 0; i < sendable.length; i += SUBMIT_CONCURRENCY) {
    await Promise.all(
      sendable.slice(i, i + SUBMIT_CONCURRENCY).map(async ({ tx, worker }) => {
        try {
          const r = await createTransfer({ transferId: tx.transferId!, workerId: worker.id, name: worker.name, phone: worker.phone, upi: worker.payoutUpi, amount: tx.amount });
          applyTransferResult(tx, r.status, { cfTransferId: r.cfTransferId, utr: r.utr, error: r.error });
        } catch (err) {
          console.error("Cashfree transfer failed", err);
          const detail = err instanceof CashfreeError ? err.message : "Unexpected error";
          fail(tx, `Cashfree rejected the transfer: ${detail}`);
        }
      }),
    );
  }
  saveDb();
}

/** Re-checks one transfer with Cashfree, even a failed one. Used before an advance is retried, so a transfer that actually went through is never paid twice. */
export async function refreshTransaction(id: string) {
  const tx = getDb().transactions.find((t) => t.id === id);
  if (!tx?.transferId) return;
  try {
    const r = await getTransfer(tx.transferId);
    applyTransferResult(tx, r.status, { cfTransferId: r.cfTransferId, utr: r.utr, error: r.error });
    saveDb();
  } catch {
    /* Cashfree has no such transfer (it never got there) or is unreachable: leave the transfer as it was */
  }
}

/** Pulls live transfer statuses from Cashfree for every transaction that is still processing. */
export async function syncTransactions() {
  const db = getDb();
  const open = db.transactions.filter((t) => t.status === "processing" && t.transferId);
  for (let i = 0; i < open.length; i += SUBMIT_CONCURRENCY) {
    await Promise.all(
      open.slice(i, i + SUBMIT_CONCURRENCY).map(async (tx) => {
        try {
          const r = await getTransfer(tx.transferId!);
          applyTransferResult(tx, r.status, { cfTransferId: r.cfTransferId, utr: r.utr, error: r.error });
        } catch (err) {
          console.error(`Could not sync Cashfree transfer ${tx.transferId}`, err);
        }
      }),
    );
  }
  saveDb();
}

function applyTransferResult(tx: Transaction, status: Transaction["status"], info: { cfTransferId?: string; utr?: string; error?: string }) {
  if (info.cfTransferId) tx.cfTransferId = info.cfTransferId;
  const ref = info.utr || info.cfTransferId;
  if (ref) tx.reference = ref;
  tx.status = status;
  tx.failureReason = status === "failed" ? (info.error ?? "Payment failed") : undefined;
  syncAdvanceFromTx(tx);
  syncRecoveryFromTx(tx);
}

/**
 * Applies a verified TRANSFER_* webhook event. Cashfree's call carries no signed-in user, so it searches
 * every dataset: a payout from the Zoho data must update even while people are viewing the demo.
 * Transfer ids derive from the payout id (which includes the period id), so a match is unambiguous.
 */
export function applyWebhookTransfer(item: { transferId: string; status: Transaction["status"]; cfTransferId?: string; utr?: string; error?: string }) {
  for (const ws of WORKSPACES) {
    const tx = getDb(ws).transactions.find((t) => t.transferId === item.transferId);
    if (!tx) continue;
    applyTransferResult(tx, item.status, item);
    saveDb(ws);
    return true;
  }
  return false;
}

/* ------------------------------ CSV import ------------------------------ */

const MAX_IMPORT_ROWS = 500;
export interface ImportResult {
  imported: number;
  errors: string[];
}

function rowsOf(csv: string) {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new ServiceError("The CSV is empty or has no data rows");
  if (rows.length > MAX_IMPORT_ROWS) throw new ServiceError(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  return rows;
}

const normName = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Columns: name, role, city, phone, payoutUpi (or upi), dailyWage (or wage). Duplicates (same name + city) are skipped. */
export function importWorkers(csv: string): ImportResult {
  const db = getDb();
  const errors: string[] = [];
  let imported = 0;
  rowsOf(csv).forEach((r, i) => {
    const line = i + 2;
    try {
      const w = buildWorker({
        name: r.name,
        role: r.role || "Delivery Rider",
        city: r.city,
        phone: r.phone,
        payoutUpi: r.payoutupi ?? r.upi,
        dailyWage: r.dailywage ?? r.wage,
      });
      if (db.workers.some((x) => normName(x.name) === normName(w.name) && normCity(x.city) === normCity(w.city))) {
        errors.push(`Row ${line}: ${w.name} already exists in ${w.city}, skipped`);
        return;
      }
      w.id = `w${Date.now().toString(36)}${i.toString(36)}${Math.random().toString(36).slice(2, 4)}`;
      db.workers.push(w);
      imported++;
    } catch (e) {
      errors.push(`Row ${line}: ${e instanceof ServiceError ? e.message : "invalid row"}`);
    }
  });
  logAudit("import.workers", `${imported} imported, ${errors.length} problems`);
  saveDb();
  return { imported, errors: errors.slice(0, 20) };
}

/** Columns: worker (name or id), date (YYYY-MM-DD), deliveries (or units), status (default present), overtime (optional). */
export function importDeliveries(csv: string): ImportResult {
  const db = getDb();
  const errors: string[] = [];
  let imported = 0;
  rowsOf(csv).forEach((r, i) => {
    const line = i + 2;
    try {
      const key = r.worker ?? r.workerid ?? r.name ?? "";
      const w = db.workers.find((x) => x.id === key) ?? db.workers.find((x) => normName(x.name) === normName(key));
      if (!w) throw new ServiceError(`worker "${key}" not found`);
      const patch: Record<string, unknown> = {};
      const units = r.deliveries ?? r.units;
      if (units) patch.units = units;
      const ot = r.overtime ?? r.overtimehours;
      if (ot) patch.overtimeHours = ot;
      patch.status = r.status || "present";
      applyAttendance(w.id, r.date, patch);
      imported++;
    } catch (e) {
      errors.push(`Row ${line}: ${e instanceof ServiceError ? e.message : "invalid row"}`);
    }
  });
  logAudit("import.deliveries", `${imported} imported, ${errors.length} problems`);
  saveDb();
  return { imported, errors: errors.slice(0, 20) };
}
