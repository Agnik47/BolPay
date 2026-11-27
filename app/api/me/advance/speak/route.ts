import { connection, NextResponse } from "next/server";
import { speechStatus, synthesizeSpeech, ttsConfigured, UnsupportedSpeechLanguageError } from "@/app/lib/speech";
import { guard, rateLimit, requireApiRole } from "@/app/lib/server/http";
import { ServiceError } from "@/app/lib/server/service";

const MAX_CHARS = 300;

/** POST { text, language }: reads the worker's confirmation back to them. Workers only; the text is server-generated read-back, never worker details. */
export async function POST(req: Request) {
  const denied = await guard(["worker"]);
  if (denied) return denied;
  await connection();
  if (!ttsConfigured()) return NextResponse.json({ error: "Text-to-speech is not configured." }, { status: 503 });
  try {
    const session = await requireApiRole(["worker"]);
    rateLimit(`advance-speak:${session.userId}`, 20, 10 * 60_000);
    const body = (await req.json()) as { text?: unknown; language?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
    if (text.length > MAX_CHARS) return NextResponse.json({ error: "Too long." }, { status: 413 });
    const language = typeof body.language === "string" ? body.language.slice(0, 12) : null;
    const { audio, contentType } = await synthesizeSpeech(text, language);
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof UnsupportedSpeechLanguageError) return NextResponse.json({ error: "Spoken replies aren't available in this language." }, { status: 422 });
    if (speechStatus(err) === 429) return NextResponse.json({ error: "Text-to-speech is busy." }, { status: 429 });
    console.error("advance speak failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not generate speech." }, { status: 502 });
  }
}
