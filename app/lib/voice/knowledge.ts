import "server-only";
import { advancePolicy } from "@/app/lib/server/advance-service";
import { isLiveCashfree } from "@/app/lib/cashfree/rest";
import { getDb } from "@/app/lib/server/db";
import type { CatalogRole } from "./catalog";

/**
 * What the assistant knows about BolPay. Every answer is written from how the product actually behaves
 * (and the live rules, policy and Cashfree mode where they matter), so the model never has to remember
 * or invent a feature. Each answer is a few short sentences: it is read aloud.
 */

export interface Who {
  role: CatalogRole;
  /** Display name from the verified session. */
  name: string;
  /** Worker record id for worker logins. */
  workerId: string | null;
}

/** "Priyanka (Owner)" -> "Priyanka". Only the first word is used to address someone. */
export const firstName = (displayName: string) => displayName.replace(/\s*\((owner|supervisor|worker)\)\s*$/i, "").trim().split(/\s+/)[0] || "there";

/** Time of day in India, where BolPay's workers are. */
function partOfDay(now = new Date()): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

const IDENTITY_STAFF =
  "My name is BolPay AI. I'm your multilingual workforce and payment operations assistant. I can help you manage workers, attendance, payroll, incentives, emergency advances and authorised payouts through natural conversation.";
const IDENTITY_WORKER =
  "My name is BolPay AI. I'm your multilingual assistant for BolPay. I can tell you about your pay and attendance, check your emergency advance, and send an advance request to your employer.";

const CAPABILITIES: Record<CatalogRole, string> = {
  owner:
    "I can mark attendance, record overtime and deliveries, calculate and approve payouts, approve or reject a worker's emergency advance, retry failed payments, add or edit workers, change pay rules, open screens, and answer questions about workers, pay, attendance and payments. Anything that moves money asks you to confirm first.",
  supervisor:
    "I can mark attendance, record overtime and deliveries, calculate pay for your team, open screens, and answer questions about your team. Approving payouts and advances, editing workers and changing pay rules are for the owner.",
  worker:
    "I can tell you how much you have earned this period, check your emergency advance limit and request status, send an advance request to your employer, and explain how BolPay works. I can't see or change anyone else's information.",
};

/** Chat replies are fixed, role-aware text: nothing here reads or changes data. */
export function chatReply(kind: string, who: Who, period?: string | null): string {
  const name = firstName(who.name);
  switch (kind) {
    case "greeting":
      // Mirror the time of day the person named; otherwise use the actual time in India.
      return `Good ${period === "morning" || period === "afternoon" || period === "evening" ? period : partOfDay()}, ${name}! How can I help you today?`;
    case "howareyou":
      return `I'm doing well, thank you for asking, ${name}! How can I help you today?`;
    case "thanks":
      return `You're welcome, ${name}! Happy to help.`;
    case "goodbye":
      return `Goodbye, ${name}! Take care.`;
    case "identity":
      return who.role === "worker" ? IDENTITY_WORKER : IDENTITY_STAFF;
    case "capabilities":
      return CAPABILITIES[who.role];
    default:
      return "I'm not sure how to answer that.";
  }
}

export const SCOPE_REPLY =
  "I'm built for BolPay: workers, attendance, pay, emergency advances and payouts. I can't help with that, but I'm happy to help with any of those.";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const WORKER_TOPICS = new Set(["what_is_bolpay", "attendance", "incentives", "payroll", "cashfree_payouts", "emergency_advances", "roles_permissions", "voice_assistant", "custom_amount_payment", "unknown"]);

const TOPICS: Record<string, () => string> = {
  what_is_bolpay: () =>
    "BolPay is a voice-first workforce and payout app for businesses with hourly or daily workers. You record attendance and deliveries, it calculates pay from your incentive rules, you approve payouts, and the money goes to each worker's UPI ID through Cashfree.",

  workers: () =>
    "Each worker has a name, role, city, daily wage and a UPI ID for payouts. The owner adds or edits workers on the Workers screen, by CSV import or by voice. Supervisors see only their own team, and a worker with no UPI ID can't be paid.",

  attendance: () =>
    "Attendance is marked per day as present, half day, absent or on leave, and a half day counts as half pay. You can mark it on the Attendance screen, by CSV import, by voice, or through the Zoho sync. Days with missing or conflicting records are flagged for review before payouts.",

  incentives: () => {
    const r = getDb().rules;
    const tiers = r.deliveryTiers.map((t) => `${t.minUnits}+ deliveries ${inr(t.bonus)}`).join(", ") || "none";
    return `Pay is the daily wage for each day worked, plus overtime at ${r.overtimeMultiplier} times the hourly rate (${r.workingHoursPerDay}-hour day), a delivery bonus for the highest daily tier reached (${tiers}), ${inr(r.ratePerExtraUnit)} for each delivery above ${r.dailyUnitTarget} a day, and a ${inr(r.attendanceBonus)} attendance bonus at ${Math.round(r.attendanceThreshold * 100)} percent attendance. These are rules version ${r.version}; each payout keeps the rules it was calculated with.`;
  },

  payroll: () =>
    "Pay is calculated for the current pay period from attendance and the incentive rules. Preparing payouts creates one payout per worker for approval. Workers with missing or conflicting records are marked Needs review and can't be approved until the records are fixed.",

  approvals: () =>
    "Only the owner approves payouts. Approving shows the exact number of payments and the total first, and nothing is sent until you confirm. Supervisors can mark attendance and prepare payouts for their team, but they can't approve payments.",

  cashfree_payouts: () =>
    `Payouts are UPI transfers through Cashfree Payouts. A transfer counts as paid only when Cashfree reports success; until then it shows as processing. A failed transfer shows Cashfree's reason and can be retried safely. Cashfree is currently in ${isLiveCashfree ? "live mode, so real money moves" : "sandbox mode, so no real money moves"}.`,

  emergency_advances: () => {
    const p = advancePolicy();
    return `A worker can ask for an advance on wages they have already earned: up to ${p.percentLimit} percent of earned unpaid pay, at most ${inr(p.maxAmount)} per request, after ${p.minServiceDays} days of service. The employer reviews it, and it counts as paid only when Cashfree confirms the transfer. The amount is then deducted from the next payroll.`;
  },

  roles_permissions: () =>
    "The owner can do everything. Supervisors mark attendance and record work for their own team, prepare payouts and recommend advances, but they can't approve payments or change wages or rules. Workers see only their own pay, attendance and advances.",

  integrations: () =>
    "BolPay can import employees and attendance from Zoho People, on the Integrations screen, owner only. A sync updates names and attendance and never overwrites wages or UPI IDs. Zoho People is the only HR integration that is built. Cashfree handles the payouts.",

  voice_assistant: () =>
    "You can talk or type to me in several Indian languages. I answer questions from your real data, and I can make changes within your role. Anything that moves money shows the exact amount and waits for you to confirm, and I never act outside what your role allows.",

  custom_amount_payment: () =>
    "BolPay doesn't send custom amounts. It pays each worker's calculated pay from attendance and the pay rules, and workers can request an emergency advance. To pay someone now, ask me to prepare and approve their payout.",

  unknown: () =>
    "I don't have documented information about that in BolPay, so I won't guess. I can explain attendance, incentives, payroll, approvals, Cashfree payouts, advances, roles and integrations.",
};

export const TOPIC_NAMES = Object.keys(TOPICS);

/** The documented answer for a topic, limited to what this role should be told. */
export function explainTopic(topic: string, who: Who): string {
  const fn = TOPICS[topic] ?? TOPICS.unknown;
  if (who.role === "worker" && !WORKER_TOPICS.has(topic)) return "That's something your employer handles. I can explain how your pay, attendance and emergency advances work.";
  return fn();
}
