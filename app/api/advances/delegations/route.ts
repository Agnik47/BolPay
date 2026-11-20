import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { createDelegation, delegationState } from "@/app/lib/server/advance-agent";
import { staffAdvances } from "@/app/lib/server/advance-service";
import { actorFor } from "@/app/lib/server/advance-actor";

export async function GET() {
  return respond(() => delegationState(), OWNER);
}

/** Owner only. Starting a delegation also lets the agent look at requests that are already waiting. */
export async function POST(req: Request) {
  return respond(async () => {
    await createDelegation(await actorFor(OWNER), await readJson(req));
    return { ...delegationState(), advances: staffAdvances() };
  }, OWNER);
}
