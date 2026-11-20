"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { CAST, Person } from "@/app/components/onboarding/art";
import { Actions, Celebrate, ErrorText, LineInput, Pill, SoftButton, Sub, TextButton, Title } from "@/app/components/onboarding/kit";
import { Stage } from "@/app/components/onboarding/Stage";
import { claimTeam, getMyPayInfo, getTeamPool, joinAsCurrentUser, joinWithInvite, saveMyUpi, type JoinState } from "./actions";

type Role = "supervisor" | "worker";
type Step = "welcome" | "name" | "email" | "password" | "team" | "upi" | "done";
const INDEX: Record<Step, number> = { welcome: 0, name: 1, email: 2, password: 3, team: 4, upi: 4, done: 5 };

export interface InvitePreview {
  businessName: string;
  role: Role;
  inviteeName: string;
  inviterName: string;
}

const PERKS: Record<Role, string> = {
  supervisor: "Mark attendance for your own team, by tap or by voice.",
  worker: "See your attendance and every payment, and get paid straight to your UPI id.",
};

/** The invitee journey, one question per screen: who invited you, then your login, then the one thing your role needs. */
export function JoinFlow({ token, preview, signedInEmail }: { token: string; preview: InvitePreview; signedInEmail: string | null }) {
  const router = useRouter();
  const role = preview.role;
  const [step, setStep] = useState<Step>("welcome");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const after: Step = role === "supervisor" ? "team" : "upi";
  // Moving on happens in the action's callback, so no effect has to watch for success.
  const [state, action, pending] = useActionState<JoinState, FormData>(async (prev, fd) => {
    const r = await joinWithInvite(prev, fd);
    if (r.ok) setStep(after);
    return r;
  }, {});
  const [name, setName] = useState(preview.inviteeName);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);


  const nameOk = name.trim().length >= 2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwOk = mode === "signin" ? password.length > 0 : password.length >= 8;
  const who = role === "supervisor" ? CAST.supervisor : CAST.worker;
  const enter = (fn: () => void, ok: boolean) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && ok) {
      e.preventDefault();
      fn();
    }
  };
  const goBack = () => {
    if (step === "name") setStep("welcome");
    else if (step === "email") setStep(mode === "signin" ? "welcome" : "name");
    else if (step === "password") setStep("email");
  };
  const canGoBack = step === "name" || step === "email" || step === "password";

  return (
    <>
      <form ref={form} action={action} className="hidden" aria-hidden>
        <input name="token" value={token} readOnly tabIndex={-1} />
        <input name="mode" value={mode} readOnly tabIndex={-1} />
        <input name="name" value={name} readOnly tabIndex={-1} />
        <input name="email" value={email} readOnly tabIndex={-1} />
        <input name="password" value={password} readOnly tabIndex={-1} />
      </form>

      <Stage stepKey={step} index={step === "done" ? undefined : INDEX[step]} total={step === "done" ? undefined : 5} onBack={canGoBack ? goBack : undefined} wide={step === "team"}>
        {step === "welcome" && (
          <>
            <Person {...who} className="mx-auto mb-3 w-36" />
            <Title accent="invited">{`${preview.inviterName ? preview.inviterName.split(" ")[0] : "Your employer"} invited you.`}</Title>
            <Sub>
              Join <span className="font-semibold text-[#16152b]">{preview.businessName}</span> on BolPay as {role === "supervisor" ? "a supervisor" : "a team member"}. {PERKS[role]}
            </Sub>
            {signedInEmail ? (
              <>
                <Sub className="!mt-3 text-xs">You&apos;re signed in as {signedInEmail}.</Sub>
                <ErrorText>{error}</ErrorText>
                <Actions>
                  <Pill
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const r = await joinAsCurrentUser(token);
                      setBusy(false);
                      if (r.ok) setStep(after);
                      else setError(r.error ?? "Could not join.");
                    }}
                  >
                    {busy ? "Joining…" : "Join with this account"}
                  </Pill>
                </Actions>
              </>
            ) : (
              <Actions>
                <Pill onClick={() => { setMode("signup"); setStep(preview.inviteeName ? "name" : "name"); }}>Get started</Pill>
                <TextButton onClick={() => { setMode("signin"); setStep("email"); }}>I already have an account</TextButton>
              </Actions>
            )}
          </>
        )}

        {step === "name" && (
          <>
            <Title>What should we call you?</Title>
            <div className="mt-10">
              <LineInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter(() => setStep("email"), nameOk)} placeholder="Type name here" autoComplete="name" maxLength={80} autoFocus aria-label="Your name" />
            </div>
            <Actions>
              <Pill disabled={!nameOk} onClick={() => setStep("email")}>Continue</Pill>
            </Actions>
          </>
        )}

        {step === "email" && (
          <>
            <Title>{mode === "signin" ? "Welcome back." : "And your email?"}</Title>
            <Sub>{mode === "signin" ? "Use the account you already have. It will join this business." : "This is what you'll sign in with."}</Sub>
            <div className="mt-6">
              <LineInput value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={enter(() => setStep("password"), emailOk)} type="email" inputMode="email" spellCheck={false} placeholder="you@email.com" autoComplete="email" autoFocus aria-label="Email" />
            </div>
            <Actions>
              <Pill disabled={!emailOk} onClick={() => setStep("password")}>Continue</Pill>
            </Actions>
          </>
        )}

        {step === "password" && (
          <>
            <Title>{mode === "signin" ? "Your password." : "Choose a password."}</Title>
            <Sub>{mode === "signin" ? "" : "At least 8 characters. Your invite link works only once."}</Sub>
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
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
              <Pill disabled={!pwOk || pending} onClick={() => form.current?.requestSubmit()}>{pending ? "Joining…" : mode === "signin" ? "Sign in and join" : "Create login and join"}</Pill>
            </Actions>
          </>
        )}

        {step === "team" && <TeamPick onNext={() => setStep("done")} />}
        {step === "upi" && <UpiStep onNext={() => setStep("done")} />}

        {step === "done" && (
          <div className="relative">
            <Celebrate />
            <Person {...who} className="mx-auto mb-3 w-36" />
            <Title accent="in">{`You're in${state.name ? `, ${state.name.split(" ")[0]}` : ""}.`}</Title>
            <Sub>{role === "supervisor" ? "Your attendance page is ready." : "Your pay page is ready."}</Sub>
            <Actions>
              <Pill onClick={() => router.replace(role === "supervisor" ? "/attendance" : "/me")}>{role === "supervisor" ? "Open attendance" : "See my pay"}</Pill>
            </Actions>
          </div>
        )}
      </Stage>
    </>
  );
}

/** Supervisor: pick who you look after. Only workers nobody supervises yet are listed. */
function TeamPick({ onNext }: { onNext: () => void }) {
  const [pool, setPool] = useState<{ id: string; name: string; role: string; city: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    void getTeamPool().then((p) => {
      if (!off) setPool(p);
    });
    return () => {
      off = true;
    };
  }, []);

  const shown = (pool ?? []).filter((w) => `${w.name} ${w.role} ${w.city}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function save() {
    setBusy(true);
    setError(null);
    const r = await claimTeam([...picked]);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onNext();
  }

  return (
    <>
      <Title accent="team">Pick your team.</Title>
      <Sub>These workers have no supervisor yet. Tick the ones you&apos;ll look after. The owner can change this later.</Sub>
      {pool === null ? (
        <p className="mt-8 text-center text-sm text-[#16152b]/55">Loading workers…</p>
      ) : pool.length === 0 ? (
        <p className="mx-auto mt-8 max-w-sm text-center text-sm leading-relaxed text-[#16152b]/60">There&apos;s nobody to pick yet. The owner hasn&apos;t added workers, or they all have a supervisor. Ask the owner to assign people to you.</p>
      ) : (
        <div className="mx-auto mt-8 max-w-md">
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search workers" className="h-11 w-full rounded-full bg-white/80 px-5 text-sm outline-none backdrop-blur placeholder:text-[#16152b]/35 focus:bg-white focus:shadow-[0_0_0_3px_rgba(255,93,115,0.28)]" />
            <SoftButton tone="light" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((w) => w.id)))}>{picked.size === shown.length && shown.length > 0 ? "Clear" : "All"}</SoftButton>
          </div>
          <ul className="mt-3 max-h-72 overflow-y-auto rounded-[24px] bg-white/80 p-2 shadow-[0_24px_60px_-30px_rgba(22,21,43,0.5)] backdrop-blur" aria-label="Workers without a supervisor">
            {shown.map((w) => (
              <li key={w.id}>
                <label className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-2.5 transition ${picked.has(w.id) ? "bg-[#ffe9c9]" : "hover:bg-[#16152b]/[0.04]"}`}>
                  <input type="checkbox" checked={picked.has(w.id)} onChange={() => toggle(w.id)} className="size-4 accent-[#16152b]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{w.name}</span>
                    <span className="block truncate text-xs text-[#16152b]/50">{w.role} · {w.city}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <Actions onSkip={onNext} skipLabel="Do this later" busy={busy}>
        <Pill onClick={save} disabled={busy || picked.size === 0}>{busy ? "Saving…" : picked.size ? `Add ${picked.size} to my team` : "Add to my team"}</Pill>
      </Actions>
    </>
  );
}

/** Worker: confirm where pay goes. If the employer already filled it in, just show it. */
function UpiStep({ onNext }: { onNext: () => void }) {
  const [info, setInfo] = useState<{ name: string; upi: string | null } | null>(null);
  const [upi, setUpi] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    void getMyPayInfo().then((i) => {
      if (!off) setInfo(i);
    });
    return () => {
      off = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveMyUpi(upi.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onNext();
  }

  if (!info) return <p className="text-center text-sm text-[#16152b]/55">Loading…</p>;
  if (info.upi) {
    return (
      <>
        <Title accent="set">Your pay is set up.</Title>
        <Sub>Your employer already added the UPI id your wages go to.</Sub>
        <p className="mx-auto mt-6 w-fit rounded-full bg-white/80 px-6 py-3 font-mono text-sm shadow-[0_10px_26px_-18px_rgba(22,21,43,0.5)]">{info.upi}</p>
        <p className="mt-3 text-center text-xs text-[#16152b]/45">To change it, ask your employer.</p>
        <Actions><Pill onClick={onNext}>Continue</Pill></Actions>
      </>
    );
  }
  return (
    <>
      <Title accent="pay">Where should your pay go?</Title>
      <Sub>Add the UPI id your wages are sent to. Once saved, only your employer can change it.</Sub>
      <div className="mt-6">
        <LineInput value={upi} onChange={(e) => setUpi(e.target.value)} onKeyDown={(e) => e.key === "Enter" && upi.includes("@") && !busy && void save()} placeholder="name@bank" spellCheck={false} autoCapitalize="none" autoComplete="off" maxLength={80} autoFocus aria-label="UPI id" />
      </div>
      <ErrorText>{error}</ErrorText>
      <Actions onSkip={onNext} skipLabel="Add it later" busy={busy}>
        <Pill disabled={busy || !upi.includes("@")} onClick={save}>{busy ? "Saving…" : "Save"}</Pill>
      </Actions>
    </>
  );
}
