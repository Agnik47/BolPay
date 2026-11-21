import { NextResponse } from "next/server";
import { mapTransferStatus, verifyBodySignature, verifyWebhookSignature, webhookTimestampFresh } from "@/app/lib/cashfree/payouts";
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

/** Older body-style events: { event, transferId, referenceId, utr, reason, signature }. */
interface LegacyEvent {
  event?: string;
  transferId?: string;
  referenceId?: string | number;
  utr?: string;
  reason?: string;
}

const LEGACY_STATUS: Record<string, string> = {
  TRANSFER_SUCCESS: "SUCCESS",
  TRANSFER_FAILED: "FAILED",
  TRANSFER_REVERSED: "REVERSED",
  TRANSFER_REJECTED: "REJECTED",
};

/**
 * POST /api/webhooks/cashfree
 * Receives TRANSFER_* events and verifies the signature before anything is trusted. Two styles are accepted:
 *  - V2: headers x-webhook-signature + x-webhook-timestamp, HMAC over timestamp + raw body.
 *  - V1: a "signature" field inside the JSON body (this is also what Cashfree's "Test & Add Webhook" ping uses).
 * Events that are not transfers (for example LOW_BALANCE_ALERT) are acknowledged and ignored.
 * Add this URL under Cashfree dashboard, Payouts, Developers, Webhooks (it must be public HTTPS, e.g. an ngrok tunnel).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const body = json as Record<string, unknown>;

  const signedByHeader = verifyWebhookSignature(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"));
  if (!signedByHeader && !verifyBodySignature(body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  // A validly signed event that is too old is a replay (V1 body-style events carry no timestamp, so they rely on the status rules).
  if (signedByHeader && !webhookTimestampFresh(req.headers.get("x-webhook-timestamp"))) {
    return NextResponse.json({ error: "Stale webhook" }, { status: 400 });
  }

  // Idempotent: replaying an event re-applies the same status.
  const v2 = body as TransferEvent;
  if (signedByHeader && v2.type?.startsWith("TRANSFER_") && v2.data?.transfer_id) {
    const d = v2.data;
    const status = mapTransferStatus(d.status);
    applyWebhookTransfer({
      transferId: d.transfer_id!,
      status,
      cfTransferId: d.cf_transfer_id,
      utr: d.transfer_utr,
      error: status === "failed" ? d.status_description : undefined,
    });
  } else if (!signedByHeader) {
    const v1 = body as LegacyEvent;
    const cfStatus = v1.event ? LEGACY_STATUS[v1.event] : undefined;
    if (cfStatus && v1.transferId) {
      const status = mapTransferStatus(cfStatus);
      applyWebhookTransfer({
        transferId: v1.transferId,
        status,
        cfTransferId: v1.referenceId === undefined ? undefined : String(v1.referenceId),
        utr: v1.utr,
        error: status === "failed" ? v1.reason : undefined,
      });
    }
  }
  return NextResponse.json({ received: true });
}
