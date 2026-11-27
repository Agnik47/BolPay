"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Snapshot } from "@/app/lib/merchant/store";
import type { TurnView } from "@/app/lib/voice/types";
import { IconClose, IconMic } from "../icons";
import { api, JSON_HEADERS, LANG_KEY, LANGS, PICKER } from "./advance-shared";
import { playWithLevel, useMicRecorder } from "./useVoiceAudio";
import { VoiceBackdrop } from "./VoiceBackdrop";
import type { OrbState } from "./VoiceOrb";
import { VoiceWave } from "./VoiceWave";

type Role = "owner" | "supervisor" | "worker";

interface Props {
  role: Role;
  userName: string;
  onClose: () => void;
  /** Staff only: the latest company data after a turn, so the screens behind this one refresh. */
  onSnapshot?: (snapshot: Snapshot) => void;
}

interface Message {
  id: number;
  who: "you" | "ai";
  text: string;
  /** ISO 639-1 code, when known: sets the right script and font. */
  lang?: string;
}

type Phase = "idle" | "transcribing" | "thinking" | "error";

const SUGGESTIONS: Record<Role, string[]> = {
  owner: ["Who is absent today?", "How much do I need to pay my workers?", "How many payments failed?"],
  supervisor: ["Who is absent today?", "Show today's attendance", "What can you do?"],
  worker: ["How much will I receive today?", "Show my available advance limit", "What can you do?"],
};

const SPEAK_LIMIT: Record<Role, number> = { owner: 380, supervisor: 380, worker: 290 }; // the voice routes cap the text they will read
const MUTE_KEY = "bolpay.voiceReplies";

const firstName = (n: string) => n.replace(/\s*\((owner|supervisor|worker)\)\s*$/i, "").trim().split(/\s+/)[0] || "there";

/** The part of a reply that fits the text-to-speech limit, cut at a sentence end. The full reply stays on screen. */
function spokenPart(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("। "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > 40 ? cut.slice(0, end + 1) : cut).trim();
}

const readLanguage = () => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved && PICKER.some((l) => l.code === saved) ? saved : "auto";
  } catch {
    return "auto";
  }
};

const readMuted = () => {
  try { return localStorage.getItem(MUTE_KEY) === "off"; } catch { return false; }
};

/**
 * The full-screen BolPay Voice AI. One screen for every role, talking to the same conversation pipeline
 * (/api/voice/turn) as the typed panel: what you say is transcribed, understood, answered from real data and, for
 * anything that changes something, held for your confirmation. The orb moves with the real microphone and with the
 * reply audio as it plays (amplitude, not lip-sync).
 */
export function AssistantStage({ role, userName, onClose, onSnapshot }: Props) {
  const router = useRouter();
  const levelRef = useRef(0);
  const worker = role === "worker";
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [view, setView] = useState<TurnView | null>(null);
  const [error, setError] = useState("");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [language, setLanguage] = useState(readLanguage);
  const [muted, setMuted] = useState(readMuted);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const playback = useRef<ReturnType<typeof playWithLevel> | null>(null);
  const sessionId = useRef<string | null>(null);
  const nextId = useRef(1);
  const dialog = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const languageRef = useRef(language);
  const mutedRef = useRef(muted);
  useEffect(() => { languageRef.current = language; mutedRef.current = muted; }, [language, muted]);

  const key = `bolpay.assistant.session.${role}`;
  const add = (m: Omit<Message, "id">) => setMessages((all) => [...all.slice(-11), { ...m, id: nextId.current++ }]);

  const speechSeq = useRef(0);
  const stopSpeaking = useCallback(() => {
    speechSeq.current += 1; // a reply still being fetched must not start playing later
    playback.current?.stop();
    playback.current = null;
    setSpeaking(false);
  }, []);

  /** Reads a reply aloud with Sarvam. Failures never block: the reply is already on screen. */
  const speak = useCallback(async (text: string, lang: string) => {
    if (mutedRef.current || !text.trim()) return;
    stopSpeaking();
    const seq = speechSeq.current;
    try {
      const url = worker ? "/api/me/advance/speak" : "/api/voice-output";
      const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: spokenPart(text, SPEAK_LIMIT[role]), language: lang }), signal: abort.current?.signal });
      if (!res.ok || !alive.current) return; // 422 means no voice for this language: text only
      const clip = await res.blob();
      if (seq !== speechSeq.current || !alive.current) return;
      const objectUrl = URL.createObjectURL(clip);
      const p = playWithLevel(objectUrl, levelRef);
      playback.current = p;
      setSpeaking(true);
      await p.done.catch(() => {});
      URL.revokeObjectURL(objectUrl);
    } catch { /* text only */ } finally {
      if (alive.current) setSpeaking(false);
    }
  }, [role, stopSpeaking, worker]);

  /** One conversational turn. Everything (intent, permissions, data, confirmation) happens on the server. */
  const turn = useCallback(async (body: { text?: string; action?: "confirm" | "cancel" }) => {
    setPhase("thinking");
    setError("");
    abort.current = new AbortController();
    const r = await api<TurnView & { snapshot?: Snapshot }>("/api/voice/turn", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: sessionId.current, ...body }), signal: abort.current.signal });
    if (!alive.current) return;
    if (!r.ok) {
      if (r.error === "aborted") return;
      setPhase("error");
      setError(r.error);
      return;
    }
    const v = r.data;
    sessionId.current = v.sessionId;
    try { sessionStorage.setItem(key, v.sessionId); } catch { /* the session still works for this screen */ }
    if (v.snapshot && onSnapshot) onSnapshot(v.snapshot);
    setView(v);
    add({ who: "ai", text: v.speech, lang: v.language });
    setPhase(v.outcome === "error" ? "error" : "idle");
    if (v.outcome === "error") setError(v.speech);
    await speak(v.speech, v.language);
    if (v.navigate && alive.current) router.push(v.navigate);
  }, [key, onSnapshot, router, speak]);

  const send = useCallback((text: string, lang?: string) => {
    const t = text.trim();
    if (!t) return;
    add({ who: "you", text: t, lang });
    void turn({ text: t });
  }, [turn]);

  /** Speech to text in the language that was spoken, then the same turn as typed text. */
  const onRecorded = useCallback(async (clip: Blob) => {
    setPhase("transcribing");
    setError("");
    abort.current = new AbortController();
    const form = new FormData();
    form.append("audio", clip, "speech.webm");
    if (worker && languageRef.current !== "auto") form.append("language", languageRef.current);
    const r = worker
      ? await api<{ transcript: string; languageCode: string | null }>("/api/me/advance/transcribe", { method: "POST", body: form, signal: abort.current.signal })
      : await api<{ text: string }>("/api/voice-input", { method: "POST", body: form, signal: abort.current.signal });
    if (!alive.current) return;
    if (!r.ok) {
      if (r.error === "aborted") return;
      setPhase("error");
      return setError(r.error);
    }
    const words = "transcript" in r.data ? r.data.transcript : r.data.text;
    const code = "languageCode" in r.data ? r.data.languageCode?.split("-")[0] : undefined;
    if (!words.trim()) {
      setPhase("error");
      return setError("I couldn't hear anything. Please speak closer to the microphone and try again.");
    }
    send(words, code);
  }, [send, worker]);

  const mic = useMicRecorder({ levelRef, onRecorded: (clip) => void onRecorded(clip), onError: (m) => { setPhase("error"); setError(m); } });
  const recording = mic.state === "recording";
  const busy = phase === "transcribing" || phase === "thinking";
  const orb: OrbState = recording ? "listening" : phase === "transcribing" ? "processing" : phase === "thinking" ? "translating" : speaking ? "speaking" : phase === "error" ? "error" : "idle";

  useEffect(() => {
    alive.current = true;
    try {
      sessionId.current = sessionStorage.getItem(key);
    } catch { /* fresh conversation */ }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { alive.current = false; abort.current?.abort(); speechSeq.current += 1; playback.current?.stop(); document.body.style.overflow = prev; };
  }, [key]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, view]);

  function close() { mic.cancel(); stopSpeaking(); onClose(); }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function pickLanguage(code: string) {
    setLanguage(code);
    setLangOpen(false);
    try { localStorage.setItem(LANG_KEY, code); } catch { /* per-device convenience */ }
  }
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try { localStorage.setItem(MUTE_KEY, next ? "off" : "on"); } catch { /* ignore */ }
    if (next) stopSpeaking();
  }
  function newConversation() {
    stopSpeaking();
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    if (sessionId.current) void fetch("/api/voice/turn", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: sessionId.current, reset: true }) }).catch(() => {});
    sessionId.current = null;
    setMessages([]);
    setView(null);
    setError("");
    setPhase("idle");
  }

  const confirming = view?.awaiting === "confirm" && phase === "idle";
  const secs = Math.floor(mic.elapsed / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const heading = recording ? "Listening…" : phase === "transcribing" ? "Understanding your request…" : phase === "thinking" ? "Working on it…" : speaking ? "BolPay is responding…" : confirming ? (view?.checkpoint ? "Please confirm the payment" : "Waiting for your confirmation") : phase === "error" ? "" : "How can I help you?";
  const sub = recording ? `${clock} · Tap the button when you are done` : phase === "idle" && !speaking && !confirming && messages.length === 0 ? `Hi ${firstName(userName)}. Ask me about ${worker ? "your pay and advances" : "workers, attendance, pay and payments"} in your own language.` : "";
  const pickLabel = PICKER.find((l) => l.code === language)?.label ?? "Auto";

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="BolPay Voice AI" className="fixed inset-0 z-[70] flex flex-col overflow-y-auto overflow-x-hidden bg-[#04161a] text-white outline-none">
      <VoiceBackdrop />

      <header className="relative flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <button type="button" onClick={close} aria-label="Close voice screen" className="flex size-10 items-center justify-center rounded-full text-[#a9dad2] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#65e6d2]"><IconClose className="size-5" /></button>
        <p className="text-sm font-semibold tracking-wide text-white/90">BolPay Voice AI</p>
        <div className="relative flex items-center gap-1">
          <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Turn spoken replies on" : "Turn spoken replies off"} className="flex h-10 items-center rounded-full px-3 text-xs font-medium text-[#a9dad2] hover:bg-white/10 hover:text-white">{muted ? "Voice off" : "Voice on"}</button>
          {worker && (
            <button type="button" onClick={() => setLangOpen((o) => !o)} disabled={recording || busy} aria-haspopup="listbox" aria-expanded={langOpen} aria-label={`Language: ${pickLabel}. Change`} className="flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-medium text-[#a9dad2] hover:bg-white/10 hover:text-white disabled:opacity-40">{pickLabel}</button>
          )}
          {langOpen && (
            <ul role="listbox" aria-label="Language you will speak" className="absolute right-0 top-11 z-10 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#071f25]/95 py-1 shadow-2xl backdrop-blur">
              {PICKER.map((l) => (
                <li key={l.code} role="option" aria-selected={language === l.code}>
                  <button type="button" onClick={() => pickLanguage(l.code)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/10 ${language === l.code ? "text-[#65e6d2]" : "text-white/85"}`}><span>{l.label}</span><span className="text-xs text-[#a9dad2]">{l.name}</span></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="relative mt-2 px-6 text-center" aria-live="polite">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#00bfa5]">{worker ? "Your assistant" : "Workforce assistant"}</p>
        {phase === "error" && error ? <p role="alert" className="mx-auto mt-2 max-w-md text-lg font-medium leading-snug text-white">{error}</p> : <h2 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{heading}</h2>}
        {sub && <p className="mt-1 text-sm text-[#a9dad2]">{sub}</p>}
      </div>

      <div className="relative min-h-[8rem] flex-1">
        <VoiceWave state={orb} levelRef={levelRef} className="absolute inset-0 size-full" />
        {recording && <span className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur"><span className="size-2 animate-pulse rounded-full bg-rose-500" />Recording</span>}
      </div>

      {/* Conversation: your words exactly as heard, and the replies */}
      <div ref={scroller} className="relative mx-auto max-h-[30vh] w-full max-w-xl space-y-2 overflow-y-auto px-5 pb-2" aria-label="Conversation">
        {messages.length === 0 && !recording && phase === "idle" && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {SUGGESTIONS[role].map((s) => <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-[#a9dad2] transition-colors hover:border-[#65e6d2] hover:text-white">{s}</button>)}
          </div>
        )}
        {messages.map((m) => (
          <p key={m.id} lang={m.lang} className={`animate-[voice-fade-in_0.4s_ease-out] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${m.who === "you" ? "ml-10 bg-white/10 text-right text-white" : "mr-10 bg-[#008577]/25 text-white"}`}>
            {m.text}
            {m.who === "ai" && m.lang && m.lang !== "en" && <span className="mt-0.5 block text-[11px] text-[#a9dad2]">{LANGS[m.lang] ?? m.lang}</span>}
          </p>
        ))}
        {recording && <p className="text-center text-sm italic text-[#a9dad2]">Your words appear here after you stop.</p>}
      </div>

      {/* Plan waiting for your confirmation: exactly what will happen, never run until you confirm */}
      {confirming && view && (
        <div className={`relative mx-auto mb-2 w-full max-w-xl rounded-2xl border px-4 py-3 ${view.checkpoint ? "border-amber-300/50 bg-amber-300/10" : "border-white/15 bg-white/5"}`} role="group" aria-label="Confirm">
          <ul className="max-h-[22vh] space-y-1 overflow-y-auto text-sm text-white/90">
            {view.lines.length ? view.lines.map((l) => <li key={l}>{l}</li>) : view.steps.map((st, i) => <li key={i}>{st.summary}</li>)}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void turn({ action: "confirm" })} className="h-10 flex-1 rounded-full bg-[#00bfa5] text-sm font-semibold text-[#04161a] disabled:opacity-40">{view.checkpoint ? "Confirm and send" : "Confirm"}</button>
            <button type="button" disabled={busy} onClick={() => void turn({ action: "cancel" })} className="h-10 flex-1 rounded-full border border-white/25 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-40">Cancel</button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[#a9dad2]">You can also say “confirm” or “cancel”.</p>
        </div>
      )}

      {typing && (
        <form className="relative mx-auto mb-3 flex w-full max-w-xl gap-2 px-4" onSubmit={(e) => { e.preventDefault(); if (typed.trim() && !busy) { send(typed); setTyped(""); } }}>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={600} placeholder="Type your message" aria-label="Type your message" className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 text-base text-white placeholder:text-white/40 focus:border-[#65e6d2] focus:outline-none" />
          <button type="submit" disabled={!typed.trim() || busy} className="h-11 rounded-xl bg-[#00bfa5] px-4 text-sm font-semibold text-[#04161a] disabled:opacity-40">Send</button>
        </form>
      )}

      {phase === "error" && (
        <div className="relative mb-2 flex flex-wrap justify-center gap-2 px-4">
          <button type="button" onClick={() => { setPhase("idle"); setError(""); }} className="h-10 rounded-full bg-[#00bfa5] px-5 text-sm font-semibold text-[#04161a]">Try again</button>
          <button type="button" onClick={() => { setPhase("idle"); setError(""); setTyping(true); }} className="h-10 rounded-full border border-white/20 px-5 text-sm font-medium text-white hover:bg-white/10">Type instead</button>
        </div>
      )}

      <footer className="relative flex items-center justify-center gap-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-1">
        <button type="button" onClick={recording ? mic.cancel : newConversation} aria-label={recording ? "Cancel recording" : "Start a new conversation"} title={recording ? "Cancel" : "New conversation"} className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#65e6d2]">
          {recording ? <IconClose className="size-5" /> : <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4" /></svg>}
        </button>
        <div className="relative flex size-24 items-center justify-center">
          {recording && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[#00bfa5]/30" />}
          <button type="button" data-sound="off" onClick={recording ? mic.stop : () => { stopSpeaking(); setPhase("idle"); setError(""); setTyping(false); void mic.start(); }} disabled={busy || mic.state === "requesting"} aria-label={recording ? "Stop recording" : "Start recording"}
            className={`relative flex size-20 items-center justify-center rounded-full text-white shadow-[0_0_40px_-4px_#00bfa5] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#65e6d2] disabled:opacity-40 disabled:shadow-none ${recording ? "bg-rose-600 hover:bg-rose-700" : "bg-[#008577] hover:bg-[#006b62]"}`}>
            {busy || mic.state === "requesting" ? <span className="size-7 animate-spin rounded-full border-[3px] border-white/30 border-t-white" /> : recording ? <span className="size-6 rounded-md bg-white" /> : <IconMic className="size-9" />}
          </button>
        </div>
        <button type="button" onClick={() => { if (recording) mic.cancel(); setTyping((t) => !t); }} disabled={busy} aria-label="Type instead" aria-pressed={typing} className={`flex size-12 items-center justify-center rounded-full text-white transition-colors focus-visible:outline-2 focus-visible:outline-[#65e6d2] disabled:opacity-40 ${typing ? "bg-[#008577]" : "bg-white/10 hover:bg-white/20"}`}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2.5" y="6.5" width="19" height="11" rx="2" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" /></svg>
        </button>
      </footer>
    </div>
  );
}
