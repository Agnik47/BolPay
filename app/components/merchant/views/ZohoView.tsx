"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateTime } from "@/app/lib/merchant/format";
import { useStore, type Snapshot } from "@/app/lib/merchant/store";
import { useToast } from "../../feedback/Toaster";
import { Badge, Button, buttonClass, Card, Notice, PageHeader, Stat, Stats } from "../ui";
import { ListSkeleton } from "../../Skeleton";

interface Status {
  configured: boolean;
  connection: "oauth" | "env" | null;
  connectedAt: string | null;
  lastSync: SyncSummary | null;
  workspace: string;
  /** True when Zoho employees go straight into this business's only dataset (no separate Zoho dataset to open). */
  dedicated: boolean;
  workers: number;
  attendance: number;
  upi: { active: number; withUpi: number; withoutUpi: number };
  accountsUrl: string;
  peopleUrl: string;
  redirectUri: string;
  scopes: string;
  defaultWage: number;
  wageField: string | null;
}

interface SyncSummary {
  at: string;
  employees: { total: number; created: number; updated: number; inactive: number };
  attendance: { records: number; employees: number; from: string; to: string } | null;
  warnings: string[];
}

export function ZohoView() {
  const params = useSearchParams();
  const router = useRouter();
  const store = useStore();
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "disconnect" | "open" | "emails" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/zoho/status");
    const d = (await res.json().catch(() => ({}))) as { zoho?: Status; error?: string };
    if (res.ok && d.zoho) setStatus(d.zoho);
    else setLoadError(d.error ?? "Could not load the Zoho status.");
  }, []);

  useEffect(() => {
    // Initial load; the fetch is the external system being synced with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function sync() {
    setBusy("sync");
    const res = await fetch("/api/zoho/sync", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { sync?: SyncSummary; state?: Snapshot; error?: string };
    setBusy(null);
    // The screens keep their data in memory, so hand them the fresh server data or they show the old list until a reload.
    if (d.state) store.applySnapshot(d.state);
    if (res.ok && d.sync) {
      const s = d.sync;
      const warn = s.warnings.length ? ` ${s.warnings.length} warning${s.warnings.length === 1 ? "" : "s"}, see Last sync.` : "";
      toast({
        tone: s.warnings.length ? "warn" : "success",
        title: `Synced ${s.employees.total} employee${s.employees.total === 1 ? "" : "s"} from Zoho`,
        description: `${s.employees.created} new, ${s.employees.updated} updated${s.attendance ? `, ${s.attendance.records} attendance records` : ""}.${warn}`,
      });
    } else {
      toast({ tone: "error", title: "The Zoho sync failed", description: d.error });
    }
    await load();
  }

  async function disconnect() {
    setBusy("disconnect");
    const res = await fetch("/api/zoho/sync", { method: "DELETE" });
    setBusy(null);
    if (res.ok) toast({ tone: "info", title: "Disconnected from Zoho", description: "Employees you already synced stay in the Zoho dataset." });
    else toast({ tone: "error", title: "Could not disconnect from Zoho" });
    await load();
  }



  async function openZohoData() {
    setBusy("open");
    const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: "zoho" }) });
    if (res.ok) {
      try {
        sessionStorage.removeItem("bolpay.voice.session"); // a voice plan from the demo data must not run on Zoho data
      } catch {
        /* storage blocked */
      }
      window.location.assign(new URL("/workers", window.location.origin).href);
    } else setBusy(null);
  }

  // Zoho's sign-in redirects back with ?zoho=...; announce it once, then drop it from the URL.
  const flag = params.get("zoho");
  const reason = params.get("reason");
  const announced = useRef(false);
  useEffect(() => {
    if (!flag || announced.current) return;
    announced.current = true;
    if (flag === "connected") toast({ tone: "success", title: "Connected to Zoho People", description: "Press Sync now to import your employees." });
    else if (flag === "not_configured") toast({ tone: "warn", title: "Zoho is not configured yet", description: "Add the keys from the setup steps to .env.local, then restart the server." });
    else if (flag === "error") toast({ tone: "error", title: "Zoho sign-in did not finish", description: reason ?? undefined });
    router.replace("/integrations", { scroll: false });
  }, [flag, reason, router, toast]);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Bring employees and attendance from your HR system, then run payouts in BolPay. The demo data stays separate."
        actions={
          status?.workers && !status.dedicated ? (
            <Button variant="primary" disabled={busy !== null || status.workspace === "zoho"} onClick={() => void openZohoData()}>
              {status.workspace === "zoho" ? "Viewing Zoho data" : "Open Zoho data"}
            </Button>
          ) : undefined
        }
      />

      {loadError && <Notice tone="error" className="mb-4">{loadError}</Notice>}

      <Card
        title="Zoho People"
        className="mb-4"
        actions={
          status && (
            <Badge tone={status.connection ? "green" : status.configured ? "amber" : "slate"}>
              {status.connection ? (status.connection === "oauth" ? "Connected" : "Connected (refresh token in .env)") : status.configured ? "Not connected" : "Not configured"}
            </Badge>
          )
        }
      >
        {!status ? (
          <ListSkeleton label="Loading Zoho status" rows={3} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Sign in with Zoho, then import every employee and this month&apos;s attendance from <span className="font-medium">{status.peopleUrl.replace("https://", "")}</span>. Run Sync now any time to pick up changes.
            </p>
            <div className="flex flex-wrap gap-2">
              {status.configured && (
                <a href="/api/zoho/connect" className={buttonClass(status.connection ? "secondary" : "primary")}>
                  {status.connection ? "Reconnect Zoho" : "Connect Zoho"}
                </a>
              )}
              <Button variant={status.connection ? "primary" : "secondary"} disabled={!status.connection || busy !== null} onClick={() => void sync()}>
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </Button>
              {status.connection === "oauth" && (
                <Button variant="ghost" disabled={busy !== null} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              )}
            </div>
            {status.connectedAt && <p className="text-xs text-slate-500">Connected {formatDateTime(status.connectedAt)}.</p>}
            {status.lastSync && (
              <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-500">Last sync, {formatDateTime(status.lastSync.at)}</p>
                <SyncDetails s={status.lastSync} />
              </div>
            )}
          </div>
        )}
      </Card>

      {status && (
        <Stats className="mb-4">
          <Stat label="Employees in Zoho dataset" value={String(status.workers)} hint={status.lastSync ? `Last sync ${formatDateTime(status.lastSync.at)}` : "Not synced yet"} tone={status.workers ? "good" : "default"} />
          <Stat label="Attendance records" value={String(status.attendance)} hint="This month, from Zoho" />
          <Stat label="Default daily wage" value={`₹${status.defaultWage}`} hint="Zoho People holds no salary data" />
        </Stats>
      )}

      {status && status.workers > 0 && (
        <Card title="UPI IDs for payouts" className="mb-4">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{status.upi.withUpi}</span> of {status.upi.active} active employees have a UPI ID
            {status.upi.withoutUpi > 0 && <span className="text-amber-800"> ({status.upi.withoutUpi} have none, so their payouts will fail)</span>}.
            Zoho People holds no payment details, so add each employee&apos;s UPI ID on Workers or by voice.
          </p>
        </Card>
      )}

      {status && !status.configured && (
        <Card title="Set up the connection (one time)" className="mb-4">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Open <span className="font-medium">api-console.zoho.in</span>, choose <span className="font-medium">Add Client</span>, then <span className="font-medium">Server-based Applications</span>.
            </li>
            <li>
              Authorized Redirect URI: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{status.redirectUri}</code>
            </li>
            <li>Copy the Client ID and Client Secret into .env as ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET, then restart the server.</li>
            <li>Come back here and press Connect Zoho. Requested access: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{status.scopes}</code></li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">Accounts server: {status.accountsUrl}. If your portal is not on the India data center, set ZOHO_ACCOUNTS_URL and ZOHO_PEOPLE_URL (see .env.example).</p>
        </Card>
      )}

      <Card title="How the import works">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Employees become workers. Zoho owns the name, role, department, city, phone, joining date and active status, and updates them on every sync.</li>
          <li>Attendance for every day Zoho reports (present, absent, half day, leave, overtime) is imported. Weekends, holidays and days with nothing recorded are left alone, so you can still mark them in BolPay or by voice.</li>
          <li>
            Pay settings belong to BolPay. A new employee gets the default daily wage{status?.wageField ? ` (or the "${status.wageField}" field)` : ""}. Their UPI ID starts empty. Edit them on Workers or by voice; a sync never overwrites them.
          </li>
          <li>Payouts, approvals and the voice assistant work on this data exactly as on the demo data. Use the Dataset switch in the sidebar to go back.</li>
        </ul>
      </Card>
    </>
  );
}

function SyncDetails({ s }: { s: SyncSummary }) {
  return (
    <div className="mt-1 space-y-1 text-sm text-slate-700">
      <p>
        {s.employees.total} employees: {s.employees.created} new, {s.employees.updated} updated, {s.employees.inactive} inactive.
      </p>
      {s.attendance && (
        <p>
          Attendance {s.attendance.from} to {s.attendance.to}: {s.attendance.records} records for {s.attendance.employees} employees.
        </p>
      )}
      {s.warnings.map((w) => (
        <p key={w} className="text-amber-800">
          {w}
        </p>
      ))}
    </div>
  );
}
