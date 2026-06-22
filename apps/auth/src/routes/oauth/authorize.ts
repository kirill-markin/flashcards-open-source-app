/**
 * Browser-facing OAuth 2.1 authorization endpoint for the MCP authorization
 * server. This is the screen the user sees after clicking "Connect" in an MCP
 * client (Claude.ai, ChatGPT, ...).
 *
 * GET /authorize validates the public-client + PKCE authorization request
 * (client_id against auth.oauth_clients, redirect_uri, response_type=code,
 * code_challenge/S256, scope, resource) and renders a localized sign-in +
 * consent page. Sign-in reuses the existing email + OTP flow (/api/send-code +
 * /api/verify-code set the session cookie). On approval the page posts to
 * POST /authorize/consent, which resolves the user from the session cookie the
 * same way createAgentApiKeyFromIdToken does, upserts the (user, client)
 * connection, writes a single-use authorization code (server/oauth model), and
 * returns the redirect URL carrying code, state, and iss.
 *
 * Validation-error rules (RFC 6749 §4.1.2.1): if client_id or redirect_uri is
 * invalid we MUST NOT redirect (the redirect target is untrusted) and render an
 * inline error instead. For other invalid parameters we redirect back to the
 * validated redirect_uri with an `error` code.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { getClient, approveAuthorizationRequest } from "../../server/oauth/oauthStore.js";
import { getMcpResource, getPublicAuthBaseUrl } from "../../server/publicUrls.js";
import { validateSessionToken } from "../../server/browserSession.js";
import { resolveLoginPageLocale } from "../browser/loginPageLocale.js";
import { renderAuthorizePage, type AuthorizeRequestView } from "../../templates/authorize.js";

const SUPPORTED_SCOPE = "flashcards";
const MAX_CONNECTION_LABEL_LENGTH = 120;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

type AuthorizeErrorCode =
  | "invalid_request"
  | "unsupported_response_type"
  | "invalid_scope"
  | "access_denied"
  | "server_error";

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
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) {
    url.searchParams.set("state", state);
  }
  return c.redirect(url.toString(), 302);
}

/**
 * Validates the connection label the page will show in settings, derived from
 * the registered client name. Falls back to a generic label.
 */
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
    if (scope !== null && !scope.split(/\s+/).every((entry) => entry === SUPPORTED_SCOPE)) {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_scope",
        `The only supported scope is '${SUPPORTED_SCOPE}'.`,
      );
    }

    const expectedResource = getMcpResource(c.req.url);
    if (resource === "") {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_request",
        "The resource parameter (RFC 8707) is required.",
      );
    }

    if (resource !== expectedResource) {
      return redirectWithError(
        c,
        redirectUri,
        state,
        "invalid_request",
        "The resource parameter does not match this server's protected resource.",
      );
    }

    const requestView: AuthorizeRequestView = {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      scope,
      resource,
      clientName: buildConnectionLabel(client.clientName),
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
    const scope = typeof body.scope === "string" && body.scope !== "" ? body.scope : null;
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

    if (resource !== getMcpResource(c.req.url)) {
      return c.json({ error: "invalid_request", error_description: "Unexpected resource." }, 400);
    }

    if (scope !== null && !scope.split(/\s+/).every((entry) => entry === SUPPORTED_SCOPE)) {
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

    const code = await approveAuthorizationRequest(
      sessionToken,
      {
        clientId,
        redirectUri,
        codeChallenge,
        scope,
        resource,
        connectionLabel: buildConnectionLabel(client.clientName),
      },
      now(),
    );

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
