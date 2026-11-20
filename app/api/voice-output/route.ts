import { connection, NextResponse } from "next/server";
import { SarvamError, synthesizeSpeech, UnsupportedSpeechLanguageError } from "@/app/lib/sarvam/client";
import { guard, STAFF } from "@/app/lib/server/http";

const MAX_CHARS = 400;

/**
 * POST /api/voice-output  { text: string, language?: string }  ->  audio (WAV)
 * Reads a short assistant reply aloud with Sarvam text-to-speech. `language` is the planner's ISO code
 * and only a hint: the script of the text decides. 422 means there is no voice for the language (Urdu):
 * the reply is shown as text only.
 * Callers should only send reply text, never recipient details (emails, bank info).
 */
export async function POST(req: Request) {
  const denied = await guard(STAFF);
  if (denied) return denied;
  await connection();
  if (!process.env.SARVAM_API_KEY) {
    return NextResponse.json({ error: "Text-to-speech is not configured." }, { status: 503 });
  }

  let text = "";
  let language: string | null = null;
  try {
    const body = (await req.json()) as { text?: unknown; language?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
    language = typeof body.language === "string" ? body.language.slice(0, 12) : null;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `Replies are limited to ${MAX_CHARS} characters.` }, { status: 413 });

  try {
    const { audio, contentType } = await synthesizeSpeech(text, language);
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UnsupportedSpeechLanguageError) {
      return NextResponse.json({ error: "Spoken replies aren't available in this language." }, { status: 422 });
    }
    console.error("Sarvam TTS failed", err instanceof Error ? err.message : err);
    if (err instanceof SarvamError && err.status === 429) {
      return NextResponse.json({ error: "Text-to-speech is busy." }, { status: 429 });
    }
    return NextResponse.json({ error: "Could not generate speech." }, { status: 502 });
  }
}
