import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { readMcp, writeMcp } from "./store";

export const CASHFREE_MCP_URL = process.env.CASHFREE_MCP_URL || "https://mcp.cashfree.com/mcp";
const SCOPES = "mcp-pg-read mcp-workflows-read";

export class McpNotConnected extends Error {
  constructor(message = "Cashfree is not connected. Connect it under Integrations first.") {
    super(message);
  }
}

/** Where Cashfree sends the owner back after login. APP_URL wins so it matches what is allowed at Cashfree. */
export function callbackUrl(origin: string) {
  return `${(process.env.APP_URL || origin).replace(/\/$/, "")}/api/cashfree-mcp/callback`;
}

/** The SDK drives discovery, dynamic client registration, PKCE and refresh; this only persists what it produces. */
export function makeProvider(redirect: string, onRedirect?: (u: URL) => void, state?: string): OAuthClientProvider {
  const metadata: OAuthClientMetadata = {
    client_name: "BolPay Funding Agent",
    redirect_uris: [redirect],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: SCOPES,
  };
  return {
    get redirectUrl() {
      return redirect;
    },
    get clientMetadata() {
      return metadata;
    },
    state: state ? () => state : undefined,
    clientInformation: () => readMcp().clientInfo,
    saveClientInformation: (clientInfo) => writeMcp({ clientInfo }),
    tokens: () => readMcp().tokens,
    saveTokens: (tokens) => writeMcp({ tokens, connectedAt: readMcp().connectedAt ?? new Date().toISOString() }),
    saveCodeVerifier: (codeVerifier) => writeMcp({ codeVerifier }),
    codeVerifier: () => {
      const v = readMcp().codeVerifier;
      if (!v) throw new Error("No sign-in is in progress.");
      return v;
    },
    redirectToAuthorization: (u) => onRedirect?.(u),
    invalidateCredentials: (scope) => {
      if (scope === "all" || scope === "tokens") writeMcp({ tokens: undefined });
      if (scope === "all" || scope === "client") writeMcp({ clientInfo: undefined });
      if (scope === "all" || scope === "verifier") writeMcp({ codeVerifier: undefined });
    },
  };
}

/** Step 1 of login: returns the Cashfree consent URL to send the owner to. */
export async function beginLogin(redirect: string, state: string): Promise<string> {
  let url: URL | null = null;
  const transport = new StreamableHTTPClientTransport(new URL(CASHFREE_MCP_URL), { authProvider: makeProvider(redirect, (u) => (url = u), state) });
  const client = new Client({ name: "bolpay", version: "1.0.0" });
  try {
    await client.connect(transport);
    await client.close();
  } catch (e) {
    if (!(e instanceof UnauthorizedError) || !url) throw e;
  }
  if (!url) throw new Error("Cashfree did not return a sign-in page.");
  return String(url);
}

/** Step 2 of login: trades the code from the callback for tokens. */
export async function finishLogin(redirect: string, code: string) {
  const transport = new StreamableHTTPClientTransport(new URL(CASHFREE_MCP_URL), { authProvider: makeProvider(redirect) });
  await transport.finishAuth(code);
  writeMcp({ codeVerifier: undefined });
}

export const isConnected = () => Boolean(readMcp().tokens);

/** Opens a session, runs `fn`, always closes. A rejected token is cleared so the UI shows "Connect" again. */
export async function withMcp<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  if (!isConnected()) throw new McpNotConnected();
  const transport = new StreamableHTTPClientTransport(new URL(CASHFREE_MCP_URL), { authProvider: makeProvider("http://localhost/unused") });
  const client = new Client({ name: "bolpay", version: "1.0.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } catch (e) {
    // A rejected or unrefreshable login surfaces as UnauthorizedError or one of the SDK's OAuth errors: either way, sign in again.
    if (e instanceof UnauthorizedError || e instanceof OAuthError) {
      writeMcp({ tokens: undefined });
      throw new McpNotConnected("Cashfree sign-in expired. Connect it again under Integrations.");
    }
    throw e;
  } finally {
    await client.close().catch(() => {});
  }
}
