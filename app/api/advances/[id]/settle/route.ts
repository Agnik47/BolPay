import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { settleAdvance, staffAdvances } from "@/app/lib/server/advance-service";
import { actorFor } from "@/app/lib/server/advance-actor";

/** Owner only. Records a repayment made outside payroll, or writes off what is left. Audited; moves no money. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(async () => {
    settleAdvance(id, await actorFor(OWNER), await readJson(req));
    return { advances: staffAdvances() };
  }, OWNER);
}
