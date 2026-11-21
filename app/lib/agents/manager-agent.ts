import "server-only";
import { routeRequest, rupees, type Route } from "@/app/lib/advances/policy";
import { addTrail, agentApprovedToday, configOf } from "@/app/lib/advances/store";
import type { AdvanceRequest, ApprovedBy } from "@/app/lib/advances/types";
import { getToday } from "@/app/lib/server/context";
import type { Db } from "@/app/lib/server/db";

/**
 * Agent 3: Manager Agent (approval and delegation).
 * Finds who may approve an eligible request. A present owner always decides. While the owner is away, this agent
 * may approve only inside an explicit delegation the owner granted (per-request and daily limits, an expiry date,
 * clean requests only); everything else is escalated. The delegation can be created and revoked only by the owner
 * through an owner-only route: this agent has no way to widen its own authority. It then hands approved requests
 * to the Payout Agent and keeps the approval audit trail.
 */
export function route(db: Db, a: AdvanceRequest): Route {
  const cfg = configOf(db);
  const today = getToday();
  return routeRequest({
    amount: a.amount,
    flags: a.eligibility.flags,
    ownerAvailable: cfg.ownerAvailable,
    delegation: cfg.delegation,
    today,
    agentApprovedToday: agentApprovedToday(db, today, a.id),
  });
}

/** Applies a routing decision that is not an approval: queue for the owner, or escalate. */
export function queue(a: AdvanceRequest, r: Route) {
  if (r.kind === "awaiting_approval") {
    a.status = "awaiting_approval";
    addTrail(a, "manager_agent", "Sent to the owner", r.reason);
  } else if (r.kind === "escalate") {
    a.status = "escalated";
    addTrail(a, "manager_agent", "Escalated to the owner", r.reason);
  }
}

/** Records an approval. The caller then asks the Payout Agent to pay. */
export function approve(db: Db, a: AdvanceRequest, by: ApprovedBy, opts: { note?: string; delegationId?: string } = {}) {
  a.status = "approved";
  a.approval = { by, at: new Date().toISOString(), day: getToday(), delegationId: opts.delegationId, note: opts.note };
  if (by === "manager_agent") {
    const d = configOf(db).delegation;
    addTrail(a, "manager_agent", "Approved within delegated authority", `${rupees(a.amount)} approved for the owner${d ? ` (limit ${rupees(d.maxPerRequest)} per request, ${rupees(d.dailyLimit)} a day, until ${d.expiresOn})` : ""}.`);
  } else {
    addTrail(a, "owner", "Approved", opts.note ? `Approved by the owner. Note: ${opts.note}` : "Approved by the owner.");
  }
}

/** True when an agent approval is still backed by a valid delegation (checked again just before paying). */
export function delegationStillCovers(db: Db, a: AdvanceRequest): string | null {
  const d = configOf(db).delegation;
  const today = getToday();
  if (!d || d.revokedAt || d.id !== a.approval?.delegationId) return "The delegation it relied on has been revoked or replaced.";
  if (today > d.expiresOn) return `The delegation expired on ${d.expiresOn}.`;
  if (a.amount > d.maxPerRequest) return `${rupees(a.amount)} is above the ${rupees(d.maxPerRequest)} per-request authority.`;
  if (agentApprovedToday(db, a.approval.day, a.id) + a.amount > d.dailyLimit) return `It would pass the ${rupees(d.dailyLimit)} daily limit.`;
  return null;
}
