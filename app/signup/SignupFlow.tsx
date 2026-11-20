"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { CAST, Person, Streetscape } from "@/app/components/onboarding/art";
import { Actions, Caps, ErrorText, LineInput, Pill, PillLink, Stagger, Sub, TextButton, Tile, TileLink, Title } from "@/app/components/onboarding/kit";
import { indexOf, TOTAL, type JourneyStep } from "@/app/components/onboarding/flow";
import { Hero } from "@/app/components/onboarding/Hero";
import { Stage } from "@/app/components/onboarding/Stage";
import { signUpOwner, type AuthState } from "./actions";

type Step = "welcome" | JourneyStep | "confirm";
const ORDER: Step[] = ["welcome", "role", "name", "email", "password"];

/** Welcome, then one question per screen: who you are, your name, email, password. */
export function SignupFlow() {
  const [step, setStep] = useState<Step>("welcome");
  const [state, action, pending] = useActionState<AuthState, FormData>(signUpOwner, {});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const current: Step = state.needsConfirm ? "confirm" : step;
  const back = ORDER.indexOf(current) > 0 ? () => setStep(ORDER[ORDER.indexOf(current) - 1]) : undefined;
  const next = (s: Step) => () => setStep(s);
  const enter = (fn: () => void, ok: boolean) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && ok) {
      e.preventDefault();
      fn();
    }
  };

  const nameOk = name.trim().length >= 2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwOk = password.length >= 8;

  return (
    <>
      {/* The server action reads these; the visible inputs below are controlled and mirror into them. */}
      <form ref={form} action={action} className="hidden" aria-hidden>
        <input name="name" value={name} readOnly tabIndex={-1} />
        <input name="email" value={email} readOnly tabIndex={-1} />
        <input name="password" value={password} readOnly tabIndex={-1} />
      </form>

      <Stage stepKey={current} index={current === "welcome" || current === "confirm" ? undefined : indexOf(current as JourneyStep)} total={current === "welcome" || current === "confirm" ? undefined : TOTAL} onBack={back} bare={current === "welcome"} wide={current === "role"}>
        {current === "welcome" && (
          <div className="flex min-h-dvh flex-col">
            <div className="px-5 pt-24 sm:pt-28">
              <Title accent="voice">Payday, in your voice.</Title>
              <Sub>Attendance, incentives and UPI payouts for teams that are paid by the day. Just say it.</Sub>
            </div>
            <div className="relative mt-6 flex-1">
              <Streetscape side="left" className="pointer-events-none absolute bottom-[8%] left-0 hidden h-[88%] w-auto opacity-80 lg:block" />
              <Streetscape side="right" className="pointer-events-none absolute bottom-[8%] right-0 hidden h-[88%] w-auto opacity-80 lg:block" />
              <div className="relative">
                <Hero />
              </div>
            </div>
            <div className="relative z-10 bg-[#fffdf8] px-5 pb-14 pt-2 text-center">
              <Caps>Attendance · Payroll · UPI payouts</Caps>
              <Pill onClick={next("role")}>Get started</Pill>
              <p className="mt-5 text-sm text-[#16152b]/55">
                Have an account?{" "}
                <Link href="/login" className="font-semibold text-[#16152b] hover:underline">Sign in</Link>
                <span aria-hidden className="mx-2 text-[#16152b]/25">·</span>
                Got an invite?{" "}
                <Link href="/join" className="font-semibold text-[#16152b] hover:underline">Join</Link>
              </p>
            </div>
          </div>
        )}

        {current === "role" && (
          <>
            <Title accent="BolPay">How will you use BolPay?</Title>
            <Sub>Owners start here. Supervisors and workers join through a link from their employer.</Sub>
            <Stagger className="mt-10 grid gap-4 sm:grid-cols-3" role="radiogroup" label="How will you use BolPay?">
              {[
                <Tile key="o" title="I run a business" caption="Create your workspace" art={<Person {...CAST.owner} />} tall onClick={next("name")} />,
                <TileLink key="s" href="/join" title="I manage a team" caption="Needs an invite link" art={<Person {...CAST.supervisor} />} tall />,
                <TileLink key="w" href="/join" title="I get paid here" caption="Needs an invite link" art={<Person {...CAST.worker} />} tall />,
              ]}
            </Stagger>
          </>
        )}

        {current === "name" && (
          <>
            <Title>What&apos;s your name?</Title>
            <div className="mt-10">
              <LineInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter(next("email"), nameOk)} placeholder="Type name here" autoComplete="name" maxLength={80} autoFocus aria-label="Your name" />
            </div>
            <Actions>
              <Pill disabled={!nameOk} onClick={next("email")}>Continue</Pill>
            </Actions>
          </>
        )}

        {current === "email" && (
          <>
            <Title>{nameOk ? `Nice to meet you, ${name.trim().split(" ")[0]}.` : "Nice to meet you."}</Title>
            <Sub>What&apos;s your work email?</Sub>
            <div className="mt-6">
              <LineInput value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={enter(next("password"), emailOk)} type="email" inputMode="email" spellCheck={false} placeholder="you@company.com" autoComplete="email" autoFocus aria-label="Work email" />
            </div>
            <Actions>
              <Pill disabled={!emailOk} onClick={next("password")}>Continue</Pill>
            </Actions>
          </>
        )}

        {current === "password" && (
          <>
            <Title>Choose a password.</Title>
            <Sub>At least 8 characters. You&apos;ll use it to sign in.</Sub>
            <div className="mt-6">
              <LineInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pwOk && !pending) {
                    e.preventDefault();
                    form.current?.requestSubmit();
                  }
                }}
                type={show ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                maxLength={72}
                autoFocus
                aria-label="Password"
              />
            </div>
            <div className="mt-2 flex justify-center">
              <TextButton onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? "Hide password" : "Show password"}</TextButton>
            </div>
            <ErrorText>{state.error}</ErrorText>
            <Actions>
              <Pill disabled={!pwOk || pending} onClick={() => form.current?.requestSubmit()}>{pending ? "Creating…" : "Create my account"}</Pill>
            </Actions>
            <p className="mx-auto mt-6 max-w-xs text-center text-xs text-[#16152b]/45">
              By continuing you agree to the <Link href="/terms" className="underline hover:text-[#16152b]">Terms</Link> and <Link href="/privacy" className="underline hover:text-[#16152b]">Privacy Policy</Link>.
            </p>
          </>
        )}

        {current === "confirm" && (
          <>
            <Person {...CAST.owner} className="mx-auto mb-4 w-32" />
            <Title>Check your email.</Title>
            <Sub>We sent a link to <span className="font-semibold text-[#16152b]">{state.email}</span>. Open it, then sign in to carry on.</Sub>
            <Actions>
              <PillLink href="/login">Go to sign in</PillLink>
            </Actions>
          </>
        )}
      </Stage>
    </>
  );
}
