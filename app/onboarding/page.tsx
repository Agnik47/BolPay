import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WIZARD_STEPS, type WizardStep } from "@/app/components/onboarding/flow";
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
  let initial: WizardStep = "business";
  if (session) {
    if (session.role !== "owner") redirect(homeFor(session.role));
    if (session.business.onboarded) redirect("/dashboard");
    const saved = session.business.onboardingStep;
    // The business exists, so the wizard resumes at the saved step (or the first one after creating it).
    initial = WIZARD_STEPS.includes(saved as (typeof WIZARD_STEPS)[number]) ? (saved as WizardStep) : "cycle";
  }

  const sp = await searchParams;
  const flag = sp.zoho === "connected" || sp.zoho === "error" ? sp.zoho : null;
  // Coming back from Zoho's consent screen lands on the team step, where the import happens.
  if (flag && session) initial = "team";
  // Nothing in the wizard works before a business exists, so a signed-in person without one starts at the top.
  if (!session) initial = "business";
  return (
    <OwnerWizard
      initialStep={initial}
      ownerName={user.displayName}
      businessName={session?.business.name ?? ""}
      zohoFlag={flag}
      zohoReason={flag === "error" ? (sp.reason ?? "").slice(0, 120) : null}
    />
  );
}
