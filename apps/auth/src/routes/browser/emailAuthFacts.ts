import type { MiddlewareHandler } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import type { AuthAnalyticsCodeVerificationOutcome } from "../../server/analytics/catalog.js";
import { reportAuthFact } from "../../server/analytics/signInFunnel.js";

const verificationOutcomes: Readonly<Record<string, AuthAnalyticsCodeVerificationOutcome>> = {
  OTP_CODE_INVALID: "invalid_code", OTP_SESSION_EXPIRED: "expired_code",
  OTP_CHALLENGE_CONSUMED: "code_already_used", OTP_TOO_MANY_ATTEMPTS: "rate_limited",
};

export const emailCodeRequestFacts: MiddlewareHandler<AuthAppEnv> = async (c, next) => {
  await next();
  if (!c.res.headers.get("content-type")?.includes("application/json")) return;
  const result = await c.res.clone().json() as Readonly<{ csrfToken?: string; ok?: boolean; idToken?: string }>;
  if (c.res.ok && result.ok === true && typeof result.idToken === "string") return;
  if (c.res.ok && typeof result.csrfToken !== "string") return;
  await reportAuthFact(c, { eventName: "auth_code_request_finished", method: "email",
    action: c.req.query("action") === "resend" ? "resend" : "initial",
    outcome: c.res.ok ? "accepted" : c.res.status === 429 ? "rate_limited" : "server_error" });
};

export const emailCodeVerificationFacts: MiddlewareHandler<AuthAppEnv> = async (c, next) => {
  await next();
  if (!c.res.headers.get("content-type")?.includes("application/json")) return;
  const result = await c.res.clone().json() as Readonly<{ code?: string; ok?: boolean; idToken?: string }>;
  if (c.res.ok && result.ok === true && typeof result.idToken === "string") {
    await reportAuthFact(c, { eventName: "auth_code_verification_finished", method: "email", outcome: "verified" });
    return;
  }
  // A later redemption/storage failure cannot establish a failed OTP verification.
  const outcome = typeof result.code === "string" ? verificationOutcomes[result.code] : undefined;
  if (outcome !== undefined) await reportAuthFact(c, { eventName: "auth_code_verification_finished", method: "email", outcome });
};
