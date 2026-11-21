import { takeTurn } from "@/app/lib/agents/worker-agent";
import { ServiceError } from "@/app/lib/server/service";
import { readJson, respondWorker } from "@/app/lib/server/http";

/**
 * POST { text: string, draftId?: string }
 * The Worker Assistance Agent reads what the worker said (a transcript from /api/voice-input, or typed text).
 * It answers with a question when a detail is missing, or a read-back to confirm. Nothing is submitted yet.
 */
export async function POST(req: Request) {
  return respondWorker(async ({ worker }) => {
    const b = await readJson(req);
    if (typeof b.text !== "string") throw new ServiceError("Say or type what you need.");
    const draftId = typeof b.draftId === "string" ? b.draftId.slice(0, 40) : undefined;
    return { turn: await takeTurn(worker.id, b.text, draftId) };
  });
}
