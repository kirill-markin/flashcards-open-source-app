/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata. MCP clients discover the
 * authorization, token, and registration endpoints from this document after
 * following the protected-resource metadata served on the mcp.<domain> host.
 *
 * The issuer is the public auth origin (https://auth.<domain>) with no stage
 * prefix; the endpoints are derived from it. Correctness depends on
 * PUBLIC_AUTH_BASE_URL being set to the custom domain (as auth-gateway.ts does
 * in production). Without it, getPublicAuthBaseUrl falls back to the request
 * origin, which on the raw execute-api stage URL omits the /v1 stage prefix and
 * yields wrong endpoints; the custom-domain path is the supported config.
 */
import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { getPublicAuthBaseUrl } from "../../server/publicUrls.js";

function buildAuthorizationServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["flashcards"],
    authorization_response_iss_parameter_supported: true,
  };
}

const app = new Hono<AuthAppEnv>();

app.get("/.well-known/oauth-authorization-server", (c) => {
  const issuer = getPublicAuthBaseUrl(c.req.url);
  return c.json(buildAuthorizationServerMetadata(issuer));
});

export default app;
