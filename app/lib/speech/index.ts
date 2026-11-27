import "server-only";
import * as elevenLabs from "@/app/lib/elevenlabs/client";
import * as sarvam from "@/app/lib/sarvam/client";

/**
 * Speech routing. SPEECH_STT picks who listens and SPEECH_TTS who speaks:
 * "sarvam" runs Sarvam, anything else (or unset) runs ElevenLabs. Translation always uses Sarvam.
 */
export { UnsupportedSpeechLanguageError } from "@/app/lib/sarvam/client";

const isSarvam = (setting: string | undefined) => setting?.trim().toLowerCase() === "sarvam";
const stt = () => (isSarvam(process.env.SPEECH_STT) ? sarvam : elevenLabs);
const tts = () => (isSarvam(process.env.SPEECH_TTS) ? sarvam : elevenLabs);

export const sttName = () => (stt() === sarvam ? "Sarvam" : "ElevenLabs");
export const ttsName = () => (tts() === sarvam ? "Sarvam" : "ElevenLabs");

export const sttConfigured = () => Boolean(stt() === sarvam ? process.env.SARVAM_API_KEY : process.env.ELEVENLABS_API_KEY);
export const ttsConfigured = () => Boolean(tts() === sarvam ? process.env.SARVAM_API_KEY : process.env.ELEVENLABS_API_KEY);

export const transcribeWithLanguage = (audio: Blob, hint?: string | null) => stt().transcribeWithLanguage(audio, hint);

/** `hint` is the planner's language code; Sarvam needs it, ElevenLabs reads the language from the text. */
export const synthesizeSpeech = (text: string, hint?: string | null) => tts().synthesizeSpeech(text, hint);

/** The HTTP status a provider failed with (429 = busy, 400 = unreadable input), or 0 for anything else. */
export const speechStatus = (err: unknown) =>
  err instanceof sarvam.SarvamError || err instanceof elevenLabs.ElevenLabsSpeechError ? err.status : 0;
