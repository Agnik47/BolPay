import "server-only";
import { rupees } from "@/app/lib/advances/policy";
import { addTrail, advancesOf, transactionOf } from "@/app/lib/advances/store";
import type { Transaction } from "@/app/lib/merchant/types";
import { getDb, logAudit, saveDb } from "@/app/lib/server/db";
import { ServiceError, submitToCashfree } from "@/app/lib/server/service";
import { assess, recordAssessment } from "./eligibility-agent";
import { delegationStillCovers, queue } from "./manager-agent";

/**
 * Agent 4: Payout Agent (execution and tracking).
 * Sends an approved advance through the existing Cashfree Payouts path: the amount and the UPI id come from the
 * server's own records, never from a request. Before any money moves it checks the approval is still valid and
 * the worker is still eligible, because things can change between approval and payment. It creates one
 * transaction per advance (a repeated call finds it and does nothing), so a double click cannot pay twice;
 * Cashfree dedupes on the transfer id as well. Outcomes (completed, failed, retried) are written to the trail by
 * the payment sync/webhook code, and a failed payment is retried from Transactions like any other.
 */
export async function pay(advanceId: string): Promise<void> {
  const db = getDb();
  const a = advancesOf(db).find((x) => x.id === advanceId);
  // Anything that is not an approval waiting for its payment is ignored: this is what makes calling it twice safe.
  if (!a || a.status !== "approved" || a.transactionId) return;
  const worker = db.workers.find((w) => w.id === a.workerId);
  if (!worker) throw new ServiceError("Worker not found", 404);

  // Everything up to the first await runs synchronously, so a concurrent call sees the transaction already created.
  const latest = assess(db, worker, a.amount, a.id);
  if (!latest.eligible) {
    a.status = "ineligible";
    a.approval = undefined;
    recordAssessment(a, latest);
    addTrail(a, "payout_agent", "Payment stopped", `The worker is no longer eligible: ${latest.reasons[0]}`);
    saveDb();
    throw new ServiceError(`Not paid: ${latest.reasons[0]}`, 409);
  }
  if (a.approval?.by === "manager_agent") {
    const problem = delegationStillCovers(db, a);
    if (problem) {
      a.approval = undefined;
      queue(a, { kind: "escalate", reason: problem });
      addTrail(a, "payout_agent", "Payment held", "The approval no longer holds, so nothing was sent.");
      saveDb();
      return;
    }
  }

  const tx: Transaction = {
    id: `tx-${a.id}`,
    payoutId: a.id,
    workerId: a.workerId,
    periodLabel: "Emergency advance",
    amount: a.amount,
    status: "processing",
    createdAt: new Date().toISOString(),
    reference: "Submitting…",
    attempt: 1,
    kind: "advance",
    advanceId: a.id,
  };
  db.transactions.push(tx);
  a.transactionId = tx.id;
  addTrail(a, "payout_agent", "Sending payment", `${rupees(a.amount)} to the worker's UPI ID through Cashfree.`);
  logAudit("advance.pay", `${a.id}: ${rupees(a.amount)} to ${worker.name} (${a.approval?.by ?? "unknown approver"})`);
  saveDb();

  await submitToCashfree([tx.id]);
  // Completed and failed outcomes are written by the payment code itself; only an in-flight transfer needs a note here.
  if (transactionOf(db, a)?.status === "processing") addTrail(a, "payout_agent", "Cashfree accepted the transfer", "It is processing; its status will update here.");
  saveDb();
}
