import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { rejectAdvance, staffAdvances } from "@/app/lib/server/advance-service";
import { actorFor } from "@/app/lib/server/advance-actor";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(async () => {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    rejectAdvance(id, await actorFor(OWNER), body.note);
    return { advances: staffAdvances() };
  }, OWNER);
}
