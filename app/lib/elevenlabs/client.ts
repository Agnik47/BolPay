import "server-only";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * ElevenLabs speech, with the same function names and result shapes as app/lib/sarvam/client.ts so the two can be
 * swapped. app/lib/speech decides which one runs.
 */

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || "scribe_v3";
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_v4_turbo";
/** Used when ELEVENLABS_VOICE_ID is not set (the default voice of the earlier ElevenLabs integration). */
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const STT_TIMEOUT_S = 30;
const TTS_TIMEOUT_S = 20;

export class ElevenLabsSpeechError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ElevenLabsSpeechError";
    this.status = status;
  }
}

let cached: ElevenLabsClient | null = null;
function client(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new ElevenLabsSpeechError("ELEVENLABS_API_KEY is not set.", 0);
  return (cached ??= new ElevenLabsClient({ apiKey }));
}

/** SDK failures become one error type carrying the HTTP status (429 = rate limited), without request details. */
function toSpeechError(err: unknown, what: string): ElevenLabsSpeechError {
  if (err instanceof ElevenLabsSpeechError) return err;
  const e = err as { statusCode?: number; body?: { detail?: { status?: string; message?: string } | string } };
  const detail = e.body?.detail;
  const reason = typeof detail === "string" ? detail : (detail?.message ?? detail?.status);
  return new ElevenLabsSpeechError(`ElevenLabs ${what} failed${reason ? `: ${reason}` : "."}`, e.statusCode ?? 502);
}

// The app uses Sarvam-style codes such as "hi-IN"; ElevenLabs answers with ISO 639-3 ("hin") or 639-1 ("hi").
const INDIAN: Record<string, string> = {
  eng: "en", hin: "hi", ben: "bn", guj: "gu", kan: "kn", mal: "ml", mar: "mr", ori: "od", ory: "od", or: "od", pan: "pa", tam: "ta", tel: "te", urd: "ur",
};
function toLocale(code: string | undefined): string | null {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0];
  const two = INDIAN[base] ?? (Object.values(INDIAN).includes(base) ? base : null);
  return two ? `${two}-IN` : null;
}

/**
 * Speech to text. `hint` is a code the speaker chose (for example "bn-IN"); without one the language is detected.
 * Audio-event tags and speaker labels stay off, so nothing but spoken words can reach amount detection.
 */
export async function transcribeWithLanguage(audio: Blob, hint?: string | null): Promise<{ transcript: string; languageCode: string | null }> {
  const chosen = /^[a-z]{2,3}-IN$/.test(hint ?? "") ? (hint as string).split("-")[0] : undefined;
  try {
    const out = await client().speechToText.convert(
      { file: audio, modelId: STT_MODEL, languageCode: chosen === "od" ? "or" : chosen, tagAudioEvents: false, diarize: false },
      { timeoutInSeconds: STT_TIMEOUT_S, maxRetries: 1 },
    );
    if (!("text" in out) || typeof out.text !== "string") throw new ElevenLabsSpeechError("Unexpected transcription response.", 502);
    return { transcript: out.text.trim(), languageCode: toLocale(out.languageCode) };
  } catch (err) {
    throw toSpeechError(err, "transcription");
  }
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  return (await transcribeWithLanguage(audio)).transcript;
}

/** Text to speech. The model reads the language from the text itself. Returns a whole MP3 clip. */
export async function synthesizeSpeech(text: string): Promise<{ audio: Buffer; contentType: string }> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  if (!text.trim()) throw new ElevenLabsSpeechError("There is nothing to say.", 400);
  try {
    const stream = await client().textToSpeech.convert(
      voiceId,
      { text, modelId: TTS_MODEL, outputFormat: "mp3_44100_128" },
      { timeoutInSeconds: TTS_TIMEOUT_S, maxRetries: 1 },
    );
    const audio = Buffer.from(await new Response(stream).arrayBuffer());
    if (!audio.length) throw new ElevenLabsSpeechError("ElevenLabs returned no audio.", 502);
    return { audio, contentType: "audio/mpeg" };
  } catch (err) {
    throw toSpeechError(err, "speech");
  }
}
