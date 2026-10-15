import { browserManagementError, browserManagementFailure, managementReturnUri } from "./browserManagementReturn.js";
import { isCognitoTypedError } from "../../server/cognito/cognitoErrors.js";
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { type AuthAppEnv, jsonAuthError } from "../../server/apiErrors.js";
import { reportBrowserAuthEvents, type ObservedAuthAnalyticsEvent } from "../../server/analytics/signInFunnel.js";
import { createAuthAnalyticsFactEventFactory, createSignInSucceededWithMethodEventFactory } from "../../server/analytics/catalog.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { claimBrowserAuthAttempt, verifyClaimedAuthAttempt } from "../../server/social/attemptStore.js";
import {
  androidAppleReturnUri, browserAttemptBinding, browserAuthOrigin, clearBrowserState, readBrowserState,
  writeBrowserState, type BrowserCallbackState,
} from "../../server/social/browserState.js";
import { continueBrowserSignIn, completeAccountProviderContinuation } from "../../server/social/completeSignIn.js";
import { completeAuthoritativeAuthAttempt } from "../../server/social/completionStore.js";
import { parseSocialObject } from "../../server/social/publicContract.js";
import { requireSignInProvider } from "../../server/social/publicMethods.js";
import { requireSocialRateLimit } from "../../server/social/rateLimit.js";
import { readSocialBody, readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";
import { completeProvedAccountProviderReenable, listAccountLoginMethods } from "../../server/social/accountMethods.js";
import { requireAccountSession } from "./accountTransport.js";
import { acceptBrowserCompletion } from "./browserCompletion.js";
import { resolveLoginPageLocale } from "../browser/loginPageLocale.js";
import { renderBrowserCompletion } from "../../templates/browserCompletion.js";
import { renderBrowserMailboxContinuation } from "../../templates/browserMailboxContinuation.js";
import { browserSignInErrorResponse, browserSignInRecovery, type BrowserSignInRecovery } from "./browserError.js";

const app = new Hono<AuthAppEnv>();

function protectCallbackResponse(c: Context<AuthAppEnv>): void {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

function oneParameter(parameters: URLSearchParams, key: string, maximum: number): string {
  const values = parameters.getAll(key);
  if (values.length !== 1 || values[0].length < 1 || values[0].length > maximum) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return values[0];
}

function androidReturn(status: "completed" | "verification_required" | "denied" | "provider_proved", handle: string): string {
  const uri = new URL(androidAppleReturnUri);
  uri.hash = new URLSearchParams({ status, [status === "completed" ? "completion" : "attempt"]: handle }).toString();
  return uri.toString();
}

async function appleCallbackContinuation(c: Context<AuthAppEnv>, parameters: URLSearchParams, state: BrowserCallbackState): Promise<Response> {
  const fields = new URLSearchParams({ state: state.state });
  if (parameters.has("error")) fields.set("error", oneParameter(parameters, "error", 255));
  else {
    fields.set("code", oneParameter(parameters, "code", 4096));
    if (parameters.has("id_token")) fields.set("id_token", oneParameter(parameters, "id_token", 16_384));
  }
  const nonce = randomBytes(32).toString("base64url");
  // Form-action also constrains the final redirect; CSP can express a hostless return only by scheme.
  const returnSource = state.client === "web" ? new URL(state.redirectUri).origin : new URL(androidAppleReturnUri).protocol;
  c.header("Referrer-Policy", "same-origin");
  c.header("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self' ${returnSource}; base-uri 'none'; frame-ancestors 'none'`);
  // A document on the auth origin makes the next POST carry current SameSite=Lax consent cookies.
  return c.html(html`<!doctype html><html><head><meta charset="utf-8"></head><body>
    <form id="social-continuation" method="post" action="/api/social/apple/continue">
      ${Array.from(fields, ([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`)}
      <noscript><button type="submit">Continue sign-in</button></noscript>
    </form><script nonce="${nonce}">document.getElementById('social-continuation').requestSubmit();</script>
    </body></html>`);
}

function protectBrowserDocument(c: Context<AuthAppEnv>, nonce: string): void {
  c.header("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
}

async function providerCallback(c: Context<AuthAppEnv>): Promise<Response> {
  protectCallbackResponse(c);
  let claimedState: BrowserCallbackState | null = null;
  let recovery: BrowserSignInRecovery | null = { chooserUri: "/login", locale: resolveLoginPageLocale(undefined, c.req.header("accept-language")) };
  let managementState: BrowserCallbackState | null = null;
  let linkRedemptionStarted = false;
  const events: ObservedAuthAnalyticsEvent[] = [];
  try {
    await requireSocialRequest(c, "callback");
    const provider = c.req.method === "POST" ? "apple" : "google";
    if (c.req.path.endsWith("/apple/continue") && c.req.header("origin") !== browserAuthOrigin(c)) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    let parameters: URLSearchParams;
    if (provider === "apple") {
      if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
        throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      }
      parameters = new URLSearchParams(await readSocialBody(c));
    } else {
      if (c.req.url.length > 8192) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      parameters = new URL(c.req.url).searchParams;
    }
    const state = readBrowserState(c, oneParameter(parameters, "state", 43));
    if (state.provider !== provider || state.phase !== "provider") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    if (state.client === "web" && state.intent === "login") {
      recovery = browserSignInRecovery(c, state.redirectUri, state.locale);
    }
    if (state.client === "web" && state.intent !== "login") managementState = state;
    requireSignInProvider(provider, state.client);
    if (provider === "apple" && c.req.path.endsWith("/apple/callback")) {
      return appleCallbackContinuation(c, parameters, state);
    }
    if (state.client === "web" && state.intent !== "login") await requireAccountSession(c, "web");
    const claimed = await claimBrowserAuthAttempt(state);
    claimedState = state;
    if (parameters.has("error")) {
      const denied = oneParameter(parameters, "error", 255) === "access_denied";
      clearBrowserState(c, state);
      events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_provider_finished", method: provider,
        outcome: denied ? "denied" : "provider_error" }), occurredAt: Date.now() });
      if (state.client === "android") return c.redirect(androidReturn("denied", state.attempt), 303);
      const response = jsonAuthError(c, 400, "PROVIDER_SIGN_IN_DENIED", "Provider authorization did not complete. Start a new provider sign-in.");
      return managementState === null ? browserSignInErrorResponse(c, response, recovery)
        : browserManagementError(c, managementState, response);
    }
    const code = oneParameter(parameters, "code", 4096);
    const identityToken = provider === "apple" && parameters.has("id_token") ? oneParameter(parameters, "id_token", 16_384) : null;
    events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_provider_finished", method: provider,
      outcome: "credential_received" }), occurredAt: Date.now() });
    const verified = await verifyClaimedAuthAttempt(claimed, provider === "google"
      ? { provider, authorizationCode: code, identityToken: null } : { provider, authorizationCode: code, identityToken });
    if (state.intent === "reenable") {
      clearBrowserState(c, state);
      if (state.client === "android") return c.redirect(androidReturn("provider_proved", state.attempt), 303);
      await completeProvedAccountProviderReenable(await requireAccountSession(c, "web"), verified, browserAttemptBinding(state));
      return c.redirect(state.redirectUri, 303);
    }
    const existingMethods = state.client === "web" && state.intent === "link"
      ? await listAccountLoginMethods(await requireAccountSession(c, "web")) : null;
    const existingMethod = existingMethods?.methods.find((method) => method.status === "active"
      && method.provider === provider && method.providerSubject === verified.secrets.proof?.identity.subject) ?? null;
    const result = await completeAuthoritativeAuthAttempt(verified);
    if (state.client === "android") {
      clearBrowserState(c, state);
      return c.redirect(result.status === "completed" ? androidReturn("completed", result.response.completion)
        : androidReturn("verification_required", state.attempt), 303);
    }
    if (result.status === "completed") {
      linkRedemptionStarted = state.intent === "link";
      const response = await acceptBrowserCompletion(c, state, result.response, existingMethod);
      linkRedemptionStarted = false;
      if ("linkOutcome" in response) events.push({ createEvent: createAuthAnalyticsFactEventFactory({
        eventName: "auth_account_link_finished", method: provider, outcome: response.linkOutcome,
      }), occurredAt: Date.now() });
      if ("signInHint" in response) {
        events.push({ createEvent: createSignInSucceededWithMethodEventFactory(response.signInHint.method), occurredAt: Date.now() });
        const nonce = randomBytes(32).toString("base64url");
        protectBrowserDocument(c, nonce);
        return c.html(renderBrowserCompletion(response, resolveLoginPageLocale(state.locale, c.req.header("accept-language")), nonce));
      }
      return c.redirect(response.redirectUri, 303);
    }
    const continuation = { ...state, phase: "mailbox" as const, state: randomBytes(32).toString("base64url") };
    writeBrowserState(c, continuation);
    clearBrowserState(c, state);
    const nonce = randomBytes(32).toString("base64url");
    protectBrowserDocument(c, nonce);
    const restartUri = state.intent === "login"
      ? `/api/social/${state.provider}/start?${new URLSearchParams({ client: "web", redirect_uri: state.redirectUri, ...(state.locale === undefined ? {} : { locale: state.locale }), ...(state.analytics.screen === "signin" ? { screen: "signin", ui_locale: state.analytics.uiLocale ?? "" } : {}) })}`
      : managementReturnUri(state, "account_method_cancelled", "AUTH_ATTEMPT_RESTART_REQUIRED");
    return c.html(renderBrowserMailboxContinuation({ csrfToken: continuation.state,
      providerEmail: result.enrollment.providerEmail, expiresAt: state.expiresAt, restartUri,
      method: state.provider, intent: state.intent, analyticsScreen: state.analytics.screen },
    resolveLoginPageLocale(state.locale, c.req.header("accept-language")), nonce));
  } catch (error) {
    if (linkRedemptionStarted && claimedState !== null) events.push({ createEvent: createAuthAnalyticsFactEventFactory({
      eventName: "auth_account_link_finished", method: claimedState.provider, outcome: "server_error",
    }), occurredAt: Date.now() });
    if (claimedState !== null) clearBrowserState(c, claimedState);
    if (managementState !== null) return browserManagementFailure(c, managementState, error);
    return browserSignInErrorResponse(c, socialErrorResponse(c, error), recovery);
  } finally {
    if (claimedState !== null) await reportBrowserAuthEvents(c, events, claimedState.analytics);
  }
}

app.get("/api/social/google/callback", providerCallback);
app.post("/api/social/apple/callback", providerCallback);
app.post("/api/social/apple/continue", providerCallback);

app.post("/api/social/browser/complete", async (c) => {
  protectCallbackResponse(c);
  let analyticsState: BrowserCallbackState | null = null;
  let mailboxAction: "mailbox_send" | "mailbox_verify" | null = null;
  let linkRedemptionStarted = false;
  const events: ObservedAuthAnalyticsEvent[] = [];
  try {
    const source = await requireSocialRequest(c, "complete");
    const fields = parseSocialObject(await readSocialJson(c));
    if (typeof fields.csrfToken !== "string") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const state = readBrowserState(c, fields.csrfToken);
    if (state.client !== "web" || state.phase !== "mailbox" || c.req.header("origin") !== state.authOrigin) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    analyticsState = state;
    const binding = browserAttemptBinding(state);
    if (state.intent !== "login") await requireAccountSession(c, "web");
    const continuation = (request: Exclude<import("../../server/social/publicContract.js").AccountProviderContinuation, { action: "provider" }>, source: string) =>
      state.intent === "login"
        ? continueBrowserSignIn({ ...request, binding: { ...binding, purpose: "login" } }, source)
        : completeAccountProviderContinuation(request, source);
    if (fields.action === "mailbox_send" && typeof fields.email === "string" && fields.email.length <= 254) {
      mailboxAction = "mailbox_send";
      await requireSocialRateLimit("mailbox_send", source);
      const { response, method } = await continuation({ action: "mailbox_send", attempt: state.attempt, binding, email: fields.email }, source);
      events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_code_request_finished", method,
        action: "initial", outcome: "accepted" }), occurredAt: Date.now() });
      return c.json(response);
    }
    if (fields.action !== "mailbox_verify" || typeof fields.code !== "string" || !/^[0-9]{6,8}$/.test(fields.code)) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    mailboxAction = "mailbox_verify";
    await requireSocialRateLimit("mailbox_verify", source);
    const { response, method } = await continuation({ action: "mailbox_verify", attempt: state.attempt, binding, code: fields.code }, source);
    if (!("status" in response) || response.status !== "completed") throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
    events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_code_verification_finished", method,
      outcome: "verified" }), occurredAt: Date.now() });
    linkRedemptionStarted = state.intent === "link";
    const accepted = await acceptBrowserCompletion(c, state, response, null);
    linkRedemptionStarted = false;
    if ("linkOutcome" in accepted) events.push({ createEvent: createAuthAnalyticsFactEventFactory({
      eventName: "auth_account_link_finished", method, outcome: accepted.linkOutcome,
    }), occurredAt: Date.now() });
    if ("signInHint" in accepted) events.push({ createEvent: createSignInSucceededWithMethodEventFactory(accepted.signInHint.method), occurredAt: Date.now() });
    return c.json(accepted);
  } catch (error) {
    if (linkRedemptionStarted && analyticsState !== null) events.push({ createEvent: createAuthAnalyticsFactEventFactory({
      eventName: "auth_account_link_finished", method: analyticsState.provider, outcome: "server_error",
    }), occurredAt: Date.now() });
    if (analyticsState !== null && mailboxAction === "mailbox_send") {
      events.push({ createEvent: createAuthAnalyticsFactEventFactory({ eventName: "auth_code_request_finished",
        method: analyticsState.provider, action: "initial", outcome: error instanceof AuthAttemptError
          && error.code === "AUTH_RATE_LIMITED" ? "rate_limited" : "server_error" }), occurredAt: Date.now() });
    } else if (analyticsState !== null && mailboxAction === "mailbox_verify" && events.length === 0) {
      const outcome = isCognitoTypedError(error)
        ? error.cognitoType === "CodeMismatchException" ? "invalid_code"
          : error.cognitoType === "ExpiredCodeException" ? "expired_code"
            : error.cognitoType === "TooManyRequestsException" || error.cognitoType === "LimitExceededException" ? "rate_limited" : "server_error"
        : error instanceof AuthAttemptError && error.code === "AUTH_RATE_LIMITED" ? "rate_limited" : "server_error";
      events.push({ createEvent: createAuthAnalyticsFactEventFactory({
        eventName: "auth_code_verification_finished", method: analyticsState.provider, outcome,
      }), occurredAt: Date.now() });
    }
    return socialErrorResponse(c, error);
  } finally {
    if (analyticsState !== null) await reportBrowserAuthEvents(c, events, analyticsState.analytics);
  }
});
export default app;
