import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { accountConnectionAction } from "../../server/social/accountConnection.js";
import type { ConnectionBinding } from "../../server/social/accountConnectionContract.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { browserAuthOrigin, createBrowserState, requireBrowserRedirect, writeBrowserState } from "../../server/social/browserState.js";
import { loadConnectionProviderBrowserLaunch } from "../../server/social/attemptStore.js";
import { parseAccountConnectionAction, parseCompletionHandle, parseSocialObject } from "../../server/social/publicContract.js";
import { getPublicAuthMethods } from "../../server/social/publicMethods.js";
import { createAuthAnalyticsFactEventFactory, type ConnectionAnalyticsAction } from "../../server/analytics/catalog.js";
import { readAuthAnalyticsContext, reportBrowserAuthEvents, type AuthAnalyticsContext, type ObservedAuthAnalyticsEvent } from "../../server/analytics/signInFunnel.js";
import { accountBinding, accountTransport, preserveAccountConnectionContext } from "./accountTransport.js";
import { providerAuthorizationUrl } from "./browserStart.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

// Web Settings sends no `screen` marker on this route, so its facts and its provider callback name the surface here.
const settingsAnalytics: AuthAnalyticsContext = { screen: "settings", uiLocale: null };

// `load` only resumes the flow and web cannot send `provider_complete`, so they and unknown actions report nothing.
function connectionAnalyticsAction(action: unknown): ConnectionAnalyticsAction | null {
  switch (action) {
    case "begin": case "adopt": return "begin";
    case "provider_begin": case "email_send": case "email_verify": return "proof";
    case "preview": return "preview";
    case "confirm": return "consent";
    case "cancel": return "cancel";
    default: return null;
  }
}

const app = new Hono<AuthAppEnv>();
app.post("/api/account/connection", async (c) => {
  let observed: ConnectionAnalyticsAction | null = null;
  let events: ObservedAuthAnalyticsEvent[] = [];
  try {
    const source = await requireSocialRequest(c, "manage");
    const fields = parseSocialObject(await readSocialJson(c));
    // Only Web Settings reports here; `client: "web"` is what gives the transport its browser context.
    observed = fields.client === "web" ? connectionAnalyticsAction(fields.action) : null;
    const transport = await accountTransport(c, fields);
    const action = parseAccountConnectionAction(fields);
    const binding = accountBinding(fields, transport, "reauth") as ConnectionBinding;
    const authOrigin = browserAuthOrigin(c);
    const browser = transport.browser === null ? null : { origin: authOrigin, secret: transport.browser.secret };
    const redirectUri = action.action === "provider_begin" && browser !== null
      ? requireBrowserRedirect(typeof fields.redirectUri === "string" ? fields.redirectUri : "", authOrigin) : null;
    const result = await accountConnectionAction(transport.sessionToken, binding, action, source, browser, authOrigin);
    if (transport.browser !== null && (action.action === "begin" || action.action === "adopt")) {
      preserveAccountConnectionContext(c, transport.browser);
    }
    // A proof that has only started is reported by the provider callback or by `email_verify`.
    if (observed !== null && result.status !== "provider_required" && result.status !== "email_required") {
      events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_account_connection", action: observed,
        outcome: result.status === "already_connected" ? "already_connected" : result.status === "cancelled" ? "cancelled" : "succeeded" }), occurredAt: Date.now() });
      if (result.status === "connected") events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_account_connection",
        action: "completion", outcome: "succeeded" }), occurredAt: Date.now() });
    }
    if (result.status !== "provider_required" || action.action !== "provider_begin") return c.json(result);
    if (browser === null) {
      const browserStart = binding.client === "android" && action.provider === "apple"
        ? "/api/account/connection/provider-start?" + new URLSearchParams({ operation: action.operation, attempt: result.proof.attempt }) : null;
      return c.json({ ...result, browserStart });
    }
    const method = getPublicAuthMethods("web").methods[action.provider];
    if (!method.available || method.transport !== "browser") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const state = { ...createBrowserState(authOrigin, action.provider, result.proof.attempt, result.proof.expiresAt,
      { client: "web", browserSecret: browser.secret, redirectUri: redirectUri! }, settingsAnalytics, "login"),
    connectionOperation: action.operation };
    writeBrowserState(c, state);
    return c.json({ status: "provider_required", authorizationUrl: providerAuthorizationUrl(action.provider, method.audience, state.state, result.proof),
      expiresAt: result.proof.expiresAt });
  } catch (error) {
    if (observed !== null) events = [{ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_account_connection",
      action: observed, outcome: "failed" }), occurredAt: Date.now() }];
    return socialErrorResponse(c, error);
  } finally {
    await reportBrowserAuthEvents(c, events, settingsAnalytics);
  }
});

app.get("/api/account/connection/provider-start", async (c) => {
  try {
    await requireSocialRequest(c, "start");
    c.header("Referrer-Policy", "no-referrer");
    const operation = parseCompletionHandle(c.req.query("operation"));
    const attempt = parseCompletionHandle(c.req.query("attempt"));
    const authOrigin = browserAuthOrigin(c);
    const method = getPublicAuthMethods("android").methods.apple;
    if (!method.available || method.transport !== "browser") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const launch = await loadConnectionProviderBrowserLaunch(operation, attempt, authOrigin);
    const state = { ...createBrowserState(authOrigin, "apple", attempt, launch.expiresAt,
      { client: "android", codeChallenge: launch.codeChallenge }, readAuthAnalyticsContext(c), "login"),
    connectionOperation: operation };
    writeBrowserState(c, state);
    return c.redirect(providerAuthorizationUrl("apple", method.audience, state.state, launch), 302);
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
