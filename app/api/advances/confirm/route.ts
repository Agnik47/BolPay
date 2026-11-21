import { confirmRequest, workerOverview } from "@/app/lib/server/advances";
import { ServiceError } from "@/app/lib/server/service";
import { readJson, respondWorker } from "@/app/lib/server/http";

/**
 * POST { draftId: string }
 * The worker confirmed the read-back. The request runs through eligibility, the Manager Agent and, if approved
 * within delegated authority, the Payout Agent. The amount comes from the server-held draft, not from this body.
 */
export async function POST(req: Request) {
  return respondWorker(async ({ worker }) => {
    const b = await readJson(req);
    if (typeof b.draftId !== "string") throw new ServiceError("Missing draftId");
    const result = await confirmRequest(worker, b.draftId.slice(0, 40));
    return { ...result, ...workerOverview(worker) };
  });
}
