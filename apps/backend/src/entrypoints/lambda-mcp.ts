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
 *
 * Routes are mounted at both `/` and `/v1`, mirroring the auth app
 * (apps/auth/src/app.ts): custom-domain traffic on `mcp.<domain>` arrives
 * without a stage prefix, while the raw execute-api invoke URL delivers the
 * `/v1` stage name in the request path.
 */
import { handle } from "hono/aws-lambda";
import { type Context, Hono } from "hono";

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

/**
 * RFC 9728 §3.1 path-aware Protected Resource Metadata URL. Because the
 * resource identifier carries a `/mcp` path, the well-known suffix is inserted
 * between the host and the path, so spec-current MCP clients that derive the
 * metadata URL from the resource find the document and the `resource` field
 * matches what they expect.
 */
function getProtectedResourceMetadataUrl(baseDomain: string): string {
  return `https://mcp.${baseDomain}/.well-known/oauth-protected-resource/mcp`;
}

function buildProtectedResourceMetadata(baseDomain: string): Record<string, unknown> {
  return {
    resource: getResourceUrl(baseDomain),
    authorization_servers: [getAuthorizationServerUrl(baseDomain)],
    bearer_methods_supported: ["header"],
    scopes_supported: [...supportedScopes],
  };
}

function buildMcpRoutes(app: Hono): Hono {
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Serve PRM at both the RFC 9728 path-aware location (`/mcp` suffix, used by
  // spec-current clients) and the legacy path-less location (older clients).
  // Both return the same document with `resource` = https://mcp.<domain>/mcp.
  const protectedResourceMetadata = (c: Context) =>
    c.json(buildProtectedResourceMetadata(getBaseDomain()));

  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);

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

  return app;
}

const app = new Hono();
// Mount at `/` (custom domain root) and `/v1` (execute-api stage path).
app.route("/", buildMcpRoutes(new Hono()));
app.route("/", buildMcpRoutes(new Hono().basePath("/v1")));

export const handler = handle(app);
