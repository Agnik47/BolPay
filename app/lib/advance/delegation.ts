/**
 * The Manager Agent's decision rules. Pure and deterministic: no model, no I/O, no imports of runtime code, so it
 * runs on the server and in scripts/advance-check.mjs. It can only return advice about one request; it has no way to
 * change a delegation, the policy or a limit. The server decides what to do with the answer.
 *
 *   approve   all rules pass and the owner explicitly allowed autonomous approval
 *   recommend all rules pass, but a person must still approve
 *   escalate  something is outside its authority or data is missing: a person decides
 *   none      no delegation is in force, so the agent has no authority at all
 */
import type { AdvanceEligibility, AdvancePolicy, AdvanceRequest, Delegation } from "../merchant/types.ts";

export type AgentAction = "approve" | "recommend" | "escalate" | "none";
export interface AgentDecision {
  action: AgentAction;
  reasons: string[];
  delegationId?: string;
}

export const AGENT_ACTOR = (delegationId: string) => `delegation:${delegationId}`;

export function isActive(d: Delegation, nowMs: number): boolean {
  return !d.revokedAt && Date.parse(d.startsAt) <= nowMs && nowMs < Date.parse(d.expiresAt);
}

const TZ = "Asia/Kolkata";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

export interface DelegationInput {
  amount: number;
  eligibility: AdvanceEligibility;
  delegations: Delegation[];
  /** All advance requests, to total what the agent has already approved. */
  ledger: Pick<AdvanceRequest, "status" | "approvedAmount" | "decision">[];
  policy: AdvancePolicy;
  now: string;
  /** Cashfree production? */
  live: boolean;
  /** ALLOW_AUTONOMOUS_ADVANCES=true on the server. */
  liveAutonomyAllowed: boolean;
}

/** Money the agent approved under `delegationId` that is paying or paid, within the same day and month (India time). */
export function exposure(ledger: DelegationInput["ledger"], delegationId: string, now: string) {
  const by = AGENT_ACTOR(delegationId);
  const today = dayOf(now);
  let daily = 0;
  let monthly = 0;
  for (const a of ledger) {
    if (a.decision?.by !== by || (a.status !== "paying" && a.status !== "paid")) continue;
    const when = dayOf(a.decision.at);
    const amt = a.approvedAmount ?? 0;
    if (when.slice(0, 7) === today.slice(0, 7)) monthly += amt;
    if (when === today) daily += amt;
  }
  return { daily, monthly };
}

export function evaluateDelegation(i: DelegationInput): AgentDecision {
  const nowMs = Date.parse(i.now);
  const active = i.delegations.filter((d) => isActive(d, nowMs)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!active) {
    const expired = i.delegations.some((d) => !d.revokedAt && Date.parse(d.expiresAt) <= nowMs);
    return { action: "none", reasons: [expired ? "The last delegation has expired, so the agent has no authority." : "No delegation is in force."] };
  }
  const id = active.id;
  const escalate = (...reasons: string[]): AgentDecision => ({ action: "escalate", reasons, delegationId: id });

  if (i.eligibility.blocks.length) return escalate(`Not eligible: ${i.eligibility.blocks.join(" ")}`);
  if (i.eligibility.flags.length) return escalate(`Data to check: ${i.eligibility.flags.join(" ")}`);
  if (i.amount > active.maxPerRequest) return escalate(`₹${i.amount} is above the delegated limit of ₹${active.maxPerRequest} per request.`);

  const used = exposure(i.ledger, id, i.now);
  if (used.daily + i.amount > active.maxDailyTotal) return escalate(`This would take today's delegated total to ₹${used.daily + i.amount}, above ₹${active.maxDailyTotal}.`);
  if (used.monthly + i.amount > active.maxMonthlyTotal) return escalate(`This would take this month's delegated total to ₹${used.monthly + i.amount}, above ₹${active.maxMonthlyTotal}.`);

  const ok = `Eligible: ₹${i.amount} is within the available ₹${i.eligibility.available}, the delegated ₹${active.maxPerRequest} per request, and today's and this month's caps.`;
  if (i.policy.requireHumanApproval) return { action: "recommend", delegationId: id, reasons: [ok, "Policy requires a person to approve every request."] };
  if (!active.autonomous) return { action: "recommend", delegationId: id, reasons: [ok, "This delegation can recommend only."] };
  if (i.live && !i.liveAutonomyAllowed) return { action: "recommend", delegationId: id, reasons: [ok, "Autonomous approval is blocked in production on this server."] };
  return { action: "approve", delegationId: id, reasons: [ok, "Approved within the owner's delegated authority."] };
}
