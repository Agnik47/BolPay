import { OWNER, respond } from "@/app/lib/server/http";
import { getDb, getWorkspace, zohoTarget } from "@/app/lib/server/db";
import { upiReadiness } from "@/app/lib/server/readiness";
import { connection, readZoho, zohoConfig, zohoConfigured } from "@/app/lib/zoho/client";

/** GET: whether Zoho is configured and connected, the last sync, and what the Zoho dataset holds. Owners only. */
export async function GET() {
  return respond(() => {
    const c = zohoConfig();
    const stored = readZoho();
    const target = zohoTarget();
    const db = getDb(target);
    return {
      zoho: {
        configured: zohoConfigured(),
        connection: connection(),
        connectedAt: stored.connectedAt ?? null,
        lastSync: stored.lastSync ?? null,
        workspace: getWorkspace(),
        // A business that signed up itself has one dataset: Zoho employees land in it directly.
        dedicated: target !== "zoho",
        workers: db.workers.length,
        attendance: db.attendance.length,
        upi: upiReadiness(target),
        accountsUrl: c.accountsUrl,
        peopleUrl: c.peopleUrl,
        redirectUri: c.redirectUri,
        scopes: c.scopes,
        defaultWage: c.defaultWage,
        wageField: c.wageField ?? null,
      },
    };
  }, OWNER);
}
