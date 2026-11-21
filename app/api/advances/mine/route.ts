import { respondWorker } from "@/app/lib/server/http";
import { sweepRelayStalls, workerOverview } from "@/app/lib/server/advances";
import { syncTransactions } from "@/app/lib/server/service";

/** GET: the signed-in worker's own advance limit and requests. Nothing about anyone else. */
export async function GET() {
  return respondWorker(async ({ worker }) => {
    // The owner may not have a screen open, so a worker looking at their own payment settles it.
    await sweepRelayStalls();
    await syncTransactions((t) => t.kind === "advance" && t.workerId === worker.id && Date.now() - Date.parse(t.createdAt) > 5000);
    return { ...workerOverview(worker) };
  });
}
