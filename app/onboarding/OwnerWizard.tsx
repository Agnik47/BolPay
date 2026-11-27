"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconDone, IconMic } from "@/app/components/icons";
import { CalendarArt, CAST, Coin, FactoryArt, Mic, Note, ParcelArt, Person, ShopArt, SiteArt, ToolboxArt } from "@/app/components/onboarding/art";
import { BUSINESS_TYPES, CYCLES, indexOf, TEAM_SIZES, TOTAL, type JourneyStep, type WizardStep } from "@/app/components/onboarding/flow";
import { Actions, Celebrate, Chip, ErrorText, InviteLinkCard, LineInput, Pill, SoftButton, Stagger, Sub, Tile, Title } from "@/app/components/onboarding/kit";
import { Stage } from "@/app/components/onboarding/Stage";
import { createBusiness, createInvite, finishOnboarding, saveSetup, setOnboardingStep } from "./actions";
import { TeamStep } from "./TeamStep";
import { useAlive } from "@/app/lib/client/lifecycle";

type Cycle = (typeof CYCLES)[number]["value"];
const TYPE_ART = { delivery: <ParcelArt />, retail: <ShopArt />, factory: <FactoryArt />, construction: <SiteArt />, other: <ToolboxArt /> } as const;
const WIDE: WizardStep[] = ["type", "cycle", "rules", "team"];
const BACK: Partial<Record<WizardStep, WizardStep>> = { type: "business", size: "type", wage: "cycle", rules: "wage", payouts: "team", voice: "payouts", invite: "voice" };

/** Everything after the account: the business, how you pay, your people, payouts, voice, a supervisor. One question per screen. */
export function OwnerWizard({ initialStep, ownerName, businessName, zohoFlag, zohoReason }: {
  initialStep: WizardStep;
  ownerName: string;
  businessName: string;
  zohoFlag: string | null;
  zohoReason: string | null;
}) {
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [bName, setBName] = useState(businessName);
  const [city, setCity] = useState("");
  const [type, setType] = useState<string>("delivery");
  const [size, setSize] = useState<string>(TEAM_SIZES[0]);
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [wage, setWage] = useState("800");
  const [preset, setPreset] = useState<"standard" | "simple">("standard");
  const [team, setTeam] = useState(0);
  const [invited, setInvited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = ownerName.trim().split(" ")[0];
  const goto = (s: WizardStep, persist = false) => {
    setError(null);
    setStep(s);
    if (persist) void setOnboardingStep(s);
  };
  const back = BACK[step];

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createBusiness({ name: bName, type, city, teamSize: size });
    setBusy(false);
    if ("error" in r && r.error) return setError(r.error);
    goto("cycle", true);
  }

  async function savePay() {
    setBusy(true);
    setError(null);
    const r = await saveSetup({ payCycle: cycle, defaultWage: Number(wage), preset });
    setBusy(false);
    if ("error" in r && r.error) return setError(r.error);
    goto("team");
  }

  const wageNum = Number(wage);

  return (
    <Stage stepKey={step} index={step === "done" ? undefined : indexOf(step as JourneyStep)} total={step === "done" ? undefined : TOTAL} onBack={back ? () => goto(back) : undefined} wide={WIDE.includes(step)}>
      {step === "business" && (
        <>
          <Title accent="business">{first ? `Great, ${first}. Tell us about your business.` : "Tell us about your business."}</Title>
          <div className="mt-8">
            <LineInput value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Business name" maxLength={80} autoFocus aria-label="Business name" />
            <LineInput value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" maxLength={60} aria-label="City" wrapClass="mt-2" />
          </div>
          <Actions>
            <Pill disabled={bName.trim().length < 2 || !city.trim()} onClick={() => goto("type")}>Continue</Pill>
          </Actions>
        </>
      )}

      {step === "type" && (
        <>
          <Title accent="business">What kind of business is it?</Title>
          <Stagger className="mt-10 grid gap-4 sm:grid-cols-2" lastSpan role="radiogroup" label="Business type">
            {BUSINESS_TYPES.map((t) => (
              <Tile key={t.value} title={t.title} caption={t.caption} art={TYPE_ART[t.value]} selected={type === t.value} onClick={() => setType(t.value)} />
            ))}
          </Stagger>
          <Actions>
            <Pill onClick={() => goto("size")}>Continue</Pill>
          </Actions>
        </>
      )}

      {step === "size" && (
        <>
          <Title accent="pay">How many people do you pay?</Title>
          <Sub>A rough number is fine.</Sub>
          <div role="radiogroup" aria-label="Team size" className="mt-10 flex flex-wrap justify-center gap-3">
            {TEAM_SIZES.map((s) => (
              <Chip key={s} selected={size === s} onClick={() => setSize(s)}>{s}</Chip>
            ))}
          </div>
          <ErrorText>{error}</ErrorText>
          <Actions>
            <Pill disabled={busy} onClick={create}>{busy ? "Creating…" : "Create my workspace"}</Pill>
          </Actions>
        </>
      )}

      {step === "cycle" && (
        <>
          <Title accent="payday">How often is payday?</Title>
          <Stagger className="mt-10 grid gap-4 sm:grid-cols-3" role="radiogroup" label="Pay cycle">
            {CYCLES.map((c) => (
              <Tile key={c.value} title={c.title} caption={c.caption} art={<CalendarArt rows={c.rows} />} tall selected={cycle === c.value} onClick={() => setCycle(c.value)} />
            ))}
          </Stagger>
          <Actions>
            <Pill onClick={() => goto("wage", true)}>Continue</Pill>
          </Actions>
        </>
      )}

      {step === "wage" && (
        <>
          <Title accent="day">What does a typical day pay?</Title>
          <Sub>In rupees, per day. It&apos;s the starting wage for people you import. You can change anyone&apos;s later.</Sub>
          <div className="mt-6">
            <LineInput value={wage} onChange={(e) => setWage(e.target.value.replace(/[^\d]/g, "").slice(0, 6))} inputMode="numeric" placeholder="800" autoFocus aria-label="Typical daily wage in rupees" />
          </div>
          <div role="radiogroup" aria-label="Quick amounts" className="mt-6 flex flex-wrap justify-center gap-2.5">
            {["600", "800", "1000", "1200"].map((v) => (
              <Chip key={v} selected={wage === v} onClick={() => setWage(v)}>₹{v}</Chip>
            ))}
          </div>
          <Actions>
            <Pill disabled={!(wageNum > 0)} onClick={() => goto("rules")}>Continue</Pill>
          </Actions>
        </>
      )}

      {step === "rules" && (
        <>
          <Title accent="pay">How is pay worked out?</Title>
          <Sub>You can fine-tune every rule later on the Incentives page.</Sub>
          <Stagger className="mt-10 grid gap-4 sm:grid-cols-2" role="radiogroup" label="Pay rules">
            {[
              <Tile key="s" title="Standard" caption="Wage + overtime + bonuses" art={<Coin />} selected={preset === "standard"} onClick={() => setPreset("standard")} />,
              <Tile key="f" title="Simple" caption="A flat daily wage" art={<Note />} selected={preset === "simple"} onClick={() => setPreset("simple")} />,
            ]}
          </Stagger>
          <ErrorText>{error}</ErrorText>
          <Actions>
            <Pill disabled={busy} onClick={savePay}>{busy ? "Saving…" : "Save and continue"}</Pill>
          </Actions>
        </>
      )}

      {step === "team" && <TeamStep businessCity={city} defaultWage={wageNum || 800} zohoFlag={zohoFlag} zohoReason={zohoReason} onAdded={(n) => setTeam((t) => t + n)} onNext={() => goto("payouts", true)} />}
      {step === "payouts" && <PayoutsStep onNext={() => goto("voice", true)} />}
      {step === "voice" && <VoiceStep onNext={() => goto("invite", true)} />}
      {step === "invite" && <InviteStep businessName={bName} onInvited={() => setInvited(true)} onNext={() => goto("done", true)} />}
      {step === "done" && <DoneStep businessName={bName} team={team} invited={invited} />}
    </Stage>
  );
}

/* ------------------------------------------------------------------- payouts */

function PayoutsStep({ onNext }: { onNext: () => void }) {
  const reduce = useReducedMotion();
  const [counts, setCounts] = useState<{ total: number; withUpi: number } | null>(null);

  useEffect(() => {
    let off = false;
    void fetch("/api/state")
      .then((r) => r.json())
      .then((d: { state?: { workers: { status: string; payoutUpi: string }[] } }) => {
        if (off || !d.state) return;
        const active = d.state.workers.filter((w) => w.status === "active");
        setCounts({ total: active.length, withUpi: active.filter((w) => w.payoutUpi).length });
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const pct = counts && counts.total > 0 ? Math.round((counts.withUpi / counts.total) * 100) : 0;
  return (
    <>
      <Title accent="safely">Payday, safely.</Title>
      <Sub>You approve. Cashfree sends the UPI payment. Everyone gets a confirmation. In test mode no real money moves.</Sub>

      <div className="relative mx-auto mt-10 grid max-w-lg grid-cols-3 items-end text-center">
        <div><Person {...CAST.owner} className="mx-auto w-24" /><p className="mt-2 text-sm font-semibold">You approve</p></div>
        <div className="pb-8"><Coin className="mx-auto w-14" /><p className="mt-2 text-sm font-semibold">Cashfree pays</p></div>
        <div><Person {...CAST.worker} className="mx-auto w-24" /><p className="mt-2 text-sm font-semibold">They get it</p></div>
        {!reduce && (
          <motion.div aria-hidden className="pointer-events-none absolute top-8" initial={{ left: "14%", opacity: 0, scale: 0.6 }} animate={{ left: ["14%", "50%", "86%"], opacity: [0, 1, 0], scale: [0.6, 1.1, 0.7] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}>
            <Coin className="-ml-4 w-8" />
          </motion.div>
        )}
      </div>

      <div className="mx-auto mt-10 max-w-sm">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Workers with a UPI id</span>
          <span className="font-mono text-xs text-[#16152b]/55">{counts ? `${counts.withUpi} / ${counts.total}` : "…"}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#16152b]/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Workers with a UPI id">
          <motion.div className="h-full origin-left rounded-full bg-gradient-to-r from-[#ffb020] to-[#12a594]" initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.3 }} />
        </div>
        <p className="mt-2 text-center text-xs text-[#16152b]/45">A worker can be paid once their UPI id is on file.</p>
      </div>

      <Actions>
        <Pill onClick={onNext}>Got it</Pill>
      </Actions>
    </>
  );
}

/* --------------------------------------------------------------------- voice */

const EXAMPLES = ["Mark everyone present today", "Who hasn't been marked yet?", "Approve pay for the riders in Bengaluru"];

function VoiceStep({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  const [level, setLevel] = useState(0);
  const cleanup = useRef<() => void>(() => {});

  const alive = useAlive();
  useEffect(() => () => cleanup.current(), []);

  async function start() {
    cleanup.current(); // pressing Start twice must not leave the first microphone open
    if (!navigator.mediaDevices?.getUserMedia) return setState("unsupported");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) return stream.getTracks().forEach((t) => t.stop()); // moved on while the prompt was open
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      let last = 0;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const v = Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 90);
        if (Math.abs(v - last) > 0.02) {
          last = v;
          setLevel(v);
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
      cleanup.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      setState("on");
    } catch {
      setState("denied");
    }
  }

  function stop() {
    cleanup.current();
    cleanup.current = () => {};
    setState("idle");
    setLevel(0);
  }

  return (
    <>
      <Title accent="something">Try saying something.</Title>
      <Sub>Allow your microphone once. BolPay understands English, Hindi and other Indian languages.</Sub>

      <div className="relative mx-auto mt-8 flex h-72 w-72 items-center justify-center">
        {[1, 2, 3].map((n) => (
          <span key={n} aria-hidden className="absolute rounded-full border-0 bg-gradient-to-br from-[#ffb020]/30 to-[#ff5d73]/25 transition-transform duration-150 ease-out" style={{ width: 130 + n * 46, height: 130 + n * 46, transform: `scale(${1 + level * (0.12 + n * 0.1)})`, opacity: state === "on" ? 0.9 - n * 0.2 : 0.35 - n * 0.07 }} />
        ))}
        <Mic className="relative h-52 drop-shadow-[0_18px_24px_rgba(22,21,43,0.25)]" />
      </div>

      <div className="mt-2 flex flex-col items-center gap-3">
        {state === "on" ? (
          <>
            <p role="status" className="text-sm font-medium text-[#0b7a63]">I can hear you.</p>
            <SoftButton tone="light" onClick={stop}>Stop</SoftButton>
          </>
        ) : (
          <SoftButton onClick={start}><IconMic className="mr-2 size-4" />Turn on microphone</SoftButton>
        )}
        {state === "denied" && <ErrorText>Microphone access was blocked. Allow it from the address bar, or skip this.</ErrorText>}
        {state === "unsupported" && <ErrorText>This browser can&apos;t use the microphone here. Voice works best in Chrome or Safari over HTTPS.</ErrorText>}
      </div>

      <Stagger className="mx-auto mt-8 grid max-w-md gap-2">
        {EXAMPLES.map((e) => (
          <p key={e} className="rounded-full bg-white/70 px-5 py-2.5 text-center text-sm text-[#16152b]/70 shadow-[0_10px_26px_-18px_rgba(22,21,43,0.5)] backdrop-blur">&ldquo;{e}&rdquo;</p>
        ))}
      </Stagger>

      <Actions onSkip={state === "on" ? undefined : onNext}>
        <Pill onClick={() => { stop(); onNext(); }}>Continue</Pill>
      </Actions>
    </>
  );
}

/* -------------------------------------------------------------------- invite */

function InviteStep({ businessName, onInvited, onNext }: { businessName: string; onInvited: () => void; onNext: () => void }) {
  const [who, setWho] = useState("");
  const [link, setLink] = useState<{ path: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createInvite({ role: "supervisor", name: who });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setLink({ path: r.path, name: r.name });
    onInvited();
  }

  return (
    <>
      <Person {...CAST.supervisor} className="mx-auto mb-3 w-28" />
      <Title accent="floor">Who runs the floor?</Title>
      <Sub>A supervisor marks attendance for their own team. They can&apos;t see payouts or change pay rules.</Sub>
      {link ? (
        <div className="mt-8">
          <InviteLinkCard path={link.path} name={link.name} businessLabel={businessName} />
          <div className="mt-3 flex justify-center">
            <button type="button" onClick={() => { setLink(null); setWho(""); }} className="text-sm font-medium text-[#16152b]/60 hover:text-[#16152b]">Invite another supervisor</button>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <LineInput value={who} onChange={(e) => setWho(e.target.value)} placeholder="Their name" maxLength={80} aria-label="Supervisor's name" />
          <ErrorText>{error}</ErrorText>
          <div className="mt-8 flex justify-center">
            <SoftButton disabled={busy || who.trim().length < 2} onClick={create}>{busy ? "Creating…" : "Create invite link"}</SoftButton>
          </div>
        </div>
      )}
      <Actions onSkip={link ? undefined : onNext}>
        <Pill onClick={onNext}>{link ? "Continue" : "Continue without"}</Pill>
      </Actions>
    </>
  );
}

/* ---------------------------------------------------------------------- done */

function DoneStep({ businessName, team, invited }: { businessName: string; team: number; invited: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    const r = await finishOnboarding();
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    router.replace("/dashboard");
  }

  const items = [
    { done: true, label: "Business created" },
    { done: true, label: "Pay rules set" },
    { done: team > 0, label: team > 0 ? `${team} worker${team === 1 ? "" : "s"} added` : "Workers added later" },
    { done: invited, label: invited ? "Supervisor invited" : "Supervisor invited later" },
  ];

  return (
    <div className="relative">
      <Celebrate />
      <div className="mx-auto mb-6 flex max-w-sm items-end justify-center">
        {[CAST.aunty, CAST.builder, CAST.rider].map((p, i) => (
          <motion.div key={i} initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.15 + i * 0.12 }} className={i === 1 ? "z-10 -mx-3 w-32" : "w-24"}>
            <Person {...p} />
          </motion.div>
        ))}
      </div>
      <Title accent="ready">{`${businessName || "Your business"} is ready.`}</Title>
      <Sub>Anything you skipped is on your dashboard checklist.</Sub>
      <ul className="mx-auto mt-8 flex max-w-xs flex-col gap-2.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-3 text-[0.95rem]">
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${i.done ? "bg-[#12a594] text-white" : "bg-[#16152b]/10 text-transparent"}`}><IconDone className="size-4" /></span>
            <span className={i.done ? "font-medium" : "text-[#16152b]/45"}>{i.label}</span>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
      <Actions>
        <Pill onClick={finish} disabled={busy}>{busy ? "Opening…" : "Open my dashboard"}</Pill>
      </Actions>
    </div>
  );
}
