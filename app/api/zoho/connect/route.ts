import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { guard, OWNER } from "@/app/lib/server/http";
import { authorizeUrl, zohoConfigured } from "@/app/lib/zoho/client";
import { safeReturnPath, ZOHO_RETURN_COOKIE } from "@/app/lib/zoho/return-path";

/** GET: starts "Connect Zoho". Sends the signed-in owner to Zoho's consent screen with a one-time state value. */
export async function GET(req: Request) {
  const denied = await guard(OWNER);
  if (denied) return denied;
  const returnTo = safeReturnPath(new URL(req.url).searchParams.get("returnTo"));
  if (!zohoConfigured()) return NextResponse.redirect(new URL(`${returnTo}?zoho=not_configured`, req.url));
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/zoho", maxAge: 600 };
  jar.set("zoho_oauth_state", state, opts);
  jar.set(ZOHO_RETURN_COOKIE, returnTo, opts);
  return NextResponse.redirect(authorizeUrl(state));
}
