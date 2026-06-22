/**
 * Lambda entry point for the dedicated MCP API Gateway on mcp.<domain>.
 *
 * This minimal handler serves only the OAuth Protected Resource Metadata
 * (PRM) document and a Bearer 401 challenge for now. The real Streamable
 * HTTP `/mcp` transport, the `sql` tool, and the Bearer-token connection
 * resolver are added later by the MCP server item, which extends this file.
 *
 * The canonical MCP resource is `https://mcp.<domain>/mcp` (no `/v1` stage
 * prefix), and the authorization server lives on `https://auth.<domain>`.
 */
import { handle } from "hono/aws-lambda";
import { Hono } from "hono";

const supportedScopes = ["flashcards"] as const;

/**
 * Resolves the public base domain from the environment. Backend Lambdas are
 * wired with `MCP_BASE_DOMAIN`, and we fail loudly rather than serve a
 * metadata document pointing at the wrong host.
 */
function getBaseDomain(): string {
  const baseDomain = process.env.MCP_BASE_DOMAIN;
  if (baseDomain === undefined || baseDomain.trim() === "") {
    throw new Error("MCP_BASE_DOMAIN environment variable is required for the MCP handler");
  }

  return baseDomain.trim();
}

function getResourceUrl(baseDomain: string): string {
  return `https://mcp.${baseDomain}/mcp`;
}

function getAuthorizationServerUrl(baseDomain: string): string {
  return `https://auth.${baseDomain}`;
}

function getProtectedResourceMetadataUrl(baseDomain: string): string {
  return `https://mcp.${baseDomain}/.well-known/oauth-protected-resource`;
}

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/.well-known/oauth-protected-resource", (c) => {
  const baseDomain = getBaseDomain();
  return c.json({
    resource: getResourceUrl(baseDomain),
    authorization_servers: [getAuthorizationServerUrl(baseDomain)],
    bearer_methods_supported: ["header"],
    scopes_supported: [...supportedScopes],
  });
});

app.all("/mcp", (c) => {
  const baseDomain = getBaseDomain();
  const authorization = c.req.header("authorization");
  const hasBearer = authorization !== undefined && /^Bearer\s+\S+/i.test(authorization);
  if (!hasBearer) {
    return c.json(
      {
        error: "invalid_token",
        error_description: "A valid OAuth Bearer token is required to access the MCP resource.",
      },
      401,
      {
        "WWW-Authenticate": `Bearer resource_metadata="${getProtectedResourceMetadataUrl(baseDomain)}"`,
      },
    );
  }

  // The real Streamable HTTP transport and the `sql` tool are added by the
  // MCP server item. Until then, an authenticated request returns 501.
  return c.json(
    {
      error: "not_implemented",
      error_description: "The MCP transport is not available yet.",
    },
    501,
  );
});

export const handler = handle(app);
