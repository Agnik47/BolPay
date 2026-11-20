"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconClose, IconMic } from "../icons";
import { api, JSON_HEADERS, LANGS, PICKER, type Preview } from "./advance-shared";
import { playWithLevel, useMicRecorder } from "./useVoiceAudio";
import { VoiceOrb, type OrbState } from "./VoiceOrb";

interface Props {
  /** "listen" captures a request; "respond" only speaks a reply the server has already saved. */
  mode: "listen" | "respond";
  workerName: string;
  language: string;
  onLanguage: (code: string) => void;
  respond?: { text: string; language: string };
  /** The request was understood. The card shows its light review screen next. */
  onResult: (preview: Preview, clip: Blob | null) => void;
  onClose: () => void;
}

const HEADLINE: Record<OrbState, [string, string]> = {
  idle: ["How can I help you?", "Tell me what happened in your own language."],
  listening: ["Listening…", ""],
  processing: ["Understanding your request…", "Transcribing what you said"],
  translating: ["Translating your message…", "Your original words are kept"],
  speaking: ["BolPay is responding…", ""],
  error: ["", ""],
};

/** Contour lines for the background: deterministic, so server and client render the same thing. */
function contourPaths() {
  return Array.from({ length: 16 }, (_, i) => {
    const y0 = 40 + i * 52;
    let d = "";
    for (let x = 0; x <= 1240; x += 40) {
      const y = y0 + Math.sin(x / 140 + i * 0.7) * 20 + Math.sin(x / 61 + i * 1.3) * 7;
      d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)} `;
    }
    return d;
  });
}

const iso = (code: string | null | undefined) => (code ?? "").split("-")[0].toLowerCase();

export function VoiceStage({ mode, workerName, language, onLanguage, respond, onResult, onClose }: Props) {
  const levelRef = useRef(0);
  const [orb, setOrb] = useState<OrbState>(mode === "respond" ? "processing" : "idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [detected, setDetected] = useState("");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [retry, setRetry] = useState<{ words: string; code: string | null; source: "voice" | "text"; clip: Blob | null } | null>(null);
  const [finished, setFinished] = useState(false);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const paths = useMemo(contourPaths, []);
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);

  const fail = (message: string, again: typeof retry = null) => { setOrb("error"); setError(message); setRetry(again); };

  /** Step 2: translate to English and read out the amount, reason and urgency. */
  async function understand(words: string, code: string | null, source: "voice" | "text", clip: Blob | null) {
    setOrb("translating");
    setError("");
    abort.current = new AbortController();
    const r = await api<Preview>("/api/me/advance/parse", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: words, languageCode: code, source }), signal: abort.current.signal });
    if (!alive.current) return;
    if (!r.ok) return fail(r.error, { words, code, source, clip });
    onResult(r.data, clip);
  }

  /** Step 1: speech to text, in the language that was spoken. Sarvam returns the whole transcript once the recording ends. */
  async function onRecorded(clip: Blob) {
    setOrb("processing");
    setError("");
    setTranscript("");
    abort.current = new AbortController();
    const form = new FormData();
    form.append("audio", clip, "request.webm");
    if (languageRef.current !== "auto") form.append("language", languageRef.current);
    const r = await api<{ transcript: string; languageCode: string | null }>("/api/me/advance/transcribe", { method: "POST", body: form, signal: abort.current.signal });
    if (!alive.current) return;
    if (!r.ok) return fail(r.error);
    setTranscript(r.data.transcript);
    setDetected(iso(r.data.languageCode));
    await understand(r.data.transcript, r.data.languageCode ?? (languageRef.current !== "auto" ? languageRef.current : null), "voice", clip);
  }

  const mic = useMicRecorder({ levelRef, onRecorded: (clip) => void onRecorded(clip), onError: (m) => fail(m) });
  const recording = mic.state === "recording";
  const busy = orb === "processing" || orb === "translating";
  const state: OrbState = recording ? "listening" : orb;

  useEffect(() => {
    alive.current = true;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { alive.current = false; abort.current?.abort(); document.body.style.overflow = prevOverflow; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Respond mode: speak the saved-request confirmation with the real Sarvam Bulbul audio.
  useEffect(() => {
    if (mode !== "respond" || !respond) return;
    const ctl = new AbortController();
    let playback: ReturnType<typeof playWithLevel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const res = await fetch("/api/me/advance/speak", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: respond.text, language: respond.language }), signal: ctl.signal });
        if (!res.ok) throw new Error("tts");
        const url = URL.createObjectURL(await res.blob());
        if (ctl.signal.aborted) return URL.revokeObjectURL(url);
        playback = playWithLevel(url, levelRef);
        setOrb("speaking");
        await playback.done.finally(() => URL.revokeObjectURL(url));
      } catch {
        if (ctl.signal.aborted) return;
        // No voice for this language, or playback was blocked: the written confirmation below still stands.
      }
      if (ctl.signal.aborted) return;
      setOrb("idle");
      setFinished(true);
      timer = setTimeout(onClose, 2200);
    })();
    return () => { ctl.abort(); playback?.stop(); if (timer) clearTimeout(timer); };
    // Runs once per mount; the parent remounts the stage for a new reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() { mic.cancel(); onClose(); }
  function reset() { setError(""); setRetry(null); setOrb("idle"); setTranscript(""); setDetected(""); }

  function sendTyped() {
    const words = typed.trim();
    if (!words || busy) return;
    setTranscript(words);
    setDetected(iso(languageRef.current !== "auto" ? languageRef.current : ""));
    setTyped("");
    setTyping(false);
    void understand(words, languageRef.current !== "auto" ? languageRef.current : null, "text", null);
  }

  const secs = Math.floor(mic.elapsed / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const [headline, sub] = mode === "respond" ? [finished ? "Request submitted" : "BolPay is responding…", ""] : recording ? HEADLINE.listening : HEADLINE[state];
  const pickLabel = PICKER.find((l) => l.code === language)?.label ?? "Auto";
  const transcriptLang = detected || iso(respond?.language);
  const shownText = mode === "respond" ? respond?.text ?? "" : transcript;

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="BolPay Voice AI" className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-voice-950 text-white outline-none">
      {/* Backdrop: soft radial light and slowly drifting contour lines */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,var(--color-voice-800)_0%,var(--color-voice-900)_48%,var(--color-voice-950)_100%)]" />
      <svg aria-hidden viewBox="0 0 1240 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full animate-[voice-drift_46s_ease-in-out_infinite] text-voice-bright opacity-[0.1]">
        {paths.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.45 + (i % 4) * 0.15} />)}
      </svg>

      {/* Top bar */}
      <header className="relative flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <button type="button" onClick={close} aria-label="Close voice screen" className="flex size-10 items-center justify-center rounded-full text-voice-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-voice-cyan">
          <IconClose className="size-5" />
        </button>
        <p className="text-sm font-semibold tracking-wide text-white/90">BolPay Voice AI</p>
        <div className="relative">
          {mode === "listen" ? (
            <button type="button" onClick={() => setLangOpen((o) => !o)} disabled={recording || busy} aria-haspopup="listbox" aria-expanded={langOpen} aria-label={`Language: ${pickLabel}. Change`}
              className="flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-medium text-voice-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-voice-cyan">
              {pickLabel}
            </button>
          ) : <span className="block size-10" />}
          {langOpen && (
            <ul role="listbox" aria-label="Language you will speak" className="absolute right-0 top-11 z-10 w-52 overflow-hidden rounded-xl border border-white/10 bg-voice-900/95 py-1 shadow-2xl backdrop-blur">
              {PICKER.map((l) => (
                <li key={l.code} role="option" aria-selected={language === l.code}>
                  <button type="button" onClick={() => { onLanguage(l.code); setLangOpen(false); }} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/10 ${language === l.code ? "text-voice-cyan" : "text-white/85"}`}>
                    <span>{l.label}</span><span className="text-xs text-voice-muted">{l.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {/* Headline */}
      <div className="relative mt-3 px-6 text-center" aria-live="polite">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-voice-bright">Emergency advance</p>
        {state === "error" ? (
          <p role="alert" className="mx-auto mt-2 max-w-md text-lg font-medium leading-snug text-white">{error}</p>
        ) : (
          <>
            <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">{headline}</h2>
            <p className="mt-1 text-sm text-voice-muted">
              {recording ? `${clock} · Tap the button when you are done` : mode === "listen" && state === "idle" ? `Hi ${workerName}. ${sub}` : sub}
            </p>
          </>
        )}
      </div>

      {/* Orb */}
      <div className="relative min-h-0 flex-1">
        <VoiceOrb state={state} levelRef={levelRef} className="absolute inset-0 size-full" />
        {recording && <span className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur"><span className="size-2 animate-pulse rounded-full bg-rose-500" />Recording</span>}
      </div>

      {/* Transcript: only what was actually heard. Sarvam returns it once the recording ends, so nothing is shown while you speak. */}
      <div className="relative mx-auto min-h-[5.5rem] w-full max-w-xl px-6 pb-3 text-center">
        {shownText ? (
          <>
            <p key={shownText} lang={transcriptLang || undefined} className="max-h-28 animate-[voice-fade-in_0.5s_ease-out] overflow-y-auto text-lg leading-relaxed text-white sm:text-xl">{shownText}</p>
            {mode === "listen" && transcriptLang && <p className="mt-1.5 text-xs text-voice-muted">Detected language: {LANGS[transcriptLang] ?? transcriptLang}</p>}
          </>
        ) : recording ? (
          <p className="text-sm italic text-voice-muted">Your words appear here after you stop.</p>
        ) : null}
        {finished && <p className="mt-2 text-sm font-medium text-voice-cyan">Done.</p>}
      </div>

      {/* Typed fallback */}
      {typing && mode === "listen" && (
        <form className="relative mx-auto mb-3 flex w-full max-w-xl gap-2 px-4" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={600} placeholder="Type what happened, e.g. I need ₹2,000 to repair my bike" aria-label="Type your request"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 text-base text-white placeholder:text-white/40 focus:border-voice-cyan focus:outline-none" />
          <button type="submit" disabled={!typed.trim() || busy} className="h-11 rounded-xl bg-voice-bright px-4 text-sm font-semibold text-voice-950 disabled:opacity-40">Send</button>
        </form>
      )}

      {/* Error actions */}
      {state === "error" && mode === "listen" && (
        <div className="relative mb-3 flex flex-wrap justify-center gap-2 px-4">
          {retry ? <button type="button" onClick={() => { const r = retry; setRetry(null); void understand(r.words, r.code, r.source, r.clip); }} className="h-10 rounded-full bg-voice-bright px-5 text-sm font-semibold text-voice-950">Try again</button>
            : <button type="button" onClick={reset} className="h-10 rounded-full bg-voice-bright px-5 text-sm font-semibold text-voice-950">Speak again</button>}
          <button type="button" onClick={() => { reset(); setTyping(true); }} className="h-10 rounded-full border border-white/20 px-5 text-sm font-medium text-white hover:bg-white/10">Type instead</button>
        </div>
      )}
      {state === "error" && mode === "respond" && <div className="relative mb-3 flex justify-center"><button type="button" onClick={onClose} className="h-10 rounded-full bg-voice-bright px-5 text-sm font-semibold text-voice-950">Close</button></div>}

      {/* Controls */}
      {mode === "listen" ? (
        <footer className="relative flex items-center justify-center gap-8 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-1">
          <button type="button" onClick={recording ? mic.cancel : close} aria-label={recording ? "Cancel recording" : "Close"} className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-voice-cyan">
            <IconClose className="size-5" />
          </button>
          <div className="relative flex size-24 items-center justify-center">
            {recording && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-voice-bright/30" />}
            <button type="button" data-sound="off" onClick={recording ? mic.stop : () => { reset(); setTyping(false); void mic.start(); }} disabled={busy || mic.state === "requesting"}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={`relative flex size-20 items-center justify-center rounded-full text-white shadow-[0_0_40px_-4px_var(--color-voice-bright)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-voice-cyan disabled:opacity-40 disabled:shadow-none ${recording ? "bg-rose-600 hover:bg-rose-700" : "bg-voice-teal hover:bg-voice-deep"}`}>
              {busy || mic.state === "requesting" ? <span className="size-7 animate-spin rounded-full border-[3px] border-white/30 border-t-white" /> : recording ? <span className="size-6 rounded-md bg-white" /> : <IconMic className="size-9" />}
            </button>
          </div>
          <button type="button" onClick={() => { if (recording) mic.cancel(); setTyping((t) => !t); }} disabled={busy} aria-label="Type instead" aria-pressed={typing} className={`flex size-12 items-center justify-center rounded-full text-white transition-colors focus-visible:outline-2 focus-visible:outline-voice-cyan disabled:opacity-40 ${typing ? "bg-voice-teal" : "bg-white/10 hover:bg-white/20"}`}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2.5" y="6.5" width="19" height="11" rx="2" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" /></svg>
          </button>
        </footer>
      ) : (
        <footer className="relative flex justify-center pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-1">
          <button type="button" onClick={onClose} className="h-11 rounded-full border border-white/20 px-6 text-sm font-medium text-white hover:bg-white/10">Close</button>
        </footer>
      )}
    </div>
  );
}
