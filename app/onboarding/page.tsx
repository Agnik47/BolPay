import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { WizardStep } from "@/app/components/onboarding/flow";
import { getAuthUser, getSession, homeFor } from "@/app/lib/auth/dal";
import { OwnerWizard } from "./OwnerWizard";

export const metadata: Metadata = { title: "Set up your business · BolPay" };

type SearchParams = Promise<{ zoho?: string; reason?: string }>;

export default function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" />}>
      <Wizard searchParams={searchParams} />
    </Suspense>
  );
}

/** Owners only. Signed in with no business yet? Start at the business step. Already finished? Go to the dashboard. */
async function Wizard({ searchParams }: { searchParams: SearchParams }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const session = await getSession();
  if (session) {
    if (session.role !== "owner") redirect(homeFor(session.role));
    if (session.business.onboarded) redirect("/dashboard");
  }
  // Once the business exists, only the team is left (also where Zoho's consent screen sends the owner back to).
  const initial: WizardStep = session ? "team" : "business";

  const sp = await searchParams;
  const flag = session && (sp.zoho === "connected" || sp.zoho === "error") ? sp.zoho : null;
  return (
    <OwnerWizard
      initialStep={initial}
      ownerName={user.displayName}
      zohoFlag={flag}
      zohoReason={flag === "error" ? (sp.reason ?? "").slice(0, 120) : null}
    />
  );
}
