import { respondWorker, rateLimit } from "@/app/lib/server/http";
import { ServiceError } from "@/app/lib/server/service";
import { speechStatus, sttConfigured, sttName, transcribeWithLanguage } from "@/app/lib/speech";

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // a clip under 30 seconds is far smaller

/**
 * POST multipart { audio, language? }: turns a recording into the worker's own words, in the language they spoke.
 * Nothing is stored, and the audio is dropped as soon as the speech service has answered. `language` is a BCP-47 code the worker
 * picked (for example "bn-IN"); without one it is detected. ElevenLabs unless SPEECH_STT=sarvam.
 */
export async function POST(req: Request) {
  let audio: Blob | null = null;
  let language: string | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof Blob) audio = f;
    const l = form.get("language");
    if (typeof l === "string") language = l;
  } catch {
    /* handled below */
  }
  return respondWorker(async ({ userId }) => {
    rateLimit(`advance-transcribe:${userId}`, 12, 10 * 60_000);
    if (!audio || audio.size === 0) throw new ServiceError("We didn't receive any audio. Please try again.");
    if (audio.size > MAX_AUDIO_BYTES) throw new ServiceError("That recording is too long. Keep it under 30 seconds.", 413);
    if (!sttConfigured()) throw new ServiceError("Voice isn't available right now. Please type your request.", 503);
    try {
      const { transcript, languageCode } = await transcribeWithLanguage(audio, language);
      if (!transcript.trim()) throw new ServiceError("We couldn't hear anything. Please speak closer to the phone and try again.", 422);
      return { transcript: transcript.trim(), languageCode };
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      console.error(`advance transcription failed (${sttName()})`, err instanceof Error ? err.message : err);
      throw new ServiceError(speechStatus(err) === 429 ? "Voice is busy. Try again in a moment." : "We couldn't read that recording. Please try again or type your request.", 502);
    }
  });
}
