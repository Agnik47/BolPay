import { readJson, respond, STAFF } from "@/app/lib/server/http";
import { recommendAdvance, staffAdvances } from "@/app/lib/server/advance-service";
import { actorFor } from "@/app/lib/server/advance-actor";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(async () => {
    const body = await readJson(req);
    recommendAdvance(id, await actorFor(STAFF), body.verdict, body.note);
    return { advances: staffAdvances() };
  }, STAFF);
}
