"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore, type Snapshot } from "@/app/lib/merchant/store";
import { playSound } from "@/app/lib/client/sounds";
import { IconClose, IconMic } from "../icons";
import { useSpeaker } from "./useSpeaker";
import { LazyAssistantStage } from "../Lazy";
import { useViewer } from "./viewer";

type Phase = "idle" | "recording" | "transcribing";
type StepStatus = "pending" | "done" | "skipped" | "failed" | "not_run";

interface StepView {
  action: string;
  summary: string;
  risk: "read" | "write" | "money";
  status: StepStatus;
  message?: string;
}

interface TurnView {
  sessionId: string;
  state: "idle" | "clarifying" | "confirming";
  outcome: string;
  speech: string;
  lines: string[];
  steps: StepView[];
  awaiting: "reply" | "confirm" | null;
  navigate?: string;
  checkpoint?: boolean;
  language?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

const STORAGE_KEY = "bolpay.voice.session";
const MAX_MESSAGES = 30;
// Sarvam's speech-to-text is meant for clips under about 30 seconds, so the recorder stops itself just before.
const MAX_RECORDING_MS = 28_000;

const STARTERS = ["Mark everyone present today", "Who is missing attendance today?", "How many payments failed?"];

/** Everything the assistant can do, as phrases to tap. Tapping one puts it in the text box so it can be edited. */
const HELP: { title: string; ownerOnly?: boolean; items: { say: string; ownerOnly?: boolean }[] }[] = [
  {
    title: "Attendance and work",
    items: [
      { say: "Mark everyone present today" },
      { say: "Mark everyone present except Ravi" },
      { say: "Ravi worked 3 hours overtime today" },
      { say: "Ravi completed 25 deliveries today" },
    ],
  },
  {
    title: "Pay",
    items: [
      { say: "Calculate pay for Bengaluru riders with at least 20 deliveries" },
      { say: "Approve all pending payouts", ownerOnly: true },
      { say: "Reject Ravi's payout", ownerOnly: true },
      { say: "Approve Ravi's advance", ownerOnly: true },
      { say: "Reject Ravi's advance", ownerOnly: true },
      { say: "Retry failed payments", ownerOnly: true },
      { say: "Refresh payment status", ownerOnly: true },
    ],
  },
  {
    title: "People and rules",
    ownerOnly: true,
    items: [
      { say: "Add a worker named Anita in Pune, 900 a day" },
      { say: "Change Ravi's daily wage to 900" },
      { say: "Set overtime to 1.5 times" },
      { say: "Add a tier: 30 deliveries pays 150 rupees" },
    ],
  },
  {
    title: "Ask a question",
    items: [
      { say: "Who is missing attendance today?" },
      { say: "How many are present today?" },
      { say: "How many payments failed?" },
      { say: "Who are the top 3 earners?" },
      { say: "What are the current rules?" },
    ],
  },
  { title: "Go to a screen", items: [{ say: "Open the payouts page" }, { say: "Show me the workers" }] },
];

const TIPS = [
  "Speak in any language, or type.",
  "Chain steps in one sentence: mark attendance, then calculate pay.",
  "Anything that moves money shows the exact amounts and waits for your confirmation.",
  "Say or tap cancel at any time.",
];

const STATUS_LABEL: Record<StepStatus, string> = { pending: "Waiting", done: "Done", skipped: "Skipped", failed: "Failed", not_run: "Not run" };
const STATUS_TONE: Record<StepStatus, string> = { pending: "text-slate-500", done: "text-emerald-700", skipped: "text-slate-400", failed: "text-rose-700", not_run: "text-slate-400" };

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

async function transcribe(body: FormData): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/voice-input", { method: "POST", body });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (res.ok && typeof data.text === "string") return { ok: true, text: data.text };
    return { ok: false, error: `${data.error ?? "Transcription failed."} Type the command instead.` };
  } catch {
    return { ok: false, error: "Could not reach the server. Type the command instead." };
  }
}

function loadSaved(): { sessionId: string | null; messages: Message[]; view: TurnView | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { sessionId: null, messages: [], view: null };
}

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function IconSend({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

function IconHelp({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 17.25a7.25 7.25 0 100-14.5 7.25 7.25 0 000 14.5zM7.9 7.9a2.2 2.2 0 014.2.8c0 1.5-2.1 1.7-2.1 3.1M10 14v.01" />
    </svg>
  );
}

export function VoiceAssistant() {
  const router = useRouter();
  const store = useStore();
  const speaker = useSpeaker();
  const { isOwner, displayName, role } = useViewer();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [view, setView] = useState<TurnView | null>(null);
  // Saving to sessionStorage waits until the saved session has been read back (React runs effects twice in dev).
  const hydrated = useRef(false);
  const sessionId = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const meter = useRef<{ raf: number; ctx: AudioContext } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const stopStream = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    if (meter.current) {
      cancelAnimationFrame(meter.current.raf);
      void meter.current.ctx.close().catch(() => {});
      meter.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  // Leaving while recording must not transcribe and run the command afterwards.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        rec.ondataavailable = null;
        if (rec.state === "recording") rec.stop();
      }
      stopStream();
    };
  }, []);

  // Closing the panel cancels a recording in progress: the microphone goes off and nothing is sent.
  const micSession = useRef(0);
  useEffect(() => {
    if (!open) return;
    return () => {
      micSession.current += 1; // also catches a permission prompt that is still open
      const rec = recorder.current;
      if (rec?.state !== "recording") return;
      rec.onstop = null;
      rec.ondataavailable = null;
      rec.stop();
      stopStream();
      setPhase("idle");
      setLevel(0);
    };
  }, [open]);

  // Restore the conversation after a reload: the pending question or plan lives on the server.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved.sessionId) {
      hydrated.current = true;
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    void fetch(`/api/voice/turn?sessionId=${encodeURIComponent(saved.sessionId)}`, { signal: ctl.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          sessionId.current = saved.sessionId;
          setMessages(saved.messages);
          setView((await res.json()) as TurnView);
        } else sessionStorage.removeItem(STORAGE_KEY);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) hydrated.current = true;
      });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: sessionId.current, messages, view }));
    } catch {
      /* ignore */
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, view, thinking]);

  const send = useCallback(
    async (input: { text?: string; action?: "confirm" | "cancel" }, shown?: string) => {
      const label = shown ?? input.text ?? (input.action === "confirm" ? "Confirm" : "Cancel");
      setNotice(null);
      setText("");
      setShowHelp(false);
      setMessages((m) => [...m, { role: "user" as const, text: label }].slice(-MAX_MESSAGES));
      setThinking(true);
      try {
        await store.flush(); // queued attendance edits must reach the server before a flow runs
        const res = await fetch("/api/voice/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId.current, ...input }),
        });
        const data = (await res.json().catch(() => ({}))) as TurnView & { snapshot?: Snapshot; error?: string };
        if (!res.ok || !data.sessionId) {
          playSound("error");
          setNotice(data.error ?? "The assistant is unavailable. Your conversation is kept; try again.");
          return;
        }
        sessionId.current = data.sessionId;
        if (data.snapshot) store.applySnapshot(data.snapshot);
        setView(data);
        setMessages((m) => [...m, { role: "assistant" as const, text: data.speech }].slice(-MAX_MESSAGES));
        // A money checkpoint always gets the attention tone; otherwise a blip only when replies aren't spoken.
        if (data.awaiting === "confirm" && data.checkpoint) playSound("attention");
        else if (data.steps?.some((s) => s.status === "failed")) playSound("error");
        else if (!speaker.enabled) playSound("notify");
        if (data.navigate) router.push(data.navigate);
        setThinking(false); // controls are usable while the reply is being fetched and spoken
        const outcome = await speaker.speak(data.speech, { language: data.language });
        if (outcome === "blocked") setNotice("Turn on “Reply aloud” to hear replies.");
        else if (outcome === "unsupported") setNotice("Spoken replies aren't available in this language yet. The reply is shown as text.");
      } catch {
        playSound("error");
        setNotice("Could not reach the assistant. Your conversation is kept; try again.");
      } finally {
        setThinking(false);
      }
    },
    [store, router, speaker],
  );

  async function startRecording() {
    speaker.stop(); // don't let the mic pick up the assistant's own voice
    setNotice(null);
    setShowHelp(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Recording isn't supported in this browser. Type the command instead.");
      return;
    }
    const session = micSession.current;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || session !== micSession.current) return mic.getTracks().forEach((t) => t.stop()); // closed while the permission prompt was open
      stream.current = mic;
    } catch {
      setNotice("Microphone access was blocked. Allow it in your browser, or type the command.");
      return;
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      stopStream();
      setLevel(0);
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      setPhase("transcribing");
      const body = new FormData();
      body.append("audio", blob, "command.webm");
      const res = await transcribe(body);
      if (!alive.current) return;
      setPhase("idle");
      if (!res.ok) {
        playSound("error");
        setNotice(res.error);
      } else if (!res.text.trim()) setNotice("I didn't catch that. Try again, a little closer to the microphone.");
      else void send({ text: res.text.trim() });
    };
    recorder.current = rec;
    playSound("micOn");
    rec.start();
    setPhase("recording");
    setElapsed(0);
    tick.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    // A live level, so you can see the microphone is hearing you.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream.current).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const m = { raf: 0, ctx };
      const loop = () => {
        analyser.getByteFrequencyData(data);
        setLevel(Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 70));
        m.raf = requestAnimationFrame(loop);
      };
      m.raf = requestAnimationFrame(loop);
      meter.current = m;
    } catch {
      /* no level meter: recording still works */
    }
    stopTimer.current = setTimeout(() => {
      if (recorder.current?.state === "recording") stopRecording(); // the clip so far is transcribed as usual
    }, MAX_RECORDING_MS);
  }

  function stopRecording() {
    recorder.current?.stop();
    playSound("micOff");
  }

  async function newConversation() {
    speaker.stop();
    const id = sessionId.current;
    sessionId.current = null;
    setMessages([]);
    setView(null);
    setNotice(null);
    setShowHelp(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      if (id) await fetch("/api/voice/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id, reset: true }) });
    } catch {
      /* the server drops idle sessions on its own */
    }
  }

  function pickExample(say: string) {
    setText(say);
    setShowHelp(false);
    setTimeout(() => field.current?.focus(), 0);
  }

  const busy = phase === "transcribing" || thinking;
  const awaiting = view?.awaiting ?? null;
  const working = phase === "recording" || busy;
  const status =
    phase === "recording"
      ? { text: "Listening…", tone: "text-rose-700" }
      : phase === "transcribing"
        ? { text: "Transcribing…", tone: "text-slate-500" }
        : thinking
          ? { text: "Working on it…", tone: "text-slate-500" }
          : awaiting === "confirm"
            ? { text: "Waiting for your confirmation", tone: "text-amber-800" }
            : awaiting === "reply"
              ? { text: "Waiting for your answer", tone: "text-teal-800" }
              : { text: "Ready. Any language.", tone: "text-slate-500" };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {stage && <LazyAssistantStage role={role} userName={displayName} onClose={() => setStage(false)} onSnapshot={store.applySnapshot} />}
      {open && (
        <div
          role="dialog"
          aria-label="Voice assistant"
          onKeyDown={(e) => e.key === "Escape" && phase !== "recording" && setOpen(false)}
          className="flex h-[min(82vh,42rem)] w-[min(calc(100vw-2rem),24rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.25)] max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:h-dvh max-sm:w-full max-sm:rounded-none max-sm:border-0 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pt-[env(safe-area-inset-top)]"
        >
          {/* header: who, what state, and the two things you may need at any time */}
          <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Voice assistant</h2>
              <p role="status" className={`mt-0.5 flex items-center gap-1.5 text-xs ${status.tone}`}>
                {working && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
                {status.text}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => { setOpen(false); setStage(true); }} className={`flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-2.5 text-xs font-medium text-white ${FOCUS}`} title="Full-screen voice mode">
                <IconMic className="size-4" />
                Voice mode
              </button>
              <button onClick={() => setShowHelp((h) => !h)} aria-pressed={showHelp} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${FOCUS} ${showHelp ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700"}`}>
                <IconHelp className="size-4" />
                Help
              </button>
              <button onClick={() => setOpen(false)} className={`flex size-8 items-center justify-center rounded-md text-slate-500 ${FOCUS}`} aria-label="Close assistant">
                <IconClose className="size-4" />
              </button>
            </div>
          </div>

          {/* settings row: replies aloud, and start over */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
            <button role="switch" aria-checked={speaker.enabled} onClick={() => speaker.setEnabled(!speaker.enabled)} className={`flex items-center gap-2 rounded text-xs text-slate-700 ${FOCUS}`}>
              <span aria-hidden className={`relative h-4 w-7 shrink-0 rounded-full ${speaker.enabled ? "bg-teal-700" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 size-3 rounded-full bg-white ${speaker.enabled ? "left-3.5" : "left-0.5"}`} />
              </span>
              Reply aloud
            </button>
            {messages.length > 0 && (
              <button onClick={() => void newConversation()} className={`rounded px-1.5 py-0.5 text-xs font-medium text-slate-600 underline underline-offset-2 ${FOCUS}`}>
                New conversation
              </button>
            )}
          </div>

          {/* body */}
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role={showHelp ? undefined : "log"} aria-live={showHelp ? undefined : "polite"}>
            {showHelp ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-900">What you can say</h3>
                <p className="mt-0.5 text-xs text-slate-500">Tap a phrase to put it in the box, change the names, then send.</p>
                <ul className="mt-3 space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                  {TIPS.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-400" />
                      {t}
                    </li>
                  ))}
                </ul>
                {HELP.filter((g) => isOwner || !g.ownerOnly).map((g) => (
                  <section key={g.title} className="mt-4">
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h4>
                    <ul className="divide-y divide-slate-100 border-y border-slate-100">
                      {g.items
                        .filter((i) => isOwner || !i.ownerOnly)
                        .map((i) => (
                          <li key={i.say}>
                            <button onClick={() => pickExample(i.say)} className={`flex w-full items-center justify-between gap-3 py-2 text-left text-sm text-slate-800 ${FOCUS}`}>
                              <span>{i.say}</span>
                              <IconSend className="size-4 shrink-0 text-slate-400" />
                            </button>
                          </li>
                        ))}
                    </ul>
                  </section>
                ))}
                {!isOwner && <p className="mt-4 text-xs text-slate-500">Approving payouts, editing workers and changing pay rules are for the owner.</p>}
              </div>
            ) : messages.length === 0 ? (
              <div>
                <h3 className="text-base font-semibold text-slate-900">How can I help?</h3>
                <p className="mt-1 text-sm text-slate-500">Tap the microphone and say it, or type below. I can chain several steps in one sentence.</p>
                <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                  {STARTERS.map((s) => (
                    <li key={s}>
                      <button disabled={busy} onClick={() => void send({ text: s })} className={`flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm text-slate-800 disabled:opacity-50 ${FOCUS}`}>
                        <span>{s}</span>
                        <IconSend className="size-4 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button onClick={() => setShowHelp(true)} className={`mt-4 flex items-center gap-1.5 rounded text-sm font-medium text-teal-800 underline underline-offset-2 ${FOCUS}`}>
                  <IconHelp className="size-4" />
                  See everything I can do
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <p className={`max-w-[88%] whitespace-pre-line rounded-lg px-3 py-2 text-sm leading-snug ${m.role === "user" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-800"}`}>{m.text}</p>
                  </div>
                ))}
                {thinking && (
                  <div className="flex justify-start" role="status" aria-label="Working on it">
                    <span className="flex gap-1 rounded-lg bg-slate-100 px-3 py-3">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="size-1.5 animate-pulse rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* controls */}
          <div className="border-t border-slate-200 px-4 py-3">
            {view && view.steps.length > 0 && (awaiting !== null || view.steps.some((s) => s.risk !== "read")) && (
              <div className={`mb-3 max-h-40 overflow-y-auto rounded-md border ${view.checkpoint ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                <p className={`border-b px-3 py-1.5 text-xs font-semibold ${view.checkpoint ? "border-amber-200 text-amber-900" : "border-slate-200 text-slate-600"}`}>
                  {view.checkpoint ? "Payment needs your confirmation" : "Plan"}
                </p>
                <ol className="space-y-1.5 px-3 py-2 text-xs" aria-label="Plan steps">
                  {view.steps.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-3 shrink-0 text-right tabular-nums text-slate-400">{i + 1}</span>
                      <span className={`min-w-0 flex-1 ${s.risk === "money" ? "font-medium text-amber-900" : "text-slate-700"}`}>
                        {s.summary}
                        {s.message && <span className="block font-normal text-slate-500">{s.message}</span>}
                      </span>
                      <span className={`shrink-0 font-medium ${STATUS_TONE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {awaiting === "confirm" && (
              <div className="mb-3">
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={() => void send({ action: "confirm" })} className={`h-10 rounded-md bg-teal-700 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400 ${FOCUS}`}>
                    {view?.checkpoint ? "Confirm and send" : "Confirm"}
                  </button>
                  <button disabled={busy} onClick={() => void send({ action: "cancel" })} className={`h-10 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:text-slate-400 ${FOCUS}`}>
                    Cancel
                  </button>
                </div>
                <p className="mt-1.5 text-center text-xs text-slate-500">or say “confirm” or “cancel”</p>
              </div>
            )}

            {phase === "recording" ? (
              <button data-sound="off" onClick={stopRecording} className={`flex h-12 w-full items-center justify-between gap-3 rounded-md bg-rose-700 px-4 text-sm font-semibold text-white ${FOCUS}`}>
                <span className="flex h-6 w-6 items-center gap-0.5" aria-hidden>
                  {[0.55, 0.9, 0.7, 1, 0.6].map((k, i) => (
                    <span key={i} className="w-1 rounded-full bg-white" style={{ height: `${6 + Math.round(level * k * 18)}px` }} />
                  ))}
                </span>
                <span>Listening · tap to stop</span>
                <span className="tabular-nums text-rose-100">{fmtTime(elapsed)}</span>
              </button>
            ) : (
              <button
                data-sound="off"
                onClick={startRecording}
                disabled={busy}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400 ${FOCUS}`}
              >
                <IconMic className="size-5" />
                {phase === "transcribing" ? "Transcribing…" : awaiting === "reply" ? "Tap and answer" : awaiting === "confirm" ? "Tap and say confirm or cancel" : "Tap and speak"}
              </button>
            )}

            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) void send({ text: text.trim() });
              }}
            >
              <input
                ref={field}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={awaiting === "reply" ? "Or type your answer" : "Or type a command"}
                aria-label="Command text"
                disabled={busy || phase === "recording"}
                className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <button type="submit" disabled={busy || phase === "recording" || !text.trim()} aria-label="Send" className={`flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white disabled:bg-slate-200 disabled:text-slate-400 ${FOCUS}`}>
                <IconSend className="size-4" />
              </button>
            </form>
            {notice && (
              <p role="status" className="mt-2 text-xs text-amber-800">
                {notice}
              </p>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close voice assistant" : "Open voice assistant"}
        aria-expanded={open}
        className={`${open ? "max-sm:hidden" : ""} relative flex size-12 items-center justify-center rounded-full bg-teal-700 text-white shadow-[0_6px_16px_-6px_rgba(15,23,42,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700`}
      >
        {!open && awaiting && <span className="absolute -right-0.5 -top-0.5 size-3 animate-pulse rounded-full bg-amber-400 ring-2 ring-white" aria-label="Waiting for your reply" />}
        {open ? <IconClose className="size-5" /> : <IconMic className="size-5" />}
      </button>
    </div>
  );
}
