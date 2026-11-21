import { runFundingAgent } from "@/app/lib/cashfree/mcp/agent";
import { OWNER, readJson, respond } from "@/app/lib/server/http";
import { ServiceError } from "@/app/lib/server/service";

/** POST { question }: runs the Payroll Funding Agent and returns its answer plus every tool call it made. Owners only. */
export async function POST(req: Request) {
  return respond(async () => {
    const body = await readJson(req);
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 300) : "";
    if (!question) throw new ServiceError("Ask a question first.");
    try {
      return { agent: await runFundingAgent(question) };
    } catch (e) {
      throw new ServiceError(e instanceof Error ? e.message : "The agent failed.", 502);
    }
  }, OWNER);
}
