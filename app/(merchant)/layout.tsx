import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell } from "@/app/components/merchant/Shell";
import { ShellSkeleton } from "@/app/components/Skeleton";
import { requireRole } from "@/app/lib/auth/dal";
import { DEMO_BUSINESS_ID } from "@/app/lib/server/db";

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  // The session is read at request time, so it streams in behind Suspense (Cache Components).
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}

async function AuthedShell({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["owner", "supervisor"]);
  // A business that signed up itself finishes the setup wizard before it sees the workspace.
  if (session.role === "owner" && !session.business.onboarded) redirect("/onboarding");
  return (
    <Shell
      viewer={{
        displayName: session.displayName,
        role: session.role === "owner" ? "owner" : "supervisor",
        businessName: session.business.name,
        ownBusiness: session.business.id !== DEMO_BUSINESS_ID,
      }}
    >
      {children}
    </Shell>
  );
}
