import "server-only";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { formatMoney } from "@/app/lib/merchant/format";
import { logAudit } from "@/app/lib/server/db";
import { isConnected, McpNotConnected, withMcp } from "./client";
import { payrollPosition } from "./payroll";

/**
 * Payroll Funding Agent. An LLM (Groq) decides which Cashfree MCP tools to call to answer "can I cover this
 * payroll?", reads the results, and answers. Guard rails, all enforced here and not by the prompt:
 *  - only read-only MCP tools are ever offered (get_/search_/list_), so it cannot create orders, links or refunds;
 *  - amounts owed come from BolPay's own records through `get_payroll_position`;
 *  - it never calls the Payouts API, so it cannot move money. Approving payouts stays with the owner.
 */

const GROQ_URL = process.env.GROQ_CHAT_URL || "https://api.groq.com/openai/v1/chat/completions";
/** Tried in order; a rate-limited model falls through to the next (Groq's free tier caps tokens per minute and per day per model). */
const MODELS = [...new Set([process.env.CASHFREE_AGENT_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b", "openai/gpt-oss-20b"])];
const MAX_STEPS = 5;
/** Total tool calls across all rounds, so one round asking for dozens of calls cannot run away either. */
const MAX_CALLS = 8;
/** Tools worth showing the model first; the free Groq tier is 8k tokens a minute, so the list stays short. */
const PREFERRED = ["get_settlement_summary", "get_unsettled_amount", "get_next_settlement_date", "search_standard_settlements", "get_on_demand_eligible_funds", "get_on_demand_charges", "search_transactions"];
const READ_ONLY = /^(get|search|list)_/;
const RESULT_LIMIT = 2500;

export interface AgentStep {
  tool: string;
  source: "cashfree-mcp" | "bolpay";
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  /** False when Cashfree is not connected and the answer uses BolPay's records only. */
  cashfree: boolean;
}

interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const SYSTEM = `You are BolPay's Payroll Funding Agent for an Indian merchant who pays gig workers by UPI.
Question to answer: can the business cover its payroll, and if not, what should it do?
How to work:
1. Call get_payroll_position first to learn what is owed (INR).
2. Call the Cashfree tools (get_settlement_summary first) to learn what money is unsettled, when the next settlement lands, and what an on-demand settlement could release.
3. Compare and answer in 2-4 short sentences with exact rupee figures from the tool results. If the money is short, say by how much and suggest the next step (wait for settlement, or an on-demand settlement with its charge).
Rules: never invent a number; if a tool fails or returns an error (permission denied, product not activated), say so plainly and what the owner must do; never guess a figure. You cannot move money or approve payouts; the owner does that. Reply in the language the question uses.`;

function trim(v: unknown) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > RESULT_LIMIT ? `${s.slice(0, RESULT_LIMIT)}…[truncated]` : s;
}

type McpTool = { name: string; description?: string; inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] } };

/** Tool schemas dominate the prompt size; keep names, types and required fields, drop prose. */
/** Arguments a tool advertises but Cashfree's server rejects (seen live: "Unexpected keyword argument include"). */
const BROKEN_ARGS: Record<string, string[]> = { get_settlement_summary: ["include", "recentCount"] };

function slim(schema: McpTool["inputSchema"], tool = "") {
  const props = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([k]) => !BROKEN_ARGS[tool]?.includes(k)).map(([k, v]) => [k, { ...(v as object), description: undefined, title: undefined }]));
  return { type: "object", properties: props, required: schema.required };
}

function pickTools(all: McpTool[]): McpTool[] {
  const readable = all.filter((t) => READ_ONLY.test(t.name));
  const first = PREFERRED.map((n) => readable.find((t) => t.name === n)).filter((t): t is McpTool => Boolean(t));
  return first.length ? first : readable.slice(0, 6);
}

const send = (key: string, body: Record<string, unknown>) =>
  fetch(GROQ_URL, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), cache: "no-store" });

async function chat(messages: ChatMsg[], tools: unknown[]) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set.");
  for (const model of MODELS) {
    const body: Record<string, unknown> = { model, messages, temperature: 0, max_completion_tokens: 500 };
    if (tools.length) Object.assign(body, { tools, tool_choice: "auto" });
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
    let res = await send(key, body);
    if (res.status === 429) {
      // Per-minute limits clear in seconds: wait the time Groq names (if short) and retry this model once before falling back.
      const text = await res.text().catch(() => "");
      const wait = Number(/try again in ([\d.]+)s/i.exec(text)?.[1]);
      console.error(`Groq rate limit on ${model}`, text.slice(0, 160));
      if (Number.isFinite(wait) && wait <= 15) {
        await new Promise((r) => setTimeout(r, wait * 1000 + 300));
        res = await send(key, body);
      }
      if (res.status === 429) continue;
    }
    if (!res.ok) throw new Error(`The AI service failed (${res.status}).`);
    const data = (await res.json()) as { choices?: { message?: ChatMsg }[] };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("The AI service gave no answer.");
    return msg;
  }
  throw new Error("The AI service is rate limited. Try again in a minute.");
}

/** The answer when Cashfree isn't connected: honest about what is missing, still useful. */
function offlineAnswer(): AgentResult {
  const p = payrollPosition();
  const steps: AgentStep[] = [{ tool: "get_payroll_position", source: "bolpay", args: {}, result: JSON.stringify(p), ok: true }];
  return {
    cashfree: false,
    steps,
    answer: `${formatMoney(p.stillToSend)} is still to be sent this period (${p.awaitingApproval.count} awaiting approval, ${p.failedNeedingRetry.count} failed). Connect Cashfree under Integrations and I can also check your settlements and tell you whether it is covered.`,
  };
}

export async function runFundingAgent(question: string, actor = "owner"): Promise<AgentResult> {
  if (!isConnected()) return offlineAnswer();
  try {
    return await withMcp((client) => loop(client, question));
  } catch (e) {
    if (e instanceof McpNotConnected) return { ...offlineAnswer(), answer: `${e.message} ${offlineAnswer().answer}` };
    throw e;
  } finally {
    logAudit("agent.funding", question.slice(0, 120), undefined, actor);
  }
}

async function loop(client: Client, question: string): Promise<AgentResult> {
  const mcpTools = pickTools((await client.listTools()).tools as McpTool[]);
  const names = new Set(mcpTools.map((t) => t.name));
  const toolDefs = [
    { type: "function", function: { name: "get_payroll_position", description: "What the business owes its workers this pay period, from BolPay records (INR).", parameters: { type: "object", properties: {} } } },
    ...mcpTools.map((t) => ({ type: "function", function: { name: t.name, description: (t.description ?? "").slice(0, 200), parameters: slim(t.inputSchema, t.name) } })),
  ];
  const messages: ChatMsg[] = [{ role: "system", content: SYSTEM }, { role: "user", content: question }];
  const steps: AgentStep[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const msg = await chat(messages, toolDefs);
    if (!msg.tool_calls?.length) return { cashfree: true, steps, answer: (msg.content ?? "").trim() || "I couldn't reach an answer." };
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* an unparsable call is reported back to the model below */
      }
      let result: string;
      let ok = true;
      if (steps.length >= MAX_CALLS) {
        steps.push({ tool: name, source: "cashfree-mcp", args, result: "Skipped: tool call limit reached.", ok: false });
        messages.push({ role: "tool", tool_call_id: call.id, content: "Skipped: tool call limit reached. Answer with what you have." });
        continue;
      }
      let source: AgentStep["source"] = "cashfree-mcp";
      try {
        if (name === "get_payroll_position") {
          source = "bolpay";
          result = JSON.stringify(payrollPosition());
        } else if (steps.some((x) => x.tool === name && !x.ok && JSON.stringify(x.args) === JSON.stringify(args))) {
          result = "This exact call already failed. Do not repeat it: change the arguments or answer from what you have.";
          ok = false;
        } else if (names.has(name)) {
          const out = await client.callTool({ name, arguments: args });
          result = trim(out.structuredContent ?? out.content);
          // Cashfree reports many failures (403, "product not activated") inside a normal reply, so look at the body too.
          ok = !out.isError && !/"success":\s*false|"error_type"|"error":\s*\{/.test(result);
        } else {
          result = `Unknown or not permitted tool: ${name}`;
          ok = false;
        }
      } catch (e) {
        result = e instanceof Error ? e.message : "Tool failed";
        ok = false;
      }
      steps.push({ tool: name, source, args, result, ok });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  // Out of steps: ask for a final answer with no tools.
  const last = await chat([...messages, { role: "user", content: "Answer now from what you have." }], []);
  return { cashfree: true, steps, answer: (last.content ?? "").trim() || "I couldn't reach an answer." };
}
