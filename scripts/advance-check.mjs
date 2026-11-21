// Checks the deterministic rules behind emergency advances (app/lib/advances/policy.ts).
// Run: node scripts/advance-check.mjs   (Node 22.18+ strips the TypeScript types itself)
import assert from "node:assert/strict";
import { isTestVpa, planTestUpiAssignment } from "../app/lib/cashfree/test-upi.ts";
import { ADVANCE_RULES, classifyPurpose, evaluateEligibility, guessAmount, normalizeDigits, planRecovery, routeRequest } from "../app/lib/advances/policy.ts";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`ok  ${name}`);
};

const base = {
  amount: 2000,
  earnedWages: 12000,
  salaryAlreadyApproved: false,
  workerActive: true,
  hasValidUpi: true,
  daysWorked: 20,
  daysSinceJoined: 400,
  outstanding: 500,
  openRequests: 0,
  recentDuplicate: false,
  requestsThisPeriod: 0,
  conflicts: [],
  missingDays: 0,
};

// The example from the product doc: earned 12000, 25% = 3000, outstanding 500, available 2500, asked 2000.
t("doc example is eligible with 2500 available", () => {
  const r = evaluateEligibility(base);
  assert.equal(r.calc.policyLimit, 3000);
  assert.equal(r.calc.availableLimit, 2500);
  assert.equal(r.eligible, true);
  assert.equal(r.maxEligible, 2500);
});
t("the doc example (outstanding advance, clean record) raises no flags, so the Manager Agent can approve it", () => {
  const r = evaluateEligibility(base);
  assert.deepEqual(r.flags, []);
  const d = { id: "d1", maxPerRequest: 3000, dailyLimit: 10000, expiresOn: "2026-11-25", grantedBy: "Owner", grantedAt: "2026-11-20T00:00:00Z" };
  const route = routeRequest({ amount: 2000, flags: r.flags, ownerAvailable: false, delegation: d, today: "2026-11-21", agentApprovedToday: 0 });
  assert.equal(route.kind, "auto_approve");
});
t("asking above the available limit is declined, with the most they can ask for", () => {
  const r = evaluateEligibility({ ...base, amount: 4000 });
  assert.equal(r.eligible, false);
  assert.equal(r.maxEligible, 2500);
  assert.match(r.explanation, /up to ₹2500/);
});
t("exactly the available limit is allowed", () => assert.equal(evaluateEligibility({ ...base, amount: 2500 }).eligible, true));
t("below the minimum and above the hard cap are declined", () => {
  assert.equal(evaluateEligibility({ ...base, amount: 50 }).eligible, false);
  const big = evaluateEligibility({ ...base, amount: 20000, earnedWages: 200000, outstanding: 0 });
  assert.equal(big.eligible, false);
  assert.equal(big.checks.find((c) => c.id === "amount_valid").passed, false);
});
t("no wages earned means nothing to advance against", () => assert.equal(evaluateEligibility({ ...base, earnedWages: 0, daysWorked: 0, outstanding: 0 }).eligible, false));
t("salary already approved for the period blocks an advance", () => {
  const r = evaluateEligibility({ ...base, earnedWages: 0, salaryAlreadyApproved: true });
  assert.equal(r.eligible, false);
  assert.equal(r.maxEligible, 0);
});
t("an open request or a same-amount repeat is a duplicate", () => {
  assert.equal(evaluateEligibility({ ...base, openRequests: 1 }).eligible, false);
  assert.equal(evaluateEligibility({ ...base, recentDuplicate: true }).eligible, false);
});
t("a fourth request in a period is declined", () => {
  assert.equal(evaluateEligibility({ ...base, requestsThisPeriod: ADVANCE_RULES.maxRequestsPerPeriod }).eligible, false);
});
t("conflicting attendance records block it; missing days only flag it", () => {
  assert.equal(evaluateEligibility({ ...base, conflicts: ["1 Nov is marked absent but deliveries are logged"] }).eligible, false);
  const r = evaluateEligibility({ ...base, missingDays: 2 });
  assert.equal(r.eligible, true);
  assert.ok(r.flags.some((f) => /no attendance record/.test(f)));
});
t("no UPI id or an inactive worker is declined", () => {
  assert.equal(evaluateEligibility({ ...base, hasValidUpi: false }).eligible, false);
  assert.equal(evaluateEligibility({ ...base, workerActive: false }).eligible, false);
});

const delegation = { id: "d1", maxPerRequest: 3000, dailyLimit: 10000, expiresOn: "2026-11-25", grantedBy: "Owner", grantedAt: "2026-11-20T00:00:00Z" };
const route = (over) => routeRequest({ amount: 2000, flags: [], ownerAvailable: false, delegation, today: "2026-11-21", agentApprovedToday: 0, ...over });

t("owner away + valid delegation + within limits: the Manager Agent approves", () => {
  const r = route({});
  assert.equal(r.kind, "auto_approve");
  assert.equal(r.delegationId, "d1");
});
t("an available owner always decides", () => assert.equal(route({ ownerAvailable: true }).kind, "awaiting_approval"));
t("no delegation: escalated", () => assert.equal(route({ delegation: null }).kind, "escalate"));
t("revoked delegation: escalated", () => assert.equal(route({ delegation: { ...delegation, revokedAt: "2026-11-21T00:00:00Z" } }).kind, "escalate"));
t("expired delegation: escalated; the last day still counts", () => {
  assert.equal(route({ today: "2026-11-26" }).kind, "escalate");
  assert.equal(route({ today: "2026-11-25" }).kind, "auto_approve");
});
t("above the per-request authority: escalated", () => assert.equal(route({ amount: 3001 }).kind, "escalate"));
t("daily limit: escalated once the day's total would pass it", () => {
  assert.equal(route({ agentApprovedToday: 8000 }).kind, "auto_approve");
  assert.equal(route({ agentApprovedToday: 8001 }).kind, "escalate");
});
t("a flagged request is never auto-approved", () => assert.equal(route({ flags: ["Joined only 2 day(s) ago."] }).kind, "escalate"));
t("delegation can never lift the hard cap", () => {
  const generous = { ...delegation, maxPerRequest: 999999, dailyLimit: 999999 };
  assert.equal(route({ delegation: generous, amount: ADVANCE_RULES.hardCapPerRequest + 1 }).kind, "escalate");
});

t("recovery takes oldest first and never more than half the payout", () => {
  const r = planRecovery(1000, [{ id: "a", remaining: 300 }, { id: "b", remaining: 600 }]);
  assert.deepEqual(r.parts, [{ advanceId: "a", amount: 300 }, { advanceId: "b", amount: 200 }]);
  assert.equal(r.total, 500);
});
t("recovery with nothing outstanding or no pay is zero", () => {
  assert.equal(planRecovery(1000, []).total, 0);
  assert.equal(planRecovery(0, [{ id: "a", remaining: 100 }]).total, 0);
});

t("native-script digits and rough amounts are read without a model", () => {
  assert.equal(normalizeDigits("আমার ২০০০ টাকা লাগবে"), "আমার 2000 টাকা লাগবে");
  assert.equal(guessAmount("আমার ২০০০ টাকা লাগবে"), 2000);
  assert.equal(guessAmount("I need Rs 1,500 for the hospital"), 1500);
  assert.equal(guessAmount("2k please"), 2000);
  assert.equal(guessAmount("I need money"), null);
});

t("purpose: emergencies pass, parties fail, pets and unknown reasons need a person", () => {
  assert.equal(classifyPurpose("medical", "hospital bill").purpose, "emergency");
  assert.equal(classifyPurpose("vehicle_repair", "bike accident").purpose, "emergency");
  assert.equal(classifyPurpose("celebration", "birthday").purpose, "non_emergency");
  assert.equal(classifyPurpose("medical", "emergency! birthday party").purpose, "non_emergency");
  assert.equal(classifyPurpose("other", "my cat died").purpose, "unclear");
  assert.equal(classifyPurpose("other", "need money").purpose, "unclear");
  assert.equal(classifyPurpose("other", "I want to go on a trip").purpose, "non_emergency");
  assert.equal(classifyPurpose("medical", "partner in hospital").purpose, "emergency", "'partner' is not 'party'");
});
t("purpose: a non-emergency is ineligible; an unclear one is eligible but flagged", () => {
  const no = evaluateEligibility({ ...base, purpose: { purpose: "non_emergency", note: "Not an emergency." } });
  assert.equal(no.eligible, false);
  assert.equal(no.reasons[0], "Not an emergency.");
  const maybe = evaluateEligibility({ ...base, purpose: { purpose: "unclear", note: "Owner decides." } });
  assert.equal(maybe.eligible, true);
  assert.ok(maybe.flags.includes("Owner decides."));
});

t("test UPI: fills only missing IDs, never overwrites a real one, honours the failure count", () => {
  const ws = [
    { id: "a", name: "Asha", status: "active", payoutUpi: "" },
    { id: "b", name: "Bina", status: "active", payoutUpi: "" },
    { id: "c", name: "Chetan", status: "active", payoutUpi: "chetan@okhdfc" },
    { id: "d", name: "Dev", status: "inactive", payoutUpi: "" },
  ];
  const plan = planTestUpiAssignment(ws, { failCount: 1 });
  assert.deepEqual(plan.changes.map((c) => c.id).sort(), ["a", "b"]);
  assert.equal(plan.failing, 1);
  assert.equal(plan.skippedReal, 1);
  assert.ok(plan.changes.every((c) => isTestVpa(c.upi)));
  assert.equal(plan.changes.find((c) => c.id === "a").upi, "failure@upi", "first by name gets the failing ID");
  assert.equal(isTestVpa("Success@UPI"), true);
  assert.equal(isTestVpa("ravi@okaxis"), false);
});

console.log(`\n${passed} checks passed`);
