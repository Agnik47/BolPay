import { ownerDecide, ownerOverview } from "@/app/lib/server/advances";
import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { ServiceError } from "@/app/lib/server/service";

/**
 * POST { decision: "approve" | "reject", note?: string } (owner only)
 * Approving hands the request to the Payout Agent, which sends it through Cashfree using the amount and UPI id
 * stored on the server.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/advances/[id]/decide">) {
  const { id } = await ctx.params;
  return respond(async () => {
    const b = await readJson(req);
    if (b.decision !== "approve" && b.decision !== "reject") throw new ServiceError("decision must be approve or reject");
    await ownerDecide(id, b.decision, b.note);
    return { overview: ownerOverview() };
  }, OWNER);
}
