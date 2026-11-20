import { respondWorker, rateLimit } from "@/app/lib/server/http";
import { previewAdvance } from "@/app/lib/server/advance-service";
import { ServiceError } from "@/app/lib/server/service";
import { SarvamError, transcribeAudio } from "@/app/lib/sarvam/client";

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // a clip under 30 seconds is far smaller

/**
 * POST: understand a worker's request. Accepts JSON { text } or multipart audio. Saves nothing: the worker
 * confirms the interpreted amount and reason before anything is stored. Rate limited per worker because
 * every call costs a speech and a language-model request.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let text = "";
  let audio: Blob | null = null;
  try {
    if (contentType.includes("multipart/form-data")) {
      const f = (await req.formData()).get("audio");
      if (f instanceof Blob) audio = f;
    } else {
      const b = (await req.json()) as { text?: unknown };
      if (typeof b.text === "string") text = b.text;
    }
  } catch {
    /* handled below */
  }

  return respondWorker(async ({ workerId, userId }) => {
    rateLimit(`advance-parse:${userId}`, 12, 10 * 60_000);
    let source: "voice" | "text" = "text";
    if (audio) {
      if (audio.size === 0) throw new ServiceError("Missing audio.");
      if (audio.size > MAX_AUDIO_BYTES) throw new ServiceError("That recording is too long. Keep it under 30 seconds.", 413);
      if (!process.env.SARVAM_API_KEY) throw new ServiceError("Voice isn't available right now. Please type your request.", 503);
      try {
        text = (await transcribeAudio(audio)).trim();
      } catch (err) {
        console.error("advance transcription failed", err instanceof Error ? err.message : err);
        throw new ServiceError(err instanceof SarvamError && err.status === 429 ? "Voice is busy. Try again in a moment." : "We couldn't read that recording. Please try again or type your request.", 502);
      }
      source = "voice";
      if (!text) throw new ServiceError("We couldn't hear anything. Please try again or type your request.", 422);
    }
    return { ...(await previewAdvance(workerId, text)), source };
  });
}
