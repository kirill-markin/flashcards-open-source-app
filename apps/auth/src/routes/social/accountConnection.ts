import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { accountConnectionAction } from "../../server/social/accountConnection.js";
import type { ConnectionBinding } from "../../server/social/accountConnectionContract.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { browserAuthOrigin, createBrowserState, requireBrowserRedirect, writeBrowserState } from "../../server/social/browserState.js";
import { loadConnectionProviderBrowserLaunch } from "../../server/social/attemptStore.js";
import { parseAccountConnectionAction, parseCompletionHandle, parseSocialObject } from "../../server/social/publicContract.js";
import { getPublicAuthMethods } from "../../server/social/publicMethods.js";
import { readAuthAnalyticsContext, reportAuthFact } from "../../server/analytics/signInFunnel.js";
import { accountBinding, accountTransport, preserveAccountConnectionContext } from "./accountTransport.js";
import { providerAuthorizationUrl } from "./browserStart.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/account/connection", async (c) => {
  let observed: "begin" | "proof" | "preview" | "consent" | "cancel" = "begin";
  try {
    const source = await requireSocialRequest(c, "manage");
    const fields = parseSocialObject(await readSocialJson(c));
    const transport = await accountTransport(c, fields);
    const action = parseAccountConnectionAction(fields);
    observed = action.action === "confirm" ? "consent" : action.action === "preview" ? "preview"
      : action.action === "cancel" ? "cancel" : action.action === "begin" || action.action === "adopt" ? "begin" : "proof";
    const binding = accountBinding(fields, transport, "reauth") as ConnectionBinding;
    const authOrigin = browserAuthOrigin(c);
    const browser = transport.browser === null ? null : { origin: authOrigin, secret: transport.browser.secret };
    const redirectUri = action.action === "provider_begin" && browser !== null
      ? requireBrowserRedirect(typeof fields.redirectUri === "string" ? fields.redirectUri : "", authOrigin) : null;
    const result = await accountConnectionAction(transport.sessionToken, binding, action, source, browser, authOrigin);
    if (transport.browser !== null && (action.action === "begin" || action.action === "adopt")) {
      preserveAccountConnectionContext(c, transport.browser);
    }
    if (action.action !== "load") {
      await reportAuthFact(c, { eventName: "auth_account_connection", action: observed,
        outcome: result.status === "already_connected" ? "already_connected" : result.status === "cancelled" ? "cancelled" : "succeeded" });
      if (result.status === "connected") await reportAuthFact(c, { eventName: "auth_account_connection", action: "completion", outcome: "succeeded" });
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
      { client: "web", browserSecret: browser.secret, redirectUri: redirectUri! }, readAuthAnalyticsContext(c), "login"),
    connectionOperation: action.operation };
    writeBrowserState(c, state);
    return c.json({ status: "provider_required", authorizationUrl: providerAuthorizationUrl(action.provider, method.audience, state.state, result.proof),
      expiresAt: result.proof.expiresAt });
  } catch (error) {
    await reportAuthFact(c, { eventName: "auth_account_connection", action: observed, outcome: "failed" });
    return socialErrorResponse(c, error);
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
