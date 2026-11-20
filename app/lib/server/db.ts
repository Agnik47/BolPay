import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_RULES } from "@/app/lib/merchant/incentives";
import { SEED_ATTENDANCE, SEED_PAYOUTS, SEED_TRANSACTIONS, SEED_WORKERS } from "@/app/lib/merchant/mock-data";
import type { AdvancePolicy, Delegation, AdvanceRequest, AttendanceRecord, IncentiveRules, Payout, Transaction, Worker } from "@/app/lib/merchant/types";

/**
 * File-backed JSON databases under .data/, one per workspace:
 *  - "demo": .data/db.json, seeded from the mock data (the trained demo dataset)
 *  - "zoho": .data/zoho.json, starts empty and is filled by syncing from Zoho People
 *  - "b_<businessId>": .data/b_<businessId>.json, one per business that signed up itself; starts empty
 * The demo business (DEMO_BUSINESS_ID) switches between "demo" and "zoho"; every other business only ever
 * sees its own file, so two businesses can never see each other's workers or money.
 * Everything reads and writes through getDb(), so the whole app (screens, payouts, voice) works
 * on whichever workspace is active without knowing about the others.
 * It stands in for Postgres + Prisma: everything goes through ./service.ts, so swapping
 * the storage later only touches this file. Single-process only (no locking), and the
 * file needs a writable disk, so it won't work on serverless hosts.
 */
/** Bump when the data shape changes; an older database file is discarded and reseeded. */
export const SCHEMA_VERSION = 3;

export type Workspace = "demo" | "zoho" | `b_${string}`;
/** The two datasets the demo business can switch between. */
export const DEMO_WORKSPACES: Workspace[] = ["demo", "zoho"];

/** The seeded demo business (supabase/seed.sql). It alone keeps the demo/zoho dataset switch. */
export const DEMO_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
/** The seeded demo supervisor, who runs the whole demo team. */
export const DEMO_SUPERVISOR_ID = "00000000-0000-4000-8000-0000000000a2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BUSINESS_WS = /^b_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** True only for a workspace key that is safe to turn into a file name. */
export const isWorkspace = (v: unknown): v is Workspace => v === "demo" || v === "zoho" || (typeof v === "string" && BUSINESS_WS.test(v));

/**
 * The workspace a signed-in business works on. The demo business uses the dataset its people chose
 * (cookie); any other business gets its own file. Throws on anything that isn't a UUID, so a bad id
 * can never reach the file system.
 */
export function workspaceForBusiness(businessId: string, chosen: Workspace): Workspace {
  if (businessId === DEMO_BUSINESS_ID) return chosen === "zoho" ? "zoho" : "demo";
  const id = businessId.toLowerCase();
  if (!UUID.test(id)) throw new Error("Invalid business id");
  return `b_${id}`;
}

/** Where Zoho employees are written: the "zoho" dataset for the demo business, the business's own file otherwise. */
export function zohoTarget(): Workspace {
  const ws = getWorkspace();
  return ws.startsWith("b_") ? ws : "zoho";
}

/** Every workspace that exists on disk (the webhook searches all of them for a transfer). */
export function listWorkspaces(): Workspace[] {
  const all: Workspace[] = [...DEMO_WORKSPACES];
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const name = f.endsWith(".json") ? f.slice(0, -5) : "";
      if (BUSINESS_WS.test(name)) all.push(name as Workspace);
    }
  } catch {
    /* no data directory yet */
  }
  return all;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: string;
  /** Who did it, when known: a user id, "worker:<id>" or "system". Absent on older entries. */
  actor?: string;
}

export interface Db {
  schemaVersion: number;
  audit: AuditEntry[];
  /** Random per database, so a reseed never reuses Cashfree transfer_ids from earlier runs. */
  batchSalt?: string;
  workers: Worker[];
  attendance: AttendanceRecord[];
  rules: IncentiveRules;
  payouts: Payout[];
  transactions: Transaction[];
  /** BolPay Advance (optional, added without a schema bump so existing data files stay valid). */
  advances?: AdvanceRequest[];
  advancePolicy?: AdvancePolicy;
  delegations?: Delegation[];
  /** Per-business choices made in onboarding. Optional: older files and the demo data have none. */
  settings?: BusinessSettings;
}

export type PayCycle = "weekly" | "fortnightly" | "monthly";

export interface BusinessSettings {
  payCycle?: PayCycle;
  /** Wage given to employees imported without one (Zoho has no salary data). */
  defaultWage?: number;
}

// DATA_DIR lets a host with a read-only project folder (Vercel) keep the JSON files in a writable one such as /tmp.
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DIR = DATA_DIR;
function fileFor(ws: Workspace): string {
  if (ws === "demo") return path.join(DIR, "db.json");
  if (ws === "zoho") return path.join(DIR, "zoho.json");
  if (!BUSINESS_WS.test(ws)) throw new Error("Invalid workspace");
  return path.join(DIR, `${ws}.json`);
}
// globalThis (not module state) so every route bundle shares the same cache and the same request scope.
const g = globalThis as unknown as {
  __dbs?: Partial<Record<string, Db>>;
  __workspaceScope?: AsyncLocalStorage<Workspace>;
  __viewerScope?: AsyncLocalStorage<{ supervisorId?: string }>;
};
const scope = () => (g.__workspaceScope ??= new AsyncLocalStorage<Workspace>());
const viewerScope = () => (g.__viewerScope ??= new AsyncLocalStorage<{ supervisorId?: string }>());

/** Runs `fn` as a caller who may only see one supervisor's team (pass undefined for owners: they see everything). */
export function runAsViewer<T>(supervisorId: string | undefined, fn: () => T): T {
  return viewerScope().run({ supervisorId }, fn);
}

/** The supervisor whose team the current caller is limited to, or undefined for owners and background work. */
export const viewerSupervisor = (): string | undefined => viewerScope().getStore()?.supervisorId;

/**
 * What the current caller is allowed to read: the whole database, or for a supervisor only their own team's
 * workers and those workers' attendance, payouts and transactions. Reads (screens, voice answers) go through
 * this; writes still use getDb() and are guarded where they happen.
 */
export function getViewDb(): Db {
  const db = getDb();
  const sup = viewerSupervisor();
  if (!sup) return db;
  const workers = db.workers.filter((w) => w.supervisorId === sup);
  const ids = new Set(workers.map((w) => w.id));
  return {
    ...db,
    workers,
    attendance: db.attendance.filter((a) => ids.has(a.workerId)),
    payouts: db.payouts.filter((p) => ids.has(p.workerId)),
    transactions: db.transactions.filter((t) => ids.has(t.workerId)),
  };
}

/** True when the current caller may act on this worker (owners: any; supervisors: their own team). */
export function canActOnWorker(workerId: string): boolean {
  const sup = viewerSupervisor();
  const w = getDb().workers.find((x) => x.id === workerId);
  return Boolean(w) && (!sup || w!.supervisorId === sup);
}

/** Cookie holding which dataset a signed-in person is viewing. A per-person view, not a permission. */
export const WORKSPACE_COOKIE = "bolpay_dataset";

/**
 * The dataset the current request works on. Each person chooses their own (see runInWorkspace, set per
 * request in app/lib/server/http.ts), so switching never changes what anyone else sees. Code outside a
 * signed-in request (worker pages, Cashfree webhooks) gets the demo data.
 */
export function getWorkspace(): Workspace {
  return scope().getStore() ?? "demo";
}

/** Runs `fn` (and everything it awaits) against one dataset. */
export function runInWorkspace<T>(ws: Workspace, fn: () => T): T {
  return scope().run(ws, fn);
}

/** The dataset a person picked with the switch: only the two the demo business shares. */
export const parseWorkspace = (v: unknown): Workspace => (v === "zoho" ? "zoho" : "demo");

function seed(ws: Workspace): Db {
  const base = { schemaVersion: SCHEMA_VERSION, audit: [], batchSalt: Math.random().toString(36).slice(2, 10), rules: DEFAULT_RULES };
  // Everything except the trained demo data starts empty.
  if (ws !== "demo") return structuredClone({ ...base, workers: [], attendance: [], payouts: [], transactions: [] });
  const demo = structuredClone({ ...base, workers: SEED_WORKERS, attendance: SEED_ATTENDANCE, payouts: SEED_PAYOUTS, transactions: SEED_TRANSACTIONS });
  for (const w of demo.workers) w.supervisorId = DEMO_SUPERVISOR_ID;
  return demo;
}

export function getDb(ws: Workspace = getWorkspace()): Db {
  const cache = (g.__dbs ??= {});
  const hit = cache[ws];
  if (hit && hit.schemaVersion === SCHEMA_VERSION) return hit;
  try {
    const parsed = JSON.parse(fs.readFileSync(fileFor(ws), "utf8")) as Db;
    if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error("outdated schema");
    cache[ws] = parsed;
    // supervisorId is newer than the demo file: the demo supervisor runs the whole demo team.
    if (ws === "demo" && parsed.workers.some((w) => w.supervisorId === undefined)) {
      for (const w of parsed.workers) w.supervisorId ??= DEMO_SUPERVISOR_ID;
      saveDb(ws);
    }
  } catch {
    cache[ws] = seed(ws);
    saveDb(ws);
  }
  return cache[ws]!;
}

/** Appends to the audit log (calculations, approvals, rule changes, imports). Capped to stay small. */
export function logAudit(action: string, detail: string, ws: Workspace = getWorkspace(), actor?: string) {
  const db = getDb(ws);
  db.audit.push({ at: new Date().toISOString(), action, detail, ...(actor ? { actor } : {}) });
  if (db.audit.length > 500) db.audit.splice(0, db.audit.length - 500);
}

/** Atomic write (temp file + rename) so a crash can't leave a half-written database. */
export function saveDb(ws: Workspace = getWorkspace()) {
  const db = g.__dbs?.[ws];
  if (!db) return;
  try {
    const file = fileFor(ws);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("Could not persist database; continuing in memory", err);
  }
}

/** Dev helper: drop all data in a workspace and re-seed it. */
export function resetDb(ws: Workspace = getWorkspace()) {
  (g.__dbs ??= {})[ws] = seed(ws);
  saveDb(ws);
}
