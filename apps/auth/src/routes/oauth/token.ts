/**
 * OAuth 2.1 token endpoint for the MCP authorization server. Supports the
 * authorization_code grant (public client + PKCE S256) and the refresh_token
 * grant. Tokens are opaque secrets minted here and bound to an
 * auth.oauth_connections row; only their hashes are persisted.
 *
 * Library-spike note: this endpoint is hand-written rather than delegated to
 * @node-oauth/oauth2-server. That library owns token generation, expiry, and
 * scope semantics through a full Model implementation plus a Request/Response
 * adapter to bridge Hono, which is more glue than the few grant-specific
 * checks below (S256 verify, single-use code, opaque mint). The token logic
 * here reuses the existing opaque-token + SHA-256 hashing + Crockford patterns
 * (server/oauth/oauthStore.ts, server/otp/crockford.ts), so no OAuth runtime
 * dependency is added.
 */
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import {
  consumeAuthorizationCodeAndIssueTokens,
  getActiveAuthorizationCode,
  rotateRefreshToken,
  type IssuedTokens,
} from "../../server/oauth/oauthStore.js";
import { verifyPkceS256 } from "../../server/oauth/pkce.js";

type OAuthErrorCode =
  | "invalid_request"
  | "invalid_grant"
  | "unsupported_grant_type";

function tokenError(
  c: Context<AuthAppEnv>,
  statusCode: ContentfulStatusCode,
  error: OAuthErrorCode,
  description: string,
): Response {
  // RFC 6749 §5.2: token error responses are JSON and must not be cached.
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({ error, error_description: description }, statusCode);
}

function tokenSuccess(c: Context<AuthAppEnv>, tokens: IssuedTokens): Response {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresInSeconds,
    refresh_token: tokens.refreshToken,
    ...(tokens.scope !== null ? { scope: tokens.scope } : {}),
  });
}

function getField(form: Record<string, string | File>, name: string): string {
  const value = form[name];
  return typeof value === "string" ? value : "";
}

async function handleAuthorizationCodeGrant(
  c: Context<AuthAppEnv>,
  form: Record<string, string | File>,
  nowMs: number,
): Promise<Response> {
  const code = getField(form, "code");
  const codeVerifier = getField(form, "code_verifier");
  const redirectUri = getField(form, "redirect_uri");
  const clientId = getField(form, "client_id");

  if (code === "" || codeVerifier === "" || redirectUri === "" || clientId === "") {
    return tokenError(
      c,
      400,
      "invalid_request",
      "code, code_verifier, redirect_uri, and client_id are required for the authorization_code grant.",
    );
  }

  const authorizationCode = await getActiveAuthorizationCode(code, nowMs);
  if (authorizationCode === null) {
    return tokenError(c, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
  }

  if (authorizationCode.clientId !== clientId) {
    return tokenError(c, 400, "invalid_grant", "The authorization code was not issued to this client.");
  }

  if (authorizationCode.redirectUri !== redirectUri) {
    return tokenError(c, 400, "invalid_grant", "redirect_uri does not match the authorization request.");
  }

  // Only S256 codes are persisted (DB CHECK constraint), but verify defensively.
  if (
    authorizationCode.codeChallengeMethod !== "S256"
    || !verifyPkceS256(codeVerifier, authorizationCode.codeChallenge)
  ) {
    return tokenError(c, 400, "invalid_grant", "PKCE verification failed.");
  }

  const tokens = await consumeAuthorizationCodeAndIssueTokens(code, nowMs);
  if (tokens === null) {
    // Lost the single-use race: the code was consumed between verification and
    // the atomic consume. Treat as already used.
    return tokenError(c, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
  }

  return tokenSuccess(c, tokens);
}

async function handleRefreshTokenGrant(
  c: Context<AuthAppEnv>,
  form: Record<string, string | File>,
  nowMs: number,
): Promise<Response> {
  const refreshToken = getField(form, "refresh_token");
  const clientId = getField(form, "client_id");

  if (refreshToken === "" || clientId === "") {
    return tokenError(
      c,
      400,
      "invalid_request",
      "refresh_token and client_id are required for the refresh_token grant.",
    );
  }

  // No separate client lookup: rotateRefreshToken binds the token to the
  // requesting client via conn.client_id, so an unknown or mismatched
  // client_id yields no active row and returns invalid_grant. This is also the
  // correct anti-enumeration behavior (no distinct unknown-client signal).
  const tokens = await rotateRefreshToken(refreshToken, clientId, nowMs);
  if (tokens === null) {
    return tokenError(c, 400, "invalid_grant", "The refresh token is invalid, expired, or revoked.");
  }

  return tokenSuccess(c, tokens);
}

export function createTokenApp(now: () => number): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/token", async (c) => {
    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody();
    } catch {
      return tokenError(c, 400, "invalid_request", "Request body must be application/x-www-form-urlencoded.");
    }

    const grantType = getField(form, "grant_type");
    const nowMs = now();

    if (grantType === "authorization_code") {
      return handleAuthorizationCodeGrant(c, form, nowMs);
    }

    if (grantType === "refresh_token") {
      return handleRefreshTokenGrant(c, form, nowMs);
    }

    return tokenError(
      c,
      400,
      "unsupported_grant_type",
      "Only authorization_code and refresh_token grants are supported.",
    );
  });

  return app;
}

export default createTokenApp(() => Date.now());
