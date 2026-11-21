import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callbackUrl, finishLogin } from "@/app/lib/cashfree/mcp/client";
import { guard, OWNER, withRequestWorkspace } from "@/app/lib/server/http";

/** GET: where Cashfree sends the owner back after login. Checks the state value, then stores the tokens. */
export async function GET(req: Request) {
  const denied = await guard(OWNER);
  if (denied) return denied;
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("cf_mcp_state")?.value;
  jar.delete("cf_mcp_state");
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, req.url));
  const err = url.searchParams.get("error");
  if (err) return back(`cashfree=error&reason=${encodeURIComponent(err)}`);
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("cashfree=error&reason=invalid_state");
  try {
    await withRequestWorkspace(() => finishLogin(callbackUrl(url.origin), code));
    return back("cashfree=connected");
  } catch (e) {
    console.error("Cashfree MCP callback failed", e instanceof Error ? e.message : e);
    return back("cashfree=error&reason=" + encodeURIComponent("Could not finish the Cashfree sign-in."));
  }
}
