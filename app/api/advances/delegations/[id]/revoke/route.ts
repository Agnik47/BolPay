import { OWNER, respond } from "@/app/lib/server/http";
import { delegationState, revokeDelegation } from "@/app/lib/server/advance-agent";
import { actorFor } from "@/app/lib/server/advance-actor";

/** Owner only, effective immediately: the agent checks the delegation at the moment it decides. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(async () => {
    revokeDelegation(await actorFor(OWNER), id);
    return delegationState();
  }, OWNER);
}
