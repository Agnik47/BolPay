import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { beginLogin, callbackUrl } from "@/app/lib/cashfree/mcp/client";
import { guard, OWNER, withRequestWorkspace } from "@/app/lib/server/http";

/** GET: starts "Connect Cashfree". Registers BolPay with Cashfree's MCP server and sends the owner to its login page. */
export async function GET(req: Request) {
  const denied = await guard(OWNER);
  if (denied) return denied;
  const state = randomBytes(16).toString("hex");
  const redirect = callbackUrl(new URL(req.url).origin);
  try {
    const url = await withRequestWorkspace(() => beginLogin(redirect, state));
    (await cookies()).set("cf_mcp_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/cashfree-mcp", maxAge: 600 });
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("Cashfree MCP connect failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/integrations?cashfree=error&reason=" + encodeURIComponent("Could not reach Cashfree's sign-in."), req.url));
  }
}
