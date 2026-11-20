import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { approveAdvance, staffAdvances } from "@/app/lib/server/advance-service";
import { actorFor } from "@/app/lib/server/advance-actor";

/** Owner only. Approving requests the Cashfree transfer; it does not mean the money has arrived. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(async () => {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    await approveAdvance(id, await actorFor(OWNER), body);
    return { advances: staffAdvances() };
  }, OWNER);
}
