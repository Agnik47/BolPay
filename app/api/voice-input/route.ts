import { NextResponse } from "next/server";
import { SarvamError, transcribeAudio } from "@/app/lib/sarvam/client";
import { guard, SPEAKERS } from "@/app/lib/server/http";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/voice-input
 * Accepts either:
 *  - multipart/form-data with an `audio` file field, or
 *  - JSON `{ audio: "<base64>", mimeType?: "audio/webm" }`
 * Returns `{ text }`. Sarvam's REST speech-to-text is meant for clips under about 30 seconds.
 */
export async function POST(req: Request) {
  const denied = await guard(SPEAKERS);
  if (denied) return denied;
  if (!process.env.SARVAM_API_KEY) {
    return NextResponse.json({ error: "Speech-to-text is not configured." }, { status: 503 });
  }

  let audio: Blob | null = null;
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const file = (await req.formData()).get("audio");
      if (file instanceof Blob) audio = file;
    } else {
      const body = (await req.json()) as { audio?: unknown; mimeType?: unknown };
      if (typeof body.audio === "string" && body.audio) {
        const mime = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
        audio = new Blob([Buffer.from(body.audio, "base64")], { type: mime });
      }
    }
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!audio || audio.size === 0) {
    return NextResponse.json({ error: "Missing audio." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "Audio is too large (max 10 MB)." }, { status: 413 });
  }

  try {
    const text = (await transcribeAudio(audio)).trim();
    return NextResponse.json({ text });
  } catch (err) {
    console.error("voice-input transcription failed", err instanceof Error ? err.message : err);
    if (err instanceof SarvamError && err.status === 429) {
      return NextResponse.json({ error: "Speech-to-text is busy. Try again in a moment." }, { status: 429 });
    }
    if (err instanceof SarvamError && err.status === 400) {
      return NextResponse.json({ error: "That recording couldn't be read. Keep commands under 30 seconds." }, { status: 422 });
    }
    return NextResponse.json({ error: "Transcription failed." }, { status: 502 });
  }
}
