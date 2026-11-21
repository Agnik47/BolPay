import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/app/lib/auth/dal";
import { AdvancesView } from "@/app/components/merchant/views/AdvancesView";
import { ContentSkeleton } from "@/app/components/Skeleton";

export const metadata: Metadata = { title: "Emergency advances · BolPay" };

export default function Page() {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <AuthedAdvances />
    </Suspense>
  );
}

async function AuthedAdvances() {
  await requireRole(["owner"]);
  return <AdvancesView />;
}
