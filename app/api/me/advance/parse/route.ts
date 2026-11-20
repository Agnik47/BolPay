import { respondWorker, rateLimit, readJson } from "@/app/lib/server/http";
import { previewAdvance } from "@/app/lib/server/advance-service";
import { ServiceError } from "@/app/lib/server/service";

/**
 * POST { text, languageCode?, source? }: understands a worker's request (translation to English, amount, reason).
 * Saves nothing: the worker confirms the interpreted details before anything is stored. `text` is what was typed,
 * or what /api/me/advance/transcribe heard. Rate limited per worker because every call costs a translation and a
 * language-model request.
 */
export async function POST(req: Request) {
  const body = await readJson(req).catch(() => null);
  return respondWorker(async ({ workerId, userId }) => {
    rateLimit(`advance-parse:${userId}`, 20, 10 * 60_000);
    if (!body || typeof body.text !== "string") throw new ServiceError("Say or type what you need.");
    const languageCode = typeof body.languageCode === "string" && /^[a-z]{2,3}(-IN)?$/.test(body.languageCode) ? body.languageCode : null;
    return { ...(await previewAdvance(workerId, body.text, { languageCode })), source: body.source === "voice" ? "voice" : "text" };
  });
}
