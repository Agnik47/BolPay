import { writeMcp } from "@/app/lib/cashfree/mcp/store";
import { OWNER, respond } from "@/app/lib/server/http";

/** POST: forgets the Cashfree login for this business. */
export async function POST() {
  return respond(() => {
    writeMcp(null);
  }, OWNER);
}
