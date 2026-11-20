"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import { IconAlert, IconMic } from "../icons";
import { Button, Card, Field, inputClass, Notice, StatusBadge } from "../merchant/ui";

interface Limit { available: number; earnedLimit: number; outstanding: number; maxAmount: number; percent: number }
interface Req { id: string; amount: number; reasonText: string; status: string; statusNote?: string; createdAt: string; owed?: number; recovered?: number }
interface State { limit: Limit; blocks: string[]; requests: Req[] }
interface Preview {
  transcript: string; language: string; amount: number | null; amountMismatch: boolean; modelAvailable: boolean;
  reasonCategory: string; summary: string; readBack: string | null; available: number; blocks: string[]; source: "voice" | "text";
}

const REASONS: Record<string, string> = {
  vehicle_repair: "Vehicle repair", medical: "Medical", family_event: "Family event", housing: "Housing", education: "Education", other: "Other",
};
const LANGS: Record<string, string> = { bn: "Bengali", hi: "Hindi", kn: "Kannada", mr: "Marathi", ta: "Tamil", te: "Telugu", gu: "Gujarati", ml: "Malayalam", pa: "Punjabi", en: "English" };
const MAX_RECORDING_MS = 28_000;

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

export function AdvanceCard() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "recording" | "reading" | "submitting">("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  // Fields the worker confirms or corrects before anything is saved.
  const [amount, setAmount] = useState("");
  const [reasonCategory, setReasonCategory] = useState("other");
  const [reasonText, setReasonText] = useState("");
  const [ack, setAck] = useState(false);
  const [key, setKey] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<State>("/api/me/advance");
    if (r.ok) { setState(r.data); setLoadError(""); } else setLoadError(r.error);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  function openReview(p: Preview) {
    setPreview(p);
    setAmount(p.amount !== null ? String(p.amount) : "");
    setReasonCategory(p.reasonCategory);
    setReasonText(p.summary);
    setAck(false);
    setKey(crypto.randomUUID().replace(/-/g, ""));
  }

  async function understand(body: BodyInit, headers?: HeadersInit) {
    setPhase("reading");
    setError("");
    const r = await api<Preview>("/api/me/advance/parse", { method: "POST", body, headers });
    setPhase("idle");
    if (!r.ok) return setError(r.error);
    openReview(r.data);
  }

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setError("Recording isn't supported in this browser. Please type your request.");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError("Microphone access was blocked. Allow it in your browser, or type your request.");
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      if (timer.current) clearTimeout(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      const form = new FormData();
      form.append("audio", new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), "request.webm");
      void understand(form);
    };
    recorder.current = rec;
    rec.start();
    setPhase("recording");
    timer.current = setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), MAX_RECORDING_MS);
  }

  async function listen() {
    if (!preview?.readBack || speaking) return;
    setSpeaking(true);
    try {
      const res = await fetch("/api/me/advance/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: preview.readBack, language: preview.language }) });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      await audio.play();
    } catch {
      setSpeaking(false);
      setError("Couldn't play the spoken version. Please read the text above.");
    }
  }

  const amountNum = Number(amount);
  const available = state?.limit.available ?? preview?.available ?? 0;
  const amountError =
    amount === "" ? "" : !Number.isInteger(amountNum) || amountNum < 1 ? "Enter a whole number of rupees." : amountNum > available ? `That is more than your available limit of ${formatMoney(available)}.` : "";
  const canSubmit = !!preview && amount !== "" && !amountError && reasonText.trim().length > 0 && ack && phase === "idle";

  async function submit() {
    if (!preview || !canSubmit) return;
    setPhase("submitting");
    setError("");
    const r = await api<{ request: Req }>("/api/me/advance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key, amount: amountNum, reasonText, reasonCategory, language: preview.language, source: preview.source, transcript: preview.transcript, confirmed: true, recoveryAck: true }),
    });
    setPhase("idle");
    if (!r.ok) return setError(r.error);
    setPreview(null);
    setText("");
    await refresh();
  }

  async function cancel(id: string) {
    const r = await api<{ request: Req }>(`/api/me/advance/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    if (!r.ok) setError(r.error);
    await refresh();
  }

  const busy = phase !== "idle";
  const waiting = state?.requests.some((r) => r.status === "pending_review");

  return (
    <Card title="Emergency advance" className="mt-5" actions={state && <span className="text-xs text-slate-500">Draw part of wages you have already earned</span>}>
      {loadError && <Notice tone="error" className="mb-3" action={<button onClick={() => void refresh()} className="underline underline-offset-2">Retry</button>}>{loadError}</Notice>}
      {!state && !loadError && <div className="h-24 animate-pulse rounded bg-slate-100" aria-busy aria-label="Loading" />}

      {state && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Available advance limit</p>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{formatMoney(state.limit.available)}</p>
              <p className="text-xs text-slate-500">{state.limit.percent}% of wages you have earned and not yet been paid{state.limit.outstanding > 0 ? `, less ${formatMoney(state.limit.outstanding)} already advanced` : ""}. Up to {formatMoney(state.limit.maxAmount)} per request.</p>
            </div>
          </div>

          {state.blocks.length > 0 && !preview && (
            <Notice tone="warn" className="mt-3">
              <p className="font-medium">You can&apos;t request an advance right now.</p>
              <ul className="mt-1 list-disc pl-4 text-xs">{state.blocks.map((b) => <li key={b}>{b}</li>)}</ul>
            </Notice>
          )}

          {!preview && state.blocks.length === 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">Need money urgently?</p>
              <p className="mt-0.5 text-sm text-slate-600">Tell us what happened, in your own language. Nothing is paid until your employer approves.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-sound="off"
                  onClick={phase === "recording" ? () => recorder.current?.stop() : () => void startRecording()}
                  disabled={busy && phase !== "recording"}
                  className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-medium text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-300 ${phase === "recording" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700"}`}
                >
                  {phase === "recording" ? <span className="size-2 animate-pulse rounded-full bg-white" /> : <IconMic className="size-4" />}
                  {phase === "recording" ? "Listening… tap to stop" : phase === "reading" ? "Understanding…" : "Tap to speak"}
                </button>
                <span className="text-xs text-slate-500">বাংলা · हिंदी · ಕನ್ನಡ · मराठी · தமிழ் · తెలుగు · English</span>
              </div>
              <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void understand(JSON.stringify({ text: text.trim() }), { "Content-Type": "application/json" }); }}>
                <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type here, e.g. I need ₹2,000 to repair my bike" aria-label="Type your request" disabled={busy} maxLength={600} />
                <Button type="submit" variant="primary" disabled={busy || !text.trim()}>Continue</Button>
              </form>
              {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
            </div>
          )}

          {preview && (
            <div className="mt-4 rounded-xl border-2 border-brand-200 bg-brand-50/40 p-4" role="group" aria-label="Check your request">
              <p className="text-sm font-semibold text-slate-900">Please check your request</p>
              <p className="mt-1 rounded-md bg-white px-3 py-2 text-sm italic text-slate-600 ring-1 ring-slate-200">“{preview.transcript}”</p>
              <p className="mt-1 text-xs text-slate-500">Language understood: {LANGS[preview.language] ?? preview.language}{!preview.modelAvailable ? ". We couldn't read the reason automatically; please fill it in." : ""}</p>

              {preview.amountMismatch && (
                <Notice tone="warn" className="mt-3"><span className="flex items-start gap-1.5"><IconAlert className="mt-0.5 size-4 shrink-0" />We weren&apos;t sure of the amount you said. Please type the amount yourself.</span></Notice>
              )}
              {preview.readBack && (
                <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <p className="text-sm text-slate-900">{preview.readBack}</p>
                  <Button size="sm" className="mt-2" onClick={() => void listen()} disabled={speaking}>{speaking ? "Playing…" : "Listen"}</Button>
                </div>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Amount you need (₹)" hint={`You can request up to ${formatMoney(available)}.`}>
                  <input className={inputClass} type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amountError} aria-describedby="amt-err" autoFocus={preview.amount === null} />
                  {amountError && <span id="amt-err" role="alert" className="mt-1 block text-xs text-rose-700">{amountError}</span>}
                </Field>
                <Field label="Reason">
                  <select className={inputClass} value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>
                    {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Reason in a few words">
                    <input className={inputClass} value={reasonText} maxLength={200} onChange={(e) => setReasonText(e.target.value)} placeholder="e.g. Bike repair after an accident" />
                  </Field>
                </div>
              </div>

              {amount !== "" && !amountError && (
                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
                  <div><dt className="text-xs text-slate-500">Requested</dt><dd className="font-semibold tabular-nums">{formatMoney(amountNum)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Available</dt><dd className="font-semibold tabular-nums">{formatMoney(available)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Left after</dt><dd className="font-semibold tabular-nums">{formatMoney(available - amountNum)}</dd></div>
                </dl>
              )}

              <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-0.5 accent-brand-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand that this amount is paid early and will be deducted from my next payroll{amount && !amountError ? ` (${formatMoney(amountNum)})` : ""}.</span>
              </label>

              {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" size="lg" disabled={!canSubmit} onClick={() => void submit()}>{phase === "submitting" ? "Sending…" : "Send request to my employer"}</Button>
                <Button size="lg" disabled={phase === "submitting"} onClick={() => { setPreview(null); setError(""); }}>Start again</Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Sending a request does not pay you. Your employer reviews it first.</p>
            </div>
          )}

          {state.requests.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Your requests</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {state.requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums text-slate-900">{formatMoney(r.amount)} <span className="font-normal text-slate-500">· {r.reasonText}</span></p>
                      <p className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</p>
                      {r.statusNote && <p className="mt-0.5 text-xs text-slate-600">{r.statusNote}</p>}
                      {r.status === "paid" && r.owed !== undefined && (
                        <p className="mt-0.5 text-xs text-slate-600">{r.owed > 0 ? `${formatMoney(r.owed)} will be deducted from your next payroll.` : "Fully repaid."}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === "pending_review" && <Button size="sm" variant="ghost" onClick={() => void cancel(r.id)}>Cancel</Button>}
                    </div>
                  </li>
                ))}
              </ul>
              {waiting && <p className="mt-1.5 text-xs text-slate-500">Your employer has not answered yet. You&apos;ll see the result here.</p>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
