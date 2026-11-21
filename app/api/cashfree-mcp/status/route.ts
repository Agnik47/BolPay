import { isConnected, withMcp, CASHFREE_MCP_URL } from "@/app/lib/cashfree/mcp/client";
import { readMcp } from "@/app/lib/cashfree/mcp/store";
import { OWNER, respond } from "@/app/lib/server/http";

/** GET: whether Cashfree's MCP server is connected and which tools it offers. Owners only. */
export async function GET() {
  return respond(async () => {
    if (!isConnected()) return { cashfreeMcp: { connected: false, url: CASHFREE_MCP_URL, tools: [] as string[], connectedAt: null } };
    let tools: string[] = [];
    let error: string | null = null;
    try {
      tools = await withMcp(async (c) => (await c.listTools()).tools.map((t) => t.name));
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not list tools";
    }
    return { cashfreeMcp: { connected: isConnected(), url: CASHFREE_MCP_URL, tools, connectedAt: readMcp().connectedAt ?? null, error } };
  }, OWNER);
}
