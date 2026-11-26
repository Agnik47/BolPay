import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/app/lib/auth/dal";
import { RelayCard } from "@/app/components/merchant/RelayCard";
import { FundingAgentCard } from "@/app/components/merchant/FundingAgentCard";
import { ZohoView } from "@/app/components/merchant/views/ZohoView";
import { ContentSkeleton } from "@/app/components/Skeleton";

export const metadata: Metadata = { title: "Integrations · BolPay" };

// A worker who opens this page is redirected by the merchant layout before it can render, which Next's dev-time
// "instant navigation" check reports as an error. The page reads the session anyway, so it opts out of that check.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <AuthedIntegrations />
    </Suspense>
  );
}

async function AuthedIntegrations() {
  await requireRole(["owner"]);
  return (
    <>
      <ZohoView />
      <div className="mt-5">
        <FundingAgentCard manage />
      </div>
      <div className="mt-5">
        <RelayCard />
      </div>
    </>
  );
}
