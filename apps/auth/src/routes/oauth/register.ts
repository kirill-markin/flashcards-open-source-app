/**
 * RFC 7591 Dynamic Client Registration. MCP clients self-register a redirect
 * URI set and receive a public client_id. All clients are public + PKCE:
 * token_endpoint_auth_method is always `none`, so no client secret is issued.
 */
import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { saveClient } from "../../server/oauth/oauthStore.js";

const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME_LENGTH = 255;

type RegisterRequestBody = Readonly<{
  redirect_uris?: unknown;
  client_name?: unknown;
}>;

/**
 * Validates a single redirect URI: absolute, https, or a loopback http URL for
 * native clients (RFC 8252). No fragment is allowed (RFC 6749 §3.1.2).
 */
function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.hash !== "") {
    return false;
  }

  if (url.protocol === "https:") {
    return true;
  }

  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }

  // Allow custom/private-use URI schemes (e.g. com.example.app:/callback) used
  // by native clients per RFC 8252 §7.1. Require a reverse-DNS style scheme
  // (must contain a dot) so file:, ftp:, vbscript:, javascript:, data:, and
  // bare single-label schemes are rejected.
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) && url.protocol.includes(".");
}

function parseRedirectUris(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS) {
    return null;
  }

  const uris: Array<string> = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isAllowedRedirectUri(entry)) {
      return null;
    }
    uris.push(entry);
  }

  return uris;
}

function parseClientName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_CLIENT_NAME_LENGTH) {
    return null;
  }

  return trimmed;
}

const app = new Hono<AuthAppEnv>();

app.post("/register", async (c) => {
  let body: RegisterRequestBody;
  try {
    body = await c.req.json<RegisterRequestBody>();
  } catch {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description: "Request body must be valid JSON.",
      },
      400,
    );
  }

  const redirectUris = parseRedirectUris(body.redirect_uris);
  if (redirectUris === null) {
    return c.json(
      {
        error: "invalid_redirect_uri",
        error_description:
          "redirect_uris must be a non-empty array of absolute https (or loopback http / private-use scheme) URIs without a fragment.",
      },
      400,
    );
  }

  const clientName = parseClientName(body.client_name);
  const client = await saveClient(redirectUris, clientName);

  return c.json(
    {
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(client.clientName !== null ? { client_name: client.clientName } : {}),
    },
    201,
  );
});

export default app;
