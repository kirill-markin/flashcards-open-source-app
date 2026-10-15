import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { createAuthAttempt, loadAccountProviderBrowserLaunch } from "../../server/social/attemptStore.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { browserAuthOrigin, createBrowserState, requireBrowserRedirect, writeBrowserState } from "../../server/social/browserState.js";
import { getPublicAuthMethods } from "../../server/social/publicMethods.js";
import { SocialProofError } from "../../server/social/providers.js";
import { readAuthAnalyticsContext, reportAuthFact } from "../../server/analytics/signInFunnel.js";
import { requireSocialRequest, socialErrorResponse } from "./http.js";

export function providerAuthorizationUrl(
  provider: "apple" | "google", audience: string, state: string,
  attempt: Readonly<{ redirectUri: string | null; nonce: string; providerCodeChallenge?: string }>,
): string {
  if (attempt.redirectUri === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const authorization = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize");
  authorization.search = new URLSearchParams({ client_id: audience, redirect_uri: attempt.redirectUri,
    response_type: "code", scope: provider === "google" ? "openid email" : "email", state, nonce: attempt.nonce }).toString();
  if (provider === "google") {
    if (attempt.providerCodeChallenge === undefined) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    authorization.searchParams.set("code_challenge", attempt.providerCodeChallenge);
    authorization.searchParams.set("code_challenge_method", "S256");
  } else authorization.searchParams.set("response_mode", "form_post");
  return authorization.toString();
}

const app = new Hono<AuthAppEnv>();
app.get("/api/social/:provider/start", async (c) => {
  try {
    await requireSocialRequest(c, "start");
    c.header("Referrer-Policy", "no-referrer");
    const provider = c.req.param("provider");
    const client = c.req.query("client") ?? "web";
    if ((provider !== "apple" && provider !== "google") || (client !== "web" && client !== "android")
      || (client === "android" && provider !== "apple") || c.req.query("purpose") !== undefined
      || Array.from(new URL(c.req.url).searchParams.keys()).some((key) => c.req.queries(key)!.length !== 1)) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    const method = getPublicAuthMethods(client).methods[provider];
    if (!method.available || method.transport !== "browser") throw new SocialProofError("PROVIDER_UNAVAILABLE");
    const authOrigin = browserAuthOrigin(c);
    const handle = c.req.query("attempt");
    if (handle !== undefined && (client !== "android" || c.req.query("codeChallenge") !== undefined
      || c.req.query("redirect_uri") !== undefined)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const launch = handle === undefined ? null : await loadAccountProviderBrowserLaunch(handle, authOrigin);
    const browserSecret = randomBytes(32).toString("base64url");
    const codeChallenge = launch?.codeChallenge ?? (client === "android" ? c.req.query("codeChallenge") ?? "" : null);
    const redirectUri = client === "web" ? requireBrowserRedirect(c.req.query("redirect_uri") ?? "", authOrigin) : null;
    if ((client === "web" && c.req.query("codeChallenge") !== undefined)
      || (client === "android" && c.req.query("redirect_uri") !== undefined)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const attempt = launch === null ? await createAuthAttempt({ provider, client, purpose: "login", codeChallenge },
      { purpose: "login", subject: null, account: null, reauthCompletion: null },
      client === "web" ? { origin: authOrigin, secret: browserSecret } : null, authOrigin) : launch;
    const state = createBrowserState(authOrigin, provider, attempt.attempt, attempt.expiresAt,
      client === "web" ? { client, browserSecret, redirectUri: redirectUri! } : { client, codeChallenge: codeChallenge! },
      readAuthAnalyticsContext(c), launch?.intent ?? "login");
    writeBrowserState(c, state);
    const authorization = providerAuthorizationUrl(provider, method.audience, state.state, attempt);
    await reportAuthFact(c, { eventName: "auth_provider_requested", method: provider });
    return c.redirect(authorization, 302);
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
