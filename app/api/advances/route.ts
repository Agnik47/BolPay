import { respond, STAFF } from "@/app/lib/server/http";
import { staffAdvances } from "@/app/lib/server/advance-service";

/** GET: advance requests with eligibility and payment status, for owners and supervisors. */
export async function GET() {
  return respond(() => ({ advances: staffAdvances() }), STAFF);
}
