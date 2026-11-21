import { readJson, respond, STAFF } from "@/app/lib/server/http";
import { assignTestUpi } from "@/app/lib/server/service";

/**
 * POST { workerIds?, failIds?, failCount? }: sandbox only. Gives workers with no UPI ID a Cashfree test one. Owner and
 * supervisors (a supervisor only reaches their own team). Refused when Cashfree is live.
 */
export async function POST(req: Request) {
  const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
  return respond(() => ({ result: assignTestUpi(body) }), STAFF);
}
