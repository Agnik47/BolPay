import { rateLimit, readJson, respondWorker } from "@/app/lib/server/http";
import { myAdvanceState, ownRequest, submitAdvance } from "@/app/lib/server/advance-service";
import { runManagerAgent } from "@/app/lib/server/advance-agent";
import { ServiceError } from "@/app/lib/server/service";

/** GET: the signed-in worker's own advance limit and requests. Nothing about other workers. */
export async function GET() {
  return respondWorker(({ workerId }) => myAdvanceState(workerId));
}

/** POST: saves a request the worker has confirmed. Pays nothing and approves nothing. */
export async function POST(req: Request) {
  const body = await readJson(req).catch(() => null);
  return respondWorker(async ({ workerId, userId }) => {
    rateLimit(`advance-submit:${userId}`, 8, 10 * 60_000); // blocked attempts are saved too, so cap them
    if (!body) throw new ServiceError("Malformed JSON body");
    const s = (v: unknown, max = 600) => (typeof v === "string" ? v.slice(0, max) : "");
    const saved = submitAdvance(workerId, {
      idempotencyKey: s(body.idempotencyKey, 64),
      amount: typeof body.amount === "number" ? body.amount : NaN,
      reasonText: s(body.reasonText, 400),
      reasonCategory: s(body.reasonCategory, 40),
      language: s(body.language, 8),
      source: s(body.source, 8),
      transcript: s(body.transcript),
      confirmed: body.confirmed === true,
      recoveryAck: body.recoveryAck === true,
    });
    // Under an active delegation the Manager Agent looks at the new request now. It never blocks the worker's save.
    if (!saved.duplicate && saved.request.status === "pending_review") {
      await runManagerAgent(saved.request.id);
      return { request: ownRequest(workerId, saved.request.id), duplicate: false };
    }
    return saved;
  });
}
