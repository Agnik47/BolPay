export type WorkerStatus = "active" | "inactive";

export interface Worker {
  id: string;
  name: string;
  role: string;
  /** City the worker operates in (used by voice/batch filters). */
  city: string;
  phone: string;
  /** UPI id (name@bank) that payouts are sent to. Empty = payouts will fail. */
  payoutUpi: string;
  dailyWage: number;
  joinedOn: string; // YYYY-MM-DD
  status: WorkerStatus;
  /** Set for workers imported from an HR system, e.g. "zoho:S19". Syncs match on this. */
  externalId?: string;
  /** Where the record came from; absent for workers created in BolPay. */
  source?: "zoho";
  /** Department from the HR system (informational). */
  department?: string;
  /** Supabase user id of the supervisor whose team this worker is on. Unset = not on anyone's team yet. */
  supervisorId?: string;
}

export type AttendanceStatus = "present" | "half" | "absent" | "leave";

export interface AttendanceRecord {
  workerId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  overtimeHours: number;
  /** Units of work completed that day (orders, tasks, items...). */
  units: number;
}

export interface IncentiveRules {
  workingHoursPerDay: number;
  overtimeMultiplier: number;
  /** Units per day before the per-unit incentive starts. */
  dailyUnitTarget: number;
  ratePerExtraUnit: number;
  /** 0-1, share of period days a worker must be paid-present for. */
  attendanceThreshold: number;
  attendanceBonus: number;
  /** Daily delivery tiers: on each worked day the highest tier reached is paid once. */
  deliveryTiers: DeliveryTier[];
  /** Bumped every time the rules change; stored on each payout for auditability. */
  version: number;
}

export interface DeliveryTier {
  minUnits: number;
  bonus: number;
}

export interface PayBreakdown {
  workerId: string;
  periodDays: number;
  payDays: number;
  overtimeHours: number;
  extraUnits: number;
  attendanceRate: number;
  basePay: number;
  overtimePay: number;
  performanceIncentive: number;
  /** Sum of daily delivery-tier bonuses. */
  tierBonus: number;
  attendanceBonus: number;
  total: number;
}

export interface Period {
  id: string;
  label: string;
  start: string;
  end: string;
}

export type PayoutStatus = "pending" | "needs_review" | "approved" | "rejected";

export interface Payout {
  id: string;
  workerId: string;
  periodId: string;
  periodLabel: string;
  breakdown: PayBreakdown;
  amount: number;
  status: PayoutStatus;
  /** Rule set used to compute this payout. */
  ruleVersion?: number;
  rulesSnapshot?: IncentiveRules;
  /** Why a payout is flagged Needs Review (missing or conflicting records). */
  reviewReasons?: string[];
  submittedAt: string; // ISO
  decidedAt?: string;
  /** Wages before advance recovery. `amount` is the net actually sent to Cashfree. Absent means no deductions. */
  grossAmount?: number;
  /** Advances withheld from this payout. Counted as recovered only when the transfer completes. */
  deductions?: PayoutDeduction[];
  /** True once the payroll transfer completed and the deductions were credited to the advances. */
  recoveryApplied?: boolean;
}

export interface PayoutDeduction {
  advanceId: string;
  amount: number;
}

export type TransactionStatus = "processing" | "completed" | "failed";

export interface Transaction {
  id: string;
  payoutId: string;
  workerId: string;
  periodLabel: string;
  /** Amount in INR, which is also what Cashfree pays out. */
  amount: number;
  status: TransactionStatus;
  createdAt: string; // ISO
  /** Bank UTR once Cashfree has one, otherwise Cashfree's transfer id. */
  reference: string;
  failureReason?: string;
  /** Cashfree transfer_id of the current attempt (absent until submitted). */
  transferId?: string;
  /** How many times this payout has been submitted (retries increment it). */
  attempt?: number;
  /** Cashfree's own id for the transfer. */
  cfTransferId?: string;
  /** Absent means payroll. Emergency advances are tagged so payroll totals and bulk retries never include them. */
  kind?: "payroll" | "advance";
  /** For kind "advance": the request this transfer pays. */
  advanceId?: string;
  /**
   * Set when Cashfree's answer to the transfer request was lost (timeout, 5xx), so the money may or may not have
   * moved. The payment stays "processing" and sync decides; it is never retried automatically.
   */
  uncertainSince?: string; // ISO
}

/* ----------------------------- BolPay Advance (docs/ADVANCE.md) ----------------------------- */

export type AdvanceStatus = "submitted" | "pending_review" | "rejected" | "cancelled" | "expired" | "approved" | "paying" | "paid" | "payment_failed";
export type AdvanceReason = "vehicle_repair" | "medical" | "family_event" | "housing" | "education" | "other";

/** Employer policy for emergency advances. Every number is configurable product policy, not a legal entitlement. */
export interface AdvancePolicy {
  /** Share of earned unpaid base pay + overtime a worker may draw, e.g. 25. */
  percentLimit: number;
  /** Hard cap per request in INR. */
  maxAmount: number;
  minServiceDays: number;
  /** Unrecovered advances allowed at once (1 = a second advance is blocked until the first is recovered). */
  maxOutstanding: number;
  /** When true, a person approves every request even if a delegation exists. */
  requireHumanApproval: boolean;
  expireAfterHours: number;
  maxRecoveryPercentOfPayout: number;
  version: number;
}

/** What the server saw when it checked a request. Stored on the request so approvers see the same numbers. */
export interface AdvanceEligibility {
  earnedBase: number;
  earnedOvertime: number;
  /** Payroll already approved (sent or being sent) for the period. Pending payouts are still unpaid and don't reduce the limit. */
  paidPayroll: number;
  /** Advances not yet recovered. */
  outstanding: number;
  /** percentLimit of earned unpaid wages, before outstanding advances. */
  limit: number;
  /** What can be requested now, in whole rupees. */
  available: number;
  /** Reasons the request cannot go ahead. Empty means eligible. */
  blocks: string[];
  /** Things a person should look at, which do not block. */
  flags: string[];
  policyVersion: number;
  rulesVersion: number;
  computedAt: string;
}

export interface AdvanceRequest {
  id: string;
  workerId: string;
  /** Requested amount in INR (whole rupees), confirmed by the worker. */
  amount: number;
  reasonText: string;
  reasonCategory: AdvanceReason;
  language: string;
  /** What the worker said or typed, kept for approvers. Audio is never stored. */
  transcript?: string;
  /** English translation of `transcript`, made by the server when the request was saved so a manager who doesn't read the language still understands it. Absent for English or when translation failed. */
  transcriptEnglish?: string;
  /** Whether the worker stressed urgency, in their own words. Shown to approvers as the worker's claim; it changes no rule. */
  urgency?: "urgent" | "normal";
  source: "voice" | "text";
  /** Client-generated, so a retried submit returns the same request instead of a second one. */
  idempotencyKey: string;
  status: AdvanceStatus;
  eligibility: AdvanceEligibility;
  /** The worker saw and accepted that the advance is deducted from the next payroll. */
  recoveryAck: boolean;
  /** Why it was rejected or cancelled, shown to the worker. */
  statusNote?: string;
  /** Amount an owner approved (never above the request). This is what is sent. */
  approvedAmount?: number;
  /** A staff member's advice. Never moves money; the owner decides. */
  recommendation?: { by: string; byName: string; at: string; verdict: "approve" | "reject"; note: string };
  decision?: { by: string; byName: string; at: string; verdict: "approved" | "rejected"; note: string };
  /** The eligibility check re-run at the moment of approval. */
  decisionEligibility?: AdvanceEligibility;
  /** The Cashfree transfer paying this advance. */
  transactionId?: string;
  /** Repayment from payroll. Recovered only when a payroll transfer with this advance's deduction completes. */
  recovery?: { /** Cleared so far. Includes anything written off; subtract writtenOff for money actually recovered. */ recovered: number; paidAt?: string; /** Forgiven by the owner, never collected. */ writtenOff?: number; closed?: { kind: "written_off" | "repaid"; by: string; at: string; amount: number; note: string } };
  /** What the Manager Agent decided, when a delegation was in force. */
  agent?: AgentRecord;
  createdAt: string;
  updatedAt: string;
}

/** Authority the owner gives the policy-bound Manager Agent for a limited time (docs/ADVANCE.md section 7). */
export interface Delegation {
  id: string;
  grantedBy: { id: string; name: string };
  /** Per-request cap. Never above the policy's maxAmount. */
  maxPerRequest: number;
  maxDailyTotal: number;
  maxMonthlyTotal: number;
  startsAt: string;
  expiresAt: string;
  /** When false the agent can only recommend. Even when true it needs policy.requireHumanApproval off. */
  autonomous: boolean;
  note?: string;
  createdAt: string;
  revokedAt?: string;
  revokedBy?: { id: string; name: string };
}

/** What the Manager Agent did with a request. Deterministic rules; the model is never involved. */
export interface AgentRecord {
  at: string;
  delegationId?: string;
  action: "approve" | "recommend" | "escalate" | "none";
  reasons: string[];
  /** For "approve": whether the approval went through (a human may have decided first). */
  executed?: boolean;
}
