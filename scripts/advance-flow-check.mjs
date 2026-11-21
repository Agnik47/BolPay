// End-to-end check of the emergency-advance agents against the real service layer, the real file database and
// the real Cashfree payout code. Only the network is faked: Cashfree Payouts and Groq are answered locally.
//
// Run: node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/advance-flow-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bolpay-advance-"));
process.env.CASHFREE_CLIENT_ID = "test-id";
process.env.CASHFREE_CLIENT_SECRET = "test-secret";
process.env.CASHFREE_ENVIRONMENT = "sandbox";
process.env.GROQ_API_KEY = "test-groq";

/* ------------------------------- fake network ------------------------------- */

const cf = { transfers: new Map(), posts: [], beneficiaries: [], nextStatus: "SUCCESS", n: 0 };
const groqCalls = [];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  if (u.startsWith("https://sandbox.cashfree.com/payout")) {
    const p = u.replace("https://sandbox.cashfree.com/payout", "");
    if (p === "/beneficiary" && init.method === "POST") {
      cf.beneficiaries.push(body);
      return json(200, { beneficiary_status: "VERIFIED" });
    }
    if (p === "/transfers" && init.method === "POST") {
      if (cf.transfers.has(body.transfer_id)) return json(409, { message: "transfer already exists", code: "transfer_id_already_exists" });
      cf.posts.push(body);
      const t = { status: cf.nextStatus, utr: cf.nextStatus === "SUCCESS" ? `UTR${++cf.n}` : undefined, cf: `cf_${cf.n}`, reason: cf.nextStatus === "FAILED" ? "Beneficiary bank is down" : undefined };
      cf.transfers.set(body.transfer_id, t);
      return json(200, { transfer_id: body.transfer_id, cf_transfer_id: t.cf, status: t.status, transfer_utr: t.utr, status_description: t.reason });
    }
    if (p.startsWith("/transfers?transfer_id=")) {
      const id = decodeURIComponent(p.split("=")[1]);
      const t = cf.transfers.get(id);
      if (!t) return json(404, { message: "transfer not found", code: "transfer_not_found" });
      return json(200, { transfer_id: id, cf_transfer_id: t.cf, status: t.status, transfer_utr: t.utr, status_description: t.reason });
    }
    return json(404, { message: `unexpected Cashfree call ${init.method} ${p}` });
  }
  if (u.startsWith("https://api.groq.com/")) {
    const messages = body.messages;
    const system = messages[0].content;
    const last = messages.at(-1).content;
    groqCalls.push(system.slice(0, 40));
    let content;
    if (system.includes("Translate the user's message into")) {
      content = `[translated] ${last}`;
    } else {
      // The Worker Assistance Agent prompt: stand in for the model with a few simple readings.
      const said = last.replace(/^Worker's words \(oldest first\):\s*/, "").replace(/Turn \d+: /g, "");
      const digits = said.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
      const m = digits.match(/(\d[\d,]*)/);
      const amount = m ? Number(m[1].replace(/,/g, "")) : null;
      const bengali = /[ঀ-৿]/.test(said);
      const chatter = /^\s*(hello|hi|thanks)\b/i.test(said);
      content = JSON.stringify({
        intent: chatter ? "other" : amount ? "emergency_salary_advance" : "clarify",
        amount,
        // A lenient model: it believes "emergency" and only knows a few words. The code-side guardrail must not.
        reason: /birthday party|party/i.test(said) && !/emergency/i.test(said) ? "celebration" : /cat|dog/i.test(said) ? "pet" : /bike|accident|দুর্ঘটনা|অ্যাক্সিডেন্ট/i.test(said) ? "vehicle_repair" : /hospital|medical|doctor|emergency/i.test(said) ? "medical" : "other",
        reasonText: /party/i.test(said) ? "birthday party" : /cat|dog/i.test(said) ? "pet died" : /bike/i.test(said) ? "bike repair" : /hospital/i.test(said) ? "hospital bill" : /emergency/i.test(said) ? "emergency" : "not stated",
        urgency: /accident|hospital|দুর্ঘটনা|অ্যাক্সিডেন্ট/i.test(said) ? "high" : "medium",
        language: bengali ? "bn" : "en",
        clarificationQuestion: amount ? null : bengali ? "কত টাকা লাগবে?" : "How much do you need?",
      });
    }
    return json(200, { choices: [{ message: { content }, finish_reason: "stop" }] });
  }
  throw new Error(`Unexpected network call to ${u}`);
};

/* ------------------------------- load the app ------------------------------- */

const { getDb, resetDb, saveDb } = await import("@/app/lib/server/db");
const svc = await import("@/app/lib/server/service");
const adv = await import("@/app/lib/server/advances");
const agent1 = await import("@/app/lib/agents/worker-agent");
const store = await import("@/app/lib/advances/store");
const { ServiceError } = svc;

/* --------------------------------- harness --------------------------------- */

let passed = 0;
let failed = 0;
async function test(name, fn) {
  resetDb("demo");
  cf.transfers.clear();
  cf.posts.length = 0;
  cf.beneficiaries.length = 0;
  cf.nextStatus = "SUCCESS";
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err instanceof Error ? (err.stack ?? err.message).split("\n").slice(0, 4).join("\n     ") : err}`);
  }
}

const worker = (id) => getDb().workers.find((w) => w.id === id);
const available = (id) => adv.workerOverview(worker(id)).summary.availableLimit;
const advances = () => store.advancesOf(getDb());
const byId = (id) => advances().find((a) => a.id === id);

/** A worker says something and confirms the read-back, like the screen does. */
async function ask(id, text) {
  // Every request needs a reason now; scenarios that are about something else give a plain medical one.
  const said = /bike|hospital|accident|party|cat|dog|emergency|অ্যাক্সিডেন্ট|দুর্ঘটনা/i.test(text) ? text : `${text} for a hospital bill`;
  const turn = await agent1.takeTurn(id, said);
  assert.equal(turn.kind, "confirm", `expected a read-back for "${text}", got ${turn.kind}`);
  return adv.confirmRequest(worker(id), turn.draftId);
}
const delegate = async (over = {}) =>
  adv.updateConfig(
    { ownerAvailable: false, delegation: { maxPerRequest: 1000, dailyLimit: 1500, expiresOn: "2026-11-10", ...over } },
    "Test Owner",
  );

/* ================================ Agent 1 ================================ */

await test("Agent 1 reads a Bengali request, reads it back in Bengali and keeps the draft on the server", async () => {
  const turn = await agent1.takeTurn("w1", "আমার বাইক অ্যাক্সিডেন্ট হয়ে গিয়েছে। ২০০০ টাকা লাগবে।");
  assert.equal(turn.kind, "confirm");
  assert.equal(turn.language, "bn");
  assert.equal(turn.request.amount, 2000);
  assert.equal(turn.request.urgency, "high");
  assert.match(turn.readback, /^\[translated\] .*₹2000/);
  assert.match(turn.readbackEnglish, /You need ₹2000 as an emergency salary advance/);
  assert.equal(advances().length, 0, "nothing is submitted before the worker confirms");
});

await test("Agent 1 asks a follow-up when the amount is missing, then continues the same draft", async () => {
  const first = await agent1.takeTurn("w1", "my bike broke down");
  assert.equal(first.kind, "ask");
  const second = await agent1.takeTurn("w1", "1500 rupees", first.draftId);
  assert.equal(second.kind, "confirm");
  assert.equal(second.draftId, first.draftId);
  assert.equal(second.request.amount, 1500);
});

await test("Agent 1 stays out of the way for chatter, and a draft belongs to one worker only", async () => {
  const chat = await agent1.takeTurn("w1", "hello");
  assert.equal(chat.kind, "not_advance");
  const turn = await agent1.takeTurn("w1", "I need 1000 for a hospital bill");
  assert.equal(agent1.takeDraft("w2", turn.draftId), null, "another worker cannot use this draft");
  assert.ok(agent1.takeDraft("w1", turn.draftId), "its owner can");
  assert.equal(agent1.takeDraft("w1", turn.draftId), null, "and only once");
});

await test("without a language model the agent still reads an amount from the text", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes("groq.com") ? json(500, {}) : realFetch(url, init));
  try {
    const turn = await agent1.takeTurn("w1", "আমার ২০০০ টাকা দরকার");
    // It still reads the amount and language, but can't tell the reason without a model, so it asks why
    // (and anything it can't classify needs the owner, never the Manager Agent).
    assert.equal(turn.kind, "ask");
    assert.equal(turn.language, "bn");
    assert.match(turn.questionEnglish, /What is the emergency/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ============================ Agents 2, 3 and 4 ============================ */

await test("owner available: eligible request waits for the owner, nothing is paid; approving pays exactly once from server records", async () => {
  const amount = Math.min(1000, available("w1"));
  assert.ok(amount >= 100);
  const r = await ask("w1", `My bike broke down, I need ${amount} rupees`);
  assert.equal(r.advance.status, "awaiting_approval");
  assert.equal(cf.posts.length, 0, "no money moves before approval");

  await adv.ownerDecide(r.advance.id, "approve");
  const a = byId(r.advance.id);
  assert.equal(a.status, "approved");
  assert.equal(a.approval.by, "owner");
  assert.equal(cf.posts.length, 1);
  assert.equal(cf.posts[0].transfer_amount, amount);
  assert.equal(cf.beneficiaries[0].beneficiary_instrument_details.vpa, worker("w1").payoutUpi, "the UPI id comes from the worker record");
  const tx = getDb().transactions.find((t) => t.id === a.transactionId);
  assert.equal(tx.kind, "advance");
  assert.equal(tx.status, "completed");
  assert.ok(a.trail.some((t) => t.actor === "payout_agent" && t.action === "Payment completed"));
  assert.equal(store.outstandingTotal(getDb(), "w1"), amount);
});

await test("approving twice at the same time sends one transfer and the second call is refused", async () => {
  const r = await ask("w2", "I need 800 rupees for the hospital");
  const results = await Promise.allSettled([adv.ownerDecide(r.advance.id, "approve"), adv.ownerDecide(r.advance.id, "approve")]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const rejected = results.find((x) => x.status === "rejected");
  assert.ok(rejected.reason instanceof ServiceError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(cf.posts.length, 1, "exactly one Cashfree transfer");
  assert.equal(getDb().transactions.filter((t) => t.advanceId === r.advance.id).length, 1);
});

await test("a request above the available limit is declined by the Eligibility Agent and nothing is sent", async () => {
  const r = await ask("w1", "I need 50000 rupees");
  assert.equal(r.advance.status, "ineligible");
  assert.match(r.messageEnglish, /Not (approved|eligible)/);
  assert.equal(cf.posts.length, 0);
  assert.ok(advances()[0].trail.some((t) => t.actor === "eligibility_agent" && t.action === "Not eligible"));
});

await test("a second request while one is open, and the same amount again, is declined", async () => {
  const amount = Math.min(500, available("w3"));
  const first = await ask("w3", `I need ${amount} rupees`);
  assert.equal(first.advance.status, "awaiting_approval");
  const second = await ask("w3", `I need ${amount} rupees`);
  assert.equal(second.advance.status, "ineligible");
  assert.ok(byId(second.advance.id).eligibility.checks.find((c) => c.id === "no_duplicate" && !c.passed));
});

await test("an advance already paid reduces what can be asked next, using the 25% rule", async () => {
  const before = available("w4");
  const amount = Math.floor(before / 2);
  const r = await ask("w4", `I need ${amount} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  const after = adv.workerOverview(worker("w4")).summary;
  assert.equal(after.outstanding, amount);
  assert.equal(after.availableLimit, before - amount);
  assert.equal(after.availableLimit, after.policyLimit - after.outstanding);
});

await test("this period's salary already approved: no advance is possible", async () => {
  svc.submitPeriod({ workerIds: ["w5"] });
  const payout = getDb().payouts.find((p) => p.workerId === "w5" && p.status === "pending");
  await svc.decidePayouts([payout.id], "approved");
  const r = await ask("w5", "I need 500 rupees");
  assert.equal(r.advance.status, "ineligible");
  assert.equal(adv.workerOverview(worker("w5")).summary.availableLimit, 0);
});

await test("conflicting attendance records make the worker ineligible until fixed", async () => {
  const db = getDb();
  db.attendance.find((r) => r.workerId === "w6" && r.status === "present" && r.date >= "2026-10-21" && r.units > 0).status = "absent"; // absent but deliveries logged, this period
  const r = await ask("w6", "I need 500 rupees");
  assert.equal(r.advance.status, "ineligible");
  assert.ok(byId(r.advance.id).eligibility.checks.find((c) => c.id === "records_consistent" && !c.passed));
});

await test("no valid UPI id: ineligible, so nothing can fail at payment", async () => {
  worker("w7").payoutUpi = "";
  const r = await ask("w7", "I need 500 rupees");
  assert.equal(r.advance.status, "ineligible");
  assert.ok(byId(r.advance.id).eligibility.checks.find((c) => c.id === "payout_account" && !c.passed));
});

/* ----------------------------- Manager Agent ----------------------------- */

await test("owner away + delegation: the Manager Agent approves within limits and the Payout Agent pays", async () => {
  await delegate();
  const amount = Math.min(1000, available("w1"));
  const r = await ask("w1", `Hospital bill, I need ${amount} rupees`);
  assert.equal(r.advance.status, "approved");
  const a = byId(r.advance.id);
  assert.equal(a.approval.by, "manager_agent");
  assert.ok(a.approval.delegationId);
  assert.equal(cf.posts.length, 1);
  assert.equal(r.advance.payment, "completed");
  assert.ok(a.trail.some((t) => t.actor === "manager_agent" && t.action === "Approved within delegated authority"));
  assert.match(r.messageEnglish, /Approved/);
});

await test("Manager Agent escalates above its per-request authority, and the owner can then approve", async () => {
  await delegate({ maxPerRequest: 500 });
  const amount = Math.min(900, available("w1"));
  assert.ok(amount > 500);
  const r = await ask("w1", `I need ${amount} rupees`);
  assert.equal(r.advance.status, "escalated");
  assert.equal(cf.posts.length, 0);
  assert.ok(byId(r.advance.id).trail.some((t) => t.action === "Escalated to the owner" && /per-request authority/.test(t.detail)));
  await adv.ownerDecide(r.advance.id, "approve");
  assert.equal(byId(r.advance.id).approval.by, "owner");
  assert.equal(cf.posts.length, 1);
});

await test("Manager Agent stops at the daily limit", async () => {
  await delegate({ maxPerRequest: 1000, dailyLimit: 1500 });
  const a1 = Math.min(1000, available("w1"));
  const a2 = Math.min(700, available("w2"));
  const first = await ask("w1", `I need ${a1} rupees`);
  assert.equal(first.advance.status, "approved");
  const second = await ask("w2", `I need ${a2} rupees`);
  assert.equal(second.advance.status, a1 + a2 > 1500 ? "escalated" : "approved");
  assert.ok(a1 + a2 > 1500, "the test needs the two amounts to pass the daily limit");
  assert.equal(adv.ownerOverview().config.agentApprovedToday, a1);
});

await test("an expired or revoked delegation approves nothing", async () => {
  await adv.updateConfig({ ownerAvailable: false, delegation: { maxPerRequest: 1000, dailyLimit: 5000, expiresOn: "2026-11-03" } }, "Owner");
  const lastDay = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  assert.equal(lastDay.advance.status, "approved", "the expiry day itself is still covered");
  getDb().advanceConfig.delegation.expiresOn = "2026-11-02"; // now expired
  const expired = await ask("w2", `I need ${Math.min(500, available("w2"))} rupees`);
  assert.equal(expired.advance.status, "escalated");
  await adv.updateConfig({ delegation: null }, "Owner");
  const revoked = await ask("w3", `I need ${Math.min(500, available("w3"))} rupees`);
  assert.equal(revoked.advance.status, "escalated");
  assert.equal(cf.posts.length, 1);
});

await test("a request with warning flags is never auto-approved", async () => {
  await delegate();
  worker("w8").joinedOn = "2026-11-01"; // joined two days ago: flagged
  const r = await ask("w8", `I need ${Math.min(500, available("w8"))} rupees`);
  assert.equal(r.advance.status, "escalated");
  assert.match(byId(r.advance.id).trail.find((t) => t.action === "Escalated to the owner").detail, /Joined only/);
  assert.equal(cf.posts.length, 0);
});

await test("the owner being available always wins over a delegation", async () => {
  await adv.updateConfig({ ownerAvailable: true, delegation: { maxPerRequest: 1000, dailyLimit: 5000, expiresOn: "2026-11-10" } }, "Owner");
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  assert.equal(r.advance.status, "awaiting_approval");
  assert.equal(cf.posts.length, 0);
});

await test("granting a delegation while requests are queued clears the ones it covers", async () => {
  await adv.updateConfig({ ownerAvailable: false }, "Owner"); // away, no delegation: requests are escalated
  const r1 = await ask("w1", `I need ${Math.min(600, available("w1"))} rupees`);
  const r2 = await ask("w2", `I need ${Math.min(1200, available("w2"))} rupees`);
  assert.equal(r1.advance.status, "escalated");
  assert.equal(r2.advance.status, "escalated");
  await adv.updateConfig({ delegation: { maxPerRequest: 1000, dailyLimit: 5000, expiresOn: "2026-11-10" } }, "Owner");
  assert.equal(byId(r1.advance.id).status, "approved", "within the new authority");
  assert.equal(byId(r2.advance.id).status, "escalated", "above it, still waiting for the owner");
  assert.equal(cf.posts.length, 1);
});

await test("the Payout Agent re-checks the delegation just before paying: a revoked one holds the payment", async () => {
  await delegate();
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  // Simulate an approval that was recorded and then the owner revoked the authority before the transfer started.
  const a = byId(r.advance.id);
  a.status = "approved";
  a.transactionId = undefined;
  getDb().transactions = getDb().transactions.filter((t) => t.advanceId !== a.id);
  cf.posts.length = 0;
  cf.transfers.clear();
  getDb().advanceConfig.delegation = null;
  const { pay } = await import("@/app/lib/agents/payout-agent");
  await pay(a.id);
  assert.equal(a.status, "escalated");
  assert.equal(cf.posts.length, 0, "nothing was sent");
});

await test("the Payout Agent refuses to pay if the worker stopped being eligible after approval", async () => {
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  const a = byId(r.advance.id);
  worker("w1").payoutUpi = ""; // UPI id removed between the decision and the payment
  await assert.rejects(adv.ownerDecide(a.id, "approve"), (e) => e instanceof ServiceError && e.status === 409);
  assert.equal(a.status, "ineligible");
  assert.equal(cf.posts.length, 0);
});

await test("only the owner-side config route can change authority, and it validates what it is given", async () => {
  const bad = (patch, re) => assert.rejects(adv.updateConfig(patch, "Owner"), (e) => e instanceof ServiceError && re.test(e.message));
  await bad({ delegation: { maxPerRequest: 20000, dailyLimit: 30000, expiresOn: "2026-11-10" } }, /per-request limit/);
  await bad({ delegation: { maxPerRequest: 1000, dailyLimit: 500, expiresOn: "2026-11-10" } }, /daily limit/);
  await bad({ delegation: { maxPerRequest: 1000, dailyLimit: 5000, expiresOn: "2026-11-01" } }, /expiry date/);
  await bad({ delegation: { maxPerRequest: 1000, dailyLimit: 5000, expiresOn: "2027-06-01" } }, /expiry date/);
  await bad({ policyPercent: 80 }, /between 5% and 50%/);
  await bad({ ownerAvailable: "yes" }, /true or false/);
});

/* ----------------------------- Payout Agent ----------------------------- */

await test("a failed Cashfree payment is recorded, can be retried from Transactions, and then completes", async () => {
  cf.nextStatus = "FAILED";
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  const a = byId(r.advance.id);
  const tx = getDb().transactions.find((t) => t.id === a.transactionId);
  assert.equal(tx.status, "failed");
  assert.ok(a.trail.some((t) => t.action === "Payment failed" && /bank is down/.test(t.detail)));
  assert.equal(store.outstandingTotal(getDb(), "w1"), 0, "money that never arrived is not owed");

  cf.nextStatus = "SUCCESS";
  await svc.retryTransaction(tx.id);
  assert.equal(tx.status, "completed");
  assert.ok(a.trail.some((t) => t.action === "Payment retried"));
  assert.ok(a.trail.some((t) => t.action === "Payment completed"));
  assert.equal(store.outstandingTotal(getDb(), "w1"), a.amount);
  assert.equal(cf.posts.length, 2, "the retry is a new attempt");
});

await test("an advance whose payment failed blocks a new request until the owner closes it", async () => {
  cf.nextStatus = "FAILED";
  const amount = Math.min(500, available("w1"));
  const r = await ask("w1", `I need ${amount} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  const again = await ask("w1", `I need ${amount + 100} rupees`);
  assert.equal(again.advance.status, "ineligible");
  await adv.ownerDecide(r.advance.id, "reject"); // close it
  assert.equal(byId(r.advance.id).status, "rejected");
  const later = await ask("w1", `I need ${amount} rupees`);
  assert.equal(later.advance.status, "awaiting_approval");
});

await test("a transfer that is still processing is settled by sync and by the webhook path, once each", async () => {
  cf.nextStatus = "RECEIVED";
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  const a = byId(r.advance.id);
  const tx = getDb().transactions.find((t) => t.id === a.transactionId);
  assert.equal(tx.status, "processing");
  assert.equal(adv.workerOverview(worker("w1")).advances[0].payment, "processing");

  cf.transfers.get(tx.transferId).status = "SUCCESS";
  cf.transfers.get(tx.transferId).utr = "UTRSYNC1";
  await svc.syncTransactions((t) => t.kind === "advance" && t.workerId === "w1");
  assert.equal(tx.status, "completed");
  svc.applyWebhookTransfer({ transferId: tx.transferId, status: "completed", utr: "UTRSYNC1" }); // a replayed webhook
  assert.equal(a.trail.filter((t) => t.action === "Payment completed").length, 1, "the outcome is written once");
  assert.equal(adv.workerOverview(worker("w1")).advances[0].paymentReference, "UTRSYNC1");
});

await test("a webhook alone settles an advance when nobody has a screen open", async () => {
  cf.nextStatus = "RECEIVED";
  const r = await ask("w2", `I need ${Math.min(500, available("w2"))} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  const a = byId(r.advance.id);
  const tx = getDb().transactions.find((t) => t.id === a.transactionId);
  assert.ok(svc.applyWebhookTransfer({ transferId: tx.transferId, status: "failed", error: "Bank declined" }));
  assert.equal(a.paymentRecorded, "failed");
  assert.ok(a.trail.some((t) => t.action === "Payment failed" && /Bank declined/.test(t.detail)));
});

/* ------------------------------- recovery ------------------------------- */

await test("a paid advance is taken back from the next salary payout, at most half of it, and only once", async () => {
  const amount = Math.min(1000, available("w1"));
  const r = await ask("w1", `I need ${amount} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  const a = byId(r.advance.id);

  svc.submitPeriod({ workerIds: ["w1"] });
  const payout = getDb().payouts.find((p) => p.workerId === "w1" && p.status === "pending");
  const gross = payout.breakdown.total;
  const expected = Math.min(amount, Math.floor(gross * 0.5));
  assert.equal(payout.advanceDeduction, expected, "preview before approval");
  assert.equal(payout.amount, Math.round((gross - expected) * 100) / 100);

  cf.posts.length = 0;
  await svc.decidePayouts([payout.id], "approved");
  assert.equal(a.recovered, expected);
  assert.equal(cf.posts.length, 1);
  assert.equal(cf.posts[0].transfer_amount, Math.round((gross - expected) * 100) / 100, "Cashfree is sent the net amount");
  assert.ok(a.trail.some((t) => t.action === "Recovered from salary"));
  assert.equal(store.outstandingTotal(getDb(), "w1"), amount - expected);
  // Deciding the same payout again does nothing and recovers nothing more.
  await assert.rejects(svc.decidePayouts([payout.id], "approved"), (e) => e instanceof ServiceError && e.status === 409);
  assert.equal(a.recovered, expected);
});

await test("an advance paid after a salary payout was prepared is still recovered when that payout is approved", async () => {
  svc.submitPeriod({ workerIds: ["w1"] });
  const payout = getDb().payouts.find((p) => p.workerId === "w1" && p.status === "pending");
  assert.equal(payout.advanceDeduction, undefined);
  // Eligibility refuses new advances only once the salary is approved, so one can still be paid while it is pending.
  const amount = Math.min(400, available("w1"));
  const r = await ask("w1", `I need ${amount} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  await svc.decidePayouts([payout.id], "approved");
  const a = byId(r.advance.id);
  const gross = payout.breakdown.total;
  assert.equal(a.recovered, Math.min(amount, Math.floor(gross * 0.5)));
  assert.equal(payout.amount, Math.round((gross - a.recovered) * 100) / 100);
});

await test("a rejected salary payout recovers nothing", async () => {
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  await adv.ownerDecide(r.advance.id, "approve");
  svc.submitPeriod({ workerIds: ["w1"] });
  const payout = getDb().payouts.find((p) => p.workerId === "w1" && p.status === "pending");
  await svc.decidePayouts([payout.id], "rejected");
  assert.equal(byId(r.advance.id).recovered, 0);
});

/* ------------------------------ other rules ------------------------------ */

await test("a worker can withdraw their own waiting request, not someone else's, and not an approved one", async () => {
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  assert.throws(() => adv.cancelOwnRequest(worker("w2"), r.advance.id), (e) => e instanceof ServiceError && e.status === 404);
  adv.cancelOwnRequest(worker("w1"), r.advance.id);
  assert.equal(byId(r.advance.id).status, "cancelled");
  const second = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  await adv.ownerDecide(second.advance.id, "approve");
  assert.throws(() => adv.cancelOwnRequest(worker("w1"), second.advance.id), (e) => e instanceof ServiceError && e.status === 409);
});

await test("a rejected request cannot be approved afterwards, and an owner decision cannot be made twice", async () => {
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  await adv.ownerDecide(r.advance.id, "reject", "not now");
  await assert.rejects(adv.ownerDecide(r.advance.id, "approve"), (e) => e instanceof ServiceError && e.status === 409);
  await assert.rejects(adv.ownerDecide(r.advance.id, "reject"), (e) => e instanceof ServiceError && e.status === 409);
  assert.equal(cf.posts.length, 0);
});

await test("a worker's view holds their own requests only", async () => {
  const mine = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  await ask("w2", `I need ${Math.min(500, available("w2"))} rupees`);
  const view = adv.workerOverview(worker("w1"));
  assert.equal(view.advances.length, 1);
  assert.equal(view.advances[0].id, mine.advance.id);
  const text = JSON.stringify(view);
  assert.ok(!text.includes(worker("w2").name), "no other worker's name");
  assert.ok(!text.includes(worker("w2").payoutUpi + "x") && !text.includes("workerId"), "no internal ids of other records");
});

await test("a worker cannot flood the queue: at most 10 requests a day", async () => {
  worker("w1").payoutUpi = "success@upi";
  let last;
  for (let i = 0; i < 12; i++) {
    try {
      last = await ask("w1", `I need ${100 + i} rupees`);
    } catch (e) {
      last = e;
      break;
    }
  }
  assert.ok(last instanceof ServiceError && last.status === 429);
});

await test("an expired draft or someone else's draft is refused at confirmation", async () => {
  await assert.rejects(adv.confirmRequest(worker("w1"), "does-not-exist"), (e) => e instanceof ServiceError && e.status === 410);
  const turn = await agent1.takeTurn("w1", "I need 500 rupees");
  await assert.rejects(adv.confirmRequest(worker("w2"), turn.draftId), (e) => e instanceof ServiceError && e.status === 410);
});

await test("the audit log records requests, approvals, delegations and payments", async () => {
  await delegate();
  const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
  assert.equal(r.advance.status, "approved");
  const actions = getDb().audit.map((e) => e.action);
  for (const want of ["advance.delegation_granted", "advance.request", "advance.pay"]) assert.ok(actions.includes(want), `audit has ${want}`);
});

await test("old database files without advance fields keep working", async () => {
  const db = getDb();
  delete db.advances;
  delete db.advanceConfig;
  saveDb();
  assert.equal(adv.workerOverview(worker("w1")).advances.length, 0);
  assert.equal(adv.ownerOverview().config.ownerAvailable, true);
  svc.submitPeriod({ workerIds: ["w1"] }); // salary flow unaffected
  assert.ok(getDb().payouts.some((p) => p.workerId === "w1" && p.status === "pending"));
});


/* --------------------------- emergency guardrail --------------------------- */

await test("guardrail: a birthday party is refused before any read-back, nothing is recorded", async () => {
  const turn = await agent1.takeTurn("w1", "I need 1000 rupees for my birthday party");
  assert.equal(turn.kind, "not_advance");
  assert.match(turn.messageEnglish, /only for urgent needs/);
  assert.equal(advances().length, 0);
});

await test("guardrail: calling a party an emergency does not get past the code check", async () => {
  // The fake model is fooled ("emergency" -> medical); the worker's own words still say party.
  const turn = await agent1.takeTurn("w1", "It's an emergency, I need 1000 rupees for my birthday party");
  assert.equal(turn.kind, "not_advance");
});

await test("guardrail: Hindi and Bengali party words are caught too", async () => {
  for (const text of ["मुझे जन्मदिन पार्टी के लिए 1000 रुपये चाहिए", "আমার জন্মদিনের পার্টির জন্য ১০০০ টাকা লাগবে"]) {
    const turn = await agent1.takeTurn("w1", text);
    assert.equal(turn.kind, "not_advance", text);
  }
});

await test("guardrail: a pet reason is never auto-approved by the Manager Agent; it goes to the owner", async () => {
  await delegate();
  const r = await ask("w1", "My cat died, I need 1000 rupees");
  assert.equal(r.advance.status, "escalated");
  const a = byId(r.advance.id);
  assert.equal(a.purpose.purpose, "unclear");
  assert.ok(a.eligibility.flags.some((f) => /pet/.test(f)));
  assert.equal(cf.posts.length, 0, "no money without a person");
});

await test("guardrail: no reason given means the agent asks why, then continues once there is one", async () => {
  const first = await agent1.takeTurn("w1", "I need 800 rupees");
  assert.equal(first.kind, "ask");
  assert.match(first.questionEnglish, /What is the emergency/);
  const second = await agent1.takeTurn("w1", "my bike broke down", first.draftId);
  assert.equal(second.kind, "confirm");
  assert.equal(second.request.amount, 800);
});

await test("guardrail: a real emergency inside delegation is still approved and paid", async () => {
  await delegate();
  const r = await ask("w1", "Hospital bill, I need 700 rupees");
  assert.equal(r.advance.status, "approved");
  assert.equal(byId(r.advance.id).purpose.purpose, "emergency");
  assert.equal(cf.posts.length, 1);
});

await test("guardrail: a non-emergency that slips past the chat is still refused at confirmation", async () => {
  // Simulate a draft whose words say party even though the reason looked fine.
  const turn = await agent1.takeTurn("w1", "Hospital bill, I need 600 rupees");
  const d = agent1.takeDraft("w1", turn.draftId);
  d.turns.push("actually it is for a birthday party");
  const g = globalThis;
  g.__advanceDrafts.set(d.id, d);
  const r = await adv.confirmRequest(worker("w1"), d.id);
  assert.equal(r.advance.status, "ineligible");
  assert.match(r.messageEnglish, /only for urgent needs/);
});

/* ------------------------- agents on Cashfree Relay ------------------------- */

// A stand-in for Relay: each agent's Inbound Webhook receives BolPay's event and its HTTP step calls BolPay back.
const relay = { hits: [], pending: [], down: false };
const STEP_FOR = { eligibility: "eligibility", manager: "manager", payout: "pay", worker: "message" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith("https://relay.test/")) return realFetch(url, init);
  if (relay.down) throw new Error("connect ECONNREFUSED");
  const event = JSON.parse(String(init.body)).data;
  relay.hits.push(event.stage);
  const extra = event.stage === "worker" ? { text: `[sarvam ${event.language}] ${event.message}`, language: event.language } : {};
  relay.pending.push(new Promise((r) => setTimeout(r, 0)).then(() => adv.relayCallback(STEP_FOR[event.stage], event.advanceId, extra)));
  return json(200, { status: "accepted" });
};
async function settleRelay() {
  while (relay.pending.length) await Promise.all(relay.pending.splice(0));
}
function useRelay(on) {
  if (on) process.env.RELAY_MODE = "callback";
  else delete process.env.RELAY_MODE;
  for (const s of ["ELIGIBILITY", "MANAGER", "PAYOUT", "WORKER"]) {
    if (on) process.env[`RELAY_${s}_WEBHOOK`] = `https://relay.test/${s.toLowerCase()}`;
    else delete process.env[`RELAY_${s}_WEBHOOK`];
  }
  relay.hits.length = 0;
  relay.down = false;
}

await test("on Relay: eligibility, manager and payout agents run in turn and the advance is paid once", async () => {
  useRelay(true);
  try {
    await delegate();
    const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
    assert.equal(r.advance.status, "checking", "handed to Relay, not decided in-process");
    assert.match(r.messageEnglish, /checking it now/);
    await settleRelay();
    const a = byId(r.advance.id);
    assert.equal(a.status, "approved");
    assert.equal(a.approval.by, "manager_agent");
    assert.deepEqual(relay.hits.filter((h) => h !== "worker"), ["eligibility", "manager", "payout"]);
    assert.equal(cf.posts.length, 1);
    assert.ok(a.trail.some((t) => /run by the agent on Cashfree Relay/.test(t.detail)));
    assert.ok(a.trail.some((t) => /decided by the agent on Cashfree Relay/.test(t.detail)));
    assert.ok(a.trail.some((t) => /started by the agent on Cashfree Relay/.test(t.detail)));
    assert.match(a.workerMessage.text, /^\[sarvam en\]/, "the Worker Assistance Agent on Relay sent the translated message");
  } finally {
    useRelay(false);
  }
});

await test("on Relay: an ineligible request stops at the Eligibility Agent", async () => {
  useRelay(true);
  try {
    const r = await ask("w1", "I need 9000 rupees");
    await settleRelay();
    assert.equal(byId(r.advance.id).status, "ineligible");
    assert.deepEqual(relay.hits.filter((h) => h !== "worker"), ["eligibility"]);
    assert.equal(cf.posts.length, 0);
  } finally {
    useRelay(false);
  }
});

await test("on Relay: owner available means the Manager Agent queues it; the owner's approval goes to the Payout Agent on Relay", async () => {
  useRelay(true);
  try {
    const r = await ask("w2", `I need ${Math.min(500, available("w2"))} rupees`);
    await settleRelay();
    assert.equal(byId(r.advance.id).status, "awaiting_approval");
    await adv.ownerDecide(r.advance.id, "approve");
    assert.equal(cf.posts.length, 0, "payment waits for the Payout Agent on Relay");
    await settleRelay();
    assert.equal(cf.posts.length, 1);
    assert.equal(adv.workerOverview(worker("w2")).advances[0].payment, "completed");
  } finally {
    useRelay(false);
  }
});

await test("on Relay: repeated, out-of-order and unknown callbacks change nothing", async () => {
  useRelay(true);
  try {
    await delegate();
    const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
    // Before Relay's eligibility agent runs, a payout or manager call must not move it.
    assert.equal((await adv.relayCallback("pay", r.advance.id, {})).changed, false);
    assert.equal((await adv.relayCallback("manager", r.advance.id, {})).changed, false);
    await settleRelay();
    assert.equal(cf.posts.length, 1);
    for (const step of ["eligibility", "manager", "pay", "pay"]) assert.equal((await adv.relayCallback(step, r.advance.id, {})).changed, false, `${step} replay`);
    assert.equal(cf.posts.length, 1, "still exactly one transfer");
    await assert.rejects(adv.relayCallback("pay", "adv-000000000000000000000000", {}), (e) => e instanceof ServiceError && e.status === 404);
  } finally {
    useRelay(false);
  }
});

await test("on Relay: if Relay can't be reached, BolPay runs the agents itself", async () => {
  useRelay(true);
  relay.down = true;
  try {
    await delegate();
    const r = await ask("w1", `I need ${Math.min(500, available("w1"))} rupees`);
    assert.equal(r.advance.status, "approved");
    assert.equal(cf.posts.length, 1);
    assert.ok(byId(r.advance.id).trail.some((t) => t.action === "Relay unreachable"));
  } finally {
    useRelay(false);
  }
});

await test("on Relay: a callback body can't choose the amount or the payee", async () => {
  useRelay(true);
  try {
    await delegate();
    const amount = Math.min(500, available("w1"));
    const r = await ask("w1", `I need ${amount} rupees`);
    relay.pending.length = 0; // drop the fake Relay's own calls; send hostile ones instead
    await adv.relayCallback("eligibility", r.advance.id, { amount: 9999, upi: "attacker@upi", eligible: true });
    await settleRelay();
    await adv.relayCallback("manager", r.advance.id, { decision: "approved", amount: 9999 });
    await settleRelay();
    await adv.relayCallback("pay", r.advance.id, { amount: 9999, upi: "attacker@upi" });
    assert.equal(cf.posts.length, 1);
    assert.equal(cf.posts[0].transfer_amount, amount);
    assert.equal(cf.beneficiaries[0].beneficiary_instrument_details.vpa, worker("w1").payoutUpi);
  } finally {
    useRelay(false);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
