"use client";

import { useState } from "react";
import { IconMic } from "../icons";
import { Card } from "../merchant/ui";
import { AssistantStage } from "./AssistantStage";

/** The worker's entry to the full-screen BolPay Voice AI: ask about pay and advances in their own language. */
export function AssistantLauncher({ workerName }: { workerName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-4 px-1">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">Ask BolPay AI</p>
            <p className="mt-0.5 max-w-md text-sm text-slate-600">Ask about your pay or advance, or request an advance, by speaking or typing in your own language.</p>
          </div>
          <button type="button" data-sound="off" onClick={() => setOpen(true)} className="flex h-12 items-center gap-2.5 rounded-full bg-teal-700 px-6 text-sm font-semibold text-white shadow-lg shadow-teal-700/25 transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
            <IconMic className="size-5" /> Talk to BolPay AI
          </button>
        </div>
      </Card>
      {open && <AssistantStage role="worker" userName={workerName} onClose={() => setOpen(false)} />}
    </>
  );
}
