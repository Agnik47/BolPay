import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/app/lib/auth/dal";
import { LazyFundingAgentCard, LazyRelayCard } from "@/app/components/Lazy";
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
        <LazyFundingAgentCard manage />
      </div>
      <div className="mt-5">
        <LazyRelayCard />
      </div>
    </>
  );
}
