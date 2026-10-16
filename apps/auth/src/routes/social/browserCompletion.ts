import type { Context } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { setBrowserSessionCookies, verifiedBrowserSession, type BrowserSessionPresentation } from "../../server/browserSession.js";
import { AuthAttemptError, type AuthCompletionResponse } from "../../server/social/attemptContract.js";
import { completeAccountProviderLink, listAccountLoginMethods, type AccountProviderMethod } from "../../server/social/accountMethods.js";
import { browserAttemptBinding, clearBrowserState, type BrowserCallbackState } from "../../server/social/browserState.js";
import { continueBrowserSignIn } from "../../server/social/completeSignIn.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit } from "../../server/social/rateLimit.js";
import type { ProviderSignInHint } from "../../server/social/signInHint.js";
import { preserveAccountLoginContext, requireAccountSession } from "./accountTransport.js";

export type BrowserLoginCompletion = Readonly<{ ok: true; redirectUri: string; signInHint: ProviderSignInHint; acceptedSession?: BrowserSessionPresentation }>;
export type BrowserCompletion = BrowserLoginCompletion
  | Readonly<{ ok: true; purpose: "link"; redirectUri: string; linkOutcome: "linked" | "already_linked" }>
  | Readonly<{ ok: true; purpose: "reauth"; redirectUri: string } & AuthCompletionResponse>;

export async function acceptBrowserCompletion(
  c: Context<AuthAppEnv>, state: BrowserCallbackState, completion: AuthCompletionResponse, existingMethod: AccountProviderMethod | null,
): Promise<BrowserCompletion> {
  const binding = browserAttemptBinding(state);
  const source = getSocialRequestSource();
  await requireSocialRateLimit("redeem", source);
  if (state.client !== "web") throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  if (state.intent !== "login") {
    const session = await requireAccountSession(c, "web");
    if (state.intent === "link") {
      await completeAccountProviderLink(session, completion.completion, binding);
      const methods = existingMethod === null ? null : await listAccountLoginMethods(session);
      const alreadyLinked = existingMethod !== null && methods !== null && methods.methods.some((method) =>
        method.status === "active" && method.provider === existingMethod.provider
        && method.providerSubject === existingMethod.providerSubject && method.generation === existingMethod.generation);
      const linkOutcome = alreadyLinked ? "already_linked" : "linked";
      clearBrowserState(c, state);
      const destination = new URL(state.redirectUri);
      const fragment = new URLSearchParams(destination.hash.slice(1));
      fragment.set("link_outcome", linkOutcome);
      destination.hash = fragment.toString();
      return { ok: true, purpose: "link", redirectUri: destination.toString(), linkOutcome };
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
  const suggestion = response.signInHint.connectionSuggestion;
  if (suggestion !== undefined) preserveAccountLoginContext(c, suggestion.suggestion, state.browserSecret, state.redirectUri);
  clearBrowserState(c, state);
  return { ok: true, redirectUri: state.redirectUri, signInHint: response.signInHint,
    acceptedSession: response[verifiedBrowserSession] };
}
