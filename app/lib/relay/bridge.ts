import "server-only";

/**
 * Hands emergency-advance work to agents running on Cashfree Relay. Each Relay agent starts from its own
 * Inbound Webhook URL (copied from the Relay canvas into .env) and calls back into /api/relay/advances/<stage>,
 * where BolPay's deterministic rules do the actual checking, approving and paying.
 *
 * Only ids and non-sensitive facts are sent: never a UPI id, phone number or another worker's data. When a stage
 * has no webhook configured (or Relay can't be reached) the caller runs that stage in-process instead, so the
 * product never depends on Relay being up.
 */
export type RelayStage = "eligibility" | "manager" | "payout" | "worker";

const ENV: Record<RelayStage, string> = {
  eligibility: "RELAY_ELIGIBILITY_WEBHOOK",
  manager: "RELAY_MANAGER_WEBHOOK",
  payout: "RELAY_PAYOUT_WEBHOOK",
  worker: "RELAY_WORKER_WEBHOOK",
};

const webhookFor = (stage: RelayStage) => {
  const url = process.env[ENV[stage]]?.trim();
  return url && /^https:\/\//.test(url) ? url : null;
};

export const relayEnabled = (stage: RelayStage) => webhookFor(stage) !== null;

/**
 * Two ways to run with Relay:
 *  - "notify" (default): BolPay's deterministic engine decides each step and pushes the decision to that step's Relay
 *    agent, which does its AI/action work with native Relay steps (Sarvam, Cashfree Communication). Works today.
 *  - "callback": each Relay agent calls BolPay back (HTTP step) to run the step. Needs the BolPay domain on
 *    Cashfree Relay's approved-websites list for the HTTP step.
 */
export const relayCallbacks = () => process.env.RELAY_MODE === "callback";
/** True when a stage is handed to Relay and BolPay waits for that agent to call back. */
export const relayHandoff = (stage: RelayStage) => relayCallbacks() && relayEnabled(stage);

/** POSTs one event to the stage's Relay agent. Never throws; `runId` is Relay's execution id when it accepted the event. */
export async function sendToRelay(stage: RelayStage, payload: Record<string, unknown>): Promise<{ ok: boolean; runId?: string }> {
  const url = webhookFor(stage);
  if (!url) return { ok: false };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Relay exposes the "data" object of the body to the agent's steps as ${node_1.output.data.<field>}.
      body: JSON.stringify({ data: { stage, source: "bolpay", ...payload } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Relay ${stage} webhook answered ${res.status}`);
      return { ok: false };
    }
    const body = (await res.json().catch(() => ({}))) as { executionId?: unknown };
    return { ok: true, runId: body.executionId === undefined ? undefined : String(body.executionId).slice(0, 40) };
  } catch (err) {
    console.error(`Relay ${stage} webhook unreachable`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export async function emitToRelay(stage: RelayStage, payload: Record<string, unknown>): Promise<boolean> {
  return (await sendToRelay(stage, payload)).ok;
}

/** The agent names as built on the Relay canvas, shown in the audit trail. */
export const RELAY_AGENT_NAME: Record<RelayStage, string> = {
  worker: "BolPay - 1 Worker Assistance Agent",
  eligibility: "BolPay - 2 Financial Eligibility Agent",
  manager: "BolPay - 3 Manager Agent",
  payout: "BolPay - 4 Payout Agent",
};
