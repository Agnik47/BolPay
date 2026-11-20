import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cashfreeFetch, CashfreeError } from "./rest";

export type ItemStatus = "processing" | "completed" | "failed";

export interface TransferInput {
  /** Unique per attempt; Cashfree rejects a repeated transfer_id, which makes resubmission safe. Max 40 chars. */
  transferId: string;
  workerId: string;
  name: string;
  phone: string;
  upi: string;
  /** Amount in INR. */
  amount: number;
}

export interface TransferResult {
  transferId: string;
  cfTransferId?: string;
  utr?: string;
  status: ItemStatus;
  error?: string;
}

/** UPI ids look like name@bank: 2+ id characters, "@", then letters. */
export const UPI_ID = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;

/** Transfer ids allow letters, digits and underscore, 40 chars at most. */
export function transferIdFor(salt: string, payoutId: string, attempt: number) {
  const digest = createHash("sha256").update(`${salt}|${payoutId}`).digest("hex").slice(0, 24);
  return `bp_${digest}_${attempt}`;
}

/** Beneficiary ids are tied to the UPI id, so a changed UPI id creates a new beneficiary instead of editing one. */
function beneficiaryIdFor(workerId: string, upi: string) {
  return `bp_${createHash("sha256").update(`${workerId}|${upi.toLowerCase()}`).digest("hex").slice(0, 24)}`;
}

/** Maps a Cashfree transfer status onto our display states. Only SUCCESS counts as paid. */
export function mapTransferStatus(status: string | undefined): ItemStatus {
  switch (status) {
    case "SUCCESS":
      return "completed";
    case "FAILED":
    case "REJECTED":
    case "REVERSED":
    case "CANCELLED":
    case "MANUALLY_REJECTED":
      return "failed";
    // RECEIVED, SENT_TO_BENEFICIARY, PENDING, APPROVAL_PENDING...: not settled yet.
    default:
      return "processing";
  }
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Beneficiary states that can never receive a transfer. INITIATED (still verifying) is let through. */
const BAD_BENEFICIARY_STATUS = new Set(["INVALID", "FAILED", "DELETED"]);

function assertBeneficiaryUsable(upi: string, status: string | undefined) {
  if (status && BAD_BENEFICIARY_STATUS.has(status)) {
    throw new CashfreeError(`UPI id ${upi} could not be verified by Cashfree (${status.toLowerCase()})`, 422);
  }
}

async function ensureBeneficiary(t: TransferInput): Promise<string> {
  const id = beneficiaryIdFor(t.workerId, t.upi);
  const phone = digits(t.phone).slice(-10);
  try {
    const created = await cashfreeFetch<{ beneficiary_status?: string }>("/beneficiary", {
      method: "POST",
      body: {
        beneficiary_id: id,
        beneficiary_name: t.name.replace(/[^a-zA-Z ]/g, " ").replace(/\s+/g, " ").trim() || "BolPay Worker",
        beneficiary_instrument_details: { vpa: t.upi },
        ...(phone.length === 10 ? { beneficiary_contact_details: { beneficiary_phone: phone, beneficiary_country_code: "+91" } } : {}),
      },
    });
    assertBeneficiaryUsable(t.upi, created.beneficiary_status);
  } catch (err) {
    // Already registered on an earlier attempt: reuse it, but still make sure it is usable.
    const exists = err instanceof CashfreeError && (err.status === 409 || /already exist/i.test(err.message));
    if (!exists) throw err;
    const current = await cashfreeFetch<{ beneficiary_status?: string }>(`/beneficiary?beneficiary_id=${encodeURIComponent(id)}`);
    assertBeneficiaryUsable(t.upi, current.beneficiary_status);
  }
  return id;
}

interface TransferResponse {
  transfer_id: string;
  cf_transfer_id?: string;
  status: string;
  status_code?: string;
  status_description?: string;
  transfer_utr?: string;
}

function toResult(r: TransferResponse): TransferResult {
  const status = mapTransferStatus(r.status);
  return {
    transferId: r.transfer_id,
    cfTransferId: r.cf_transfer_id,
    utr: r.transfer_utr,
    status,
    error: status === "failed" ? (r.status_description ?? r.status_code ?? "Transfer failed") : undefined,
  };
}

/** Pays one worker by UPI: registers the beneficiary (idempotent), then creates the transfer. */
export async function createTransfer(t: TransferInput): Promise<TransferResult> {
  const beneficiaryId = await ensureBeneficiary(t);
  try {
    const res = await cashfreeFetch<TransferResponse>("/transfers", {
      method: "POST",
      body: {
        transfer_id: t.transferId,
        transfer_amount: Math.round(t.amount * 100) / 100,
        transfer_currency: "INR",
        transfer_mode: "upi",
        beneficiary_details: { beneficiary_id: beneficiaryId },
        transfer_remarks: "BolPay payout",
      },
    });
    return toResult(res);
  } catch (err) {
    // Same transfer_id sent before (a retried submission): report its real state instead of failing.
    if (err instanceof CashfreeError && err.status === 409) return getTransfer(t.transferId);
    throw err;
  }
}

export async function getTransfer(transferId: string): Promise<TransferResult> {
  return toResult(await cashfreeFetch<TransferResponse>(`/transfers?transfer_id=${encodeURIComponent(transferId)}`));
}

/** Verifies x-webhook-signature: base64(HMAC-SHA256(timestamp + rawBody, client secret)). */
export function verifyWebhookSignature(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  const secret = process.env.CASHFREE_CLIENT_SECRET;
  if (!secret || !signature || !timestamp) return false;
  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
