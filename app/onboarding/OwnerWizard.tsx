"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CYCLES, DEFAULT_WAGE, indexOf, TOTAL, type Cycle, type WizardStep } from "@/app/components/onboarding/flow";
import { Actions, Caps, Chip, ErrorText, LineInput, Pill, Sub, Title } from "@/app/components/onboarding/kit";
import { Stage } from "@/app/components/onboarding/Stage";
import { finishOnboarding, setUpBusiness } from "./actions";
import { TeamStep } from "./TeamStep";

/** Everything after the account, in two screens: name the business (and payday), then bring the team in. */
export function OwnerWizard({ initialStep, ownerName, zohoFlag, zohoReason }: {
  initialStep: WizardStep;
  ownerName: string;
  zohoFlag: string | null;
  zohoReason: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [name, setName] = useState("");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = ownerName.trim().split(" ")[0];
  const nameOk = name.trim().length >= 2;

  async function create(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nameOk || busy) return;
    setBusy(true);
    setError(null);
    const r = await setUpBusiness({ name, payCycle: cycle });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setStep("team");
  }

  /** The team step is the last one: leaving it opens the dashboard, whose checklist covers anything skipped. */
  async function finish() {
    setBusy(true);
    setError(null);
    const r = await finishOnboarding();
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    router.replace("/dashboard");
  }

  return (
    <Stage stepKey={step} index={indexOf(step)} total={TOTAL} wide={step === "team"}>
      {step === "business" && (
        <form onSubmit={create}>
          <Title accent="business">{first ? `Hi ${first}, name your business.` : "Name your business."}</Title>
          <Sub>Everything else can wait. You can change any of it later.</Sub>
          <div className="mt-8">
            <LineInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" maxLength={80} autoFocus aria-label="Business name" />
          </div>
          <div className="mt-10">
            <Caps>Payday</Caps>
            <div role="radiogroup" aria-label="Payday" className="flex flex-wrap justify-center gap-2.5">
              {CYCLES.map((c) => (
                <Chip key={c.value} selected={cycle === c.value} onClick={() => setCycle(c.value)}>{c.title}</Chip>
              ))}
            </div>
          </div>
          <ErrorText>{error}</ErrorText>
          <Actions>
            <Pill type="submit" disabled={!nameOk || busy}>{busy ? "Creating…" : "Create my workspace"}</Pill>
          </Actions>
        </form>
      )}

      {step === "team" && (
        <>
          <TeamStep defaultWage={DEFAULT_WAGE} zohoFlag={zohoFlag} zohoReason={zohoReason} busy={busy} onNext={finish} />
          <ErrorText>{error}</ErrorText>
        </>
      )}
    </Stage>
  );
}
