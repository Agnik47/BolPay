import { cancelOwnRequest, workerOverview } from "@/app/lib/server/advances";
import { respondWorker } from "@/app/lib/server/http";

/** POST: the worker withdraws one of their own requests that is still waiting for a decision. */
export async function POST(_req: Request, ctx: RouteContext<"/api/advances/[id]/cancel">) {
  const { id } = await ctx.params;
  return respondWorker(({ worker }) => {
    cancelOwnRequest(worker, id);
    return { ...workerOverview(worker) };
  });
}
