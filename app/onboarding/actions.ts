"use server";

import { DEFAULT_WAGE } from "@/app/components/onboarding/flow";
import { getAuthUser, getSession } from "@/app/lib/auth/dal";
import { withRequestWorkspace } from "@/app/lib/server/http";
import { applyBusinessSetup, assignSupervisor, ServiceError, type BusinessSetup } from "@/app/lib/server/service";
import { canActOnWorker, getDb } from "@/app/lib/server/db";
import { createClient } from "@/app/lib/supabase/server";

export type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Turns a Postgres function's error code into something a person can act on. */
function friendly(message: string): string {
  if (message.includes("invalid_name")) return "Give your business a name (2 to 80 characters).";
  if (message.includes("already_member")) return "This account already belongs to a business.";
  if (message.includes("not_signed_in")) return "Your session expired. Sign in again.";
  if (message.includes("already_linked")) return "That worker already has a login.";
  if (message.includes("forbidden") || message.includes("not_a_member")) return "You can't do that with your role.";
  if (message.includes("worker_required")) return "Pick a worker for this invite.";
  return "Something went wrong. Please try again.";
}

async function ownerSession() {
  const session = await getSession();
  if (!session || session.role !== "owner") throw new ServiceError("Only the business owner can do this.", 403);
  return session;
}

const CYCLE_DAYS = { weekly: 7, fortnightly: 15, monthly: 30 } as const;

/**
 * The only form in the wizard: creates the business with the signed-in person as its owner, and its pay cycle.
 * Wage and rules start on defaults (₹800 a day, standard rules); both are edited later on Workers and Incentives.
 */
export async function setUpBusiness(input: { name: string; payCycle: BusinessSetup["payCycle"] }): Promise<Result> {
  if (!(await getAuthUser())) return { error: "Your session expired. Sign in again." };
  const payCycle = input.payCycle in CYCLE_DAYS ? input.payCycle : "monthly";
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_business", { p_name: clean(input.name, 80), p_period_days: CYCLE_DAYS[payCycle] });
  if (error) return { error: friendly(error.message) };

  // The business exists now, so a failure past here mustn't send the owner back to create it again.
  try {
    const session = await ownerSession();
    await withRequestWorkspace(async () => applyBusinessSetup({ payCycle, defaultWage: DEFAULT_WAGE, preset: "standard" }));
    await setStepFor(session.business.id, "team");
  } catch (err) {
    console.error("business setup", err);
  }
  return { ok: true };
}

async function setStepFor(businessId: string, step: string, extra: Record<string, unknown> = {}) {
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("onboarding").eq("id", businessId).maybeSingle();
  const current = (data?.onboarding && typeof data.onboarding === "object" && !Array.isArray(data.onboarding) ? data.onboarding : {}) as Record<string, never>;
  await supabase.from("businesses").update({ onboarding: { ...current, step, ...extra } }).eq("id", businessId);
}

/** Marks onboarding finished: the owner goes to the dashboard from now on. */
export async function finishOnboarding(): Promise<Result> {
  try {
    const session = await ownerSession();
    await setStepFor(session.business.id, "done", { completed_at: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof ServiceError ? err.message : "Could not finish setup." };
  }
}

/**
 * Creates a one-time invite and returns its path (/join/<token>). Owners can invite supervisors and any worker;
 * a supervisor can invite workers on their own team. The role comes from here, never from the invitee.
 */
export async function createInvite(input: { role: "supervisor" | "worker"; workerId?: string; name?: string }): Promise<Result<{ path: string; name: string }>> {
  try {
    const session = await getSession();
    if (!session || session.role === "worker") return { error: "You can't invite people." };
    if (input.role === "supervisor" && session.role !== "owner") return { error: "Only the owner can invite a supervisor." };
    if (input.role !== "supervisor" && input.role !== "worker") return { error: "Unknown role." };

    let name = clean(input.name, 80);
    let workerRef: string | null = null;
    if (input.role === "worker") {
      workerRef = clean(input.workerId, 80);
      // Runs on this business's data, and for a supervisor only their own team is reachable.
      const worker = await withRequestWorkspace(async () => (canActOnWorker(workerRef!) ? getDb().workers.find((w) => w.id === workerRef) : undefined));
      if (!worker) return { error: "That worker isn't on your team." };
      name = worker.name;
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_invite", { p_role: input.role, p_worker_ref: workerRef, p_name: name });
    if (error || !data) return { error: friendly(error?.message ?? "") };
    return { ok: true, path: `/join/${data}`, name };
  } catch (err) {
    return { error: err instanceof ServiceError ? err.message : "Could not create the invite." };
  }
}

/** Owner: put workers on a supervisor's team, or `null` to take them off any team. */
export async function assignTeam(ids: string[], supervisorId: string | null): Promise<Result<{ count: number }>> {
  try {
    await ownerSession();
    if (supervisorId !== null && !(await listSupervisors()).some((s) => s.id === supervisorId)) return { error: "That person isn't a supervisor in your business." };
    const picked = Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 500) : [];
    const count = await withRequestWorkspace(async () => assignSupervisor(picked, supervisorId));
    return { ok: true, count };
  } catch (err) {
    return { error: err instanceof ServiceError ? err.message : "Could not update the team." };
  }
}

/** Owner: the supervisors in this business, to put workers on their teams. */
export async function listSupervisors(): Promise<{ id: string; name: string }[]> {
  const session = await getSession();
  if (!session || session.role !== "owner") return [];
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("user_id, display_name").eq("business_id", session.business.id).eq("role", "supervisor");
  return (data ?? []).map((m) => ({ id: m.user_id, name: m.display_name || "Supervisor" }));
}
