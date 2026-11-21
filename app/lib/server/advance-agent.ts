import "server-only";
import { AGENT_ACTOR, evaluateDelegation, isActive } from "@/app/lib/advance/delegation";
import { isLiveCashfree } from "@/app/lib/cashfree/rest";
import type { AdvancePolicy, Delegation } from "@/app/lib/merchant/types";
import { advancePolicy, advances, approveAdvance, eligibilityFor, type Actor } from "./advance-service";
import { getDb, logAudit, saveDb } from "./db";
import { ServiceError } from "./service";

/**
 * Policy, delegation and the Manager Agent runner.
 * The agent is the pure rule function in app/lib/advance/delegation.ts. Nothing here lets it change the policy,
 * a delegation or a limit: those are owner-only routes, and the runner only reads them. When it is allowed to
 * approve, it goes through the same approveAdvance() as the owner (fresh eligibility check, one synchronous
 * compare-and-set, the existing Cashfree path), acting as "delegation:<id>".
 */

const AGENT_NAME = "BolPay Manager Agent";
const delegations = () => (getDb().delegations ??= []);
const autonomyAllowed = () => !isLiveCashfree || process.env.ALLOW_AUTONOMOUS_ADVANCES === "true";

const int = (v: unknown, lo: number, hi: number, label: string) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ServiceError(`${label} must be a whole number from ${lo} to ${hi}.`);
  return n;
};

/* -------------------------------- policy -------------------------------- */

export function updatePolicy(actor: Actor, input: Record<string, unknown>) {
  const cur = advancePolicy();
  const next: AdvancePolicy = { ...cur };
  if (input.percentLimit !== undefined) next.percentLimit = int(input.percentLimit, 1, 50, "The percentage limit");
  if (input.maxAmount !== undefined) next.maxAmount = int(input.maxAmount, 1, 50_000, "The maximum amount");
  if (input.minServiceDays !== undefined) next.minServiceDays = int(input.minServiceDays, 0, 365, "The minimum service period");
  if (input.maxOutstanding !== undefined) next.maxOutstanding = int(input.maxOutstanding, 1, 5, "Outstanding advances allowed");
  if (input.expireAfterHours !== undefined) next.expireAfterHours = int(input.expireAfterHours, 1, 720, "Expiry (hours)");
  if (input.maxRecoveryPercentOfPayout !== undefined) next.maxRecoveryPercentOfPayout = int(input.maxRecoveryPercentOfPayout, 10, 100, "The recovery share");
  if (input.requireHumanApproval !== undefined) {
    if (typeof input.requireHumanApproval !== "boolean") throw new ServiceError("Human approval must be on or off.");
    next.requireHumanApproval = input.requireHumanApproval;
  }
  const changed = (Object.keys(next) as (keyof AdvancePolicy)[]).filter((k) => k !== "version" && next[k] !== cur[k]);
  if (!changed.length) return;
  next.version = cur.version + 1;
  getDb().advancePolicy = next;
  logAudit("advance.policy", `v${next.version}: ${changed.map((k) => `${k} ${String(cur[k])} → ${String(next[k])}`).join(", ")}`, undefined, actor.id);
  saveDb();
}

/* ------------------------------- delegation ------------------------------ */

export function delegationState() {
  const now = Date.now();
  const list = [...delegations()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    policy: advancePolicy(),
    delegations: list.map((d) => ({ ...d, state: d.revokedAt ? "revoked" : now >= Date.parse(d.expiresAt) ? "expired" : now < Date.parse(d.startsAt) ? "scheduled" : "active" })),
    live: isLiveCashfree,
    autonomyAllowed: autonomyAllowed(),
  };
}

export async function createDelegation(actor: Actor, input: Record<string, unknown>) {
  const policy = advancePolicy();
  const nowMs = Date.now();
  const maxPerRequest = int(input.maxPerRequest, 1, policy.maxAmount, "The per-request limit");
  const maxDailyTotal = int(input.maxDailyTotal, maxPerRequest, 500_000, "The daily total");
  const maxMonthlyTotal = int(input.maxMonthlyTotal, maxDailyTotal, 5_000_000, "The monthly total");
  const startsMs = input.startsAt ? Date.parse(String(input.startsAt)) : nowMs;
  const expiresMs = Date.parse(String(input.expiresAt ?? ""));
  if (!Number.isFinite(startsMs) || !Number.isFinite(expiresMs)) throw new ServiceError("Choose when the delegation starts and expires.");
  if (startsMs < nowMs - 5 * 60_000) throw new ServiceError("The start time can't be in the past.");
  if (expiresMs < startsMs + 5 * 60_000) throw new ServiceError("The delegation must last at least 5 minutes.");
  if (expiresMs > startsMs + 60 * 86_400_000) throw new ServiceError("A delegation can last at most 60 days. Renew it if you need longer.");
  if (typeof input.autonomous !== "boolean") throw new ServiceError("Choose whether the agent may approve on its own or only recommend.");
  if (delegations().some((d) => !d.revokedAt && Date.parse(d.expiresAt) > nowMs)) throw new ServiceError("A delegation is already active or scheduled. Revoke it first.", 409);

  const d: Delegation = {
    id: `dlg_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    grantedBy: { id: actor.id, name: actor.name },
    maxPerRequest,
    maxDailyTotal,
    maxMonthlyTotal,
    startsAt: new Date(startsMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    autonomous: input.autonomous,
    note: typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) || undefined : undefined,
    createdAt: new Date(nowMs).toISOString(),
  };
  delegations().push(d);
  logAudit("advance.delegation", `${d.id}: up to ₹${maxPerRequest} per request, ₹${maxDailyTotal}/day, ₹${maxMonthlyTotal}/month, until ${d.expiresAt}, ${d.autonomous ? "may approve" : "recommend only"}`, undefined, actor.id);
  saveDb();
  await sweepAgent(); // requests already waiting are looked at under the new authority
}

export function revokeDelegation(actor: Actor, id: string) {
  const d = delegations().find((x) => x.id === id);
  if (!d) throw new ServiceError("Delegation not found.", 404);
  if (d.revokedAt) throw new ServiceError("This delegation is already revoked.", 409);
  d.revokedAt = new Date().toISOString();
  d.revokedBy = { id: actor.id, name: actor.name };
  logAudit("advance.delegation_revoked", d.id, undefined, actor.id);
  saveDb();
}

/* ------------------------------- the agent ------------------------------- */

/**
 * Looks at one waiting request under the delegation in force, records what the agent decided, and, only when the
 * rules, the policy and the owner's opt-in all allow it, approves through the normal path. No `await` sits between
 * the rule evaluation and approveAdvance()'s synchronous check-and-set, so a revoke or a human decision can't slip in
 * between. Never throws: a failure leaves the request waiting for a person.
 */
export async function runManagerAgent(id: string) {
  try {
    const a = advances().find((x) => x.id === id);
    if (!a || a.status !== "pending_review" || a.agent) return;
    const now = new Date().toISOString();
    const decision = evaluateDelegation({
      amount: a.amount,
      eligibility: eligibilityFor(a.workerId, { amount: a.amount, excludeId: a.id }),
      delegations: delegations(),
      ledger: advances(),
      policy: advancePolicy(),
      now,
      live: isLiveCashfree,
      liveAutonomyAllowed: process.env.ALLOW_AUTONOMOUS_ADVANCES === "true",
    });
    if (decision.action === "none" || !decision.delegationId) return; // no authority: leave it to people, leave no trace on the request

    const actor = AGENT_ACTOR(decision.delegationId);
    a.agent = { at: now, delegationId: decision.delegationId, action: decision.action, reasons: decision.reasons };
    if (decision.action === "recommend") {
      a.recommendation = { by: actor, byName: AGENT_NAME, at: now, verdict: "approve", note: decision.reasons.join(" ") };
    }
    a.updatedAt = now;
    logAudit(`advance.agent_${decision.action}`, `${a.id}: ${decision.reasons.join(" ")}`, undefined, actor);
    saveDb();

    if (decision.action === "approve") {
      const pending = approveAdvance(a.id, { id: actor, name: AGENT_NAME }, { note: "Approved by the Manager Agent within delegated authority." });
      try {
        await pending;
        a.agent.executed = true;
      } catch (err) {
        a.agent.executed = false;
        a.agent.reasons = [...a.agent.reasons, `Not executed: ${err instanceof Error ? err.message : "unknown error"}`];
        logAudit("advance.agent_not_executed", `${a.id}: ${err instanceof Error ? err.message : "error"}`, undefined, actor);
      }
      saveDb();
    }
  } catch (err) {
    console.error("Manager agent failed", err);
  }
}

/** Looks at every waiting request the agent hasn't seen yet (used when a delegation starts). */
export async function sweepAgent() {
  for (const a of advances().filter((x) => x.status === "pending_review" && !x.agent)) await runManagerAgent(a.id);
}

/** Delegations currently in force. */
export const activeDelegations = () => delegations().filter((d) => isActive(d, Date.now()));
