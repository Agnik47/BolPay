import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/app/lib/auth/dal";
import { TransactionsView } from "@/app/components/merchant/views/TransactionsView";
import { ContentSkeleton } from "@/app/components/Skeleton";

export const metadata: Metadata = { title: "Transactions · BolPay" };

// A worker who opens this page is redirected by the merchant layout before it can render, which Next's dev-time
// "instant navigation" check reports as an error. The page reads the session anyway, so it opts out of that check.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <AuthedTransactions />
    </Suspense>
  );
}

async function AuthedTransactions() {
  await requireRole(["owner"]);
  return <TransactionsView />;
}
