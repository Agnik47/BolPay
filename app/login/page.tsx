import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/app/lib/auth/dal";
import { Mic } from "@/app/components/onboarding/art";
import { Sub, Title } from "@/app/components/onboarding/kit";
import { Stage } from "@/app/components/onboarding/Stage";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · BolPay" };

/** Already signed in? Go straight to your home page. */
async function RedirectIfSignedIn(): Promise<null> {
  const session = await getSession();
  if (session) redirect(homeFor(session.role));
  return null;
}

export default function LoginPage() {
  return (
    <Stage stepKey="login">
      <Mic className="mx-auto mb-2 h-32 drop-shadow-[0_14px_18px_rgba(22,21,43,0.22)]" />
      <Title accent="back">Welcome back.</Title>
      <Sub>Sign in to run today&apos;s attendance and payouts.</Sub>
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <LoginForm />
      <p className="mt-8 text-center text-sm text-[#16152b]/55">
        New to BolPay? <Link href="/signup" className="font-semibold text-[#16152b] hover:underline">Create a business account</Link>
        <span aria-hidden className="mx-2 text-[#16152b]/25">·</span>
        Invited? <Link href="/join" className="font-semibold text-[#16152b] hover:underline">Join</Link>
      </p>
    </Stage>
  );
}
