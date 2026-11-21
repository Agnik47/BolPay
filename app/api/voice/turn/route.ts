import { connection, NextResponse } from "next/server";
import { getSnapshot, ServiceError } from "@/app/lib/server/service";
import { handleTurn, peekSession } from "@/app/lib/voice/session";
import { rateLimit, requireApiRole, withRequestWorkspace } from "@/app/lib/server/http";
import { runInWorkspace, workspaceForBusiness } from "@/app/lib/server/db";
import type { SessionContext } from "@/app/lib/auth/dal";

async function signedIn() {
  try {
    return { session: await requireApiRole(["owner", "supervisor", "worker"]) };
  } catch (err) {
    const e = err as ServiceError;
    return { denied: NextResponse.json({ error: e.message }, { status: e.status }) };
  }
}

const MAX_TEXT = 600;

const ctxOf = (s: SessionContext) => ({ role: s.role, name: s.displayName, workerId: s.workerRef });

/**
 * POST { sessionId?, text?, action?: "confirm" | "cancel", dryRun?, reset? }
 * One conversational turn for every signed-in role. The session (pending question or pending plan) lives on
 * the server, so it survives the panel closing, the mic being tapped again, or the page reloading, and it can
 * only be continued by the person who started it. The role, name and worker record come from the verified
 * session, never from the request. Staff get the latest company `snapshot` back so the UI can refresh;
 * workers never do.
 */
export async function POST(req: Request) {
  await connection();
  const auth = await signedIn();
  if (auth.denied) return auth.denied;
  const { session } = auth;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : undefined;
  if (text && text.length > MAX_TEXT) return NextResponse.json({ error: `Messages are limited to ${MAX_TEXT} characters.` }, { status: 413 });
  const action = body.action === "confirm" || body.action === "cancel" ? body.action : undefined;
  try {
    rateLimit(`voice-turn:${session.userId}`, 60, 10 * 60_000);
  } catch (err) {
    return NextResponse.json({ error: (err as ServiceError).message }, { status: (err as ServiceError).status });
  }

  const run = async () =>
    handleTurn({
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      text,
      action,
      dryRun: body.dryRun === true,
      reset: body.reset === true,
      ctx: ctxOf(session),
      userId: session.userId,
    });

  if (session.role === "worker") {
    // A worker's conversation runs in their own business's dataset, and only ever returns what they asked about.
    const view = await runInWorkspace(workspaceForBusiness(session.business.id, "demo"), run);
    return NextResponse.json(view);
  }
  // The plan, its checks and the money step all run on the caller's own dataset.
  return withRequestWorkspace(async () => NextResponse.json({ ...(await run()), snapshot: getSnapshot() }));
}

/** GET ?sessionId=... restores the last turn view after a reload (only for the session's own user). */
export async function GET(req: Request) {
  await connection();
  const auth = await signedIn();
  if (auth.denied) return auth.denied;
  const id = new URL(req.url).searchParams.get("sessionId");
  const view = id ? peekSession(id, auth.session.userId) : null;
  return view ? NextResponse.json(view) : NextResponse.json({ error: "No such session" }, { status: 404 });
}
