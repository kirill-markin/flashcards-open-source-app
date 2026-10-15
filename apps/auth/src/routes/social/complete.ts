import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { completeNativeSignIn, completeAccountProviderContinuation } from "../../server/social/completeSignIn.js";
import { parseNativeSignIn, parseSocialObject, parseAccountProviderContinuation, parseCompletionHandle } from "../../server/social/publicContract.js";
import { reportAuthFact, reportSignInSucceededWithMethod } from "../../server/analytics/signInFunnel.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit, type SocialPublicAction } from "../../server/social/rateLimit.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";
import { completeAccountProviderReenable, resumeAccountProviderReenable, completeAccountProviderLink } from "../../server/social/accountMethods.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { requireNativeProvider } from "../../server/social/publicMethods.js";
import { accountBinding, accountTransport } from "./accountTransport.js";

const actionLimits: Readonly<Record<"provider" | "mailbox_send" | "mailbox_verify" | "redeem", SocialPublicAction>> = {
  provider: "complete", mailbox_send: "mailbox_send", mailbox_verify: "mailbox_verify", redeem: "redeem",
};
const app = new Hono<AuthAppEnv>();
app.post("/api/social/complete", async (c) => {
  try {
    await requireSocialRequest(c, "complete");
    const fields = parseSocialObject(await readSocialJson(c));
    if (fields.purpose !== "login") {
      const transport = await accountTransport(c, fields);
      if (transport.browser !== null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      if (fields.action === "resume_reenable" || fields.action === "redeem") {
        if (fields.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
        await requireSocialRateLimit("redeem", getSocialRequestSource());
        const binding = accountBinding(fields, transport, "link");
        if (fields.action === "resume_reenable") await resumeAccountProviderReenable(transport.sessionToken,
          parseCompletionHandle(fields.attempt), binding);
        else await completeAccountProviderLink(transport.sessionToken, parseCompletionHandle(fields.completion), binding);
        return c.json({ ok: true, purpose: "link" });
      }
      const request = parseAccountProviderContinuation(fields.action === "reenable_provider" ? { ...fields, action: "provider" } : fields);
      if (fields.action === "reenable_provider") {
        if (request.action !== "provider" || request.binding.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
        requireNativeProvider(request.submission.provider, request.binding.client);
        await completeAccountProviderReenable(transport.sessionToken, request.attempt, request.binding, request.submission);
        return c.json({ ok: true, purpose: "link" });
      }
      if (request.action !== "provider") await requireSocialRateLimit(actionLimits[request.action], getSocialRequestSource());
      return c.json((await completeAccountProviderContinuation(request, getSocialRequestSource())).response);
    }
    const request = parseNativeSignIn(fields);
    const source = getSocialRequestSource();
    if (request.action !== "provider") await requireSocialRateLimit(actionLimits[request.action], source);
    const { response, method } = await completeNativeSignIn(request, source);
    if (request.action === "mailbox_send") {
      await reportAuthFact(c, { eventName: "auth_code_request_finished", method, action: "initial", outcome: "accepted" });
    } else if (request.action === "mailbox_verify") {
      await reportAuthFact(c, { eventName: "auth_code_verification_finished", method, outcome: "verified" });
    } else if ("signInHint" in response) {
      await reportSignInSucceededWithMethod(c, response.signInHint.method);
    }
    return c.json(response);
  } catch (error) {
    return socialErrorResponse(c, error);
  }
});
export default app;
