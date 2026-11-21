import { getSession } from "@/app/lib/auth/dal";
import { ownerOverview, updateConfig } from "@/app/lib/server/advances";
import { OWNER, readJson, respond } from "@/app/lib/server/http";

/**
 * PUT { ownerAvailable?, awayNote?, policyPercent?, delegation?: { maxPerRequest, dailyLimit, expiresOn } | null } (owner only)
 * The only way to set or revoke the Manager Agent's delegated authority. The agents cannot call this.
 */
export async function PUT(req: Request) {
  return respond(async () => {
    const session = await getSession();
    await updateConfig(await readJson(req), session?.displayName || "Owner");
    return { overview: ownerOverview() };
  }, OWNER);
}
