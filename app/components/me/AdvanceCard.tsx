"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import { IconAlert, IconMic } from "../icons";
import { Badge, Button, Card, Field, inputClass, Notice, StatusBadge } from "../merchant/ui";
import { Pager, usePaged } from "../Pager";
import { api, JSON_HEADERS, LANG_KEY, LANGS, PICKER, type Preview } from "./advance-shared";
import { LazyVoiceStage } from "../Lazy";
import { useAlive, useLatestRequest } from "@/app/lib/client/lifecycle";

interface Limit { available: number; earnedLimit: number; outstanding: number; maxAmount: number; percent: number }
interface Req { id: string; amount: number; reasonText: string; status: string; statusNote?: string; createdAt: string; owed?: number; recovered?: number }
interface State { limit: Limit; blocks: string[]; requests: Req[] }

const REASONS: Record<string, string> = {
  vehicle_repair: "Vehicle repair", medical: "Medical", family_event: "Family event", housing: "Housing", education: "Education", other: "Other",
};

const NO_REQUESTS: Req[] = [];

export function AdvanceCard({ workerName }: { workerName: string }) {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  // The full-screen voice screen handles recording, transcription and translation; this card handles typing, review and sending.
  const [phase, setPhase] = useState<"idle" | "reading" | "submitting">("idle");
  const [stage, setStage] = useState<null | { mode: "listen" } | { mode: "respond"; text: string; language: string }>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [langPick, setLangPick] = useState("auto");
  // Fields the worker confirms or corrects before anything is saved.
  const [transcript, setTranscript] = useState("");
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [amount, setAmount] = useState("");
  const [reasonCategory, setReasonCategory] = useState("other");
  const [reasonText, setReasonText] = useState("");
  const [ack, setAck] = useState(false);
  const [key, setKey] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [done, setDone] = useState<{ request: Req; spoken: { text: string; language: string } | null } | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const pagedRequests = usePaged(state?.requests ?? NO_REQUESTS, 5);

  const nextLoad = useLatestRequest();
  const alive = useAlive();
  const spokenUrl = useRef<string | null>(null);
  // Leaving the page stops any reply that is playing and frees its audio.
  useEffect(() => () => {
    audio.current?.pause();
    audio.current = null;
    if (spokenUrl.current) URL.revokeObjectURL(spokenUrl.current);
  }, []);

  const refresh = useCallback(async () => {
    const signal = nextLoad();
    const r = await api<State>("/api/me/advance", { signal });
    if (signal.aborted) return;
    if (r.ok) { setState(r.data); setLoadError(""); } else setLoadError(r.error);
  }, [nextLoad]);
  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
      try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved && PICKER.some((l) => l.code === saved)) setLangPick(saved);
      } catch { /* storage blocked: stays on Auto */ }
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);

  function chooseLanguage(code: string) {
    setLangPick(code);
    try { localStorage.setItem(LANG_KEY, code); } catch { /* per-device convenience only */ }
  }

  function openReview(p: Preview) {
    setPreview(p);
    setTranscript(p.transcript);
    setTranscriptDirty(false);
    setAmount(p.amount !== null ? String(p.amount) : "");
    setReasonCategory(p.reasonCategory);
    setReasonText(p.summary);
    setAck(false);
    setKey(crypto.randomUUID().replace(/-/g, ""));
  }

  /** Step 2 of understanding: translate to English and pull out the amount and reason. */
  async function understand(words: string, languageCode: string | null, source: "voice" | "text") {
    setPhase("reading");
    setError("");
    const r = await api<Preview>("/api/me/advance/parse", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: words, languageCode, source }) });
    setPhase("idle");
    if (!r.ok) return setError(r.error);
    openReview(r.data);
  }

  /** The voice screen understood the request: keep the recording for replay and show the review. */
  function onVoiceResult(p: Preview, clip: Blob | null) {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    setClipUrl(clip ? URL.createObjectURL(clip) : null);
    setStage(null);
    openReview(p);
  }

  async function play(url: string) {
    audio.current?.pause();
    setSpeaking(false);
    const a = new Audio(url);
    audio.current = a;
    await a.play();
  }

  async function speak(words: string, language: string) {
    if (speaking) return;
    setSpeaking(true);
    try {
      const res = await fetch("/api/me/advance/speak", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: words, language }) });
      if (!res.ok) throw new Error();
      const clip = await res.blob();
      if (!alive.current) return;
      if (spokenUrl.current) URL.revokeObjectURL(spokenUrl.current);
      audio.current?.pause();
      const url = URL.createObjectURL(clip);
      spokenUrl.current = url;
      const a = new Audio(url);
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); spokenUrl.current = null; setSpeaking(false); };
      audio.current = a;
      await a.play();
    } catch {
      setSpeaking(false);
      setError("We couldn't play the spoken version. Please read the text on screen.");
    }
  }

  const amountNum = Number(amount);
  const available = state?.limit.available ?? preview?.available ?? 0;
  const amountError =
    amount === "" ? "" : !Number.isInteger(amountNum) || amountNum < 1 ? "Enter a whole number of rupees." : amountNum > available ? `That is more than your available limit of ${formatMoney(available)}.` : "";
  const canSubmit = !!preview && amount !== "" && !amountError && reasonText.trim().length > 0 && transcript.trim().length > 0 && !transcriptDirty && ack && phase === "idle";

  async function submit() {
    if (!preview || !canSubmit) return;
    setPhase("submitting");
    setError("");
    const r = await api<{ request: Req; spoken: { text: string; language: string } | null }>("/api/me/advance", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ idempotencyKey: key, amount: amountNum, reasonText, reasonCategory, language: preview.language, source: preview.source, transcript, urgency: preview.urgency, confirmed: true, recoveryAck: true }),
    });
    setPhase("idle");
    if (!r.ok) return setError(r.error);
    // Only now, after the server has saved it, do we tell the worker it was submitted.
    setPreview(null);
    setText("");
    setDone({ request: r.data.request, spoken: r.data.spoken });
    await refresh();
    if (r.data.spoken) setStage({ mode: "respond", text: r.data.spoken.text, language: r.data.spoken.language });
  }

  async function cancel(id: string) {
    const r = await api<{ request: Req }>(`/api/me/advance/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    if (!r.ok) setError(r.error);
    await refresh();
  }

  function startOver() {
    setPreview(null);
    setError("");
    setDone(null);
    if (clipUrl) { URL.revokeObjectURL(clipUrl); setClipUrl(null); }
  }

  const busy = phase !== "idle";
  const waiting = state?.requests.some((r) => r.status === "pending_review");
  const eligible = !!state && state.blocks.length === 0;

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
            <div className="flex flex-col items-end gap-1 text-right">
              <Badge tone={eligible ? "green" : "amber"}>{eligible ? "You can request an advance" : "Not available right now"}</Badge>
              {state.limit.outstanding > 0 && <span className="text-xs text-slate-600">Outstanding: {formatMoney(state.limit.outstanding)}</span>}
            </div>
          </div>

          {state.blocks.length > 0 && !preview && !done && (
            <Notice tone="warn" className="mt-3">
              <p className="font-medium">You can&apos;t request an advance right now.</p>
              <ul className="mt-1 list-disc pl-4 text-xs">{state.blocks.map((b) => <li key={b}>{b}</li>)}</ul>
            </Notice>
          )}

          {done && (
            <div className="mt-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/60 p-4" role="status">
              <p className="text-base font-semibold text-emerald-900">Your emergency advance request has been submitted successfully.</p>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Request ID</dt><dd className="font-mono text-slate-900">{done.request.id}</dd></div>
                <div><dt className="text-xs text-slate-500">Amount requested</dt><dd className="font-semibold tabular-nums text-slate-900">{formatMoney(done.request.amount)}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd><StatusBadge status={done.request.status} /></dd></div>
                <div><dt className="text-xs text-slate-500">Approval</dt><dd className="text-slate-900">{done.request.status === "pending_review" ? "Waiting for your employer" : "See below"}</dd></div>
              </dl>
              <p className="mt-3 text-sm text-slate-700">What happens next: your employer reviews the request. You are not paid until they approve it, and it shows as paid here only after your bank confirms it. The amount is deducted from your next payroll.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {done.spoken && <Button size="sm" disabled={speaking} onClick={() => void speak(done.spoken!.text, done.spoken!.language)}>{speaking ? "Playing…" : "Listen again"}</Button>}
                <Button size="sm" variant="ghost" onClick={startOver}>Done</Button>
              </div>
              {done.spoken && <p className="mt-2 text-xs text-slate-500">“{done.spoken.text}”</p>}
            </div>
          )}

          {!preview && !done && eligible && (
            <div className="mt-4 rounded-2xl border border-teal-200 bg-gradient-to-b from-teal-50 to-white p-5">
              <p className="text-center text-lg font-semibold text-slate-900">Need money urgently?</p>
              <p className="mx-auto mt-0.5 max-w-md text-center text-sm text-slate-600">Explain your emergency in your own language. BolPay understands you. Nothing is paid until your employer approves.</p>

              <div className="mt-4 flex flex-col items-center gap-3">
                <button type="button" data-sound="off" onClick={() => setStage({ mode: "listen" })} disabled={busy}
                  className="flex h-14 items-center gap-3 rounded-full bg-teal-700 px-7 text-base font-semibold text-white shadow-lg shadow-teal-700/25 transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:bg-slate-300 disabled:shadow-none">
                  <IconMic className="size-6" /> Tap to speak
                </button>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Language
                  <select className={`${inputClass} h-8 w-auto py-0 text-xs`} value={langPick} onChange={(e) => chooseLanguage(e.target.value)} disabled={busy}>
                    {PICKER.map((l) => <option key={l.code} value={l.code}>{l.label} {l.code === "auto" ? "(detect)" : l.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="my-4 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-slate-400"><span className="h-px flex-1 bg-slate-200" />or type<span className="h-px flex-1 bg-slate-200" /></div>
              <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void understand(text.trim(), langPick !== "auto" ? langPick : null, "text"); }}>
                <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type here, e.g. I need ₹2,000 to repair my bike" aria-label="Type your request" disabled={busy} maxLength={600} />
                <Button type="submit" variant="primary" disabled={busy || !text.trim()}>Continue</Button>
              </form>
              {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800">{error}</p>}
            </div>
          )}

          {preview && (
            <div className="mt-4 rounded-xl border-2 border-teal-200 bg-teal-50/40 p-4" role="group" aria-label="Check your request">
              <p className="text-base font-semibold text-slate-900">Your request</p>
              <p className="text-xs text-slate-500">Check everything. Nothing is sent until you confirm.</p>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your words ({LANGS[preview.language] ?? preview.language})</span>
                    {clipUrl && <button type="button" data-sound="off" className="text-xs font-medium text-teal-700 hover:underline" onClick={() => void play(clipUrl).catch(() => setError("Couldn't play the recording."))}>▶ Replay recording</button>}
                  </div>
                  <textarea className={`${inputClass} min-h-24 leading-relaxed`} value={transcript} maxLength={600} onChange={(e) => { setTranscript(e.target.value); setTranscriptDirty(true); }} aria-label="What you said. You can correct it." />
                  {transcriptDirty ? (
                    <Button size="sm" className="mt-1.5" disabled={busy || !transcript.trim()} onClick={() => void understand(transcript.trim(), preview.language, preview.source)}>Update translation</Button>
                  ) : (
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                      Language
                      <select className={`${inputClass} h-7 py-0 text-xs`} value={PICKER.find((l) => l.code.startsWith(`${preview.language}-`))?.code ?? ""} disabled={busy}
                        onChange={(e) => { chooseLanguage(e.target.value); void understand(transcript, e.target.value, preview.source); }}>
                        {!PICKER.some((l) => l.code.startsWith(`${preview.language}-`)) && <option value="">{LANGS[preview.language] ?? preview.language}</option>}
                        {PICKER.filter((l) => l.code !== "auto").map((l) => <option key={l.code} value={l.code}>{l.label} {l.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">English translation (your employer sees this too)</span>
                  <p className="min-h-24 rounded-lg bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 ring-1 ring-slate-200">
                    {preview.language === "en" ? <span className="text-slate-500">You spoke English, so no translation is needed.</span> : preview.englishTranslation ?? <span className="text-amber-800">We couldn&apos;t translate this right now. Your employer will see your original words.</span>}
                  </p>
                </div>
              </div>
              {preview.modelAvailable === false && <p className="mt-2 text-xs text-amber-800">We couldn&apos;t read the reason automatically. Please fill it in below.</p>}

              {preview.amountMismatch && (
                <Notice tone="warn" className="mt-3"><span className="flex items-start gap-1.5"><IconAlert className="mt-0.5 size-4 shrink-0" />We weren&apos;t sure of the amount you said. Please type the amount yourself.</span></Notice>
              )}
              {preview.amount === null && !preview.amountMismatch && !transcriptDirty && (
                <Notice tone="warn" className="mt-3"><span className="flex items-start gap-1.5"><IconAlert className="mt-0.5 size-4 shrink-0" />We didn&apos;t hear an amount. How many rupees do you need? Type it below.</span></Notice>
              )}
              {preview.readBack && !transcriptDirty && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <p className="text-sm text-slate-900">{preview.readBack}</p>
                  <Button size="sm" onClick={() => void speak(preview.readBack!, preview.language)} disabled={speaking}>{speaking ? "Playing…" : "Listen"}</Button>
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

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span className="text-xs text-slate-500">Urgency you described:</span>
                <button type="button" aria-pressed={preview.urgency === "urgent"} onClick={() => setPreview({ ...preview, urgency: preview.urgency === "urgent" ? "normal" : "urgent" })}
                  className={`h-7 rounded-full border px-3 text-xs font-medium ${preview.urgency === "urgent" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-300 bg-white text-slate-600"}`}>{preview.urgency === "urgent" ? "Urgent" : "Not marked urgent"}</button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-slate-500">Eligibility:</span>
                {state.blocks.length > 0 ? <Badge tone="red">Not eligible</Badge> : amount === "" ? <Badge tone="slate">Enter an amount</Badge> : amountError ? <Badge tone="red">Over your limit</Badge> : <Badge tone="green">Within your limit</Badge>}
                <span className="text-xs text-slate-500">Available now {formatMoney(available)}. BolPay&apos;s server checks this again when you send.</span>
              </div>
              

              {amount !== "" && !amountError && (
                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
                  <div><dt className="text-xs text-slate-500">Requested</dt><dd className="font-semibold tabular-nums">{formatMoney(amountNum)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Available</dt><dd className="font-semibold tabular-nums">{formatMoney(available)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Left after</dt><dd className="font-semibold tabular-nums">{formatMoney(available - amountNum)}</dd></div>
                </dl>
              )}

              <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-0.5 accent-teal-700" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I confirm these details are correct. I understand this amount is paid early and will be deducted from my next payroll{amount && !amountError ? ` (${formatMoney(amountNum)})` : ""}.</span>
              </label>

              {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
              {transcriptDirty && <p className="mt-2 text-xs text-amber-800">You changed your words. Tap &ldquo;Update translation&rdquo; before sending.</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" size="lg" disabled={!canSubmit} onClick={() => void submit()}>{phase === "submitting" ? "Sending…" : "Confirm and send request"}</Button>
                <Button size="lg" disabled={phase === "submitting" || busy} onClick={() => { startOver(); setStage({ mode: "listen" }); }}>Record again</Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Sending a request does not pay you. Your employer reviews it first.</p>
            </div>
          )}

          {state.requests.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Your requests</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {pagedRequests.rows.map((r) => (
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
              <Pager {...pagedRequests} label="your requests" />
              {waiting && <p className="mt-1.5 text-xs text-slate-500">Your employer has not answered yet. You&apos;ll see the result here.</p>}
            </div>
          )}
        </>
      )}
          {stage && (
        <LazyVoiceStage
          key={stage.mode}
          mode={stage.mode}
          workerName={workerName}
          language={langPick}
          onLanguage={chooseLanguage}
          respond={stage.mode === "respond" ? { text: stage.text, language: stage.language } : undefined}
          onResult={onVoiceResult}
          onClose={() => setStage(null)}
        />
      )}
    </Card>
  );
}
