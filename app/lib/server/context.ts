import "server-only";
import { CURRENT_PERIOD, TODAY } from "@/app/lib/merchant/mock-data";
import type { Period } from "@/app/lib/merchant/types";
import { getDb, getWorkspace, type PayCycle, type Workspace } from "./db";

/**
 * "Today" and the current pay period for the active workspace.
 * The demo dataset is pinned to fixed dates so the trained demo always looks the same.
 * Every other workspace holds real data, so it uses the real date (India time). The Zoho dataset is paid by
 * calendar month; a business's own workspace uses the pay cycle chosen in onboarding (monthly by default).
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

export function getToday(ws: Workspace = getWorkspace()): string {
  if (ws === "demo") return TODAY;
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

export function getPeriod(ws: Workspace = getWorkspace()): Period {
  if (ws === "demo") return CURRENT_PERIOD;
  const [y, m, d] = getToday(ws).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = ws === "zoho" ? "zoho" : "pay";
  const cycle: PayCycle = ws === "zoho" ? "monthly" : (getDb(ws).settings?.payCycle ?? "monthly");

  if (cycle === "weekly") {
    // Monday to Sunday around today.
    const today = Date.UTC(y, m - 1, d);
    const start = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
    const end = start + 6 * DAY;
    const [s, e] = [new Date(start), new Date(end)];
    const label = `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
    return { id: `${prefix}-${iso(start)}`, label, start: iso(start), end: iso(end) };
  }
  if (cycle === "fortnightly") {
    const first = d <= 15;
    const [from, to] = first ? [1, 15] : [16, last];
    return { id: `${prefix}-${y}-${pad(m)}-${first ? "a" : "b"}`, label: `${from}–${to} ${MONTHS[m - 1]} ${y}`, start: `${y}-${pad(m)}-${pad(from)}`, end: `${y}-${pad(m)}-${pad(to)}` };
  }
  return { id: `${prefix}-${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}`, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}
