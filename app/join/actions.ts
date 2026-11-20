"use server";

import { getSession } from "@/app/lib/auth/dal";
import { withRequestWorkspace } from "@/app/lib/server/http";
import { claimWorkers, ServiceError, setOwnUpiOnce, unassignedWorkers } from "@/app/lib/server/service";
import { getDb } from "@/app/lib/server/db";
import { createClient } from "@/app/lib/supabase/server";

export interface JoinState {
  ok?: boolean;
  error?: string;
  role?: "supervisor" | "worker";
  name?: string;
  email?: string;
}

const TOKEN = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function joinError(message: string): string {
  if (message.includes("invalid_invite")) return "This invite link has expired or was already used. Ask for a new one.";
  if (message.includes("already_member")) return "This account already belongs to a business, so it can't join another.";
  if (message.includes("already_linked")) return "Someone has already joined with this worker's invite.";
  return "We couldn't finish joining. Please try again.";
}

/**
 * Turns an invite link into a login: creates the account (or signs in an existing one), then consumes the
 * invite. The role and the worker record come from the invite itself; nothing the browser sends can change them.
 */
export async function joinWithInvite(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const token = String(formData.get("token") ?? "");
  const mode = formData.get("mode") === "signin" ? "signin" : "signup";
  const name = clean(formData.get("name"), 80);
  const email = clean(formData.get("email"), 254).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const keep = { name, email };

  if (!TOKEN.test(token)) return { ...keep, error: "This invite link isn't valid." };
  if (!EMAIL.test(email)) return { ...keep, error: "Enter a valid email address." };
  if (mode === "signup" && name.length < 2) return { ...keep, error: "Enter your full name." };
  if (mode === "signup" && password.length < 8) return { ...keep, error: "Use at least 8 characters for your password." };
  if (password.length > 72) return { ...keep, error: "Passwords can be at most 72 characters." };

  const supabase = await createClient();
  const preview = await supabase.rpc("preview_invite", { p_token: token });
  if (!preview.data?.length) return { ...keep, error: joinError("invalid_invite") };

  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) return { ...keep, error: "We couldn't create that account. If you already have one, choose \"I already have an account\"." };
    if (!data.session) return { ...keep, error: "We sent you a confirmation email. Open it, then come back to this link and choose \"I already have an account\"." };
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ...keep, error: "Wrong email or password." };
  }

  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error || !data?.length) return { ...keep, error: joinError(error?.message ?? "") };
  return { ok: true, role: data[0].role, name: preview.data[0].invitee_name || name };
}

/** For someone already signed in without a business (e.g. they started owner sign-up, then opened an invite). */
export async function joinAsCurrentUser(token: string): Promise<JoinState> {
  if (!TOKEN.test(token)) return { error: "This invite link isn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error || !data?.length) return { error: joinError(error?.message ?? "") };
  return { ok: true, role: data[0].role };
}

/* ------------------------------------------------------------- supervisor team */

/** Workers nobody supervises yet: the pool a new supervisor picks their team from. */
export async function getTeamPool(): Promise<{ id: string; name: string; role: string; city: string }[]> {
  const session = await getSession();
  if (!session || session.role !== "supervisor") return [];
  return withRequestWorkspace(async () => unassignedWorkers());
}

export async function claimTeam(ids: string[]): Promise<{ ok: true; count: number } | { ok?: false; error: string }> {
  const session = await getSession();
  if (!session || session.role !== "supervisor") return { error: "Only supervisors can pick a team." };
  const picked = Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 500) : [];
  const count = await withRequestWorkspace(async () => claimWorkers(session.userId, picked));
  return { ok: true, count };
}

/* ---------------------------------------------------------------- worker's pay */

const mask = (upi: string) => {
  const [user, bank] = upi.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(2, user.length - 2))}@${bank ?? ""}`;
};

/** Whether the signed-in worker's UPI id is on file (masked), so the join flow knows what to ask. */
export async function getMyPayInfo(): Promise<{ name: string; upi: string | null }> {
  const session = await getSession();
  if (!session || session.role !== "worker" || !session.workerRef) return { name: "", upi: null };
  return withRequestWorkspace(async () => {
    const w = getDb().workers.find((x) => x.id === session.workerRef);
    return { name: w?.name ?? "", upi: w?.payoutUpi ? mask(w.payoutUpi) : null };
  });
}

export async function saveMyUpi(upi: string): Promise<{ ok: true } | { ok?: false; error: string }> {
  const session = await getSession();
  if (!session || session.role !== "worker" || !session.workerRef) return { error: "Only workers can add their own UPI id." };
  try {
    await withRequestWorkspace(async () => setOwnUpiOnce(session.workerRef!, upi));
    return { ok: true };
  } catch (err) {
    return { error: err instanceof ServiceError ? err.message : "Could not save your UPI id." };
  }
}
