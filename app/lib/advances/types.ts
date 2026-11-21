/** Emergency salary advances: shared types (client and server). Amounts are INR. */

export type AdvanceReason =
  | "medical"
  | "accident"
  | "vehicle_repair"
  | "family"
  | "rent"
  | "education"
  | "celebration"
  | "shopping"
  | "travel"
  | "entertainment"
  | "pet"
  | "other";

/** Whether the stated purpose is an emergency under the advance policy (decided by code, see classifyPurpose). */
export type AdvancePurpose = "emergency" | "non_emergency" | "unclear";

export interface PurposeCheck {
  purpose: AdvancePurpose;
  /** Plain-language reason for the classification. */
  note: string;
}
export type AdvanceUrgency = "low" | "medium" | "high";

export type AdvanceStatus =
  /** Confirmed by the worker and handed to the agents on Cashfree Relay; not decided yet. */
  | "checking"
  /** The Financial Eligibility Agent declined it. Final: the worker can ask again for a smaller amount. */
  | "ineligible"
  /** Eligible, and the approver is available: the owner decides. */
  | "awaiting_approval"
  /** Eligible, but the approver is away and the request is outside what the Manager Agent may approve. */
  | "escalated"
  /** Approved (by the owner or within delegated authority). The Payout Agent pays it through Cashfree. */
  | "approved"
  | "rejected"
  | "cancelled";

export type ApprovedBy = "owner" | "manager_agent";

export type Actor = "worker" | "worker_agent" | "eligibility_agent" | "manager_agent" | "payout_agent" | "owner" | "system";

export interface AdvanceCalc {
  /** Wages earned this period and not yet paid out. */
  earnedWages: number;
  policyPercent: number;
  /** earnedWages x policyPercent. */
  policyLimit: number;
  /** Advances paid and not yet recovered from salary. */
  outstanding: number;
  /** policyLimit - outstanding, never below zero. */
  availableLimit: number;
  requested: number;
}

export interface EligibilityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface EligibilityResult {
  eligible: boolean;
  calc: AdvanceCalc;
  checks: EligibilityCheck[];
  /** Why it was declined (empty when eligible). */
  reasons: string[];
  /** Records that look inconsistent or unusual. A flagged request is never auto-approved by the Manager Agent. */
  flags: string[];
  /** The most the worker could be given right now (0 when nothing). */
  maxEligible: number;
  explanation: string;
}

export interface TrailEntry {
  at: string; // ISO
  actor: Actor;
  action: string;
  detail: string;
}

export interface AdvanceRequest {
  id: string;
  workerId: string;
  amount: number;
  reason: AdvanceReason;
  /** The worker's reason in a few English words, as understood by the Worker Assistance Agent. */
  reasonText: string;
  urgency: AdvanceUrgency;
  /** ISO 639-1 code of the language the worker used (replies come back in it). */
  language: string;
  /** Emergency guardrail result for the stated reason (absent on requests made before it existed). */
  purpose?: PurposeCheck;
  /** What the worker said or typed (trimmed). Kept for the audit trail only. */
  requestText: string;
  createdAt: string; // ISO
  periodId: string;
  status: AdvanceStatus;
  eligibility: EligibilityResult;
  approval?: {
    by: ApprovedBy;
    at: string; // ISO
    /** Business day (workspace "today") the approval counts against, for the daily delegated limit. */
    day: string;
    delegationId?: string;
    note?: string;
  };
  decisionNote?: string;
  /** The Cashfree transaction created by the Payout Agent. */
  transactionId?: string;
  /** Last payment state written to the trail, so each outcome is recorded once. */
  paymentRecorded?: "completed" | "failed";
  /** INR already taken back from later salary payouts. */
  recovered: number;
  trail: TrailEntry[];
  /** While status is "checking": which Relay agent is expected to call back next. */
  relayStage?: "eligibility" | "manager";
  /** The latest message for the worker, in their language (translated by Sarvam on Relay when that agent is set up). */
  workerMessage?: { text: string; language: string; at: string };
}

export interface Delegation {
  id: string;
  /** Most the Manager Agent may approve for one request. */
  maxPerRequest: number;
  /** Most it may approve in total on one day. */
  dailyLimit: number;
  /** Last day (YYYY-MM-DD, inclusive) the authority is valid. */
  expiresOn: string;
  grantedBy: string;
  grantedAt: string; // ISO
  revokedAt?: string;
}

export interface AdvanceConfig {
  policyPercent: number;
  /** False while the owner is away: requests are then routed to the Manager Agent. */
  ownerAvailable: boolean;
  awayNote?: string;
  delegation: Delegation | null;
}

/** What the worker sees (their own requests only). */
export interface WorkerAdvanceView {
  id: string;
  amount: number;
  reasonText: string;
  status: AdvanceStatus;
  /** "processing" | "completed" | "failed" once the Payout Agent has sent it. */
  payment?: "processing" | "completed" | "failed";
  paymentReference?: string;
  paymentFailure?: string;
  /** Latest message to the worker in their own language, if one was sent. */
  message?: string;
  createdAt: string;
  explanation: string;
  calc: AdvanceCalc;
  recovered: number;
  trail: TrailEntry[];
}

export interface WorkerAdvanceSummary {
  periodLabel: string;
  earnedWages: number;
  policyPercent: number;
  policyLimit: number;
  outstanding: number;
  availableLimit: number;
  /** Plain-language reason nothing can be requested right now, or null. */
  blocked: string | null;
}

/** What the owner sees. */
export interface OwnerAdvanceView extends WorkerAdvanceView {
  workerId: string;
  workerName: string;
  urgency: AdvanceUrgency;
  language: string;
  requestText: string;
  checks: EligibilityCheck[];
  flags: string[];
  approvedBy?: ApprovedBy;
  approvedAt?: string;
  /** Proof of the Cashfree Payouts transfer, once one exists. */
  cashfree?: {
    transferId?: string;
    cfTransferId?: string;
    utr?: string;
    status: "processing" | "completed" | "failed";
    mode: "UPI";
    environment: "sandbox" | "production";
    attempt: number;
    createdAt: string;
  };
}
