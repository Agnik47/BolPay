import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, getSession, homeFor } from "@/app/lib/auth/dal";
import { SignupFlow } from "./SignupFlow";

export const metadata: Metadata = { title: "Create your account · BolPay" };

/** Already signed in? Continue where you left off instead of creating a second account. */
async function RedirectIfSignedIn(): Promise<null> {
  const session = await getSession();
  if (session) redirect(session.role === "owner" && !session.business.onboarded ? "/onboarding" : homeFor(session.role));
  if (await getAuthUser()) redirect("/onboarding");
  return null;
}

export default function SignupPage() {
  return (
    <>
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <SignupFlow />
    </>
  );
}
