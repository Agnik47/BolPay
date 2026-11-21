"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import { useStore, type Snapshot } from "@/app/lib/merchant/store";
import type { OwnerOverview } from "@/app/lib/server/advances";
import type { OwnerAdvanceView } from "@/app/lib/advances/types";
import { AdvanceBadge, CalcTable, CashfreeProof, Trail } from "../../advances/shared";
import { useToast } from "../../feedback/Toaster";
import { Avatar, Badge, Button, Card, EmptyState, Field, fieldClass, Notice, PageHeader, Stat, Stats, Switch, td, th, thRight } from "../ui";

type Reply = { state?: Snapshot; overview?: OwnerOverview; error?: string };

async function call(method: string, path: string, body?: unknown): Promise<Reply & { ok: boolean }> {
  try {
    const res = await fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ...((await res.json().catch(() => ({}))) as Reply), ok: res.ok };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const URGENCY_TONE = { high: "red", medium: "amber", low: "slate" } as const;
const POLL_MS = 5000;

export function AdvancesView() {
  const { applySnapshot } = useStore();
  const toast = useToast();
  const [ov, setOv] = useState<OwnerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ max: string; daily: string; expires: string } | null>(null);

  const take = useCallback(
    (r: Reply & { ok: boolean }) => {
      if (r.state) applySnapshot(r.state);
      if (r.overview) setOv(r.overview);
      if (!r.ok) setError(r.error ?? "Something went wrong");
      else setError(null);
      return r.ok;
    },
    [applySnapshot],
  );

  useEffect(() => {
    const id = setTimeout(() => void call("GET", "/api/advances").then(take), 0);
    return () => clearTimeout(id);
  }, [take]);

  const inFlight = ov?.advances.some((a) => a.status === "approved" && a.payment === "processing");
  const waitingCount = ov?.advances.filter((a) => a.status === "awaiting_approval" || a.status === "escalated").length ?? 0;
  useEffect(() => {
    // New requests arrive while this page is open, and payments settle in the background.
    const id = setInterval(() => void call("GET", "/api/advances").then(take), inFlight || waitingCount ? POLL_MS : POLL_MS * 3);
    return () => clearInterval(id);
  }, [take, inFlight, waitingCount]);

  if (!ov) return <>{error ? <Notice tone="error">{error}</Notice> : <p className="py-10 text-center text-sm text-slate-500">Loading…</p>}</>;

  const cfg = ov.config;
  const d = cfg.delegation && !cfg.delegation.revokedAt ? cfg.delegation : null;
  const delegationLive = d && ov.today <= d.expiresOn;
  const waiting = ov.advances.filter((a) => a.status === "awaiting_approval" || a.status === "escalated");
  const history = ov.advances.filter((a) => !waiting.includes(a));
  const paid = ov.advances.filter((a) => a.status === "approved" && a.payment === "completed").reduce((s, a) => s + a.amount, 0);
  const formValues = form ?? { max: String(d?.maxPerRequest ?? 3000), daily: String(d?.dailyLimit ?? 10000), expires: d?.expiresOn ?? addDays(ov.today, 7) };

  async function act(key: string, fn: () => Promise<Reply & { ok: boolean }>, done?: () => void) {
    setBusy(key);
    const ok = take(await fn());
    setBusy(null);
    setConfirming(null);
    if (ok) done?.();
  }

  const decide = (a: OwnerAdvanceView, decision: "approve" | "reject") =>
    act(
      `${a.id}:${decision}`,
      () => call("POST", `/api/advances/${encodeURIComponent(a.id)}/decide`, { decision }),
      () =>
        toast(
          decision === "approve"
            ? { tone: "success", title: `Sent ${formatMoney(a.amount)} to ${a.workerName}`, description: "The Payout Agent is paying it through Cashfree.", action: { label: "Track in Transactions", href: "/transactions" } }
            : { tone: "info", sound: false, title: `Rejected ${a.workerName}'s request` },
        ),
    );

  const setConfig = (patch: Record<string, unknown>, done?: () => void) => act("config", () => call("PUT", "/api/advances/config", patch), done);

  return (
    <>
      <PageHeader title="Emergency advances" description="Workers ask in their own language. Eligibility is checked against their pay records; you, or the Manager Agent within the limits you set, approve." />

      {error && <Notice tone="error" className="mb-4">{error}</Notice>}

      <Stats className="mb-5">
        <Stat label="Waiting for a decision" value={String(waiting.length)} hint={waiting.length ? formatMoney(waiting.reduce((s, a) => s + a.amount, 0)) : "Nothing waiting"} tone={waiting.length ? "warn" : "default"} />
        <Stat label="Paid as advances" value={formatMoney(paid)} hint="Recovered from the next salary" />
        <Stat label="Manager Agent today" value={formatMoney(cfg.agentApprovedToday)} hint={delegationLive && d ? `of ${formatMoney(d.dailyLimit)} daily limit` : "No active delegation"} />
      </Stats>

      <Card title="Approver and delegation" className="mb-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p id="avail-label" className="text-sm font-medium text-slate-900">I am available to approve requests</p>
                <p id="avail-hint" className="mt-0.5 text-xs text-slate-500">
                  {cfg.ownerAvailable ? "Requests wait for your decision. The Manager Agent never approves while you are available." : "You are away. The Manager Agent may approve within the delegation; anything else is escalated to you."}
                </p>
              </div>
              <Switch checked={cfg.ownerAvailable} labelledBy="avail-label" describedBy="avail-hint" disabled={busy === "config"} onChange={(on) => void setConfig({ ownerAvailable: on })} />
            </div>
            {!cfg.ownerAvailable && !delegationLive && <Notice tone="warn" className="mt-3">You are away and no delegation is active, so every request will wait for you.</Notice>}
          </div>

          <div>
            <p className="text-sm font-medium text-slate-900">Delegate approval to the Manager Agent</p>
            <p className="mt-0.5 text-xs text-slate-500">
              It can approve only while you are away, only a clean request (no flags), and never above ₹{ov.rules.hardCapPerRequest}. Only you can change this.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Field label="Per request (₹)">
                <input type="number" min={ov.rules.minAmount} max={ov.rules.hardCapPerRequest} value={formValues.max} onChange={(e) => setForm({ ...formValues, max: e.target.value })} className={fieldClass("h-8 w-full px-2.5 text-sm")} />
              </Field>
              <Field label="Per day (₹)">
                <input type="number" min={ov.rules.minAmount} value={formValues.daily} onChange={(e) => setForm({ ...formValues, daily: e.target.value })} className={fieldClass("h-8 w-full px-2.5 text-sm")} />
              </Field>
              <Field label="Valid until">
                <input type="date" min={ov.today} max={addDays(ov.today, ov.rules.maxDelegationDays)} value={formValues.expires} onChange={(e) => setForm({ ...formValues, expires: e.target.value })} className={fieldClass("h-8 w-full px-2 text-sm")} />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={busy === "config"}
                onClick={() =>
                  void setConfig({ delegation: { maxPerRequest: Number(formValues.max), dailyLimit: Number(formValues.daily), expiresOn: formValues.expires } }, () => {
                    setForm(null);
                    toast({ tone: "success", title: "Delegation saved", description: "Requests waiting while you are away are checked against it now." });
                  })
                }
              >
                {d ? "Update delegation" : "Grant delegation"}
              </Button>
              {d && (
                <Button variant="danger" disabled={busy === "config"} onClick={() => void setConfig({ delegation: null }, () => setForm(null))}>
                  Revoke
                </Button>
              )}
              {d && (
                <span className="text-xs text-slate-500">
                  {delegationLive ? `Active: ${formatMoney(d.maxPerRequest)} each, ${formatMoney(d.dailyLimit)} a day, until ${d.expiresOn}` : `Expired on ${d.expiresOn}`}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card title={`Needs a decision (${waiting.length})`} className="mb-5" flush>
        {waiting.length === 0 ? (
          <EmptyState>No requests are waiting.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {waiting.map((a) => {
              const escalation = [...a.trail].reverse().find((t) => t.actor === "manager_agent" && t.action.startsWith("Escalated"));
              const key = `${a.id}:approve`;
              return (
                <li key={a.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={a.workerName} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{a.workerName} <span className="tabular-nums">asks for {formatMoney(a.amount)}</span></p>
                        <p className="text-xs text-slate-500">{a.reasonText} · {formatDateTime(a.createdAt)} UTC</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={URGENCY_TONE[a.urgency]}>{a.urgency} urgency</Badge>
                      <AdvanceBadge status={a.status} payment={a.payment} />
                    </div>
                  </div>

                  {escalation && <Notice tone="warn" className="mt-3"><span className="font-medium">Escalated by the Manager Agent.</span> {escalation.detail}</Notice>}

                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">Eligibility Agent</p>
                      <p className="mb-2 text-sm text-slate-700">{a.explanation}</p>
                      <CalcTable calc={a.calc} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">Checks</p>
                      <ul className="space-y-1 text-sm">
                        {a.checks.map((c) => (
                          <li key={c.id} className="flex items-start gap-2">
                            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${c.passed ? "bg-emerald-500" : "bg-rose-500"}`} />
                            <span className="text-slate-700">{c.label}<span className="text-slate-400"> · {c.detail}</span></span>
                          </li>
                        ))}
                      </ul>
                      {a.flags.length > 0 && (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                          {a.flags.map((f) => <p key={f}>{f}</p>)}
                        </div>
                      )}
                      <p className="mt-2 text-xs text-slate-500">They said ({a.language}): “{a.requestText}”</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {confirming === key ? (
                      <>
                        <span className="text-sm text-slate-700">Send {formatMoney(a.amount)} to {a.workerName}&apos;s UPI ID now?</span>
                        <Button variant="primary" disabled={busy === key} onClick={() => void decide(a, "approve")}>{busy === key ? "Sending…" : "Yes, approve and pay"}</Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>Not yet</Button>
                      </>
                    ) : (
                      <>
                        <Button variant="primary" disabled={busy !== null} onClick={() => setConfirming(key)}>Approve and pay</Button>
                        <Button variant="danger" disabled={busy !== null} onClick={() => void decide(a, "reject")}>Reject</Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? "Hide trail" : "Audit trail"}</Button>
                  </div>
                  {openId === a.id && <div className="mt-3"><Trail entries={a.trail} /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="History" flush>
        {history.length === 0 ? (
          <EmptyState>No decided requests yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={th}>Worker</th>
                  <th className={th}>Requested</th>
                  <th className={thRight}>Amount</th>
                  <th className={th}>Decided by</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((a) => (
                  <Fragment key={a.id}>
                    <tr>
                      <td className={td}>{a.workerName}</td>
                      <td className={`${td} text-slate-500`}>{formatDateTime(a.createdAt)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(a.amount)}</td>
                      <td className={`${td} text-slate-500`}>{a.approvedBy === "manager_agent" ? "Manager Agent (delegated)" : a.approvedBy === "owner" ? "Owner" : a.status === "ineligible" ? "Eligibility Agent" : "—"}</td>
                      <td className={td}><AdvanceBadge status={a.status} payment={a.payment} /></td>
                      <td className={`${td} text-right`}>
                        {a.status === "approved" && a.payment === "failed" && (
                          <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void decide(a, "reject")} className="mr-1">Close</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? "Hide" : "Trail"}</Button>
                      </td>
                    </tr>
                    {openId === a.id && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50/60 px-4 py-3">
                          <p className="mb-2 text-sm text-slate-700">{a.explanation}</p>
                          {a.payment === "failed" && a.paymentFailure && <p className="mb-2 text-xs text-rose-700">{a.paymentFailure} Retry it from Transactions, or close it here.</p>}
                          {a.cashfree && <CashfreeProof proof={a.cashfree} />}
                          <Trail entries={a.trail} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
