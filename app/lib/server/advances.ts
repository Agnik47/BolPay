import "server-only";
import { ADVANCE_RULES, classifyPurpose, rupees } from "@/app/lib/advances/policy";
import {
  addTrail,
  advancesOf,
  agentApprovedToday,
  configOf,
  newAdvanceId,
  summaryFor,
  toOwnerView,
  toWorkerView,
  transactionOf,
} from "@/app/lib/advances/store";
import type { AdvanceRequest, OwnerAdvanceView, WorkerAdvanceSummary, WorkerAdvanceView } from "@/app/lib/advances/types";
import { assess, recordAssessment } from "@/app/lib/agents/eligibility-agent";
import { approve, queue, route } from "@/app/lib/agents/manager-agent";
import { pay } from "@/app/lib/agents/payout-agent";
import { localise, takeDraft } from "@/app/lib/agents/worker-agent";
import type { Worker } from "@/app/lib/merchant/types";
import { getPeriod, getToday } from "./context";
import { emitToRelay, RELAY_AGENT_NAME, relayCallbacks, relayHandoff, sendToRelay, type RelayStage } from "@/app/lib/relay/bridge";
import { getDb, getWorkspace, listWorkspaces, logAudit, runInWorkspace, saveDb, type Db } from "./db";
import { ServiceError } from "./service";

/**
 * The emergency-advance pipeline: Worker Assistance Agent -> Financial Eligibility Agent -> Manager Agent ->
 * Payout Agent -> Cashfree. This file wires the agents together and holds what the API routes call.
 * Money checks live in app/lib/advances/policy.ts; payment goes through the existing Cashfree payout code.
 */

const MAX_REQUESTS_PER_DAY = 10;
const note = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : "");
const find = (id: string) => {
  const a = advancesOf(getDb()).find((x) => x.id === id);
  if (!a) throw new ServiceError("Request not found", 404);
  return a;
};

/* --------------------------------- worker --------------------------------- */

export interface WorkerOverview {
  summary: WorkerAdvanceSummary;
  advances: WorkerAdvanceView[];
}

export function workerOverview(worker: Worker): WorkerOverview {
  const db = getDb();
  return {
    summary: summaryFor(db, worker),
    advances: advancesOf(db)
      .filter((a) => a.workerId === worker.id)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .map((a) => toWorkerView(db, a)),
  };
}

function outcomeMessage(db: Db, a: AdvanceRequest): string {
  const money = rupees(a.amount);
  switch (a.status) {
    case "ineligible": {
      // Short on purpose: a translation must keep every number, and the full working is shown beside it.
      const e = a.eligibility;
      if (e.checks.some((c) => c.id === "genuine_emergency" && !c.passed)) {
        return "Sorry, emergency advances are only for urgent needs such as medical care, an accident, repairing the vehicle you work with, a family emergency or rent. This request can't be approved.";
      }
      return e.maxEligible > 0
        ? `Not approved: ${money} is more than your advance limit right now. You can ask for up to ${rupees(e.maxEligible)}.`
        : `Not eligible right now: ${e.reasons[0] ?? "the request could not be approved."}`;
    }
    case "awaiting_approval":
      return `Your request for ${money} is eligible. It has been sent to your employer for approval.`;
    case "escalated":
      return `Your request for ${money} is eligible. Your employer is away, so it has been sent up for their decision.`;
    case "approved": {
      const s = transactionOf(db, a)?.status;
      if (s === "failed") return `Your request for ${money} was approved, but the payment did not go through. Your employer will retry it.`;
      return s === "completed" ? `Approved. ${money} has been sent to your UPI ID.` : `Approved. ${money} is being sent to your UPI ID now.`;
    }
    default:
      return `Your request for ${money} is ${a.status}.`;
  }
}

/**
 * The worker confirmed the read-back: record the request, run it through eligibility and the Manager Agent, and,
 * when it is approved within delegated authority, have the Payout Agent send it. Everything before the first
 * await is synchronous, so the request is saved even if payment later fails.
 */
export async function confirmRequest(worker: Worker, draftId: string): Promise<{ advance: WorkerAdvanceView; message: string; messageEnglish: string; language: string }> {
  const draft = takeDraft(worker.id, draftId);
  if (!draft) throw new ServiceError("That request expired. Please tell me what you need again.", 410);
  const db = getDb();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (advancesOf(db).filter((a) => a.workerId === worker.id && Date.parse(a.createdAt) > dayAgo).length >= MAX_REQUESTS_PER_DAY) {
    throw new ServiceError("Too many requests today. Please try again tomorrow or talk to your employer.", 429);
  }

  const purpose = classifyPurpose(draft.reason, `${draft.reasonText} ${draft.turns.join(" ")}`);
  const elig = assess(db, worker, draft.amount, undefined, purpose);
  const a: AdvanceRequest = {
    id: newAdvanceId(),
    workerId: worker.id,
    amount: Math.round(draft.amount),
    reason: draft.reason,
    reasonText: draft.reasonText,
    urgency: draft.urgency,
    language: draft.language,
    purpose,
    requestText: draft.turns.join(" / ").slice(0, 300),
    createdAt: new Date().toISOString(),
    periodId: getPeriod().id,
    status: "ineligible",
    eligibility: elig,
    recovered: 0,
    trail: [],
  };
  addTrail(a, "worker_agent", "Request understood", `${rupees(a.amount)} for "${a.reasonText}" (${a.urgency} urgency, language ${a.language}). The worker confirmed the read-back.`);
  advancesOf(db).push(a);
  logAudit("advance.request", `${worker.name} asked for ${rupees(a.amount)}`);

  // On Relay: the Financial Eligibility Agent there calls back /api/relay/advances/eligibility and the chain continues.
  if (relayHandoff("eligibility")) {
    a.status = "checking";
    a.relayStage = "eligibility";
    addTrail(a, "system", "Sent to Relay", "Handed to the Financial Eligibility Agent on Cashfree Relay.");
    saveDb();
    if (await emitToRelay("eligibility", relayEvent(a))) {
      const english = `Your request for ${rupees(a.amount)} has been received. Our agents are checking it now.`;
      return { advance: toWorkerView(db, a), message: await localise(english, a.language), messageEnglish: english, language: a.language };
    }
    a.relayStage = undefined;
    addTrail(a, "system", "Relay unreachable", "Checked inside BolPay instead.");
  }

  recordAssessment(a, elig);
  a.status = "ineligible";
  let payFailure: string | null = null;
  if (elig.eligible) payFailure = await decideAsManager(db, a);
  saveDb();

  const english = payFailure ?? outcomeMessage(db, a);
  notifyAgents(a, english);
  const message = await tellWorker(a, english);
  return { advance: toWorkerView(db, a), message, messageEnglish: english, language: a.language };
}

/**
 * Notify mode: the Financial Eligibility and Manager agents on Relay receive the decision BolPay's rules made, with
 * the plain message, and act on it (Sarvam, Cashfree Communication). Fire-and-forget: Relay being down never blocks.
 */
function notifyAgents(a: AdvanceRequest, english: string) {
  if (relayCallbacks()) return;
  const eligible = a.status !== "ineligible";
  void toRelay(a, "eligibility", { ...relayEvent(a), eligible: eligible ? "yes" : "no", message: english });
  if (eligible) void toRelay(a, "manager", { ...relayEvent(a), decision: a.status, approvedBy: a.approval?.by ?? "", message: english });
}

/* ------------------------------ agent hand-offs ------------------------------ */

/** Sends one event to a Relay agent and writes the agent and its Relay run id into the audit trail. */
async function toRelay(a: AdvanceRequest, stage: RelayStage, payload: Record<string, unknown>) {
  const r = await sendToRelay(stage, payload);
  if (!r.ok) return;
  addTrail(a, "system", "Sent to Cashfree Relay", `${RELAY_AGENT_NAME[stage]}${r.runId ? ` · Relay run #${r.runId}` : ""}`);
  saveDb();
}

/** What a Relay agent receives: ids and plain facts only, never a UPI id, phone number or another worker's data. */
function relayEvent(a: AdvanceRequest) {
  // The worker's own words are cleaned to letters, digits and spaces: they reach other people's screens and prompts.
  const reason = a.reasonText.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return { advanceId: a.id, amount: a.amount, reason, urgency: a.urgency, language: a.language };
}

const STALL_MS = 90_000;

/**
 * Safety net: a Relay run that never calls back must not strand a request. A request still "checking" after
 * 90 seconds is finished inside BolPay, and an approval whose payment never started is paid here (pay() itself
 * refuses to pay twice). Called whenever the owner's or a worker's screen loads.
 */
export async function sweepRelayStalls() {
  const db = getDb();
  const now = Date.now();
  for (const a of advancesOf(db)) {
    const last = Date.parse(a.trail[a.trail.length - 1]?.at ?? a.createdAt);
    if (now - last < STALL_MS) continue;
    if (a.status === "checking") {
      addTrail(a, "system", "Relay did not answer", "Finished inside BolPay instead.");
      if (a.relayStage === "eligibility") a.relayStage = undefined;
      const worker = db.workers.find((w) => w.id === a.workerId);
      if (!worker) continue;
      if (!a.relayStage) {
        const result = assess(db, worker, a.amount, a.id);
        recordAssessment(a, result);
        a.status = "ineligible";
        if (!result.eligible) {
          saveDb();
          continue;
        }
      }
      a.relayStage = undefined;
      await decideAsManager(db, a);
      saveDb();
    } else if (a.status === "approved" && !a.transactionId) {
      addTrail(a, "system", "Relay did not answer", "Paid from inside BolPay instead.");
      saveDb();
      try {
        await pay(a.id);
      } catch (err) {
        console.error("Stalled payment could not start", err instanceof Error ? err.message : err);
      }
    }
  }
}

/** Manager Agent step for an eligible request. Returns a message if an approved payment could not start. */
async function decideAsManager(db: Db, a: AdvanceRequest): Promise<string | null> {
  const r = route(db, a);
  if (r.kind !== "auto_approve") {
    queue(a, r);
    return null;
  }
  approve(db, a, "manager_agent", { delegationId: r.delegationId });
  return startPayment(db, a);
}

/** Hands an approved request to the Payout Agent: on Relay when configured, otherwise in-process. */
async function startPayment(db: Db, a: AdvanceRequest): Promise<string | null> {
  if (relayHandoff("payout")) {
    addTrail(a, "system", "Sent to Relay", "Handed to the Payout Agent on Cashfree Relay.");
    saveDb();
    if (await emitToRelay("payout", relayEvent(a))) return null;
    addTrail(a, "system", "Relay unreachable", "Paid from inside BolPay instead.");
  }
  saveDb();
  try {
    await pay(a.id);
    if (!relayCallbacks()) {
      const status = transactionOf(getDb(), a)?.status ?? "processing";
      void toRelay(a, "payout", { ...relayEvent(a), payment: status, message: status === "completed" ? `Paid. ${rupees(a.amount)} has reached your UPI ID.` : `${rupees(a.amount)} is being sent to your UPI ID.` });
    }
    return null;
  } catch (err) {
    return err instanceof ServiceError ? err.message : "The payment could not be started.";
  }
}

/**
 * The worker's message in their language. With the Worker Assistance Agent on Relay, Sarvam translates it there
 * and calls back /api/relay/advances/message; until then (or without Relay) it is translated here.
 */
async function tellWorker(a: AdvanceRequest, english: string): Promise<string> {
  const text = await localise(english, a.language);
  a.workerMessage = { text, language: a.language, at: new Date().toISOString() };
  saveDb();
  const phone = getDb().workers.find((w) => w.id === a.workerId)?.phone.replace(/\D/g, "").slice(-10) ?? "";
  void toRelay(a, "worker", { ...relayEvent(a), message: english, phone });
  return text;
}

export function cancelOwnRequest(worker: Worker, id: string) {
  const a = find(id);
  if (a.workerId !== worker.id) throw new ServiceError("Request not found", 404);
  if (a.status !== "awaiting_approval" && a.status !== "escalated") throw new ServiceError("Only a request that is still waiting for a decision can be withdrawn.", 409);
  a.status = "cancelled";
  addTrail(a, "worker", "Withdrawn", "The worker withdrew the request.");
  saveDb();
}

/* ---------------------------------- owner ---------------------------------- */

export interface OwnerOverview {
  today: string;
  advances: OwnerAdvanceView[];
  config: {
    policyPercent: number;
    ownerAvailable: boolean;
    awayNote?: string;
    delegation: ReturnType<typeof configOf>["delegation"];
    /** Approved by the Manager Agent today, against the delegation's daily limit. */
    agentApprovedToday: number;
  };
  rules: { minAmount: number; hardCapPerRequest: number; maxDelegationDays: number };
}

export function ownerOverview(): OwnerOverview {
  const db = getDb();
  const cfg = configOf(db);
  const today = getToday();
  return {
    today,
    advances: advancesOf(db)
      .slice()
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .map((a) => toOwnerView(db, a)),
    config: { policyPercent: cfg.policyPercent, ownerAvailable: cfg.ownerAvailable, awayNote: cfg.awayNote, delegation: cfg.delegation, agentApprovedToday: agentApprovedToday(db, today) },
    rules: { minAmount: ADVANCE_RULES.minAmount, hardCapPerRequest: ADVANCE_RULES.hardCapPerRequest, maxDelegationDays: ADVANCE_RULES.maxDelegationDays },
  };
}

/** The owner approves or rejects a request that is waiting (or closes one whose payment failed). */
export async function ownerDecide(id: string, decision: "approve" | "reject", noteText?: unknown) {
  const db = getDb();
  const a = find(id);
  const text = note(noteText);
  const waiting = a.status === "awaiting_approval" || a.status === "escalated";

  if (decision === "reject") {
    const failedPayment = a.status === "approved" && transactionOf(db, a)?.status === "failed";
    if (!waiting && !failedPayment) throw new ServiceError("This request is already decided.", 409);
    a.status = "rejected";
    a.decisionNote = text || undefined;
    addTrail(a, "owner", failedPayment ? "Closed after failed payment" : "Rejected", text ? `Note: ${text}` : failedPayment ? "Closed without retrying the payment." : "Rejected by the owner.");
    logAudit("advance.reject", `${a.id}`);
    saveDb();
    return;
  }

  if (!waiting) throw new ServiceError("This request is already decided.", 409);
  const worker = db.workers.find((w) => w.id === a.workerId);
  if (!worker) throw new ServiceError("Worker not found", 404);
  // Facts may have moved since the request was made: check the rules again before approving.
  const latest = assess(db, worker, a.amount, a.id);
  if (!latest.eligible) {
    a.status = "ineligible";
    recordAssessment(a, latest);
    addTrail(a, "manager_agent", "Approval refused", "The worker is no longer eligible, so it cannot be approved.");
    saveDb();
    throw new ServiceError(`Cannot approve: ${latest.reasons[0]}`, 409);
  }
  approve(db, a, "owner", { note: text || undefined });
  logAudit("advance.approve", `${a.id}: ${rupees(a.amount)}`);
  saveDb();
  const failed = await startPayment(db, a);
  if (failed) throw new ServiceError(failed, 409);
}

/**
 * Owner settings: availability, the delegation to the Manager Agent, the advance percentage. Only the owner-only
 * route calls this. When the settings change, requests that are waiting are routed again, so a delegation granted
 * while requests are queued clears the ones it covers.
 */
export async function updateConfig(input: Record<string, unknown>, ownerName: string) {
  const db = getDb();
  const cfg = configOf(db);
  const today = getToday();

  if ("ownerAvailable" in input) {
    if (typeof input.ownerAvailable !== "boolean") throw new ServiceError("ownerAvailable must be true or false");
    cfg.ownerAvailable = input.ownerAvailable;
    logAudit("advance.availability", input.ownerAvailable ? "owner available" : "owner away");
  }
  if ("awayNote" in input) cfg.awayNote = note(input.awayNote) || undefined;
  if ("policyPercent" in input) {
    const p = Number(input.policyPercent);
    if (!Number.isFinite(p) || p < 5 || p > 50) throw new ServiceError("The advance limit must be between 5% and 50% of earned wages");
    cfg.policyPercent = Math.round(p);
    logAudit("advance.policy", `${cfg.policyPercent}% of earned wages`);
  }
  if ("delegation" in input) {
    if (input.delegation === null) {
      if (cfg.delegation) logAudit("advance.delegation_revoked", cfg.delegation.id);
      cfg.delegation = null;
    } else {
      const d = (input.delegation ?? {}) as Record<string, unknown>;
      const maxPerRequest = Math.round(Number(d.maxPerRequest));
      const dailyLimit = Math.round(Number(d.dailyLimit));
      const expiresOn = typeof d.expiresOn === "string" ? d.expiresOn : "";
      if (!Number.isFinite(maxPerRequest) || maxPerRequest < ADVANCE_RULES.minAmount || maxPerRequest > ADVANCE_RULES.hardCapPerRequest) {
        throw new ServiceError(`The per-request limit must be between ${rupees(ADVANCE_RULES.minAmount)} and ${rupees(ADVANCE_RULES.hardCapPerRequest)}`);
      }
      if (!Number.isFinite(dailyLimit) || dailyLimit < maxPerRequest || dailyLimit > ADVANCE_RULES.hardCapPerRequest * 5) {
        throw new ServiceError(`The daily limit must be at least the per-request limit and at most ${rupees(ADVANCE_RULES.hardCapPerRequest * 5)}`);
      }
      const last = new Date(`${today}T00:00:00Z`);
      last.setUTCDate(last.getUTCDate() + ADVANCE_RULES.maxDelegationDays);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || expiresOn < today || expiresOn > last.toISOString().slice(0, 10)) {
        throw new ServiceError(`The expiry date must be between today and ${ADVANCE_RULES.maxDelegationDays} days from now`);
      }
      cfg.delegation = { id: `dlg-${Date.now().toString(36)}`, maxPerRequest, dailyLimit, expiresOn, grantedBy: ownerName.slice(0, 80), grantedAt: new Date().toISOString() };
      logAudit("advance.delegation_granted", `up to ${rupees(maxPerRequest)} each, ${rupees(dailyLimit)} a day, until ${expiresOn}`);
    }
  }
  saveDb();
  await rerouteWaiting();
}

/** Routes every waiting request again under the current settings (the Manager Agent clears what its authority now covers). */
async function rerouteWaiting() {
  const db = getDb();
  for (const a of advancesOf(db)) {
    if (a.status !== "awaiting_approval" && a.status !== "escalated") continue;
    const worker = db.workers.find((w) => w.id === a.workerId);
    if (!worker) continue;
    const latest = assess(db, worker, a.amount, a.id);
    if (!latest.eligible) {
      a.status = "ineligible";
      recordAssessment(a, latest);
      continue;
    }
    a.eligibility = latest;
    const r = route(db, a);
    if (r.kind === "auto_approve") {
      approve(db, a, "manager_agent", { delegationId: r.delegationId });
      const failed = await startPayment(db, a);
      if (failed) console.error("Delegated payment did not start:", failed);
    } else if ((r.kind === "awaiting_approval") !== (a.status === "awaiting_approval")) {
      queue(a, r);
    }
  }
  saveDb();
}

/* ---------------------------- Relay agent callbacks ---------------------------- */

export type RelayCallback = "eligibility" | "manager" | "pay" | "message";

/**
 * Called by the agents on Cashfree Relay (HTTP step -> /api/relay/advances/<step>). A Relay agent can only move a
 * request one step along BolPay's own rules: it sends an advance id, never an amount, a limit or a UPI id. Every step
 * checks the request is at the stage it expects, so a repeated or out-of-order call changes nothing.
 * The request is found in whichever workspace holds it (Relay calls carry no signed-in user).
 */
export async function relayCallback(step: RelayCallback, advanceId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ws = listWorkspaces().find((w) => advancesOf(getDb(w)).some((a) => a.id === advanceId));
  if (!ws) throw new ServiceError("Unknown request", 404);
  return runInWorkspace(ws, () => runRelayStep(step, advanceId, body));
}

async function runRelayStep(step: RelayCallback, advanceId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = getDb();
  const a = advancesOf(db).find((x) => x.id === advanceId)!;
  const worker = db.workers.find((w) => w.id === a.workerId);
  const state = () => ({ advanceId: a.id, status: a.status, payment: transactionOf(db, a)?.status ?? null, workspace: getWorkspace() === "demo" ? "demo" : "business" });

  if (step === "eligibility") {
    if (a.status !== "checking" || a.relayStage !== "eligibility" || !worker) return { ...state(), changed: false };
    const result = assess(db, worker, a.amount, a.id);
    recordAssessment(a, result);
    a.trail[a.trail.length - 1].detail += " (run by the agent on Cashfree Relay)";
    if (!result.eligible) {
      a.status = "ineligible";
      a.relayStage = undefined;
      saveDb();
      await tellWorker(a, outcomeMessage(db, a));
      return { ...state(), changed: true, eligible: "no" };
    }
    a.relayStage = "manager";
    saveDb();
    if (relayHandoff("manager")) {
      addTrail(a, "system", "Sent to Relay", "Handed to the Manager Agent on Cashfree Relay.");
      saveDb();
      if (await emitToRelay("manager", relayEvent(a))) return { ...state(), changed: true, eligible: "yes" };
      addTrail(a, "system", "Relay unreachable", "Decided inside BolPay instead.");
    }
    return { ...(await runRelayStep("manager", advanceId, body)), eligible: "yes" };
  }

  if (step === "manager") {
    if (a.status !== "checking" || a.relayStage !== "manager") return { ...state(), changed: false };
    a.relayStage = undefined;
    const failed = await decideAsManager(db, a);
    const last = [...a.trail].reverse().find((t) => t.actor === "manager_agent");
    if (last) last.detail += " (decided by the agent on Cashfree Relay)";
    saveDb();
    await tellWorker(a, failed ?? outcomeMessage(db, a));
    return { ...state(), changed: true, decision: a.status };
  }

  if (step === "pay") {
    if (a.status !== "approved" || a.transactionId) return { ...state(), changed: false };
    try {
      await pay(a.id);
    } catch (err) {
      return { ...state(), changed: true, error: err instanceof ServiceError ? err.message : "Payment could not start" };
    }
    const last = [...a.trail].reverse().find((t) => t.actor === "payout_agent" && t.action === "Sending payment");
    if (last) last.detail += " (started by the agent on Cashfree Relay)";
    saveDb();
    return { ...state(), changed: true };
  }

  // message: the Worker Assistance Agent on Relay sends the worker's message translated by Sarvam.
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, 600) : "";
  if (!text) throw new ServiceError("Missing text");
  a.workerMessage = { text, language: typeof body.language === "string" ? body.language.slice(0, 8) : a.language, at: new Date().toISOString() };
  addTrail(a, "worker_agent", "Message to the worker", "Translated by Sarvam on Cashfree Relay.");
  saveDb();
  return { ...state(), changed: true };
}
