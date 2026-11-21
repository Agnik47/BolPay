"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TurnResult } from "@/app/lib/agents/worker-agent";
import type { WorkerAdvanceSummary, WorkerAdvanceView } from "@/app/lib/advances/types";
import { formatDateTime, formatMoney } from "@/app/lib/merchant/format";
import { AdvanceBadge, CalcTable, Trail } from "../advances/shared";
import { IconMic, IconSpeaker } from "../icons";
import { Button, Card, EmptyState, fieldClass, Notice, Stat, Stats } from "../merchant/ui";

interface Overview {
  summary: WorkerAdvanceSummary;
  advances: WorkerAdvanceView[];
}
interface Outcome {
  message: string;
  messageEnglish: string;
  language: string;
  advance: WorkerAdvanceView;
}

const MAX_RECORDING_S = 28;
const POLL_MS = 5000;

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? "Something went wrong." };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

/**
 * A worker asks for an emergency salary advance by voice or text, in their own language. The Worker Assistance
 * Agent reads it back for confirmation; only then does it go through eligibility, approval and payment on the server.
 */
export function AdvanceCard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [turn, setTurn] = useState<TurnResult | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing" | "thinking" | "submitting">("idle");
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(async () => {
    const r = await call<Overview>("GET", "/api/advances/mine");
    if (r.ok) {
      setOverview(r.data);
      setLoadError(null);
    } else setLoadError(r.error);
  }, []);

  useEffect(() => {
    // The first load runs after mount, so the setState inside it is not a cascading render.
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh]);

  // While a payment is on its way or a decision is pending, look again every few seconds.
  const live = overview?.advances.some((a) => a.status === "checking" || a.status === "awaiting_approval" || a.status === "escalated" || (a.status === "approved" && a.payment === "processing"));
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      audio.current?.pause();
    },
    [],
  );

  async function speak(message: string, language: string) {
    try {
      const res = await fetch("/api/voice-output", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message.slice(0, 400), language }) });
      if (!res.ok) return; // no voice for this language, or speech is not set up: the text is on screen
      audio.current?.pause();
      const el = new Audio(URL.createObjectURL(await res.blob()));
      audio.current = el;
      el.onended = () => URL.revokeObjectURL(el.src);
      await el.play().catch(() => undefined);
    } catch {
      /* the text is already on screen */
    }
  }

  async function send(said: string) {
    const clean = said.trim();
    if (!clean) return;
    setNotice(null);
    setOutcome(null);
    setPhase("thinking");
    const r = await call<{ turn: TurnResult }>("POST", "/api/advances/interpret", { text: clean, draftId: turn && "draftId" in turn ? turn.draftId : undefined });
    setPhase("idle");
    if (!r.ok) return setNotice(r.error);
    setText("");
    const t = r.data.turn;
    if (t.kind === "not_advance") {
      setTurn(null);
      setNotice(t.message);
      void speak(t.message, t.language);
      return;
    }
    setTurn(t);
    void speak(t.kind === "ask" ? t.question : t.readback, t.language);
  }

  async function confirm() {
    if (!turn || turn.kind !== "confirm") return;
    setPhase("submitting");
    const r = await call<Outcome & Overview>("POST", "/api/advances/confirm", { draftId: turn.draftId });
    setPhase("idle");
    if (!r.ok) {
      setTurn(null);
      return setNotice(r.error);
    }
    setTurn(null);
    setOutcome({ message: r.data.message, messageEnglish: r.data.messageEnglish, language: r.data.language, advance: r.data.advance });
    setOverview({ summary: r.data.summary, advances: r.data.advances });
    void speak(r.data.message, r.data.language);
  }

  async function withdraw(id: string) {
    const r = await call<Overview>("POST", `/api/advances/${encodeURIComponent(id)}/cancel`);
    if (r.ok) setOverview(r.data);
    else setNotice(r.error);
  }

  function reset() {
    audio.current?.pause();
    setTurn(null);
    setOutcome(null);
    setNotice(null);
    setText("");
  }

  async function startRecording() {
    audio.current?.pause(); // don't record the app's own voice
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return setNotice("Recording isn't supported in this browser. Type your request instead.");
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setNotice("Microphone access was blocked. Allow it in your browser, or type your request.");
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      setPhase("transcribing");
      const body = new FormData();
      body.append("audio", new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), "request.webm");
      try {
        const res = await fetch("/api/voice-input", { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) {
          setPhase("idle");
          return setNotice(`${data.error ?? "Could not read the recording."} Type your request instead.`);
        }
        if (!data.text?.trim()) {
          setPhase("idle");
          return setNotice("I didn't catch that. Try again a little closer to the microphone, or type it.");
        }
        await send(data.text);
      } catch {
        setPhase("idle");
        setNotice("Could not reach the server. Type your request instead.");
      }
    };
    recorder.current = rec;
    rec.start();
    setPhase("recording");
    setSeconds(0);
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_RECORDING_S && recorder.current?.state === "recording") recorder.current.stop();
        return s + 1;
      });
    }, 1000);
  }

  const busy = phase !== "idle";
  const summary = overview?.summary;

  return (
    <div className="mt-5 space-y-5">
      <Card title="Emergency advance" actions={<span className="text-xs text-slate-500">Paid straight to your UPI ID</span>}>
        {summary && (
          <>
            <Stats className="mb-4">
              <Stat label="Earned this period" value={formatMoney(summary.earnedWages)} hint={summary.periodLabel} />
              <Stat label={`${summary.policyPercent}% advance limit`} value={formatMoney(summary.policyLimit)} />
              <Stat label="Already advanced" value={formatMoney(summary.outstanding)} hint="Taken from your next salary" />
              <Stat label="You can ask for" value={formatMoney(summary.availableLimit)} tone={summary.availableLimit > 0 ? "good" : "warn"} />
            </Stats>
            {summary.blocked && <Notice tone="info" className="mb-4">{summary.blocked}</Notice>}
          </>
        )}
        {loadError && <Notice tone="error" className="mb-4">{loadError}</Notice>}

        {outcome ? (
          <div className="space-y-3">
            <Notice tone={outcome.advance.status === "ineligible" || outcome.advance.status === "rejected" ? "warn" : "success"}>
              <p className="font-medium">{outcome.message}</p>
              {outcome.language !== "en" && outcome.message !== outcome.messageEnglish && <p className="mt-1 text-xs text-slate-500">{outcome.messageEnglish}</p>}
            </Notice>
            <CalcTable calc={outcome.advance.calc} />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset}>New request</Button>
              <Button variant="ghost" onClick={() => void speak(outcome.message, outcome.language)}><IconSpeaker className="size-4" />Listen</Button>
            </div>
          </div>
        ) : turn?.kind === "confirm" ? (
          <div className="space-y-3" aria-live="polite">
            <p className="text-sm font-medium text-slate-900">Please check your request</p>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
              <p className="text-base text-slate-900">{turn.readback}</p>
              {turn.language !== "en" && turn.readback !== turn.readbackEnglish && <p className="mt-1.5 text-xs text-slate-500">{turn.readbackEnglish}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => void confirm()} disabled={busy}>{phase === "submitting" ? "Sending…" : "Yes, send my request"}</Button>
              <Button variant="secondary" size="lg" onClick={reset} disabled={busy}>No, start again</Button>
              <Button variant="ghost" size="lg" onClick={() => void speak(turn.readback, turn.language)}><IconSpeaker className="size-4" />Listen</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {turn?.kind === "ask" && (
              <Notice tone="info">
                <p className="font-medium">{turn.question}</p>
                {turn.language !== "en" && <p className="mt-1 text-xs text-slate-500">{turn.questionEnglish}</p>}
              </Notice>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{turn?.kind === "ask" ? "Your answer" : "Tell us how much you need and why"}</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={600}
                disabled={busy}
                placeholder="For example: my bike broke down, I need 2000 rupees. You can write in Hindi, Bengali, Kannada, Marathi or English."
                className={fieldClass("w-full px-2.5 py-2 text-sm")}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="lg" onClick={() => void send(text)} disabled={busy || !text.trim()}>{phase === "thinking" ? "Reading…" : "Send"}</Button>
              {phase === "recording" ? (
                <Button variant="danger" size="lg" onClick={() => recorder.current?.stop()}>
                  <span className="size-2 animate-pulse rounded-full bg-rose-600" />
                  Stop ({Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")})
                </Button>
              ) : (
                <Button variant="secondary" size="lg" onClick={() => void startRecording()} disabled={busy}>
                  <IconMic className="size-4" />
                  {phase === "transcribing" ? "Listening…" : "Speak"}
                </Button>
              )}
              {turn && <Button variant="ghost" size="lg" onClick={reset} disabled={busy}>Cancel</Button>}
            </div>
          </div>
        )}
        {notice && <Notice tone="warn" className="mt-3">{notice}</Notice>}
      </Card>

      <Card title="My advance requests" flush>
        {!overview ? (
          <EmptyState>Loading…</EmptyState>
        ) : overview.advances.length === 0 ? (
          <EmptyState>No requests yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {overview.advances.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 tabular-nums">{formatMoney(a.amount)} <span className="font-normal text-slate-500">· {a.reasonText}</span></p>
                    <p className="text-xs text-slate-500">{formatDateTime(a.createdAt)} UTC{a.recovered > 0 ? ` · ${formatMoney(a.recovered)} recovered from salary` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <AdvanceBadge status={a.status} payment={a.payment} />
                    {(a.status === "awaiting_approval" || a.status === "escalated") && <Button size="sm" variant="ghost" onClick={() => void withdraw(a.id)}>Withdraw</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === a.id ? null : a.id)} aria-expanded={openId === a.id}>{openId === a.id ? "Hide" : "Details"}</Button>
                  </div>
                </div>
                {a.message && <p className="mt-1.5 text-sm text-slate-700">{a.message}</p>}
                {a.payment === "failed" && a.paymentFailure && <p className="mt-1 text-xs text-rose-700">{a.paymentFailure}</p>}
                {a.paymentReference && a.payment === "completed" && <p className="mt-1 text-xs text-slate-500">Reference <span className="font-mono">{a.paymentReference}</span></p>}
                {openId === a.id && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">How it was worked out</p>
                      <p className="mb-2 text-sm text-slate-700">{a.explanation}</p>
                      <CalcTable calc={a.calc} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">What happened</p>
                      <Trail entries={a.trail} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
