"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions, ErrorText, LineInput, Pill, Sub, Title } from "@/app/components/onboarding/kit";
import { CAST, Person } from "@/app/components/onboarding/art";
import { Stage } from "@/app/components/onboarding/Stage";

/** For someone who was sent a link but opened BolPay directly: paste it (or just its code) here. */
export function JoinCode() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go() {
    const token = value.toLowerCase().match(/[0-9a-f]{64}/)?.[0];
    if (!token) return setError("That doesn't look like an invite link. Paste the whole link you were sent.");
    router.push(`/join/${token}`);
  }

  return (
    <Stage stepKey="code" onBack={() => router.push("/signup")}>
      <div className="flex justify-center gap-1">
        <Person {...CAST.supervisor} className="w-24" />
        <Person {...CAST.worker} className="w-24" />
      </div>
      <Title accent="invite">Paste your invite link.</Title>
      <Sub>Your employer or supervisor sent you a link. Paste it here and we&apos;ll take you in.</Sub>
      <div className="mt-6">
        <LineInput
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && go()}
          placeholder="https://…/join/…"
          spellCheck={false}
          autoCapitalize="none"
          autoFocus
          aria-label="Invite link"
          className="!text-[clamp(1rem,2.6vw,1.4rem)]"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <Actions>
        <Pill disabled={!value.trim()} onClick={go}>Continue</Pill>
      </Actions>
      <p className="mt-6 text-center text-sm text-[#16152b]/55">
        Starting a business instead? <Link href="/signup" className="font-semibold text-[#16152b] hover:underline">Create an account</Link>
      </p>
    </Stage>
  );
}
