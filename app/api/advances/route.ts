import { OWNER, respond } from "@/app/lib/server/http";
import { ownerOverview, sweepRelayStalls } from "@/app/lib/server/advances";
import { syncTransactions } from "@/app/lib/server/service";

/** GET: every emergency advance request, the approval settings and the Manager Agent's delegation (owner only). */
export async function GET() {
  return respond(async () => {
    // Settle any advance payment still in flight; a transfer still being created is left alone.
    await sweepRelayStalls();
    await syncTransactions((t) => t.kind === "advance" && Date.now() - Date.parse(t.createdAt) > 5000);
    return { overview: ownerOverview() };
  }, OWNER);
}
