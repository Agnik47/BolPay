"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, buttonClass, Card, inputClass, Notice } from "./ui";
import { ListSkeleton } from "../Skeleton";

interface McpStatus {
  connected: boolean;
  tools: string[];
  connectedAt: string | null;
  error?: string | null;
}
interface Step {
  tool: string;
  source: "cashfree-mcp" | "bolpay";
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
}
interface Answer {
  answer: string;
  steps: Step[];
  cashfree: boolean;
}

const SUGGESTIONS = ["Can I cover this month's payroll?", "When is my next settlement?", "Am I short for the pending payouts?"];

/** Payroll Funding Agent: connect Cashfree's MCP server, ask a question, see every tool the agent called. */
export function FundingAgentCard({ manage = false }: { manage?: boolean }) {
  const params = useSearchParams();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cashfree-mcp/status");
    const d = (await res.json().catch(() => ({}))) as { cashfreeMcp?: McpStatus };
    if (res.ok && d.cashfreeMcp) setStatus(d.cashfreeMcp);
  }, []);
  useEffect(() => {
    // Initial load of the connection state from the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setOut(null);
    const res = await fetch("/api/cashfree-mcp/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
    const d = (await res.json().catch(() => ({}))) as { agent?: Answer; error?: string };
    if (res.ok && d.agent) setOut(d.agent);
    else setErr(d.error ?? "The agent could not answer.");
    setBusy(false);
    void load();
  }

  async function disconnect() {
    await fetch("/api/cashfree-mcp/disconnect", { method: "POST" });
    setOut(null);
    void load();
  }

  const flag = params.get("cashfree");
  return (
    <Card
      title="Payroll funding agent"
      actions={status && <Badge tone={status.connected ? "green" : "slate"}>{status.connected ? `Cashfree connected · ${status.tools.length} tools` : "Cashfree not connected"}</Badge>}
    >
      <div className="space-y-3">
        {!status && <ListSkeleton label="Checking the Cashfree connection" rows={2} />}
        <p className="text-sm text-slate-600">
          An AI agent that checks your Cashfree settlements against what you owe workers, using Cashfree&apos;s MCP server. It only reads; it can&apos;t move money.
        </p>
        {manage && flag === "connected" && <Notice tone="success">Cashfree is connected.</Notice>}
        {manage && flag === "error" && <Notice tone="error">{params.get("reason") ?? "Could not connect Cashfree."}</Notice>}
        {manage && status && !status.connected && (
          <a href="/api/cashfree-mcp/connect" className={buttonClass("primary", "md")}>
            Connect Cashfree
          </a>
        )}
        {manage && status?.connected && (
          <Button size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        )}
        {status?.error && <Notice tone="warn">{status.error}</Notice>}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about funding, settlements, shortfall…" maxLength={300} />
          <Button type="submit" variant="primary" disabled={busy || !q.trim()}>
            {busy ? "Checking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s} size="sm" disabled={busy} onClick={() => { setQ(s); void ask(s); }}>
              {s}
            </Button>
          ))}
        </div>

        {err && <Notice tone="error">{err}</Notice>}
        {out && (
          <div className="space-y-2" aria-live="polite">
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-900">{out.answer}</p>
            {!out.cashfree && <Notice tone="warn">Cashfree isn&apos;t connected, so this uses BolPay records only.</Notice>}
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">What the agent did ({out.steps.length} tool call{out.steps.length === 1 ? "" : "s"})</summary>
              <ol className="mt-2 space-y-1.5">
                {out.steps.map((s, i) => (
                  <li key={i} className="rounded border border-slate-200 p-2">
                    <span className="font-medium text-slate-800">{s.tool}</span> <span className="text-slate-500">· {s.source === "cashfree-mcp" ? "Cashfree MCP" : "BolPay records"}{s.ok ? "" : " · failed"}</span>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-500">{s.result}</pre>
                  </li>
                ))}
              </ol>
            </details>
          </div>
        )}
      </div>
    </Card>
  );
}
