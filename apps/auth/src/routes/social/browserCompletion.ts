import { createAuthAnalyticsFactEventFactory } from "../../server/analytics/catalog.js";
import { reportBrowserAuthEvents } from "../../server/analytics/signInFunnel.js";
import type { Context } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { setBrowserSessionCookies, verifiedBrowserSession, type BrowserSessionPresentation } from "../../server/browserSession.js";
import { AuthAttemptError, type AuthCompletionResponse } from "../../server/social/attemptContract.js";
import { completeAccountProviderLink } from "../../server/social/accountMethods.js";
import { browserAttemptBinding, clearBrowserState, type BrowserCallbackState } from "../../server/social/browserState.js";
import { continueBrowserSignIn } from "../../server/social/completeSignIn.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit } from "../../server/social/rateLimit.js";
import type { ProviderSignInHint } from "../../server/social/signInHint.js";
import { requireAccountSession } from "./accountTransport.js";

export type BrowserLoginCompletion = Readonly<{ ok: true; redirectUri: string; signInHint: ProviderSignInHint; acceptedSession?: BrowserSessionPresentation }>;
export type BrowserCompletion = BrowserLoginCompletion
  | Readonly<{ ok: true; purpose: "link"; redirectUri: string }>
  | Readonly<{ ok: true; purpose: "reauth"; redirectUri: string } & AuthCompletionResponse>;

export async function acceptBrowserCompletion(
  c: Context<AuthAppEnv>, state: BrowserCallbackState, completion: AuthCompletionResponse,
): Promise<BrowserCompletion> {
  const binding = browserAttemptBinding(state);
  const source = getSocialRequestSource();
  await requireSocialRateLimit("redeem", source);
  if (state.client !== "web") throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  if (state.intent !== "login") {
    const session = await requireAccountSession(c, "web");
    if (state.intent === "link") {
      try { await completeAccountProviderLink(session, completion.completion, binding); }
      catch (error) {
        await reportBrowserAuthEvents(c, [{ createEvent: createAuthAnalyticsFactEventFactory({
          eventName: "auth_account_link_finished", method: state.provider, outcome: "server_error",
        }), occurredAt: Date.now() }], state.analytics);
        throw error;
      }
      clearBrowserState(c, state);
      await reportBrowserAuthEvents(c, [{ createEvent: createAuthAnalyticsFactEventFactory({
        eventName: "auth_account_link_finished", method: state.provider, outcome: "linked",
      }), occurredAt: Date.now() }], state.analytics);
      return { ok: true, purpose: "link", redirectUri: state.redirectUri };
    }
    if (state.intent !== "reauth") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    clearBrowserState(c, state);
    const destination = new URL(state.redirectUri);
    destination.hash = new URLSearchParams({ status: "reauthenticated", completion: completion.completion }).toString();
    return { ok: true, purpose: "reauth", ...completion, redirectUri: destination.toString() };
  }
  const { response } = await continueBrowserSignIn({ action: "redeem", completion: completion.completion,
    binding: { ...binding, purpose: "login" } }, source);
  if (!("signInHint" in response)) throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  setBrowserSessionCookies(c, response.idToken, response.refreshToken);
  clearBrowserState(c, state);
  return { ok: true, redirectUri: state.redirectUri, signInHint: response.signInHint,
    acceptedSession: response[verifiedBrowserSession] };
}
