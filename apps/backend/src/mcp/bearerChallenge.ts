/**
 * The Bearer token extraction and the 401 challenge of the `/mcp` resource,
 * shared by the dispatcher, which answers requests without a token, and the
 * worker, which answers rejected tokens. MCP clients start OAuth from this
 * challenge, so both must send the same one.
 */

import { getMcpProtectedResourceMetadataUrl } from "./hosts";

const bearerTokenPattern = /^Bearer\s+(\S+)$/i;

export type McpBearerChallenge = Readonly<{
  statusCode: 401;
  body: Readonly<{ error: string; error_description: string }>;
  wwwAuthenticate: string;
}>;

/** The token of one `Authorization` header value, or null when it is not a Bearer credential. */
export function extractBearerToken(authorization: string): string | null {
  return bearerTokenPattern.exec(authorization.trim())?.[1] ?? null;
}

/**
 * Points spec-current MCP clients at the PRM document of the host they used,
 * so a client on the alternate host is never sent across to the primary host.
 */
export function buildMcpBearerChallenge(mcpHost: string): McpBearerChallenge {
  return {
    statusCode: 401,
    body: {
      error: "invalid_token",
      error_description: "A valid OAuth Bearer token is required to access the MCP resource.",
    },
    wwwAuthenticate: `Bearer resource_metadata="${getMcpProtectedResourceMetadataUrl(mcpHost)}"`,
  };
}
