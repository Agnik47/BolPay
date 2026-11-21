import { payrollReadyEvent, payrollWebhook, sendPayrollToRelay } from "@/app/lib/relay/notify";
import { OWNER, respond } from "@/app/lib/server/http";

/** GET: whether the Relay webhook is set, and the event that would be sent. POST: send it. Owners only. */
export async function GET() {
  return respond(() => ({ relay: { configured: Boolean(payrollWebhook()), event: payrollReadyEvent() } }), OWNER);
}

export async function POST() {
  return respond(async () => ({ relay: await sendPayrollToRelay("owner") }), OWNER);
}
