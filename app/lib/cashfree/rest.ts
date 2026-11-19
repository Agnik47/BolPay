import "server-only";

/**
 * Minimal Cashfree Payouts V2 client. Auth is two headers (client id + secret), no token exchange.
 * Production also needs the server's IP whitelisted in the Cashfree dashboard.
 */
const IS_PRODUCTION = process.env.CASHFREE_ENVIRONMENT === "production";
export const CASHFREE_BASE_URL = IS_PRODUCTION ? "https://api.cashfree.com/payout" : "https://sandbox.cashfree.com/payout";
export const isLiveCashfree = IS_PRODUCTION;
export const CASHFREE_API_VERSION = "2024-01-01";

export class CashfreeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export function cashfreeConfigured() {
  return Boolean(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
}

export async function cashfreeFetch<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const id = process.env.CASHFREE_CLIENT_ID;
  const secret = process.env.CASHFREE_CLIENT_SECRET;
  if (!id || !secret) throw new CashfreeError("Cashfree credentials are not configured", 500);

  const res = await fetch(`${CASHFREE_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-client-id": id,
      "x-client-secret": secret,
      "x-api-version": CASHFREE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new CashfreeError(
      typeof json.message === "string" ? json.message : `Cashfree request failed (${res.status})`,
      res.status,
      typeof json.code === "string" ? json.code : undefined,
    );
  }
  return json as T;
}
