import "server-only";
import { randomUUID } from "node:crypto";
import { IntentModelError } from "@/app/lib/ai/intent";
import { translateReply } from "@/app/lib/ai/translate";
import { logAudit } from "@/app/lib/server/db";
import { detectAmounts, reconcileAmount } from "@/app/lib/advance/amounts";
import { eligibilityFor, staffAdvances } from "@/app/lib/server/advance-service";
import { getViewDb } from "@/app/lib/server/db";
import { allowedFor, describePreview, previewMoney, runPlan, type StepOutcome, type VoiceCtx } from "./executor";
import { SCOPE_REPLY } from "./knowledge";
import { recordTurn } from "./metrics";
import { classifyReply, fastClassify, planTurn, type PendingQuestion, type PlannerMemory } from "./planner";
import { resolveSteps } from "./resolver";
import type { RawStep, ResolvedStep, SessionState, StepStatus, StepView, TurnOutcome, TurnView } from "./types";

const TTL_MS = 15 * 60_000;
const PLAN_TTL_MS = 10 * 60_000;

interface MemoryEntry {
  said: string;
  /** The planner's steps for that message, replayed to it as its own earlier answer. */
  steps: RawStep[];
  language: string;
  workers: string[];
  city: string | null;
}

const MAX_MEMORY = 4;

interface Session {
  id: string;
  /** The signed-in user the session belongs to. Another user can never read or continue it. */
  userId?: string;
  dryRun: boolean;
  /** Who is talking: name, role and worker record, refreshed from the verified session on every turn. */
  ctx: VoiceCtx;
  /** The last few exchanges, so a follow-up ("only Bengaluru", "what is his salary") can be understood. */
  history: MemoryEntry[];
  state: SessionState;
  language: string;
  /** While clarifying: the request so far and the question that was asked. */
  utterance?: string;
  partial?: RawStep[];
  question?: string;
  /** While confirming: the exact plan that was shown. Confirm only ever runs this. */
  plan?: ResolvedStep[];
  /** The planner's steps behind `plan`, so a follow-up can edit them. */
  rawPlan?: RawStep[];
  planAt?: number;
  cursor: number;
  outcomes: Record<number, StepOutcome>;
  updatedAt: number;
  last?: TurnView;
}

const g = globalThis as unknown as { __voiceSessions?: Map<string, Session> };
const sessions = () => (g.__voiceSessions ??= new Map());

function getSession(id: string | null | undefined, dryRun: boolean, userId?: string): Session {
  const map = sessions();
  const now = Date.now();
  for (const [k, s] of map) if (now - s.updatedAt > TTL_MS) map.delete(k);
  const found = id ? map.get(id) : undefined;
  const existing = found && (!found.userId || found.userId === userId) ? found : undefined;
  if (existing) {
    existing.updatedAt = now;
    return existing;
  }
  const s: Session = { id: randomUUID(), userId, dryRun, ctx: { role: "supervisor", name: "", workerId: null }, history: [], state: "idle", language: "en", cursor: 0, outcomes: {}, updatedAt: now };
  map.set(s.id, s);
  return s;
}

const trim = (s: string, n = 380) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

async function localize(text: string, language: string): Promise<string> {
  if (language === "en") return text;
  return (await translateReply(text, language)) ?? text;
}

function stepViews(s: Session): StepView[] {
  return (s.plan ?? []).map((st, i) => {
    const o = s.outcomes[i];
    let status: StepStatus = "pending";
    if (o) status = o.skipped ? "skipped" : o.ok ? "done" : "failed";
    else if (s.state === "idle" && i >= s.cursor && Object.values(s.outcomes).some((x) => !x.ok)) status = "not_run";
    return { action: st.action, summary: st.summary, risk: st.risk, status, message: o?.message };
  });
}

interface ViewInput {
  outcome: TurnOutcome;
  speech: string;
  lines: string[];
  awaiting: TurnView["awaiting"];
  navigate?: string;
  checkpoint?: boolean;
}

async function finish(s: Session, v: ViewInput): Promise<TurnView> {
  const speech = trim(await localize(v.speech, s.language));
  const view: TurnView = {
    sessionId: s.id,
    state: s.state,
    outcome: v.outcome,
    speech,
    lines: v.lines,
    steps: stepViews(s),
    awaiting: v.awaiting,
    navigate: v.navigate,
    language: s.language,
    dryRun: s.dryRun,
    checkpoint: v.checkpoint,
  };
  s.last = view;
  return view;
}

function clearPending(s: Session) {
  s.state = "idle";
  s.utterance = undefined;
  s.partial = undefined;
  s.question = undefined;
}

function clearPlan(s: Session) {
  s.plan = undefined;
  s.rawPlan = undefined;
  s.planAt = undefined;
  s.cursor = 0;
  s.outcomes = {};
}

function planSpeech(steps: ResolvedStep[]): string {
  const items = steps.map((st, i) => `${steps.length > 1 ? `${i + 1}. ` : ""}${st.summary}`);
  const shown = items.length > 3 ? [...items.slice(0, 3), `and ${items.length - 3} more steps`] : items;
  return `${steps.length > 1 ? "Here's the plan. " : ""}${shown.join(". ")}. Say confirm to run it, or cancel.`;
}

/** Reads-only plans run straight away; anything that writes waits for an explicit confirmation. */
async function present(s: Session, steps: ResolvedStep[], note: string, base: { llmMs: number; llmCalls: number; fastPath: boolean; outcomeOverride?: TurnOutcome; model?: string }) {
  const m = (outcome: TurnOutcome) => recordTurn({ sessionId: s.id, stateBefore: base.outcomeOverride === "superseded" ? "confirming" : s.state, outcome, llmMs: base.llmMs, llmCalls: base.llmCalls, steps: steps.length, language: s.language, fastPath: base.fastPath, dryRun: s.dryRun, model: base.model });

  if (steps.every((st) => st.risk === "read")) {
    clearPending(s);
    s.plan = steps;
    s.cursor = 0;
    s.outcomes = {};
    const run = await runPlan(steps, 0, s.dryRun, s.ctx);
    s.outcomes = run.outcomes;
    s.cursor = run.cursor;
    const msgs = steps.map((_, i) => run.outcomes[i]?.message).filter(Boolean) as string[];
    const outcome: TurnOutcome = steps.some((st) => !["query", "navigate", "chat", "explain"].includes(st.action)) ? "executed" : "answered";
    m(base.outcomeOverride ?? outcome);
    const view = await finish(s, { outcome: base.outcomeOverride ?? outcome, speech: `${note}${msgs.join(" ")}`, lines: msgs, awaiting: null, navigate: run.navigate });
    clearPlan(s);
    return view;
  }

  // Money steps that run before anything else changes state can show exact figures now.
  const lines: string[] = [];
  let sawWrite = false;
  for (const st of steps) {
    if (st.risk === "money" && !sawWrite) {
      const p = previewMoney(st);
      if (!p || p.count === 0) {
        clearPending(s);
        clearPlan(s);
        m("rejected");
        return finish(s, { outcome: "rejected", speech: `${note}There is nothing to ${st.action === "retry_failed" ? "retry" : "approve"} for that selection right now.`, lines: [], awaiting: null });
      }
      st.expect = p;
      lines.push(`${st.summary}: ${describePreview(p)}${st.args.upi ? ` To ${st.args.upi}.` : ""}`);
    } else lines.push(st.summary);
    if (st.risk !== "read") sawWrite = true;
  }
  clearPending(s);
  s.state = "confirming";
  s.plan = steps;
  s.planAt = Date.now();
  s.cursor = 0;
  s.outcomes = {};
  m(base.outcomeOverride ?? "planned");
  const hasLaterMoney = steps.some((st, i) => st.risk === "money" && !st.expect && i > 0);
  const extra = hasLaterMoney ? " I'll show you the exact amount before any money is sent." : "";
  return finish(s, { outcome: base.outcomeOverride ?? "planned", speech: `${note}${planSpeech(steps)}${extra}`, lines, awaiting: "confirm" });
}

async function doConfirm(s: Session, base: { llmMs: number; fastPath: boolean }): Promise<TurnView> {
  const rec = (outcome: TurnOutcome, steps: number) => recordTurn({ sessionId: s.id, stateBefore: "confirming", outcome, llmMs: base.llmMs, llmCalls: base.llmMs > 0 ? 1 : 0, steps, language: s.language, fastPath: base.fastPath, dryRun: s.dryRun });
  const plan = s.plan;
  if (!plan || s.state !== "confirming") {
    rec("rejected", 0);
    return finish(s, { outcome: "rejected", speech: "There's nothing waiting for confirmation.", lines: [], awaiting: null });
  }
  if (s.planAt && Date.now() - s.planAt > PLAN_TTL_MS) {
    clearPlan(s);
    s.state = "idle";
    rec("rejected", plan.length);
    return finish(s, { outcome: "rejected", speech: "That plan has expired. Please say it again.", lines: [], awaiting: null });
  }

  const run = await runPlan(plan, s.cursor, s.dryRun, s.ctx);
  s.outcomes = { ...s.outcomes, ...run.outcomes };

  if (run.checkpoint) {
    const { stepIndex, preview } = run.checkpoint;
    plan[stepIndex].expect = preview; // the next confirm is for exactly these figures
    s.cursor = stepIndex;
    s.planAt = Date.now();
    rec("checkpoint", plan.length);
    const text = describePreview(preview);
    return finish(s, { outcome: "checkpoint", speech: `Before I send money: ${text} Say confirm to send, or cancel.`, lines: [`${plan[stepIndex].summary}: ${text}${plan[stepIndex].args.upi ? ` To ${plan[stepIndex].args.upi}.` : ""}`], awaiting: "confirm", checkpoint: true });
  }

  s.cursor = run.cursor;
  const failedAt = Object.entries(s.outcomes).find(([, o]) => !o.ok);
  const msgs = plan.map((_, i) => s.outcomes[i]?.message).filter(Boolean) as string[];
  logAudit("voice.flow", `${plan.map((p) => p.action).join(" > ")}${failedAt ? " (stopped early)" : ""}${s.dryRun ? " [dry run]" : ""}`);
  const view = await (async () => {
    s.state = "idle";
    const speech = failedAt
      ? `${msgs.join(" ")} I stopped there, so the remaining steps did not run.`
      : `${s.dryRun ? "Dry run complete. " : "Done. "}${msgs.join(" ")}`;
    return finish(s, { outcome: "executed", speech, lines: msgs, awaiting: null, navigate: run.navigate });
  })();
  rec("executed", plan.length);
  clearPlan(s);
  return view;
}

async function doCancel(s: Session, base: { llmMs: number; fastPath: boolean }): Promise<TurnView> {
  recordTurn({ sessionId: s.id, stateBefore: s.state, outcome: "cancelled", llmMs: base.llmMs, llmCalls: base.llmMs > 0 ? 1 : 0, steps: s.plan?.length ?? 0, language: s.language, fastPath: base.fastPath, dryRun: s.dryRun });
  const had = s.state !== "idle";
  clearPending(s);
  clearPlan(s);
  return finish(s, { outcome: "cancelled", speech: had ? "Okay, cancelled. Nothing was changed." : "Nothing to cancel.", lines: [], awaiting: null });
}

export interface TurnInput {
  sessionId?: string | null;
  text?: string;
  dryRun?: boolean;
  reset?: boolean;
  /** Button presses: same effect as saying confirm or cancel. */
  action?: "confirm" | "cancel";
  /** From the verified session; decides which steps may run. */
  ctx?: VoiceCtx;
  /** The verified user id, so a session can only be continued by the person who started it. */
  userId?: string;
}

/** What the planner is told about the conversation so far. Only what was said and what was understood; never records or amounts. */
function memoryOf(s: Session): PlannerMemory {
  const workers = [...new Set([...s.history].reverse().flatMap((h) => h.workers))].slice(0, 4);
  const city = [...s.history].reverse().find((h) => h.city)?.city;
  const note = [
    workers.length ? `Most recently mentioned workers: ${workers.join(", ")}. Pronouns (he, she, him, her, his, them) mean these; put their names in the selector.` : "",
    city ? `Most recent city: ${city}.` : "",
    s.history.length ? "A short follow-up fragment ('only Bengaluru', 'what about Anita', 'and their pay') repeats the previous action with the new target." : "",
  ].filter(Boolean).join(" ");
  return { note, turns: s.history.map((h) => ({ said: h.said, steps: h.steps, language: h.language })) };
}

function remember(s: Session, said: string, raw: RawStep[], steps: ResolvedStep[], language: string) {
  const db = getViewDb();
  // Only staff conversations remember workers; a worker is only ever talking about themselves.
  const ids = s.ctx.role === "worker" ? [] : [...new Set(steps.flatMap((st) => (Array.isArray(st.args.workerIds) ? (st.args.workerIds as string[]) : [])))];
  const workers = ids.length > 0 && ids.length <= 3 ? ids.map((id) => db.workers.find((w) => w.id === id)?.name).filter((n): n is string => !!n) : [];
  const city = raw.map((r) => (r.args?.workers as { city?: string | null } | null | undefined)?.city).find((c) => typeof c === "string") ?? null;
  // A request to send money is never replayed as history: a follow-up must not be able to inherit it.
  const safe = raw.filter((r) => r.action !== "approve_payouts" && r.action !== "retry_failed" && r.action !== "request_advance" && r.action !== "approve_advance" && r.action !== "reject_advance");
  s.history.push({ said: said.replace(/["\n]/g, " ").slice(0, 160), steps: safe, language, workers, city });
  if (s.history.length > MAX_MEMORY) s.history.shift();
}

/** "Advance" as people actually say it, in the scripts the assistant hears. */
const SAID_ADVANCE = /advance|एडवांस|एडवान्स|ऍडव्हान्स|अग्रिम|অ্যাডভান্স|এডভান্স|অগ্রিম|ಅಡ್ವಾನ್ಸ್|ಮುಂಗಡ|அட்வான்ஸ்|முன்பணம்|అడ్వాన్స్/i;
const REASON_LABEL: Record<string, string> = { vehicle_repair: "Bike or vehicle repair", medical: "A medical expense", family_event: "A family event", housing: "Housing", education: "Education", other: "An urgent need" };

export function peekSession(id: string, userId?: string): TurnView | null {
  const s = sessions().get(id);
  if (!s || Date.now() - s.updatedAt > TTL_MS) return null;
  if (s.userId && s.userId !== userId) return null;
  return s.last ?? null;
}

export async function handleTurn(input: TurnInput): Promise<TurnView> {
  try {
    return await handleTurnInner(input);
  } catch (err) {
    console.error("voice turn crashed", err);
    const s = getSession(input.sessionId, input.dryRun === true, input.userId);
    const detail = process.env.NODE_ENV !== "production" && err instanceof Error ? ` (${err.message})` : "";
    return finish(s, { outcome: "error", speech: "Something went wrong on my side. Nothing was changed.", lines: [`Something went wrong${detail}`], awaiting: s.state === "confirming" ? "confirm" : s.state === "clarifying" ? "reply" : null });
  }
}

async function handleTurnInner(input: TurnInput): Promise<TurnView> {
  if (input.reset && input.sessionId) { const old = sessions().get(input.sessionId); if (!old?.userId || old.userId === input.userId) sessions().delete(input.sessionId); }
  const s = getSession(input.reset ? null : input.sessionId, input.dryRun === true, input.userId);
  if (input.dryRun !== undefined && !input.sessionId) s.dryRun = input.dryRun === true;
  s.ctx = input.ctx ?? { role: "supervisor", name: "", workerId: null };
  if (input.reset) return finish(s, { outcome: "cancelled", speech: "Okay, starting fresh.", lines: [], awaiting: null });

  if (input.action === "confirm") return doConfirm(s, { llmMs: 0, fastPath: true });
  if (input.action === "cancel") return doCancel(s, { llmMs: 0, fastPath: true });

  const text = (input.text ?? "").trim().slice(0, 600);
  if (!text) return finish(s, { outcome: "error", speech: "I didn't catch anything. Please try again.", lines: [], awaiting: s.state === "idle" ? null : s.state === "confirming" ? "confirm" : "reply" });

  let llmMs = 0;
  let llmCalls = 0;
  let superseded = false;
  let note = "";
  let fromPlan: PendingQuestion | null = null;
  const stateBefore = s.state;

  try {
    if (s.state === "confirming") {
      const fast = fastClassify(text);
      const cls = fast ?? (await classifyReply(text, s.plan?.map((p) => p.summary).join("; ") ?? ""));
      const verdict = typeof cls === "string" ? cls : cls.result;
      if (typeof cls !== "string") llmMs += cls.latencyMs;
      if (verdict === "confirm") return doConfirm(s, { llmMs, fastPath: !!fast });
      if (verdict === "cancel") return doCancel(s, { llmMs, fastPath: !!fast });
      // Not a yes or no. It may add to or change the waiting plan ("also mark Anita absent") or start
      // something new; the planner decides which, with the waiting plan as context.
      fromPlan = { utterance: s.utterance ?? "", steps: s.rawPlan ?? [], question: `Shall I run this plan: ${s.plan?.map((p) => p.summary).join("; ") ?? ""}? The manager may confirm, change it, or add to it.` };
      clearPlan(s);
      clearPending(s);
    }

    const pending: PendingQuestion | null = fromPlan ?? (s.state === "clarifying" && s.partial && s.question && s.utterance ? { utterance: s.utterance, steps: s.partial, question: s.question } : null);
    const plan = await planTurn(text, pending, s.ctx, memoryOf(s));
    llmMs += plan.latencyMs;
    llmCalls += plan.calls;
    s.language = plan.language;

    let continuing = false;
    if (pending) {
      if (plan.answersPending === false || (plan.answersPending === null && plan.steps.length === 0)) {
        superseded = true;
        note = fromPlan ? "Okay, I dropped the earlier plan. " : "Okay, setting that question aside. ";
        clearPending(s);
      } else {
        continuing = true;
        if (fromPlan) note = "Updated the plan. ";
      }
    }

    const record = (outcome: TurnOutcome, steps = plan.steps.length) => recordTurn({ sessionId: s.id, stateBefore, outcome, llmMs, llmCalls, steps, language: s.language, fastPath: false, dryRun: s.dryRun, model: plan.model });

    if (plan.steps.length === 0) {
      clearPending(s);
      record(superseded ? "superseded" : "rejected", 0);
      const why = plan.notUnderstood ?? "";
      const worker = s.ctx.role === "worker";
      const speech = /off.?topic/i.test(why)
        ? SCOPE_REPLY
        : /not.?allowed/i.test(why)
          ? worker
            ? "That's not something I can do for you; your employer handles it. I can tell you about your own pay and advances."
            : "I can't do that."
          : /\s/.test(why) // a bare code such as "cannot_process" is the model's shorthand, not something to read out
            ? `I can't do that: ${why} Ask me what I can do to see what's possible.`
            : worker
              ? "Sorry, I didn't understand. You can ask how much you've earned, check your advance, or ask for one."
              : "Sorry, I didn't understand. You can say things like mark Ravi present, prepare payouts, or approve Anita's payout. Ask me what I can do for more.";
      return finish(s, { outcome: superseded ? "superseded" : "rejected", speech: `${note}${speech}`, lines: [], awaiting: null });
    }

    const resolution = resolveSteps(plan.steps);
    if (resolution.kind === "clarify") {
      s.state = "clarifying";
      s.utterance = continuing && pending ? pending.utterance : text;
      s.partial = plan.steps;
      const q = await localize(resolution.question, s.language);
      s.question = q;
      record(superseded ? "superseded" : "clarified");
      return finish(s, { outcome: superseded ? "superseded" : "clarified", speech: `${note}${resolution.question}`, lines: [q], awaiting: "reply" });
    }
    if (resolution.kind === "reject") {
      clearPending(s);
      record(superseded ? "superseded" : "rejected");
      return finish(s, { outcome: superseded ? "superseded" : "rejected", speech: `${note}${resolution.reason}`, lines: [], awaiting: null });
    }
    // A worker's plan may only contain what the catalog gives workers; the executor checks again on every step.
    if (s.ctx.role === "worker" && resolution.steps.some((st) => !allowedFor("worker", st))) {
      clearPending(s);
      record(superseded ? "superseded" : "rejected");
      return finish(s, { outcome: superseded ? "superseded" : "rejected", speech: `${note}That's not something I can do for you; your employer handles it. I can tell you about your own pay and advances.`, lines: [], awaiting: null });
    }

    // Deciding an advance request. An advance is not payroll: if the word was said but a payroll decision was
    // understood, nothing happens. This is a code check, so it doesn't depend on the model getting it right.
    const saidAll = `${continuing && pending ? pending.utterance : ""} ${text}`;
    const advanceSteps = resolution.steps.filter((st) => st.action === "approve_advance" || st.action === "reject_advance");
    const stop = (speech: string) => {
      clearPending(s);
      record(superseded ? "superseded" : "rejected");
      return finish(s, { outcome: superseded ? "superseded" : "rejected", speech: `${note}${speech}`, lines: [], awaiting: null });
    };
    if (!advanceSteps.length && SAID_ADVANCE.test(saidAll) && resolution.steps.some((st) => st.action === "approve_payouts" || st.action === "reject_payouts")) {
      return stop("You mentioned an advance, but I understood a payroll payout, so I haven't done anything. Say, for example, approve Ravi's advance, or open the Advances page.");
    }
    for (const st of advanceSteps) {
      // Refuse before showing any figures or asking for a confirmation.
      if (!allowedFor(s.ctx.role, st)) return stop("Only the owner can approve or reject an advance.");
      const verb = st.action === "approve_advance" ? "approve" : "reject";
      const ids = new Set((st.args.workerIds as string[] | undefined) ?? []);
      const waiting = staffAdvances().filter((a) => a.status === "pending_review" && ids.has(a.workerId));
      if (!waiting.length) return stop(`There is no advance request waiting that I can ${verb} for that selection.`);
      if (waiting.length > 1) {
        s.state = "clarifying";
        s.utterance = continuing && pending ? pending.utterance : text;
        s.partial = plan.steps.map((p) => (p.action === st.action ? { ...p, args: { ...p.args, workers: null } } : p));
        const list = waiting.slice(0, 4).map((a) => `${a.worker?.name ?? "Unknown"} ₹${a.amount}`).join(", ");
        const q = `${waiting.length} advance requests are waiting: ${list}${waiting.length > 4 ? " and more" : ""}. Whose should I ${verb}?`;
        s.question = await localize(q, s.language);
        record("clarified");
        return finish(s, { outcome: "clarified", speech: `${note}${q}`, lines: [s.question], awaiting: "reply" });
      }
      const a = waiting[0];
      const name = a.worker?.name ?? "this worker";
      st.args.advanceId = a.id;
      if (st.action === "reject_advance") {
        st.summary = `Reject ${name}'s advance request of ₹${a.amount}`;
        continue;
      }
      const approved = typeof st.args.amount === "number" ? st.args.amount : a.amount;
      const heard = detectAmounts(saidAll);
      // A number that was said but isn't the number about to be sent is never ignored.
      if (heard.length && !heard.includes(approved)) return stop(`I heard ₹${heard[0]}, but ${name}'s request is for ₹${a.amount}. Say approve, with the amount you mean.`);
      if (!Number.isInteger(approved) || approved < 1 || approved > a.amount) return stop(`${name} asked for ₹${a.amount}. I can approve that or less, in whole rupees.`);
      const check = eligibilityFor(a.workerId, { amount: approved, excludeId: a.id });
      if (check.blocks.length) return stop(`I can't approve it: ${check.blocks[0]}`);
      st.args.approvedAmount = approved;
      st.args.upi = getViewDb().workers.find((w) => w.id === a.workerId)?.payoutUpi || null; // shown on screen, never spoken
      st.summary = `Approve ${name}'s emergency advance of ₹${approved}${approved !== a.amount ? ` (they asked for ₹${a.amount})` : ""}, to be deducted from their next payroll`;
    }

    // An advance request: check what was actually said, check eligibility now, and attach what the service needs.
    const adv = resolution.steps.find((st) => st.action === "request_advance");
    if (adv) {
      const amount = Number(adv.args.amount);
      const said = reconcileAmount(amount, text, true);
      if (said.mismatch || said.amount !== amount) {
        s.state = "clarifying";
        s.utterance = text;
        s.partial = plan.steps.map((st) => (st.action === "request_advance" ? { ...st, args: { ...st.args, amount: null } } : st));
        const q = "I wasn't sure of the amount. How many rupees do you need?";
        s.question = await localize(q, s.language);
        record("clarified");
        return finish(s, { outcome: "clarified", speech: `${note}${q}`, lines: [s.question], awaiting: "reply" });
      }
      const e = s.ctx.workerId ? eligibilityFor(s.ctx.workerId, { amount }) : null;
      if (!e || e.blocks.length) {
        clearPending(s);
        record("rejected");
        return finish(s, { outcome: "rejected", speech: `${note}I can't send that request: ${e?.blocks[0] ?? "your login isn't linked to a worker profile."}`, lines: e?.blocks ?? [], awaiting: null });
      }
      const reason = String(adv.args.reason ?? "other");
      adv.args.requestKey = randomUUID().replace(/-/g, "");
      adv.args.transcript = text;
      adv.args.language = plan.language;
      adv.args.reasonText = REASON_LABEL[reason] ?? REASON_LABEL.other;
      adv.summary = `${adv.summary}. It is deducted from your next payroll, and nothing is paid until your employer approves it`;
    }
    remember(s, text, plan.steps, resolution.steps, plan.language);

    const view = await present(s, resolution.steps, note, { llmMs, llmCalls, fastPath: false, outcomeOverride: superseded ? "superseded" : undefined, model: plan.model });
    if (s.state === "confirming") {
      s.utterance = continuing && pending ? pending.utterance : text;
      s.rawPlan = plan.steps;
    }
    return view;
  } catch (err) {
    const message =
      err instanceof IntentModelError
        ? err.kind === "not_configured"
          ? "The language model isn't configured."
          : err.kind === "rate_limited"
            ? "The assistant is busy right now. Please try again in a moment."
            : "I couldn't reach the assistant. Please try again."
        : "Something went wrong on my side.";
    if (!(err instanceof IntentModelError)) console.error("voice turn failed", err);
    recordTurn({ sessionId: s.id, stateBefore, outcome: "error", llmMs, llmCalls, steps: 0, language: s.language, fastPath: false, dryRun: s.dryRun });
    return finish(s, { outcome: "error", speech: message, lines: [message], awaiting: s.state === "confirming" ? "confirm" : s.state === "clarifying" ? "reply" : null });
  }
}
