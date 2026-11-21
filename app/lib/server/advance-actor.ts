import "server-only";
import { requireApiRole } from "./http";
import type { Role } from "@/app/lib/auth/dal";

/** The verified caller, for the decision record and the audit log. */
export async function actorFor(roles: Role[]) {
  const s = await requireApiRole(roles);
  return { id: `${s.role}:${s.userId}`, name: s.displayName.replace(/\s*\((owner|supervisor)\)\s*$/i, "") || s.email };
}
