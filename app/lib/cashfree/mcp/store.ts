import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { getWorkspace } from "@/app/lib/server/db";

/**
 * Per-business OAuth state for the Cashfree MCP server (.data/cashfree-mcp.json), keyed by workspace so one
 * business can never use (or disconnect) another's Cashfree login. Tokens never leave the server.
 */
interface Stored {
  clientInfo?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  connectedAt?: string;
}

const FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "cashfree-mcp.json");

function readAll(): Record<string, Stored | undefined> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, Stored | undefined>;
  } catch {
    return {};
  }
}

export function readMcp(): Stored {
  return readAll()[getWorkspace()] ?? {};
}

export function writeMcp(patch: Partial<Stored> | null) {
  const all = readAll();
  const key = getWorkspace();
  all[key] = patch === null ? undefined : { ...(all[key] ?? {}), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all), { mode: 0o600 });
}
