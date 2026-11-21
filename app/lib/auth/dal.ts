import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/app/lib/supabase/server";

export type Role = "owner" | "supervisor" | "worker";

export interface SessionContext {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  /** `onboardingStep` is where an owner's setup wizard left off (null once finished or never started). */
  business: { id: string; name: string; onboarded: boolean; onboardingStep: string | null };
  /** Worker record id in the app data (e.g. "w1") for worker logins. */
  workerRef: string | null;
}

/** A signed-in user, whether or not they belong to a business yet (mid-signup, or an invitee). */
export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return null;
  const meta = (claims.user_metadata ?? {}) as { full_name?: string };
  const email = typeof claims.email === "string" ? claims.email : "";
  return { userId: claims.sub, email, displayName: meta.full_name || email };
});

/**
 * Verified session + membership for the current request, or null when signed
 * out or not a member of any business. Memoized per render pass.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  // Token checks depend on the clock, so this always runs per request.
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return null;

  const { data: member } = await supabase
    .from("members")
    .select("role, business_id, worker_ref")
    .eq("user_id", claims.sub)
    .limit(1)
    .maybeSingle();
  if (!member) return null;

  let business: { name: string; onboarding?: unknown } | null = null;
  const full = await supabase.from("businesses").select("name, onboarding").eq("id", member.business_id).maybeSingle();
  if (full.error) {
    // The onboarding migration hasn't been applied yet: treat every business as already set up.
    business = (await supabase.from("businesses").select("name").eq("id", member.business_id).maybeSingle()).data;
  } else {
    business = full.data;
  }
  const onboardingState = (business?.onboarding ?? {}) as { completed_at?: string; step?: string };
  const onboarded = business?.onboarding === undefined || Boolean(onboardingState.completed_at);

  const meta = (claims.user_metadata ?? {}) as { full_name?: string };
  const email = typeof claims.email === "string" ? claims.email : "";
  return {
    userId: claims.sub,
    email,
    displayName: meta.full_name || email,
    role: member.role,
    business: { id: member.business_id, name: business?.name ?? "", onboarded, onboardingStep: onboarded ? null : (onboardingState.step ?? null) },
    workerRef: member.worker_ref,
  };
});

/** Use at the top of a page: redirects unless the user has one of `roles`. */
export async function requireRole(roles: Role[]): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roles.includes(session.role)) redirect(homeFor(session.role));
  return session;
}

export function homeFor(role: Role) {
  return role === "worker" ? "/me" : role === "supervisor" ? "/attendance" : "/dashboard";
}
