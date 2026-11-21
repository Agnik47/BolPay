"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Notice } from "./ui";

/** Sends a payroll summary to the Cashfree Relay "Payroll alert" agent through its Inbound Webhook. */
export function RelayCard() {
  const [state, setState] = useState<{ configured: boolean; event: { summary: string; period: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/relay/events");
    const d = (await res.json().catch(() => ({}))) as { relay?: { configured: boolean; event: { summary: string; period: string } } };
    if (res.ok && d.relay) setState(d.relay);
  }, []);
  useEffect(() => {
    // Initial load from the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function send() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/relay/events", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { relay?: { sent: boolean; reason?: string }; error?: string };
    setMsg(d.relay?.sent ? { tone: "success", text: "Sent. Check the Runs tab in Relay." } : { tone: "error", text: d.relay?.reason ?? d.error ?? "Could not send." });
    setBusy(false);
  }

  return (
    <Card title="Cashfree Relay: Payroll alert agent" actions={state && <Badge tone={state.configured ? "green" : "slate"}>{state.configured ? "Webhook set" : "Not set"}</Badge>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Sends this period&apos;s payroll summary to your Relay agent, which can email you. Only totals and counts are sent; no UPI ids, and no money moves.</p>
        {state && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-900">{state.event.period}: {state.event.summary}</p>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button variant="primary" disabled={busy || !state?.configured} onClick={send}>
          {busy ? "Sending…" : "Send test event to Relay"}
        </Button>
      </div>
    </Card>
  );
}
