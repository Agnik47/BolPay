import "server-only";
import { getDb } from "./db";

/** How many active employees can receive a payout right now (have a UPI ID on file). */
export function upiReadiness(ws?: Parameters<typeof getDb>[0]) {
  const active = getDb(ws).workers.filter((w) => w.status === "active");
  const withUpi = active.filter((w) => w.payoutUpi).length;
  return { active: active.length, withUpi, withoutUpi: active.length - withUpi };
}
