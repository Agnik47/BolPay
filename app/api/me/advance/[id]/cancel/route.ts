import { respondWorker } from "@/app/lib/server/http";
import { cancelAdvance } from "@/app/lib/server/advance-service";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respondWorker(({ workerId }) => cancelAdvance(workerId, id));
}
