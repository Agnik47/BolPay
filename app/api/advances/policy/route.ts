import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { delegationState, updatePolicy } from "@/app/lib/server/advance-agent";
import { actorFor } from "@/app/lib/server/advance-actor";

/** GET: the advance policy and delegations. PUT: change the policy. Owner only; the Manager Agent has no route here. */
export async function GET() {
  return respond(() => delegationState(), OWNER);
}

export async function PUT(req: Request) {
  return respond(async () => {
    updatePolicy(await actorFor(OWNER), await readJson(req));
    return delegationState();
  }, OWNER);
}
