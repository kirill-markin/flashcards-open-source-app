import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { beginCurrentEmailReauthentication, completeCurrentEmailReauthentication } from "../../server/social/currentEmailReauth.js";
import { AuthAttemptError, type AuthReauthenticationBinding } from "../../server/social/attemptContract.js";
import { parseCompletionHandle, parseSocialClient, parseSocialObject } from "../../server/social/publicContract.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit } from "../../server/social/rateLimit.js";
import { accountBinding, accountTransport } from "./accountTransport.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/account/reauth/email", async (c) => {
  try {
    await requireSocialRequest(c, "manage");
    const fields = parseSocialObject(await readSocialJson(c));
    const transport = await accountTransport(c, fields);
    const client = parseSocialClient(fields.client);
    if (fields.action === "begin") {
      const challenge = transport.browser === null ? fields.codeChallenge : null;
      if (challenge !== null && (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge))) {
        throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      }
      const source = getSocialRequestSource();
      await requireSocialRateLimit("mailbox_send", source);
      const response = await beginCurrentEmailReauthentication(transport.sessionToken,
        { method: "email", purpose: "reauth", client, codeChallenge: challenge },
        transport.browser === null ? null : { origin: transport.browser.authOrigin, secret: transport.browser.secret }, source);
      return c.json(response);
    }
    if (fields.action !== "complete" || typeof fields.code !== "string" || !/^[0-9]{6,8}$/.test(fields.code)) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    await requireSocialRateLimit("mailbox_verify", getSocialRequestSource());
    return c.json(await completeCurrentEmailReauthentication(transport.sessionToken, parseCompletionHandle(fields.attempt),
      accountBinding(fields, transport, "reauth") as AuthReauthenticationBinding, fields.code));
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
