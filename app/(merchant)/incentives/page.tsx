import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/app/lib/auth/dal";
import { IncentivesView } from "@/app/components/merchant/views/IncentivesView";
import { ContentSkeleton } from "@/app/components/Skeleton";

export const metadata: Metadata = { title: "Incentives · BolPay" };

// A worker who opens this page is redirected by the merchant layout before it can render, which Next's dev-time
// "instant navigation" check reports as an error. The page reads the session anyway, so it opts out of that check.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <AuthedIncentives />
    </Suspense>
  );
}

async function AuthedIncentives() {
  await requireRole(["owner"]);
  return <IncentivesView />;
}
