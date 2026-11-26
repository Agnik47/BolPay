"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, type Snapshot } from "@/app/lib/merchant/store";
import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import type { AdvanceEligibility, AdvanceRequest } from "@/app/lib/merchant/types";
import { useToast } from "../../feedback/Toaster";
import { IconAlert } from "../../icons";
import { ConfirmDialog } from "../overlays";
import { useViewer } from "../viewer";
import { LazyAdvancePolicyPanel } from "../../Lazy";
import { Avatar, Badge, Button, Card, EmptyState, EnvBadge, inputClass, Notice, PageHeader, Segmented, Stat, Stats, StatusBadge } from "../ui";
import { Pager, usePaged } from "../../Pager";

type StaffAdvance = Omit<AdvanceRequest, "idempotencyKey"> & {
  worker: { id: string; name: string; city: string; role: string; dailyWage: number; hasUpi: boolean } | null;
  current: AdvanceEligibility | null;
  /** Still owed after recovery so far (paid advances only), and how much of it a live payroll deduction already covers. */
  owed: number;
  inRecovery: number;
  payment: { status: string; reference: string; failureReason?: string; attempt: number; createdAt: string } | null;
};
type View = "pending" | "payments" | "closed" | "settings";
type Dialog = { kind: "approve" | "reject" | "recommend_approve" | "recommend_reject" | "retry" | "repay" | "write_off"; id: string } | null;

const REASON: Record<string, string> = { vehicle_repair: "Bike or vehicle repair", medical: "Medical", family_event: "Family event", housing: "Housing", education: "Education", other: "Other" };
const LANG: Record<string, string> = { bn: "Bengali", hi: "Hindi", kn: "Kannada", mr: "Marathi", ta: "Tamil", te: "Telugu", gu: "Gujarati", ml: "Malayalam", pa: "Punjabi", en: "English" };
const hasRef = (r: string) => r && r !== "—" && r !== "Submitting…";

async function post(url: string, body?: unknown) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = (await res.json().catch(() => ({}))) as { advances?: StaffAdvance[]; state?: Snapshot; error?: string; alreadyProcessed?: boolean };
    return res.ok ? { ok: true as const, data } : { ok: false as const, error: data.error ?? "Something went wrong." };
  } catch {
    return { ok: false as const, error: "Could not reach the server." };
  }
}

function Numbers({ e, title }: { e: AdvanceEligibility; title: string }) {
  const rows: [string, string][] = [
    ["Earned (base + overtime)", formatMoney(e.earnedBase + e.earnedOvertime)],
    ["Payroll already approved", formatMoney(e.paidPayroll)],
    ["Advance limit", formatMoney(e.limit)],
    ["Advances outstanding", formatMoney(e.outstanding)],
    ["Available", formatMoney(e.available)],
  ];
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium tabular-nums text-slate-900">{v}</dd></div>
        ))}
      </dl>
      {e.blocks.map((b) => <p key={b} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-700"><IconAlert className="mt-px size-3 shrink-0" />{b}</p>)}
      {e.flags.map((f) => <p key={f} className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800"><IconAlert className="mt-px size-3 shrink-0" />{f}</p>)}
      <p className="mt-1 text-[11px] text-slate-400">Computed by the server with policy v{e.policyVersion} and rules v{e.rulesVersion}.</p>
    </div>
  );
}

export function AdvancesView() {
  const { transactions, applySnapshot, workerById } = useStore();
  const { isOwner, liveCashfree } = useViewer();
  const toast = useToast();
  const [items, setItems] = useState<StaffAdvance[] | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("pending");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [noteText, setNoteText] = useState("");
  const [approved, setApproved] = useState("");
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(0); // when the list was fetched (keeps Date.now() out of render)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/advances", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { advances?: StaffAdvance[]; error?: string };
      if (!res.ok || !d.advances) throw new Error(d.error ?? "Could not load advance requests.");
      setItems(d.advances);
      setAsOf(Date.now());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load advance requests.");
      setItems((p) => p ?? []);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // The store already polls Cashfree while a transfer is processing; reload requests whenever an advance transfer changes.
  const sig = useMemo(() => transactions.filter((t) => t.kind === "advance").map((t) => `${t.id}:${t.status}`).join(","), [transactions]);
  useEffect(() => {
    if (!sig) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [sig, load]);

  const list = items ?? [];
  const pending = list.filter((a) => a.status === "pending_review");
  const payments = list.filter((a) => ["paying", "paid", "payment_failed"].includes(a.status));
  const closed = list.filter((a) => ["rejected", "cancelled", "expired"].includes(a.status));
  const shown = view === "pending" ? pending : view === "payments" ? payments : view === "closed" ? closed : [];
  const paged = usePaged(shown, 5, view);
  const agentPaid = list.filter((a) => a.agent?.action === "approve" && a.agent.executed && asOf - Date.parse(a.agent.at) < 86_400_000);
  const sum = (xs: StaffAdvance[], f: (a: StaffAdvance) => number) => xs.reduce((s, a) => s + f(a), 0);
  const paid = payments.filter((a) => a.status === "paid");
  const target = dialog ? list.find((a) => a.id === dialog.id) : undefined;
  const targetWorker = target ? workerById(target.workerId) : undefined;

  function open(kind: NonNullable<Dialog>["kind"], a: StaffAdvance) {
    setNoteText("");
    setApproved(String(kind === "repay" || kind === "write_off" ? a.owed : a.amount));
    setDialog({ kind, id: a.id });
  }

  async function run() {
    if (!dialog || !target) return;
    const { kind } = dialog;
    const approvedNum = Number(approved);
    if (kind === "approve" && (!Number.isInteger(approvedNum) || approvedNum < 1 || approvedNum > target.amount)) return toast({ tone: "error", title: "Enter a whole-rupee amount, no more than requested." });
    const settling = kind === "repay" || kind === "write_off";
    if (settling && !noteText.trim()) return toast({ tone: "error", title: "Add a note so the audit log says why." });
    if (kind === "repay" && (!Number.isInteger(approvedNum) || approvedNum < 1 || approvedNum > target.owed)) return toast({ tone: "error", title: `Enter a whole-rupee amount up to ${formatMoney(target.owed)}.` });
    setBusy(true);
    const url = `/api/advances/${encodeURIComponent(target.id)}/${kind === "approve" ? "approve" : kind === "reject" ? "reject" : kind === "retry" ? "retry" : settling ? "settle" : "recommend"}`;
    const body = settling ? { action: kind, amount: approvedNum, note: noteText } : kind === "approve" ? { approvedAmount: approvedNum, note: noteText } : kind === "reject" ? { note: noteText } : kind === "retry" ? {} : { verdict: kind === "recommend_approve" ? "approve" : "reject", note: noteText };
    const r = await post(url, body);
    setBusy(false);
    setDialog(null);
    if (!r.ok) {
      toast({ tone: "error", title: "Couldn't complete that", description: r.error });
      return void load();
    }
    if (r.data.advances) setItems(r.data.advances);
    if (r.data.state) applySnapshot(r.data.state);
    const name = target.worker?.name ?? "the worker";
    if (kind === "approve") toast({ tone: "success", title: `Transfer requested for ${name}`, description: `${formatMoney(approvedNum)} sent to Cashfree. It counts as paid only when Cashfree confirms it.`, action: { label: "Track in Transactions", href: "/transactions" } });
    else if (settling) toast({ tone: "success", sound: false, title: kind === "repay" ? `Recorded ${formatMoney(approvedNum)} repaid by ${name}` : `Wrote off ${formatMoney(target.owed)} for ${name}`, description: "It is in the audit log. No money moved." });
    else if (kind === "reject") toast({ tone: "info", sound: false, title: `Rejected ${name}'s request` });
    else if (kind === "retry") toast(r.data.alreadyProcessed ? { tone: "success", title: "The earlier attempt had gone through", description: "Cashfree reports the transfer as processed, so nothing was sent again." } : { tone: "info", title: `Retry sent for ${name}`, description: "A new attempt was requested." });
    else toast({ tone: "success", sound: false, title: "Recommendation saved", description: "The owner makes the final decision." });
  }

  const titles = { approve: "Approve and send", reject: "Reject this request?", recommend_approve: "Recommend approval", recommend_reject: "Recommend rejection", retry: "Retry this payment?", repay: "Record a repayment", write_off: "Write off what is owed?" } as const;

  return (
    <>
      <PageHeader
        title="Emergency advances"
        description={isOwner ? "Review worker requests. Approving requests a Cashfree transfer; nothing is sent until you approve." : "Review worker requests and recommend a decision. Only the owner can approve or reject."}
        actions={isOwner ? <EnvBadge live={liveCashfree} /> : undefined}
      />
      <Stats className="mb-5">
        <Stat label="Waiting for a decision" value={String(pending.length)} hint={formatMoney(sum(pending, (a) => a.amount)) + " requested"} tone={pending.length ? "warn" : "default"} />
        <Stat label="Payment in progress" value={String(payments.filter((a) => a.status === "paying").length)} hint="Not yet confirmed by Cashfree" />
        <Stat label="Paid" value={formatMoney(sum(paid, (a) => a.approvedAmount ?? a.amount))} hint={`${paid.length} confirmed`} tone={paid.length ? "good" : "default"} />
        <Stat label="Payment failed" value={String(payments.filter((a) => a.status === "payment_failed").length)} hint="Needs your attention" tone={payments.some((a) => a.status === "payment_failed") ? "warn" : "default"} />
      </Stats>

      {error && <Notice tone="error" className="mb-4" action={<button onClick={() => void load()} className="underline underline-offset-2">Retry</button>}>{error}</Notice>}

      {isOwner && agentPaid.length > 0 && (
        <Notice tone="info" className="mb-4">
          The Manager Agent approved {agentPaid.length} advance{agentPaid.length === 1 ? "" : "s"} ({formatMoney(agentPaid.reduce((s, a) => s + (a.approvedAmount ?? 0), 0))}) in the last 24 hours under your delegation. Details are on each request and in the audit log.
        </Notice>
      )}

      <div className="mb-3">
        <Segmented<View> label="Show" value={view} onChange={setView} options={[
          { value: "pending", label: `Needs a decision (${pending.length})` },
          { value: "payments", label: `Payments (${payments.length})` },
          { value: "closed", label: `Closed (${closed.length})` },
          ...(isOwner ? [{ value: "settings" as View, label: "Policy & delegation" }] : []),
        ]} />
      </div>

      {view === "settings" && isOwner ? (
        <LazyAdvancePolicyPanel onChanged={() => void load()} />
      ) : items === null ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading requests">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : shown.length === 0 ? (
        <Card flush><EmptyState>{view === "pending" ? "No requests are waiting. Workers can ask from My Pay." : view === "payments" ? "No advance payments yet." : "Nothing closed yet."}</EmptyState></Card>
      ) : (
        <ul className="space-y-3">
          {paged.rows.map((a) => {
            const e = a.current ?? a.decisionEligibility ?? a.eligibility;
            const stale = a.current && a.current.available !== a.eligibility.available;
            return (
              <li key={a.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={a.worker?.name ?? "?"} />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{a.worker?.name ?? "Unknown worker"}</p>
                        <p className="text-xs text-slate-500">{a.worker ? `${a.worker.role} · ${a.worker.city} · ${a.worker.id}` : a.workerId} · requested {formatDateTime(a.createdAt)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{formatMoney(a.approvedAmount ?? a.amount)}</p>
                      {a.approvedAmount !== undefined && a.approvedAmount !== a.amount && <p className="text-xs text-slate-500">of {formatMoney(a.amount)} requested</p>}
                      <StatusBadge status={a.status} />
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                    <p><span className="font-medium text-slate-900">{REASON[a.reasonCategory] ?? a.reasonCategory}:</span> <span className="text-slate-700">“{a.reasonText}”</span></p>
                    <p className="mt-0.5 text-xs text-slate-500">Stated by the worker; BolPay doesn&apos;t judge whether it&apos;s genuine. Source: {a.source === "voice" ? "voice" : "typed"} · {LANG[a.language] ?? a.language}</p>
                    {a.urgency === "urgent" && <p className="mt-1"><Badge tone="red">Worker says it is urgent</Badge></p>}
                    {a.transcript && (
                      <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                        <div>
                          <p className="mb-0.5 font-semibold uppercase tracking-wide text-slate-500">Original ({LANG[a.language] ?? a.language})</p>
                          <p lang={a.language} className="whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 text-sm text-slate-800">{a.transcript}</p>
                        </div>
                        <div>
                          <p className="mb-0.5 font-semibold uppercase tracking-wide text-slate-500">English translation</p>
                          <p className="whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 text-sm text-slate-800">
                            {a.language === "en" ? <span className="text-slate-500">Written in English.</span> : a.transcriptEnglish ?? <span className="text-amber-800">Translation unavailable. Use the original, or ask the worker.</span>}
                          </p>
                        </div>
                        <p className="md:col-span-2 text-[11px] text-slate-400">Machine translation of the worker&apos;s own words, made when the request was saved. The amount above is what the worker confirmed. The audio is not kept.</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-3"><Numbers e={e} title={a.current ? "Eligibility now" : "Eligibility at decision"} /></div>
                  {stale && <p className="mt-1 text-xs text-amber-800">The available limit has changed since the request was made (was {formatMoney(a.eligibility.available)}).</p>}

                  {a.agent && (
                    <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        Manager Agent
                        <Badge tone={a.agent.action === "approve" ? "green" : a.agent.action === "recommend" ? "blue" : "amber"}>
                          {a.agent.action === "approve" ? (a.agent.executed === false ? "tried to approve" : "approved") : a.agent.action === "recommend" ? "recommended" : "escalated to you"}
                        </Badge>
                      </p>
                      {a.agent.reasons.map((r) => <p key={r} className="mt-1 text-xs text-slate-600">{r}</p>)}
                      <p className="mt-1 text-[11px] text-slate-400">Fixed rules under your delegation, not an AI judgement.</p>
                    </div>
                  )}
                  {a.recommendation && a.recommendation.by.startsWith("supervisor:") || a.recommendation && a.recommendation.by.startsWith("owner:") ? (
                    <p className="mt-3 text-sm text-slate-700"><Badge tone={a.recommendation.verdict === "approve" ? "green" : "red"}>Recommended: {a.recommendation.verdict}</Badge> by {a.recommendation.byName}{a.recommendation.note ? ` — “${a.recommendation.note}”` : ""}</p>
                  ) : null}
                  {a.decision && <p className="mt-2 text-xs text-slate-500">{a.decision.verdict === "approved" ? "Approved" : "Rejected"} by {a.decision.byName} on {formatDateTime(a.decision.at)}{a.decision.note ? ` — “${a.decision.note}”` : ""}</p>}
                  {a.statusNote && a.status !== "paying" && <p className={`mt-2 text-sm ${a.status === "payment_failed" ? "font-medium text-rose-700" : "text-slate-600"}`}>{a.statusNote}</p>}

                  {a.payment && (
                    <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={a.status === "paid" ? "completed" : a.status === "payment_failed" ? "failed" : "processing"} />
                        <span className="text-slate-700">{a.status === "paid" ? "Confirmed paid by Cashfree" : a.status === "payment_failed" ? "Payment failed" : "Transfer requested; waiting for Cashfree to confirm"}</span>
                        <span className="text-xs text-slate-500">attempt {a.payment.attempt}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Reference / UTR: {hasRef(a.payment.reference) ? <span className="font-mono">{a.payment.reference}</span> : "not assigned yet"}</p>
                    </div>
                  )}

                  {a.status === "paid" && (
                    <p className="mt-3 text-sm text-slate-700">
                      {a.owed > 0 ? <><Badge tone="amber">Owed {formatMoney(a.owed)}</Badge> of {formatMoney(a.approvedAmount ?? a.amount)}{a.recovery?.recovered ? `, ${formatMoney(a.recovery.recovered)} recovered` : ""}. {a.inRecovery > 0 ? `${formatMoney(a.inRecovery)} is set aside in a payroll that is not finished yet.` : "It is deducted from the next payroll."}</> : <><Badge tone="green">{a.recovery?.closed?.kind === "written_off" ? "Written off" : "Recovered"}</Badge> {formatMoney(a.approvedAmount ?? a.amount)} {a.recovery?.closed ? `closed by ${a.recovery.closed.note ? `“${a.recovery.closed.note}”` : "the owner"}` : "repaid from payroll"}.</>}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.status === "paid" && isOwner && a.owed > 0 && a.inRecovery === 0 && (
                      <>
                        <Button disabled={busy} onClick={() => open("repay", a)}>Record repayment…</Button>
                        <Button variant="danger" disabled={busy} onClick={() => open("write_off", a)}>Write off…</Button>
                      </>
                    )}
                    {a.status === "pending_review" && (
                      <>
                        {isOwner ? (
                          <>
                            <Button variant="primary" disabled={!!a.current?.blocks.length || busy} onClick={() => open("approve", a)} title={a.current?.blocks.length ? "Resolve the blocks above first" : undefined}>Approve…</Button>
                            <Button variant="danger" disabled={busy} onClick={() => open("reject", a)}>Reject…</Button>
                          </>
                        ) : (
                          <>
                            <Button disabled={busy} onClick={() => open("recommend_approve", a)}>Recommend approval</Button>
                            <Button disabled={busy} onClick={() => open("recommend_reject", a)}>Recommend rejection</Button>
                            <span className="self-center text-xs text-slate-500">Only the owner can approve or reject.</span>
                          </>
                        )}
                      </>
                    )}
                    {a.status === "payment_failed" && isOwner && <Button variant="primary" disabled={busy} onClick={() => open("retry", a)}>Retry payment…</Button>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {view !== "settings" && paged.pages > 1 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white [&>nav]:border-t-0"><Pager {...paged} label="advance requests" /></div>
      )}

      <ConfirmDialog
        open={!!dialog && !!target}
        title={dialog && target ? (dialog.kind === "approve" ? `${titles.approve} ${formatMoney(Number(approved) || target.amount)}?` : titles[dialog.kind]) : ""}
        confirmLabel={dialog?.kind === "approve" ? "Approve and send" : dialog?.kind === "reject" ? "Reject request" : dialog?.kind === "retry" ? "Retry payment" : dialog?.kind === "repay" ? "Record repayment" : dialog?.kind === "write_off" ? "Write off" : "Save recommendation"}
        tone={dialog?.kind === "reject" || dialog?.kind === "recommend_reject" || dialog?.kind === "write_off" ? "danger" : "primary"}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setDialog(null)}
      >
        {target && dialog && (
          <div className="space-y-3">
            {(dialog.kind === "approve" || dialog.kind === "retry") && (
              <dl className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Worker</dt><dd className="font-medium text-slate-900">{target.worker?.name}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Requested</dt><dd className="tabular-nums">{formatMoney(target.amount)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Send to</dt><dd className="text-slate-900">{targetWorker?.payoutUpi || "No UPI ID"}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Via</dt><dd className="text-slate-900">Cashfree Payouts · UPI</dd></div>
                <div className="flex items-center justify-between"><dt className="text-slate-500">Environment</dt><dd><EnvBadge live={liveCashfree} /></dd></div>
              </dl>
            )}
            {dialog.kind === "approve" && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Amount to send (₹)</span>
                <input className={inputClass} type="number" min="1" max={target.amount} step="1" value={approved} onChange={(e) => setApproved(e.target.value)} data-autofocus />
                <span className="mt-1 block text-xs text-slate-500">You can approve less than requested, never more. The server re-checks the limit when you confirm.</span>
              </label>
            )}
            {dialog.kind === "approve" && <p>Approval requests the transfer. The advance is deducted from the worker&apos;s next payroll. It counts as paid only when Cashfree confirms it, which you can follow in Transactions.</p>}
            {dialog.kind === "repay" && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Amount repaid (₹, up to {formatMoney(target.owed)})</span>
                <input className={inputClass} type="number" min="1" max={target.owed} step="1" value={approved} onChange={(e) => setApproved(e.target.value)} data-autofocus />
              </label>
            )}
            {dialog.kind === "repay" && <p>Use this when the worker paid you back some other way. It only updates the balance; BolPay moves no money.</p>}
            {dialog.kind === "write_off" && <p>This forgives the remaining {formatMoney(target.owed)} for {target.worker?.name}. It will not be deducted from any payroll. BolPay moves no money, and the note goes in the audit log.</p>}
            {dialog.kind === "retry" && <p>BolPay first asks Cashfree whether the earlier attempt went through. If it did, nothing is sent again; otherwise a new attempt is made.</p>}
            {(dialog.kind === "reject" || dialog.kind === "approve" || dialog.kind === "repay" || dialog.kind === "write_off" || dialog.kind.startsWith("recommend")) && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">{dialog.kind === "reject" ? "Reason (shown to the worker)" : dialog.kind === "repay" || dialog.kind === "write_off" ? "Note (required, goes in the audit log)" : "Note (optional)"}</span>
                <input className={inputClass} value={noteText} maxLength={200} onChange={(e) => setNoteText(e.target.value)} placeholder={dialog.kind === "reject" ? "e.g. Limit reached for this month" : ""} />
              </label>
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
