"use client";

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";
import { ErrorText, LineInput, Pill, TextButton } from "@/app/components/onboarding/kit";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="mt-8">
      <LineInput name="email" type="email" autoComplete="email" inputMode="email" spellCheck={false} defaultValue={state.email} required placeholder="Email" aria-label="Email" aria-invalid={state.error ? true : undefined} className="!text-[clamp(1.15rem,3vw,1.6rem)]" />
      <LineInput name="password" type={show ? "text" : "password"} autoComplete="current-password" required placeholder="Password" aria-label="Password" aria-invalid={state.error ? true : undefined} wrapClass="mt-1" className="!text-[clamp(1.15rem,3vw,1.6rem)]" />
      <div className="mt-2 flex justify-center">
        <TextButton onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? "Hide password" : "Show password"}</TextButton>
      </div>
      <ErrorText>{state.error}</ErrorText>
      <div className="mt-8 flex justify-center">
        <Pill type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Pill>
      </div>
    </form>
  );
}
