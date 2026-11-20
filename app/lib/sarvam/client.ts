import "server-only";
import { pickSpeechLanguage, prepareForSpeech } from "./languages";

const BASE_URL = "https://api.sarvam.ai";
const STT_MODEL = process.env.SARVAM_STT_MODEL || "saaras:v4";
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3";
const TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || "shubh";

const STT_TIMEOUT_MS = 20_000;
const TTS_TIMEOUT_MS = 15_000;

/** A failed Sarvam call. `status` is Sarvam's HTTP status (0 when it never answered). */
export class SarvamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SarvamError";
  }
}

/** The reply is in a language Sarvam has no voice for (for example Urdu). Callers show text only. */
export class UnsupportedSpeechLanguageError extends Error {
  constructor() {
    super("Sarvam has no voice for this language.");
    this.name = "UnsupportedSpeechLanguageError";
  }
}

/** One call with a timeout and a single polite retry when Sarvam is rate-limiting or briefly down. */
async function call(path: string, init: () => RequestInit, timeoutMs: number): Promise<unknown> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new SarvamError("SARVAM_API_KEY is not set.", 0);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      const { headers, ...rest } = init();
      res = await fetch(`${BASE_URL}${path}`, {
        ...rest,
        headers: { ...(headers as Record<string, string>), "api-subscription-key": key },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new SarvamError(timedOut ? "Sarvam timed out." : "Could not reach Sarvam.", 0);
    }
    if (res.ok) return res.json();
    if (attempt === 0 && (res.status === 429 || res.status === 503)) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new SarvamError(body?.error?.message ?? `Sarvam returned HTTP ${res.status}.`, res.status);
  }
}

/** Sarvam sniffs the container itself; MediaRecorder's "audio/webm;codecs=opus" is safer without the parameter. */
function audioFile(audio: Blob): { blob: Blob; name: string } {
  const mime = (audio.type || "audio/webm").split(";")[0].trim().toLowerCase();
  const ext: Record<string, string> = {
    "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/flac": "flac",
  };
  return { blob: new Blob([audio], { type: mime }), name: `command.${ext[mime] ?? "webm"}` };
}

/**
 * Transcribes a short recorded clip (the voice command box). The spoken language is auto-detected.
 * Sarvam's REST endpoint is meant for clips under about 30 seconds; the recorder stops itself before that.
 */
export async function transcribeAudio(audio: Blob): Promise<string> {
  const { blob, name } = audioFile(audio);
  const out = (await call(
    "/speech-to-text",
    () => {
      const form = new FormData();
      form.append("file", blob, name);
      form.append("model", STT_MODEL);
      form.append("language_code", "unknown");
      return { method: "POST", body: form };
    },
    STT_TIMEOUT_MS,
  )) as { transcript?: unknown };
  if (typeof out.transcript !== "string") throw new SarvamError("Unexpected transcription response.", 502);
  return out.transcript;
}

/** Container of the bytes Sarvam returned. The docs promise WAV (the default codec); the header check keeps this honest. */
function sniffContentType(b: Buffer): string {
  const head = b.subarray(0, 4).toString("latin1");
  if (head === "RIFF") return "audio/wav";
  if (head === "OggS") return "audio/ogg";
  if (head === "fLaC") return "audio/flac";
  if (head.startsWith("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return "audio/wav";
}

/**
 * Speaks a short reply. Sarvam has no language auto-detect, so the language comes from the text itself
 * (`hint` is the planner's language). Throws UnsupportedSpeechLanguageError when there is no voice for it.
 */
export async function synthesizeSpeech(text: string, hint?: string | null): Promise<{ audio: Buffer; contentType: string }> {
  const language = pickSpeechLanguage(text, hint);
  if (!language) throw new UnsupportedSpeechLanguageError();
  const out = (await call(
    "/text-to-speech",
    () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: prepareForSpeech(text),
        language_code: language,
        model: TTS_MODEL,
        speaker: TTS_SPEAKER,
      }),
    }),
    TTS_TIMEOUT_MS,
  )) as { audios?: unknown };
  const parts = Array.isArray(out.audios) ? out.audios.filter((a): a is string => typeof a === "string" && a.length > 0) : [];
  if (parts.length === 0) throw new SarvamError("Sarvam returned no audio.", 502);
  // Replies are far below Sarvam's per-request limit, so this is one clip. Each part is a full file: never join the base64.
  const audio = Buffer.concat(parts.map((p) => Buffer.from(p, "base64")));
  return { audio, contentType: sniffContentType(audio) };
}
