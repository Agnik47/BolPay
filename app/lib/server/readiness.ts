import "server-only";
import { isTestVpa } from "@/app/lib/cashfree/test-upi";
import { isLiveCashfree } from "@/app/lib/cashfree/rest";
import { getDb } from "./db";

/** How many active employees can receive a payout right now (have a UPI ID on file). */
export function upiReadiness(ws?: Parameters<typeof getDb>[0]) {
  const active = getDb(ws).workers.filter((w) => w.status === "active");
  // A Cashfree test ID can't receive real money, so it doesn't count as ready once payouts are live.
  const withUpi = active.filter((w) => w.payoutUpi && !(isLiveCashfree && isTestVpa(w.payoutUpi))).length;
  return { active: active.length, withUpi, withoutUpi: active.length - withUpi };
}
