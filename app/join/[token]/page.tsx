import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CAST, Person } from "@/app/components/onboarding/art";
import { Actions, PillLink, SoftButton, Sub, Title } from "@/app/components/onboarding/kit";
import { Stage } from "@/app/components/onboarding/Stage";
import { getAuthUser, getSession, homeFor } from "@/app/lib/auth/dal";
import { createClient } from "@/app/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { JoinFlow } from "../JoinFlow";

export const metadata: Metadata = { title: "Join your team · BolPay", robots: { index: false } };

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#fbf7ef]" />}>
      <Invite params={params} />
    </Suspense>
  );
}

function Message({ title, accent, description, children }: { title: string; accent?: string; description: string; children: React.ReactNode }) {
  return (
    <Stage stepKey="message">
      <Person {...CAST.owner} className="mx-auto mb-3 w-32" />
      <Title accent={accent}>{title}</Title>
      <Sub>{description}</Sub>
      <Actions>{children}</Actions>
    </Stage>
  );
}

async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const session = await getSession();
  if (session) {
    return (
      <Message title="You're already signed in." accent="already" description="This account already belongs to a business, so it can't join another one. Sign out first if this invite was meant for someone else.">
        <PillLink href={homeFor(session.role)}>Go to my home</PillLink>
        <form action={signOut}>
          <SoftButton type="submit" tone="light" className="mt-2">Sign out</SoftButton>
        </form>
      </Message>
    );
  }

  const supabase = await createClient();
  const { data } = /^[0-9a-f]{64}$/.test(token) ? await supabase.rpc("preview_invite", { p_token: token }) : { data: null };
  const row = data?.[0];
  if (!row) {
    return (
      <Message title="This link doesn't work." accent="doesn't" description="It may have expired (links last 7 days), already been used, or been replaced by a newer one. Ask for a fresh invite link.">
        <PillLink href="/login">Sign in</PillLink>
        <Link href="/join" className="mt-2 text-sm font-medium text-[#16152b]/60 hover:text-[#16152b]">Paste a different link</Link>
      </Message>
    );
  }

  const user = await getAuthUser();
  return (
    <JoinFlow
      token={token}
      signedInEmail={user?.email ?? null}
      preview={{ businessName: row.business_name, role: row.role, inviteeName: row.invitee_name, inviterName: row.inviter_name }}
    />
  );
}
