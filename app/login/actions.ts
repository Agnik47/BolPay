"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Wrong email or password.", email };

  const { data: member } = await supabase.from("members").select("role").eq("user_id", data.user.id).limit(1).maybeSingle();
  // Signed up but never finished creating a business: carry on with setup instead of turning them away.
  if (!member) redirect("/onboarding");

  // "/" sends each role to its own home page.
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
