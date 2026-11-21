import { connection, NextResponse } from "next/server";
import { relayCallback, type RelayCallback } from "@/app/lib/server/advances";
import { ServiceError } from "@/app/lib/server/service";

const STEPS: RelayCallback[] = ["eligibility", "manager", "pay", "message"];

/**
 * POST /api/relay/advances/{eligibility|manager|pay|message}  { advanceId, text?, language? }
 * Called by the BolPay agents on Cashfree Relay (HTTP step). No session: the unguessable advance id identifies the
 * request, and each step can only move it forward along BolPay's own rules (see relayCallback). Amounts, limits and
 * UPI ids are never read from this body. If RELAY_SHARED_SECRET is set, the header x-relay-secret must match it.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/relay/advances/[step]">) {
  await connection();
  const { step } = await ctx.params;
  if (!STEPS.includes(step as RelayCallback)) return NextResponse.json({ error: "Unknown step" }, { status: 404 });
  const secret = process.env.RELAY_SHARED_SECRET;
  if (secret && req.headers.get("x-relay-secret") !== secret) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  // Relay may wrap the payload; accept advanceId at the top level or under data.
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const advanceId = String(body.advanceId ?? data.advanceId ?? "");
  if (!/^adv-[0-9a-z]{8,32}$/.test(advanceId)) return NextResponse.json({ error: "Missing or invalid advanceId" }, { status: 400 });
  // Relay's "Test flow" (required before an agent can be activated) uses this id: answered, nothing changes.
  if (advanceId.startsWith("adv-relaytest")) return NextResponse.json({ advanceId, step, test: true, changed: false, status: "test" });

  try {
    return NextResponse.json(await relayCallback(step as RelayCallback, advanceId, { ...data, ...body }));
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Relay callback failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
