import { normalizeSupportedLoginPageLocale } from "../browser/loginPageLocale.js";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { beginAccountProviderLink, beginAccountProviderReauthentication, beginAccountProviderReenable, completeAccountProviderLink } from "../../server/social/accountMethods.js";
import { AuthAttemptError, type AuthAttemptResponse } from "../../server/social/attemptContract.js";
import { browserAuthOrigin, createBrowserState, requireBrowserRedirect, writeBrowserState } from "../../server/social/browserState.js";
import { parseCompletionHandle, parseProviderTarget } from "../../server/social/publicContract.js";
import { getPublicAuthMethods, requireSignInProvider } from "../../server/social/publicMethods.js";
import { accountAttempt, accountBinding, accountProof, accountTransport } from "./accountTransport.js";
import { providerAuthorizationUrl } from "./browserStart.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";
import { parseSocialObject } from "../../server/social/publicContract.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/account/provider-methods/link", async (c) => {
  try {
    await requireSocialRequest(c, "manage");
    const fields = parseSocialObject(await readSocialJson(c));
    const transport = await accountTransport(c, fields);
    if (fields.action === "complete") {
      if (transport.browser !== null || fields.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      await completeAccountProviderLink(transport.sessionToken, parseCompletionHandle(fields.completion), accountBinding(fields, transport, "link"));
      return c.json({ ok: true, purpose: "link" });
    }
    if (fields.action !== "begin") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const request = accountAttempt(fields, transport);
    const intent = request.purpose === "reauth" ? "reauth" : fields.intent;
    if (intent !== "reauth" && intent !== "link" && intent !== "reenable") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    requireSignInProvider(request.provider, request.client);
    const authOrigin = browserAuthOrigin(c);
    const browser = transport.browser === null ? null : { origin: authOrigin,
      secret: intent === "reauth" ? transport.browser.secret : randomBytes(32).toString("base64url") };
    const redirectUri = browser === null ? null : requireBrowserRedirect(typeof fields.redirectUri === "string" ? fields.redirectUri : "", authOrigin);
    let response: AuthAttemptResponse;
    if (intent === "reauth") response = await beginAccountProviderReauthentication(transport.sessionToken, request, browser, authOrigin);
    else {
      const proof = accountProof(c, fields, transport);
      response = intent === "reenable"
        ? await beginAccountProviderReenable(transport.sessionToken, parseProviderTarget(fields.target), request, proof, browser, authOrigin)
        : await beginAccountProviderLink(transport.sessionToken, request, proof, browser, authOrigin);
    }
    if (browser === null) {
      const browserStart = request.client === "android" && request.provider === "apple"
        ? "/api/social/apple/start?client=android&attempt=" + response.attempt : null;
      return c.json({ ...response, browserStart });
    }
    const method = getPublicAuthMethods("web").methods[request.provider];
    if (!method.available || method.transport !== "browser") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const locale = typeof fields.locale === "string" ? normalizeSupportedLoginPageLocale(fields.locale) : null;
    if (fields.locale !== undefined && locale === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const state = createBrowserState(authOrigin, request.provider, response.attempt, response.expiresAt,
      { client: "web", browserSecret: browser.secret, redirectUri: redirectUri!, ...(locale === null ? {} : { locale }) }, { screen: "settings", uiLocale: locale }, intent);
    writeBrowserState(c, state);
    return c.json({ authorizationUrl: providerAuthorizationUrl(request.provider, method.audience, state.state, response),
      expiresAt: response.expiresAt });
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
