"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

export type MicState = "idle" | "requesting" | "recording";
export const MAX_RECORDING_MS = 28_000;

/** Turns a getUserMedia failure into something a worker can act on. */
function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow the microphone in your browser settings and try again, or type your request.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device. You can type your request instead.";
  if (name === "NotReadableError" || name === "AbortError") return "Another app is using the microphone. Close it and try again, or type your request.";
  return "We couldn't start the microphone. Please try again or type your request.";
}

const AudioCtx = () => (typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext));

/**
 * Records from the real microphone. While recording it writes the live loudness (0 to 1, from an analyser on the
 * actual stream) into `levelRef`, which the orb reads every frame without re-rendering React. Cancel drops the clip.
 * Tracks, the analyser and the timers are released when recording stops or the component unmounts.
 */
export function useMicRecorder({ levelRef, onRecorded, onError }: {
  levelRef: MutableRefObject<number>;
  onRecorded: (clip: Blob, ms: number) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<MicState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const stateRef = useRef<MicState>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);
  const raf = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef({ onRecorded, onError });
  useEffect(() => { cb.current = { onRecorded, onError }; });

  const set = (s: MicState) => { stateRef.current = s; setState(s); };

  const release = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (tick.current) clearInterval(tick.current);
    if (limit.current) clearTimeout(limit.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    levelRef.current = 0;
  }, [levelRef]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    };
  }, [release]);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return; // one recording at a time
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return cb.current.onError("Recording isn't supported in this browser. Please type your request.");
    set("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      if (!alive.current) return;
      set("idle");
      return cb.current.onError(micError(err));
    }
    // The screen was closed while the permission prompt was open: turn the microphone straight off.
    if (!alive.current) return release();
    chunks.current = [];
    cancelled.current = false;
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onerror = () => { release(); set("idle"); cb.current.onError("The recording was interrupted. Please try again."); };
    rec.onstop = () => {
      const ms = Date.now() - started.current;
      const clip = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      release();
      set("idle");
      if (cancelled.current) return;
      if (ms < 700 || clip.size < 800) return cb.current.onError("That was too short to hear. Tap the microphone and speak for a few seconds.");
      cb.current.onRecorded(clip, ms);
    };
    recorder.current = rec;

    try {
      const Ctx = AudioCtx();
      if (Ctx) {
        const c = new Ctx();
        ctx.current = c;
        const analyser = c.createAnalyser();
        analyser.fftSize = 1024;
        c.createMediaStreamSource(stream.current).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const raw = Math.min(1, Math.sqrt(sum / buf.length) * 5);
          levelRef.current = levelRef.current * 0.6 + raw * 0.4;
          raf.current = requestAnimationFrame(loop);
        };
        loop();
      }
    } catch { /* recording still works; the orb just won't react to loudness */ }

    started.current = Date.now();
    setElapsed(0);
    rec.start();
    set("recording");
    tick.current = setInterval(() => setElapsed(Date.now() - started.current), 200);
    limit.current = setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), MAX_RECORDING_MS);
  }, [levelRef, release]);

  const stop = useCallback(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
  const cancel = useCallback(() => { cancelled.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
  return { state, elapsed, start, stop, cancel };
}

/**
 * Plays an audio URL through an analyser so `levelRef` follows the real loudness of the sound being played
 * (Sarvam's Bulbul voice). This is amplitude-reactive animation, not lip-sync. Resolves when playback ends.
 */
export function playWithLevel(url: string, levelRef: MutableRefObject<number>): { done: Promise<void>; stop: () => void } {
  const audio = new Audio(url);
  let raf = 0;
  let c: AudioContext | null = null;
  const finish = () => { cancelAnimationFrame(raf); levelRef.current = 0; void c?.close().catch(() => {}); c = null; };
  let settle = () => {};
  const done = new Promise<void>((resolve, reject) => {
    settle = resolve;
    audio.onended = () => { finish(); resolve(); };
    audio.onerror = () => { finish(); reject(new Error("playback")); };
    try {
      const Ctx = AudioCtx();
      if (Ctx) {
        c = new Ctx();
        const analyser = c.createAnalyser();
        analyser.fftSize = 1024;
        const src = c.createMediaElementSource(audio);
        src.connect(analyser);
        analyser.connect(c.destination);
        const buf = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          levelRef.current = levelRef.current * 0.6 + Math.min(1, Math.sqrt(sum / buf.length) * 4) * 0.4;
          raf = requestAnimationFrame(loop);
        };
        loop();
      }
    } catch { /* plays without the analyser */ }
    void audio.play().catch((e) => { finish(); reject(e); });
  });
  // Stopping also settles `done`: a paused clip never fires "ended", so callers would never free its URL.
  return { done, stop: () => { audio.pause(); finish(); settle(); } };
}
