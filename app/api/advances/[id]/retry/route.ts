import { OWNER, respond } from "@/app/lib/server/http";
import { retryAdvancePayment, staffAdvances } from "@/app/lib/server/advance-service";
import { actorFor } from "@/app/lib/server/advance-actor";

/** Owner only. Checks Cashfree about the earlier attempt first, so a transfer that went through is never paid twice. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(async () => {
    const r = await retryAdvancePayment(id, await actorFor(OWNER));
    return { advances: staffAdvances(), alreadyProcessed: r.alreadyProcessed };
  }, OWNER);
}
