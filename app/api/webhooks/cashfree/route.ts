import { NextResponse } from "next/server";
import { mapTransferStatus, verifyWebhookSignature } from "@/app/lib/cashfree/payouts";
import { applyWebhookTransfer } from "@/app/lib/server/service";

interface TransferEvent {
  type?: string;
  data?: {
    transfer_id?: string;
    cf_transfer_id?: string;
    status?: string;
    status_description?: string;
    transfer_utr?: string;
  };
}

/**
 * POST /api/webhooks/cashfree
 * Receives TRANSFER_* events. The HMAC signature is verified over the raw body before anything is trusted.
 * Add this URL under Cashfree dashboard, Payouts, Developers, Webhooks (it must be public HTTPS, e.g. an ngrok tunnel).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: TransferEvent;
  try {
    event = JSON.parse(raw) as TransferEvent;
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const d = event.data;
  if (event.type?.startsWith("TRANSFER_") && d?.transfer_id) {
    // Idempotent: replaying an event re-applies the same status.
    const status = mapTransferStatus(d.status);
    applyWebhookTransfer({
      transferId: d.transfer_id,
      status,
      cfTransferId: d.cf_transfer_id,
      utr: d.transfer_utr,
      error: status === "failed" ? d.status_description : undefined,
    });
  }
  return NextResponse.json({ received: true });
}
