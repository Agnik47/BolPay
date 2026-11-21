"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";

export interface AuthState {
  error?: string;
  name?: string;
  email?: string;
  /** Email confirmation is switched on in Supabase: the person must open the link we emailed. */
  needsConfirm?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Creates the login for a new owner. The business itself is created in the next step of the wizard. */
export async function signUpOwner(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = clean(formData.get("name"), 80);
  const email = clean(formData.get("email"), 254).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const keep = { name, email };

  if (name.length < 2) return { ...keep, error: "Enter your full name." };
  if (!EMAIL.test(email)) return { ...keep, error: "Enter a valid email address." };
  if (password.length < 8) return { ...keep, error: "Use at least 8 characters for your password." };
  if (password.length > 72) return { ...keep, error: "Passwords can be at most 72 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
  // One message for every failure, so this form can't be used to find out which emails already have an account.
  if (error) return { ...keep, error: "We couldn't create that account. If you already have one, sign in instead." };
  if (!data.session) return { ...keep, needsConfirm: true };

  redirect("/onboarding");
}
