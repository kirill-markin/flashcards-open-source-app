import { Hono } from "hono";
import { type AuthAppEnv, getRequestLogger, getRequestId, jsonAuthError } from "../../server/apiErrors.js";
import { processSignedAppleNotification } from "../../server/social/appleNotifications.js";
import { parseSocialObject } from "../../server/social/publicContract.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { SocialProofError } from "../../server/social/providers.js";
import { getDatabaseErrorSqlState } from "../../server/databaseErrors.js";
import { readSocialJson, requireSocialRequest, socialErrorResponse } from "./http.js";

const app = new Hono<AuthAppEnv>();
app.post("/api/social/apple/notifications", async (c) => {
  try {
    await requireSocialRequest(c, "notification");
    const fields = parseSocialObject(await readSocialJson(c));
    if (Object.keys(fields).length !== 1 || typeof fields.payload !== "string") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    const outcome = await processSignedAppleNotification(fields.payload);
    getRequestLogger(c)({ domain: "auth", action: "apple_notification", requestId: getRequestId(c), reasonCategory: outcome });
    return c.json({ ok: true });
  } catch (error) {
    if ((error instanceof AuthAttemptError && error.code === "AUTH_ATTEMPT_INVALID")
      || (error instanceof SocialProofError && error.code === "PROVIDER_PROOF_INVALID")
      || getDatabaseErrorSqlState(error) === "23514" || getDatabaseErrorSqlState(error) === "23505") {
      return jsonAuthError(c, 400, "APPLE_NOTIFICATION_INVALID", "Apple notification signature, claims, body or replay identity was rejected.");
    }
    return socialErrorResponse(c, error);
  }
});
export default app;
