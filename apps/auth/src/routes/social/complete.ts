import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { completeNativeSignIn } from "../../server/social/completeSignIn.js";
import { parseNativeSignIn } from "../../server/social/publicContract.js";
import { reportAuthFact, reportSignInSucceededWithMethod } from "../../server/analytics/signInFunnel.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit, type SocialPublicAction } from "../../server/social/rateLimit.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

const actionLimits: Readonly<Record<"provider" | "mailbox_send" | "mailbox_verify" | "redeem", SocialPublicAction>> = {
  provider: "complete", mailbox_send: "mailbox_send", mailbox_verify: "mailbox_verify", redeem: "redeem",
};
const app = new Hono<AuthAppEnv>();
app.post("/api/social/complete", async (c) => {
  try {
    await requireSocialRequest(c, "complete");
    const request = parseNativeSignIn(await readSocialJson(c));
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
