"use client";

/**
 * Heavy parts that are only needed sometimes, split into their own chunks. Each shows a placeholder while its code
 * downloads, so a tap or a page never looks dead.
 */
import dynamic from "next/dynamic";
import { ListSkeleton } from "./Skeleton";

/** Full-screen placeholder with the voice screen's background, so opening it doesn't flash. */
function VoiceLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Opening voice assistant" className="fixed inset-0 z-[70] flex items-center justify-center bg-[#04161a]">
      <span className="size-40 animate-pulse rounded-full bg-white/10" />
    </div>
  );
}

const panel = () => <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4"><ListSkeleton label="Loading panel" rows={3} /></div>;

export const LazyAssistantStage = dynamic(() => import("./me/AssistantStage").then((m) => m.AssistantStage), { ssr: false, loading: VoiceLoading });
export const LazyVoiceStage = dynamic(() => import("./me/VoiceStage").then((m) => m.VoiceStage), { ssr: false, loading: VoiceLoading });
export const LazyFundingAgentCard = dynamic(() => import("./merchant/FundingAgentCard").then((m) => m.FundingAgentCard), { ssr: false, loading: panel });
export const LazyRelayCard = dynamic(() => import("./merchant/RelayCard").then((m) => m.RelayCard), { ssr: false, loading: panel });
export const LazyAdvancePolicyPanel = dynamic(() => import("./merchant/views/AdvancePolicyPanel").then((m) => m.AdvancePolicyPanel), { ssr: false, loading: panel });
