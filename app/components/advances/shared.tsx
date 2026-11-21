import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import type { Actor, AdvanceCalc, AdvanceStatus, OwnerAdvanceView, TrailEntry } from "@/app/lib/advances/types";
import { Badge } from "../merchant/ui";

type Tone = "green" | "amber" | "red" | "slate" | "blue";

/** One label and colour for where an advance stands, folding in the payment state once it is approved. */
export function advanceState(a: { status: AdvanceStatus; payment?: "processing" | "completed" | "failed" }): { label: string; tone: Tone; pulse: boolean } {
  switch (a.status) {
    case "checking":
      return { label: "Agents checking", tone: "blue", pulse: true };
    case "awaiting_approval":
      return { label: "Waiting for approval", tone: "amber", pulse: false };
    case "escalated":
      return { label: "Escalated to owner", tone: "amber", pulse: false };
    case "approved":
      if (a.payment === "completed") return { label: "Paid", tone: "green", pulse: false };
      if (a.payment === "failed") return { label: "Payment failed", tone: "red", pulse: false };
      return { label: "Paying", tone: "blue", pulse: true };
    case "ineligible":
      return { label: "Not eligible", tone: "red", pulse: false };
    case "rejected":
      return { label: "Rejected", tone: "red", pulse: false };
    case "cancelled":
      return { label: "Withdrawn", tone: "slate", pulse: false };
  }
}

export function AdvanceBadge({ status, payment }: { status: AdvanceStatus; payment?: "processing" | "completed" | "failed" }) {
  const s = advanceState({ status, payment });
  return (
    <Badge tone={s.tone} pulse={s.pulse}>
      {s.label}
    </Badge>
  );
}

const ACTOR: Record<Actor, string> = {
  worker: "Worker",
  worker_agent: "Worker Assistance Agent",
  eligibility_agent: "Financial Eligibility Agent",
  manager_agent: "Manager Agent",
  payout_agent: "Payout Agent",
  owner: "Owner",
  system: "System",
};

/** The audit trail: who did what, in order. */
export function Trail({ entries }: { entries: TrailEntry[] }) {
  return (
    <ol className="space-y-2.5 border-l border-slate-200 pl-4">
      {entries.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-slate-300 ring-2 ring-white" />
          <p className="text-xs text-slate-500">
            <span className="font-medium text-slate-700">{ACTOR[e.actor]}</span> · {formatDateTime(e.at)} UTC
          </p>
          <p className="text-sm text-slate-900">{e.action}</p>
          {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

/** The salary maths behind a decision, in the order the Eligibility Agent works it out. */
export function CalcTable({ calc }: { calc: AdvanceCalc }) {
  const rows: [string, string, boolean?][] = [
    ["Earned wages this period", formatMoney(calc.earnedWages)],
    [`${calc.policyPercent}% advance limit`, formatMoney(calc.policyLimit)],
    ["Outstanding advance", `− ${formatMoney(calc.outstanding)}`],
    ["Available limit", formatMoney(calc.availableLimit), true],
    ["Requested", formatMoney(calc.requested)],
  ];
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {rows.map(([k, v, strong]) => (
        <div key={k} className="flex items-center justify-between gap-3 py-1.5">
          <dt className="text-slate-500">{k}</dt>
          <dd className={`tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-800"}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What Cashfree Payouts actually recorded for this advance: the proof that money moved, not just a status. */
export function CashfreeProof({ proof }: { proof: NonNullable<OwnerAdvanceView["cashfree"]> }) {
  const rows: [string, string | undefined][] = [
    ["Transfer ID (sent to Cashfree)", proof.transferId],
    ["Cashfree transfer ID", proof.cfTransferId],
    ["Bank UTR", proof.utr],
    ["Mode", `${proof.mode} · attempt ${proof.attempt}`],
    ["Started", `${formatDateTime(proof.createdAt)} UTC`],
  ];
  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cashfree Payouts</p>
        <Badge tone={proof.status === "completed" ? "green" : proof.status === "failed" ? "red" : "blue"} pulse={proof.status === "processing"}>
          {proof.status === "completed" ? "SUCCESS" : proof.status === "failed" ? "FAILED" : "PROCESSING"}
        </Badge>
        <Badge tone={proof.environment === "sandbox" ? "amber" : "green"}>{proof.environment === "sandbox" ? "Sandbox (test money)" : "Production"}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-slate-500">{k}</dt>
            <dd className="truncate font-mono text-slate-900">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-slate-500">Status comes from the Cashfree Payouts API (sync and signed webhooks). Look it up in the Cashfree dashboard under Payouts, Transfers, by the transfer ID.</p>
    </div>
  );
}
