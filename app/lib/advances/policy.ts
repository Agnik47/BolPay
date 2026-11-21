/**
 * The deterministic rules behind emergency salary advances. No imports besides types, so it runs on the
 * server, in the browser and in scripts/advance-check.mjs. The AI agents interpret and explain; every limit,
 * permission and amount below is plain code they cannot talk their way past.
 */
import type { AdvanceCalc, AdvanceReason, Delegation, EligibilityCheck, EligibilityResult, PurposeCheck } from "./types";

export const ADVANCE_RULES = {
  /** Share of wages earned (and not yet paid) this period that can be advanced. */
  policyPercent: 25,
  minAmount: 100,
  /** No advance above this, whatever the earned wages or any delegation say. */
  hardCapPerRequest: 10_000,
  /** Requests (not declined or withdrawn) allowed in one pay period. */
  maxRequestsPerPeriod: 3,
  /** The same amount asked again inside this window counts as a duplicate. */
  duplicateWindowMs: 24 * 60 * 60 * 1000,
  /** Most of one salary payout that can be taken back for earlier advances; the rest carries to the next payout. */
  maxRecoveryShare: 0.5,
  /** A worker younger than this (days since joining) is flagged for a human to look at. */
  newWorkerDays: 7,
  /** The longest a delegation may run from the day it is granted. */
  maxDelegationDays: 90,
} as const;

export const REASON_LABEL: Record<AdvanceReason, string> = {
  medical: "a medical emergency",
  accident: "an accident",
  vehicle_repair: "vehicle repair",
  family: "a family emergency",
  rent: "rent or housing",
  education: "education fees",
  celebration: "a celebration",
  shopping: "shopping",
  travel: "travel",
  entertainment: "entertainment",
  pet: "a pet",
  other: "an urgent need",
};

/* --------------------------- emergency guardrail --------------------------- */

/** Reasons the policy treats as emergencies. */
const EMERGENCY_REASONS: AdvanceReason[] = ["medical", "accident", "vehicle_repair", "family", "rent"];
/** Reasons the policy never treats as emergencies. */
const NON_EMERGENCY_REASONS: AdvanceReason[] = ["celebration", "shopping", "travel", "entertainment"];

/** Words that mark a request as not an emergency, whatever the model said (English, Hindi, Bengali, romanised). */
const NON_EMERGENCY_WORDS = [
  "birthday", "bday", "party", "celebrat", "anniversary", "wedding gift", "gift", "shopping", "clothes", "new dress", "shoes",
  "movie", "cinema", "concert", "trip", "holiday", "vacation", "picnic", "tour", "outing", "new phone", "iphone", "new mobile",
  "laptop", "television", "gaming", "game", "bet", "betting", "lottery", "alcohol", "liquor", "drinks", "beer", "festival shopping",
  "jashan", "janamdin", "janmdin", "janmadin",
  "जन्मदिन", "पार्टी", "शॉपिंग", "खरीदारी", "घूमने", "छुट्टी", "फिल्म", "शराब",
  "জন্মদিন", "পার্টি", "শপিং", "কেনাকাটা", "ঘুরতে", "সিনেমা", "মদ",
];
/** Words that make a stated pet reason something a person should look at (not refused, not auto-approved). */
const PET_WORDS = ["cat", "dog", "pet", "puppy", "kitten", "बिल्ली", "कुत्ता", "বিড়াল", "কুকুর"];

const hasAny = (text: string, words: string[]) => {
  const t = text.toLowerCase();
  return words.some((w) => (/^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}`).test(t) : t.includes(w)));
};

/**
 * The emergency guardrail. The model only suggests a reason; this decides, and the worker's own words are checked
 * too, so "it's an emergency, I need it for my birthday party" is still not an emergency.
 *  - emergency: medical, accident, vehicle repair, family emergency, rent.
 *  - non_emergency: celebrations, shopping, travel, entertainment, or any of NON_EMERGENCY_WORDS: refused.
 *  - unclear: anything else (a pet, education, no reason): allowed to be asked for, but a person must approve it.
 */
export function classifyPurpose(reason: AdvanceReason, words: string): PurposeCheck {
  if (NON_EMERGENCY_REASONS.includes(reason) || hasAny(words, NON_EMERGENCY_WORDS)) {
    return { purpose: "non_emergency", note: "Emergency advances are only for urgent needs such as medical care, an accident, repairing the vehicle you work with, a family emergency or rent. This request is not one of those." };
  }
  if (reason === "pet" || hasAny(words, PET_WORDS)) {
    return { purpose: "unclear", note: "The reason involves a pet, so the owner decides whether it counts as an emergency." };
  }
  if (EMERGENCY_REASONS.includes(reason)) return { purpose: "emergency", note: `Emergency: ${REASON_LABEL[reason]}.` };
  return { purpose: "unclear", note: "The reason is not one of the standard emergencies, so the owner decides." };
}

/** Whole rupees without grouping commas, so a translation can keep every digit unchanged. */
export const rupees = (n: number) => `₹${Math.round(n)}`;

/* ------------------------------ eligibility ------------------------------ */

export interface EligibilityInput {
  amount: number;
  /** Wages earned this period. Pass 0 when this period's salary is already approved (nothing is left to advance against). */
  earnedWages: number;
  salaryAlreadyApproved: boolean;
  workerActive: boolean;
  hasValidUpi: boolean;
  daysWorked: number;
  daysSinceJoined: number;
  /** Advances paid and not yet recovered. */
  outstanding: number;
  /** Other advances of this worker still waiting for a decision or for their payment. */
  openRequests: number;
  /** Same amount requested in the last 24 hours. */
  recentDuplicate: boolean;
  /** Other requests this period that were not declined, rejected or withdrawn. */
  requestsThisPeriod: number;
  /** Records that contradict each other (marked absent but deliveries logged). */
  conflicts: string[];
  /** Days in the period with no attendance record (earned wages only count marked days). */
  missingDays: number;
  policyPercent?: number;
  /** Emergency guardrail result; absent only for the worker's limit preview. */
  purpose?: PurposeCheck;
}

export function evaluateEligibility(i: EligibilityInput): EligibilityResult {
  const percent = i.policyPercent ?? ADVANCE_RULES.policyPercent;
  const requested = Math.round(i.amount);
  const earned = Math.max(0, Math.round(i.earnedWages));
  const policyLimit = Math.floor((earned * percent) / 100);
  const outstanding = Math.max(0, Math.round(i.outstanding));
  const availableLimit = Math.max(0, policyLimit - outstanding);
  const calc: AdvanceCalc = { earnedWages: earned, policyPercent: percent, policyLimit, outstanding, availableLimit, requested };

  const checks: EligibilityCheck[] = [];
  const check = (id: string, label: string, passed: boolean, detail: string) => checks.push({ id, label, passed, detail });

  check("worker_active", "Active worker", i.workerActive, i.workerActive ? "Your profile is active." : "Your profile is not active.");
  check(
    "payout_account",
    "Payment account on file",
    i.hasValidUpi,
    i.hasValidUpi ? "A valid UPI ID is on file." : "No valid UPI ID is on file, so money cannot be sent. Ask your employer to add one.",
  );
  const amountOk = Number.isFinite(requested) && requested >= ADVANCE_RULES.minAmount && requested <= ADVANCE_RULES.hardCapPerRequest;
  check(
    "amount_valid",
    "Amount allowed",
    amountOk,
    amountOk ? `${rupees(requested)} is inside the allowed range.` : `An advance must be between ${rupees(ADVANCE_RULES.minAmount)} and ${rupees(ADVANCE_RULES.hardCapPerRequest)}.`,
  );
  check(
    "salary_open",
    "Salary for this period not yet approved",
    !i.salaryAlreadyApproved,
    i.salaryAlreadyApproved ? "This period's salary has already been approved for payment, so there is nothing left to advance against." : "This period's salary has not been paid out yet.",
  );
  check("earned_wages", "Wages earned this period", earned > 0 && i.daysWorked > 0, earned > 0 ? `${rupees(earned)} earned over ${i.daysWorked} worked day(s).` : "No wages earned yet this period.");
  check(
    "no_duplicate",
    "No duplicate request",
    i.openRequests === 0 && !i.recentDuplicate,
    i.openRequests > 0 ? "You already have an advance request waiting." : i.recentDuplicate ? "The same amount was requested in the last 24 hours." : "No other request is open.",
  );
  check(
    "request_frequency",
    "Request count this period",
    i.requestsThisPeriod < ADVANCE_RULES.maxRequestsPerPeriod,
    i.requestsThisPeriod < ADVANCE_RULES.maxRequestsPerPeriod ? `${i.requestsThisPeriod} earlier request(s) this period.` : `At most ${ADVANCE_RULES.maxRequestsPerPeriod} requests are allowed per pay period.`,
  );
  check(
    "records_consistent",
    "Attendance records consistent",
    i.conflicts.length === 0,
    i.conflicts.length === 0 ? "No conflicting attendance records." : `Conflicting records: ${i.conflicts.slice(0, 2).join("; ")}. Your employer needs to fix them first.`,
  );
  check(
    "within_limit",
    `Within the ${percent}% advance limit`,
    requested <= availableLimit,
    requested <= availableLimit
      ? `${rupees(requested)} is within the ${rupees(availableLimit)} available.`
      : `${rupees(requested)} is more than the ${rupees(availableLimit)} available (${percent}% of ${rupees(earned)} is ${rupees(policyLimit)}${outstanding ? `, minus ${rupees(outstanding)} already advanced` : ""}).`,
  );

  if (i.purpose) {
    check("genuine_emergency", "Genuine emergency", i.purpose.purpose !== "non_emergency", i.purpose.note);
  }

  const flags: string[] = [];
  if (i.purpose?.purpose === "unclear") flags.push(i.purpose.note);
  if (i.missingDays > 0) flags.push(`${i.missingDays} day(s) this period have no attendance record, so earned wages count marked days only.`);
  if (i.daysSinceJoined < ADVANCE_RULES.newWorkerDays) flags.push(`Joined only ${Math.max(0, i.daysSinceJoined)} day(s) ago.`);
  if (i.requestsThisPeriod >= 2) flags.push(`This would be request number ${i.requestsThisPeriod + 1} this period.`);

  const failed = checks.filter((c) => !c.passed);
  const eligible = failed.length === 0;
  const blocked = failed.some((c) => c.id !== "within_limit");
  const maxEligible = blocked ? 0 : Math.min(availableLimit, ADVANCE_RULES.hardCapPerRequest);
  // The emergency guardrail is the most useful thing to tell the worker, so it leads.
  const reasons = [...failed].sort((x, y) => Number(y.id === "genuine_emergency") - Number(x.id === "genuine_emergency")).map((c) => c.detail);

  const explanation = eligible
    ? `Eligible. You have earned ${rupees(earned)} this period, so the ${percent}% limit is ${rupees(policyLimit)}${outstanding ? `; after ${rupees(outstanding)} already advanced, ${rupees(availableLimit)} is available` : ""}. You asked for ${rupees(requested)}.`
    : maxEligible > 0
      ? `Not approved for ${rupees(requested)}: ${reasons[0]} You can ask for up to ${rupees(maxEligible)}.`
      : `Not eligible right now: ${reasons[0]}`;

  return { eligible, calc, checks, reasons, flags, maxEligible, explanation };
}

/* -------------------------------- routing -------------------------------- */

export type Route =
  | { kind: "awaiting_approval"; reason: string }
  | { kind: "auto_approve"; reason: string; delegationId: string }
  | { kind: "escalate"; reason: string };

export function delegationActive(d: Delegation | null | undefined, today: string): d is Delegation {
  return Boolean(d && !d.revokedAt && today <= d.expiresOn);
}

/**
 * Who decides an eligible request. A present owner decides (the agent never approves over their head). When the
 * owner is away, the Manager Agent may approve only inside an explicit, unexpired delegation: per-request and
 * daily limits, a clean request (no flags) and the hard cap. Anything else goes up to the owner.
 */
export function routeRequest(args: {
  amount: number;
  flags: string[];
  ownerAvailable: boolean;
  delegation: Delegation | null | undefined;
  today: string;
  /** Total the Manager Agent has already approved today (excluding this request). */
  agentApprovedToday: number;
}): Route {
  if (args.ownerAvailable) return { kind: "awaiting_approval", reason: "The owner is available, so they decide." };
  const d = args.delegation;
  if (!d || d.revokedAt) return { kind: "escalate", reason: "The owner is away and has not delegated approval." };
  if (args.today > d.expiresOn) return { kind: "escalate", reason: `The delegated authority expired on ${d.expiresOn}.` };
  const perRequest = Math.min(d.maxPerRequest, ADVANCE_RULES.hardCapPerRequest);
  if (args.amount > perRequest) return { kind: "escalate", reason: `${rupees(args.amount)} is above the ${rupees(perRequest)} per-request authority.` };
  if (args.agentApprovedToday + args.amount > d.dailyLimit) {
    return { kind: "escalate", reason: `It would take today's delegated total to ${rupees(args.agentApprovedToday + args.amount)}, above the ${rupees(d.dailyLimit)} daily limit.` };
  }
  if (args.flags.length > 0) return { kind: "escalate", reason: `The request has points a person should look at: ${args.flags[0]}` };
  return { kind: "auto_approve", reason: `Within delegated authority (up to ${rupees(perRequest)} each, ${rupees(d.dailyLimit)} a day, until ${d.expiresOn}).`, delegationId: d.id };
}

/* -------------------------------- recovery -------------------------------- */

/**
 * How much of a salary payout goes back to earlier advances: oldest first, never more than `maxRecoveryShare`
 * of the payout (so a worker is never paid nothing); whatever is left carries to the next payout.
 */
export function planRecovery(gross: number, outstanding: { id: string; remaining: number }[]): { total: number; parts: { advanceId: string; amount: number }[] } {
  let room = Math.floor(Math.max(0, gross) * ADVANCE_RULES.maxRecoveryShare);
  const parts: { advanceId: string; amount: number }[] = [];
  for (const a of outstanding) {
    if (room <= 0) break;
    const take = Math.min(room, Math.max(0, Math.round(a.remaining)));
    if (take > 0) {
      parts.push({ advanceId: a.id, amount: take });
      room -= take;
    }
  }
  return { total: parts.reduce((s, p) => s + p.amount, 0), parts };
}

/* ----------------------------- amount fallback ----------------------------- */

const DIGIT_BLOCKS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66]; // Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam

/** Rewrites native-script digits (২০০০, ₹२०००) as 0-9 so an amount can be read without a model. */
export function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const block = DIGIT_BLOCKS.find((b) => cp >= b && cp <= b + 9);
    out += block === undefined ? ch : String(cp - block);
  }
  return out;
}

/** Best-effort amount from text when the language model is unavailable. Returns null when none is clear. */
export function guessAmount(text: string): number | null {
  const t = normalizeDigits(text).toLowerCase();
  const found = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|हज़ार|हजार)?/g)]
    .map((m) => {
      const base = Number(m[1].replace(/,/g, ""));
      return m[2] ? base * 1000 : base;
    })
    .filter((n) => Number.isFinite(n) && n >= 10);
  return found.length ? Math.round(found[0]) : null;
}
