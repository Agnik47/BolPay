"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import type { AdvancePolicy, Delegation } from "@/app/lib/merchant/types";
import { useToast } from "../../feedback/Toaster";
import { ConfirmDialog } from "../overlays";
import { Badge, Button, Card, Field, inputClass, Notice, Switch } from "../ui";
import { useLatestRequest } from "@/app/lib/client/lifecycle";

type DelegationRow = Delegation & { state: "active" | "scheduled" | "expired" | "revoked" };
interface State { policy: AdvancePolicy; delegations: DelegationRow[]; live: boolean; autonomyAllowed: boolean }

const TONE = { active: "green", scheduled: "blue", expired: "slate", revoked: "red" } as const;

async function call(method: string, url: string, body?: unknown, signal?: AbortSignal) {
  try {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal });
    const data = (await res.json().catch(() => ({}))) as Partial<State> & { error?: string; advances?: unknown };
    return res.ok ? { ok: true as const, data } : { ok: false as const, error: data.error ?? "Something went wrong." };
  } catch {
    return { ok: false as const, error: "Could not reach the server." };
  }
}

const inFiveDays = () => {
  const d = new Date(Date.now() + 5 * 86_400_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Owner-only: advance policy and the Manager Agent's delegated authority. */
export function AdvancePolicyPanel({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pol, setPol] = useState({ percentLimit: "", maxAmount: "", minServiceDays: "", maxOutstanding: "", expireAfterHours: "", maxRecoveryPercentOfPayout: "" });
  const [human, setHuman] = useState(true);
  const [del, setDel] = useState({ maxPerRequest: "2000", maxDailyTotal: "6000", maxMonthlyTotal: "20000", expiresAt: inFiveDays(), autonomous: false, note: "" });
  const [revoke, setRevoke] = useState<DelegationRow | null>(null);

  const adopt = useCallback((s: State) => {
    setState(s);
    setPol({ percentLimit: String(s.policy.percentLimit), maxAmount: String(s.policy.maxAmount), minServiceDays: String(s.policy.minServiceDays), maxOutstanding: String(s.policy.maxOutstanding), expireAfterHours: String(s.policy.expireAfterHours), maxRecoveryPercentOfPayout: String(s.policy.maxRecoveryPercentOfPayout) });
    setHuman(s.policy.requireHumanApproval);
  }, []);
  const nextLoad = useLatestRequest();
  const load = useCallback(async () => {
    const signal = nextLoad();
    const r = await call("GET", "/api/advances/delegations", undefined, signal);
    if (signal.aborted) return;
    if (r.ok && r.data.policy) { adopt(r.data as State); setError(""); } else if (!r.ok) setError(r.error);
  }, [adopt, nextLoad]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function savePolicy() {
    setBusy(true);
    const r = await call("PUT", "/api/advances/policy", { ...Object.fromEntries(Object.entries(pol).map(([k, v]) => [k, Number(v)])), requireHumanApproval: human });
    setBusy(false);
    if (!r.ok) return toast({ tone: "error", title: "Policy not saved", description: r.error });
    nextLoad();
    adopt(r.data as State);
    toast({ tone: "success", sound: false, title: "Policy saved", description: "It applies to new checks straight away." });
  }

  async function grant() {
    setBusy(true);
    const r = await call("POST", "/api/advances/delegations", { maxPerRequest: Number(del.maxPerRequest), maxDailyTotal: Number(del.maxDailyTotal), maxMonthlyTotal: Number(del.maxMonthlyTotal), expiresAt: new Date(del.expiresAt).toISOString(), autonomous: del.autonomous, note: del.note });
    setBusy(false);
    if (!r.ok) return toast({ tone: "error", title: "Delegation not created", description: r.error });
    nextLoad();
    adopt(r.data as State);
    onChanged();
    toast({ tone: "success", title: "Delegation started", description: del.autonomous && !human ? "The Manager Agent may approve within these limits." : "The Manager Agent will recommend; a person still approves." });
  }

  async function doRevoke() {
    if (!revoke) return;
    setBusy(true);
    const r = await call("POST", `/api/advances/delegations/${encodeURIComponent(revoke.id)}/revoke`);
    setBusy(false);
    setRevoke(null);
    if (!r.ok) return toast({ tone: "error", title: "Couldn't revoke", description: r.error });
    nextLoad();
    adopt(r.data as State);
    onChanged();
    toast({ tone: "info", sound: false, title: "Delegation revoked", description: "The Manager Agent has no authority now." });
  }

  if (!state) return error ? <Notice tone="error">{error}</Notice> : <div className="h-40 animate-pulse rounded-xl bg-slate-100" aria-busy />;
  const current = state.delegations.find((d) => d.state === "active" || d.state === "scheduled");
  const willApprove = del.autonomous && !human && state.autonomyAllowed;

  return (
    <div className="space-y-5">
      <Card title={`Advance policy (v${state.policy.version})`} actions={<span className="text-xs text-slate-500">Configurable product policy, not a legal entitlement</span>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Limit (% of earned unpaid wages)" hint="Of base pay plus overtime. 1 to 50."><input className={inputClass} type="number" min="1" max="50" value={pol.percentLimit} onChange={(e) => setPol({ ...pol, percentLimit: e.target.value })} /></Field>
          <Field label="Maximum per request (₹)"><input className={inputClass} type="number" min="1" value={pol.maxAmount} onChange={(e) => setPol({ ...pol, maxAmount: e.target.value })} /></Field>
          <Field label="Minimum service (days)"><input className={inputClass} type="number" min="0" value={pol.minServiceDays} onChange={(e) => setPol({ ...pol, minServiceDays: e.target.value })} /></Field>
          <Field label="Unrecovered advances allowed" hint="1 blocks a second advance until the first is recovered."><input className={inputClass} type="number" min="1" max="5" value={pol.maxOutstanding} onChange={(e) => setPol({ ...pol, maxOutstanding: e.target.value })} /></Field>
          <Field label="Requests expire after (hours)"><input className={inputClass} type="number" min="1" value={pol.expireAfterHours} onChange={(e) => setPol({ ...pol, expireAfterHours: e.target.value })} /></Field>
          <Field label="Most deducted from one payroll (%)" hint="Of that payout. The worker always gets at least ₹1; the rest carries to the next payroll. 10 to 100."><input className={inputClass} type="number" min="10" max="100" value={pol.maxRecoveryPercentOfPayout} onChange={(e) => setPol({ ...pol, maxRecoveryPercentOfPayout: e.target.value })} /></Field>
          <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
            <Switch checked={human} onChange={setHuman} labelledBy="human-label" />
            <div><p id="human-label" className="text-sm font-medium text-slate-900">A person approves every request</p><p className="text-xs text-slate-500">When on, the Manager Agent can recommend but never approve, even with a delegation.</p></div>
          </div>
        </div>
        <div className="mt-4"><Button variant="primary" disabled={busy} onClick={() => void savePolicy()}>{busy ? "Saving…" : "Save policy"}</Button></div>
      </Card>

      <Card title="Manager Agent delegation" actions={current && <Badge tone={TONE[current.state]}>{current.state}</Badge>}>
        <p className="text-sm text-slate-600">For when a manager is away. The agent applies fixed rules (eligibility, your limits, daily and monthly caps). It is not an AI model and can&apos;t change its own limits, the policy or Cashfree settings. Anything outside its limits goes to you.</p>

        {current ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Per request</dt><dd className="font-medium tabular-nums">{formatMoney(current.maxPerRequest)}</dd></div>
              <div><dt className="text-xs text-slate-500">Daily / monthly total</dt><dd className="font-medium tabular-nums">{formatMoney(current.maxDailyTotal)} / {formatMoney(current.maxMonthlyTotal)}</dd></div>
              <div><dt className="text-xs text-slate-500">Valid</dt><dd>{formatDateTime(current.startsAt)} to {formatDateTime(current.expiresAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Authority</dt><dd>{current.autonomous ? (state.policy.requireHumanApproval ? "May approve, but policy requires a person, so it recommends only" : "May approve within these limits") : "Recommends only"}</dd></div>
            </dl>
            {current.note && <p className="mt-2 text-sm text-slate-600">“{current.note}”</p>}
            <p className="mt-2 text-xs text-slate-500">Granted by {current.grantedBy.name}. You are told in this screen of every decision it makes, and each one is in the audit log.</p>
            <div className="mt-3"><Button variant="danger" disabled={busy} onClick={() => setRevoke(current)}>Revoke now…</Button></div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Max per request (₹)" hint={`Up to the policy maximum, ₹${state.policy.maxAmount}.`}><input className={inputClass} type="number" min="1" max={state.policy.maxAmount} value={del.maxPerRequest} onChange={(e) => setDel({ ...del, maxPerRequest: e.target.value })} /></Field>
            <Field label="Max per day (₹)"><input className={inputClass} type="number" min="1" value={del.maxDailyTotal} onChange={(e) => setDel({ ...del, maxDailyTotal: e.target.value })} /></Field>
            <Field label="Max per month (₹)"><input className={inputClass} type="number" min="1" value={del.maxMonthlyTotal} onChange={(e) => setDel({ ...del, maxMonthlyTotal: e.target.value })} /></Field>
            <Field label="Expires" hint="At most 60 days."><input className={inputClass} type="datetime-local" value={del.expiresAt} onChange={(e) => setDel({ ...del, expiresAt: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Note (optional)"><input className={inputClass} maxLength={200} value={del.note} placeholder="e.g. Priya on leave until 25 Nov" onChange={(e) => setDel({ ...del, note: e.target.value })} /></Field></div>
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 sm:col-span-3">
              <Switch checked={del.autonomous} onChange={(v) => setDel({ ...del, autonomous: v })} labelledBy="auto-label" />
              <div>
                <p id="auto-label" className="text-sm font-medium text-slate-900">Allow the agent to approve and pay on its own</p>
                <p className="text-xs text-slate-500">Off: it only recommends and you approve. On: it approves eligible requests within the limits above and the transfer is sent through Cashfree.</p>
              </div>
            </div>
            {del.autonomous && human && <div className="sm:col-span-3"><Notice tone="warn">“A person approves every request” is on in the policy, so the agent will only recommend. Turn it off above and save to let it approve.</Notice></div>}
            {del.autonomous && state.live && !state.autonomyAllowed && <div className="sm:col-span-3"><Notice tone="error">Cashfree is in production and autonomous approval is not enabled on this server, so the agent can only recommend.</Notice></div>}
            {willApprove && <div className="sm:col-span-3"><Notice tone="warn">The agent will approve and send real transfers up to {formatMoney(Number(del.maxPerRequest) || 0)} each without asking you{state.live ? " (production)" : " (sandbox)"}.</Notice></div>}
            <div className="sm:col-span-3"><Button variant="primary" disabled={busy} onClick={() => void grant()}>{busy ? "Starting…" : "Start delegation"}</Button></div>
          </div>
        )}

        {state.delegations.filter((d) => d !== current).length > 0 && (
          <div className="mt-5">
            <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Earlier delegations</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {state.delegations.filter((d) => d !== current).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-slate-700">{formatMoney(d.maxPerRequest)} per request · {formatDateTime(d.startsAt)} to {formatDateTime(d.expiresAt)}{d.revokedAt ? ` · revoked ${formatDateTime(d.revokedAt)}` : ""}</span>
                  <Badge tone={TONE[d.state]}>{d.state}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!revoke} title="Revoke the delegation?" confirmLabel="Revoke now" tone="danger" busy={busy} onConfirm={() => void doRevoke()} onCancel={() => setRevoke(null)}>
        The Manager Agent stops immediately. Requests it already approved keep their payments; waiting requests stay for you to decide.
      </ConfirmDialog>
    </div>
  );
}
