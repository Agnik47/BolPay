import { cookies } from "next/headers";
import { getSession } from "@/app/lib/auth/dal";
import { readJson, respond, STAFF } from "@/app/lib/server/http";
import { DEMO_BUSINESS_ID, DEMO_WORKSPACES, getWorkspace, WORKSPACE_COOKIE, type Workspace } from "@/app/lib/server/db";
import { ServiceError } from "@/app/lib/server/service";

/** GET: which dataset the signed-in person is viewing ("demo" or "zoho", or their own business's). */
export async function GET() {
  return respond(() => ({ workspace: getWorkspace() }), STAFF);
}

/**
 * POST { workspace: "demo" | "zoho" }: switch the dataset for the person calling only, kept in their own
 * cookie. Everyone else keeps their view. Only the demo business has two datasets to switch between; every
 * other business works on its own data. Roles still decide what they may do inside a dataset.
 */
export async function POST(req: Request) {
  return respond(async () => {
    const session = await getSession();
    if (session?.business.id !== DEMO_BUSINESS_ID) throw new ServiceError("Your business has a single dataset, so there is nothing to switch.", 400);
    const b = await readJson(req);
    if (!DEMO_WORKSPACES.includes(b.workspace as Workspace)) throw new ServiceError('workspace must be "demo" or "zoho"');
    const next = b.workspace as Workspace;
    (await cookies()).set(WORKSPACE_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    // This request still ran on the old dataset; the client reloads to pick up the new one.
    return { workspace: next };
  }, STAFF);
}
