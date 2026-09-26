import { hasOAuthScope, isSupportedOAuthScope } from "../../server/oauth/scopes.js";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { getClient, approveAuthorizationRequest } from "../../server/oauth/oauthStore.js";
import { DeletedSubjectError } from "../../server/agent/userWorkspace.js";
import { getPublicAuthBaseUrl, isSupportedMcpResource } from "../../server/publicUrls.js";
import { validateSessionToken } from "../../server/browserSession.js";
import { resolveLoginPageLocale } from "../browser/loginPageLocale.js";
import { renderAuthorizePage, type AuthorizeRequestView } from "../../templates/authorize.js";

const MAX_CONNECTION_LABEL_LENGTH = 120;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

type AuthorizeErrorCode =
  | "invalid_request"
  | "unsupported_response_type"
  | "invalid_scope"
  | "access_denied"
  | "server_error"
  | "consent_required"
  | "request_not_supported"
  | "request_uri_not_supported";

/**
 * Builds the redirect back to the client carrying an OAuth error
 * (RFC 6749 §4.1.2.1). Only called once redirect_uri is validated.
 */
function redirectWithError(
  c: Context<AuthAppEnv>,
  redirectUri: string,
  state: string | null,
  error: AuthorizeErrorCode,
  description: string,
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("iss", getPublicAuthBaseUrl(c.req.url));
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) {
    url.searchParams.set("state", state);
  }
  return c.redirect(url.toString(), 302);
}

function buildConnectionLabel(clientName: string | null): string {
  const trimmed = (clientName ?? "").trim();
  if (trimmed === "") {
    return "MCP client";
  }
  return trimmed.slice(0, MAX_CONNECTION_LABEL_LENGTH);
}

export function createAuthorizeApp(now: () => number): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.get("/authorize", async (c) => {
    const clientId = c.req.query("client_id") ?? "";
    const redirectUri = c.req.query("redirect_uri") ?? "";
    const responseType = c.req.query("response_type") ?? "";
    const codeChallenge = c.req.query("code_challenge") ?? "";
    const codeChallengeMethod = c.req.query("code_challenge_method") ?? "";
    const rawScope = c.req.query("scope") ?? "";
    const resource = c.req.query("resource") ?? "";
    const state = c.req.query("state") ?? null;
    const nonce = c.req.query("nonce") ?? null;

    // 1. client_id + redirect_uri: invalid here MUST NOT redirect (untrusted
    //    target). Render inline plaintext errors instead.
    if (clientId === "") {
      return c.text("Missing client_id parameter", 400);
    }

    const client = await getClient(clientId);
    if (client === null) {
      return c.text("Unknown client_id", 400);
    }

    if (redirectUri === "") {
      return c.text("Missing redirect_uri parameter", 400);
    }

    if (!client.redirectUris.includes(redirectUri)) {
      return c.text("redirect_uri does not match a registered redirect URI", 400);
    }

    // 2. Remaining parameters: redirect_uri is trusted, so report errors to it.
    if (responseType !== "code") {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "unsupported_response_type",
        "Only response_type=code is supported.",
      );
    }

    if (codeChallengeMethod !== "S256" || !CODE_CHALLENGE_RE.test(codeChallenge)) {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_request",
        "A PKCE code_challenge with code_challenge_method=S256 is required.",
      );
    }

    const scope = rawScope.trim() === "" ? null : rawScope.trim();
    if (!isSupportedOAuthScope(scope)) {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_scope",
        "Supported scopes are flashcards, openid, and email; email requires openid.",
      );
    }

    if (resource === "") {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_request",
        "The resource parameter (RFC 8707) is required.",
      );
    }

    // The grant is bound to the exact resource the client asked for, which is one
    // of the MCP hosts this server serves. The resulting token is valid only on
    // that host (server/publicUrls.ts).
    if (!isSupportedMcpResource(resource, c.req.url)) {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_request",
        "The resource parameter does not match this server's protected resource.",
      );
    }

    if (nonce !== null && (nonce === "" || nonce.length > 1024)) {
      return redirectWithError(c, redirectUri, state, "invalid_request", "nonce must contain 1 to 1024 characters.");
    }
    if (hasOAuthScope(scope, "openid")) {
      if (c.req.query("request") !== undefined) {
        return redirectWithError(c, redirectUri, state, "request_not_supported", "Request objects are not supported.");
      }
      if (c.req.query("request_uri") !== undefined) {
        return redirectWithError(c, redirectUri, state, "request_uri_not_supported", "Request URI objects are not supported.");
      }
      const prompt = c.req.query("prompt");
      if (prompt === "none") {
        return redirectWithError(c, redirectUri, state, "consent_required", "Explicit consent is required for each authorization.");
      }
      if ((prompt !== undefined && prompt !== "consent") || c.req.query("max_age") !== undefined) {
        return redirectWithError(c, redirectUri, state, "invalid_request", "Only interactive consent is supported; prompt and max_age requirements cannot be satisfied.");
      }
    }

    const requestView: AuthorizeRequestView = {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      scope,
      resource,
      clientName: buildConnectionLabel(client.clientName),
      nonce,
      issuer: getPublicAuthBaseUrl(c.req.url),
    };

    const locale = resolveLoginPageLocale(c.req.query("locale"), c.req.header("accept-language"));
    // Authenticated consent page reflecting per-request parameters: never serve
    // it from a shared cache.
    c.header("Cache-Control", "no-store");
    // Anti-clickjacking: the consent screen is a one-click persistent OAuth-grant
    // target, so deny framing entirely.
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "frame-ancestors 'none'");
    return c.html(renderAuthorizePage(requestView, locale));
  });

  app.post("/authorize/consent", async (c) => {
    let body: {
      client_id?: unknown;
      redirect_uri?: unknown;
      state?: unknown;
      code_challenge?: unknown;
      scope?: unknown;
      resource?: unknown;
      nonce?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", error_description: "Request body must be valid JSON." }, 400);
    }

    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
    const state = typeof body.state === "string" ? body.state : null;
    const codeChallenge = typeof body.code_challenge === "string" ? body.code_challenge : "";
    const scope = typeof body.scope === "string" && body.scope.trim() !== "" ? body.scope.trim() : null;
    const nonce = typeof body.nonce === "string" ? body.nonce : null;
    if (nonce !== null && (nonce === "" || nonce.length > 1024)) {
      return c.json({ error: "invalid_request", error_description: "nonce must contain 1 to 1024 characters." }, 400);
    }
    const resource = typeof body.resource === "string" ? body.resource : "";

    // Re-validate the request server-side: the page-embedded values are
    // attacker-influencable, so the consent grant must not trust them blindly.
    if (clientId === "" || redirectUri === "" || resource === "" || !CODE_CHALLENGE_RE.test(codeChallenge)) {
      return c.json({ error: "invalid_request", error_description: "The authorization request is incomplete." }, 400);
    }

    const client = await getClient(clientId);
    if (client === null || !client.redirectUris.includes(redirectUri)) {
      return c.json({ error: "invalid_request", error_description: "Unknown client or redirect_uri." }, 400);
    }

    if (!isSupportedMcpResource(resource, c.req.url)) {
      return c.json({ error: "invalid_request", error_description: "Unexpected resource." }, 400);
    }

    if (!isSupportedOAuthScope(scope)) {
      return c.json({ error: "invalid_scope", error_description: "Unsupported scope." }, 400);
    }

    // The session cookie holds the Cognito ID token set by /api/verify-code.
    const sessionToken = getCookie(c, "session") ?? "";
    if (sessionToken === "") {
      return c.json({ error: "login_required", error_description: "Sign in before approving access." }, 401);
    }

    const validation = await validateSessionToken(sessionToken);
    if (validation.status === "error") {
      throw new Error(validation.reason);
    }
    if (validation.status !== "valid") {
      return c.json({ error: "login_required", error_description: "Sign in before approving access." }, 401);
    }

    let code: string;
    try {
      code = await approveAuthorizationRequest(
        sessionToken,
        {
          clientId,
          redirectUri,
          codeChallenge,
          scope,
          resource,
          connectionLabel: buildConnectionLabel(client.clientName),
          nonce,
        },
        now(),
      );
    } catch (error) {
      if (error instanceof DeletedSubjectError) {
        return c.json({ error: "ACCOUNT_DELETED", error_description: error.message }, 410);
      }
      throw error;
    }

    const redirectTo = new URL(redirectUri);
    redirectTo.searchParams.set("code", code);
    if (state !== null) {
      redirectTo.searchParams.set("state", state);
    }
    // RFC 9207: identify the issuer so clients can defend against mix-up attacks.
    redirectTo.searchParams.set("iss", getPublicAuthBaseUrl(c.req.url));

    c.header("Cache-Control", "no-store");
    return c.json({ redirect_to: redirectTo.toString() });
  });

  return app;
}

export default createAuthorizeApp(() => Date.now());
