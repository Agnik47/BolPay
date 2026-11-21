import "server-only";
import { addTrail, evaluateForWorker } from "@/app/lib/advances/store";
import type { AdvanceRequest, EligibilityResult, PurposeCheck } from "@/app/lib/advances/types";
import type { Worker } from "@/app/lib/merchant/types";
import type { Db } from "@/app/lib/server/db";

/**
 * Agent 2: Financial Eligibility Agent (salary and risk).
 * Decides whether the worker can receive the amount, from the worker's real records: earned wages, the 25%
 * advance policy, earlier advances still to be recovered, duplicate and repeat requests, and records that look
 * inconsistent. It is deterministic code (see app/lib/advances/policy.ts): a model explains, it never decides.
 */
export function assess(db: Db, worker: Worker, amount: number, excludeId?: string, purpose?: PurposeCheck): EligibilityResult {
  return evaluateForWorker(db, worker, amount, excludeId, purpose);
}

/** Writes the decision and its reasoning into the request's audit trail. */
export function recordAssessment(a: AdvanceRequest, result: EligibilityResult) {
  a.eligibility = result;
  const { calc } = result;
  addTrail(
    a,
    "eligibility_agent",
    result.eligible ? "Eligible" : "Not eligible",
    `${result.explanation} (earned ₹${calc.earnedWages}, ${calc.policyPercent}% limit ₹${calc.policyLimit}, outstanding ₹${calc.outstanding}, available ₹${calc.availableLimit}, requested ₹${calc.requested})` + (result.flags.length ? ` Flags: ${result.flags.join(" ")}` : ""),
  );
}
