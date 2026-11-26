"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { AccountMenu } from "./AccountMenu";
import { VoiceAssistant } from "./VoiceAssistant";
import { StoreProvider, useStore } from "@/app/lib/merchant/store";
import { formatMoney } from "@/app/lib/merchant/format";
import { readPreferences } from "@/app/lib/client/preferences";
import { personName, ViewerProvider, useViewer, type Viewer } from "./viewer";
import { Brand } from "../icons";
import { ContentSkeleton } from "../Skeleton";
import { ToastProvider, useToast } from "../feedback/Toaster";

const ROLE_LABEL = { owner: "Owner", supervisor: "Supervisor" } as const;


/** Save errors from the store show up as toasts. */
function useErrorToasts() {
  const { error, dismissError } = useStore();
  const toast = useToast();
  useEffect(() => {
    if (!error) return;
    toast({ tone: "error", title: error });
    dismissError();
  }, [error, dismissError, toast]);
}

/** Announces Cashfree payments that complete or fail, whether from polling, an approval or a voice flow. */
function usePaymentAlerts() {
  const { transactions, loaded, workerById } = useStore();
  const toast = useToast();
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const prev = seen.current;
    seen.current = new Map(transactions.map((t) => [t.id, t.status]));
    if (!prev || !readPreferences().paymentAlerts) return;

    const completed = transactions.filter((t) => t.status === "completed" && prev.get(t.id) !== "completed");
    const failed = transactions.filter((t) => t.status === "failed" && prev.get(t.id) !== "failed");
    const name = (id: string) => workerById(id)?.name ?? "a worker";

    if (completed.length === 1) {
      const t = completed[0];
      toast({ tone: "success", sound: "payment", title: "Payment completed", description: `${name(t.workerId)} received ${formatMoney(t.amount)}.` });
    } else if (completed.length > 1) {
      const total = completed.reduce((s, t) => s + t.amount, 0);
      toast({ tone: "success", sound: "payment", title: `${completed.length} payments completed`, description: `${formatMoney(total)} paid out through Cashfree.` });
    }
    if (failed.length) {
      toast({
        tone: "error",
        title: failed.length === 1 ? `Payment to ${name(failed[0].workerId)} failed` : `${failed.length} payments failed`,
        description: failed.length === 1 ? failed[0].failureReason : "Open Transactions to see why and retry.",
        action: { label: "Review transactions", href: "/transactions" },
      });
    }
  }, [transactions, loaded, workerById, toast]);
}

function Frame({ children }: { children: React.ReactNode }) {
  const { payouts, loaded } = useStore();
  const viewer = useViewer();
  const pending = payouts.filter((p) => p.status === "pending").length;
  useErrorToasts();
  usePaymentAlerts();

  const name = personName(viewer.displayName);
  const role = ROLE_LABEL[viewer.role];

  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menu]);

  return (
    // minmax(0, 1fr): a wide table must scroll inside its card, never widen the page.
    <div className="min-h-dvh bg-canvas text-slate-900 md:grid md:grid-cols-[216px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-4 py-4">
          <Brand sub={viewer.businessName} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <Sidebar role={viewer.role} pendingCount={pending} />
        </div>
        <div className="border-t border-slate-200 p-2">
          <AccountMenu name={name} role={role} />
        </div>
      </aside>

      {/* Phones: a slim top bar, with the whole navigation in a drawer. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu} className="relative flex size-10 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
            <svg viewBox="0 0 20 20" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" />
            </svg>
            {pending > 0 && viewer.role === "owner" && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-amber-500" aria-hidden />}
          </button>
          <Brand sub={viewer.businessName} />
        </div>
        <AccountMenu name={name} role={role} compact />
      </header>
      {menu && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setMenu(false)} className="absolute inset-0 bg-slate-900/50" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            // Following any link closes the drawer.
            onClick={(e) => (e.target as HTMLElement).closest("a") && setMenu(false)}
            className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col bg-white shadow-xl [&_nav_a]:py-2.5"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <Brand sub={viewer.businessName} />
              <button type="button" autoFocus onClick={() => setMenu(false)} aria-label="Close menu" className="flex size-10 shrink-0 items-center justify-center rounded-md text-xl text-slate-500 hover:bg-slate-100">×</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <Sidebar role={viewer.role} pendingCount={pending} />
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-5 pb-28 md:px-8 md:py-7">
        {!loaded && <ContentSkeleton />}
        {/* Always rendered (so Next can validate the page) but hidden until data arrives, to avoid a flash of empty state. */}
        <div hidden={!loaded}>{children}</div>
      </main>
      <VoiceAssistant />
    </div>
  );
}

export function Shell({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  return (
    <ViewerProvider viewer={viewer}>
      <ToastProvider>
        <StoreProvider>
          <Frame>{children}</Frame>
        </StoreProvider>
      </ToastProvider>
    </ViewerProvider>
  );
}
