import type { Context, MiddlewareHandler } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import type { AuthAnalyticsCodeVerificationOutcome, AuthAnalyticsFact } from "../../server/analytics/catalog.js";
import { reportAuthFact, sendCollectedAuthEvents, startCollectingAuthEvents } from "../../server/analytics/signInFunnel.js";

const verificationOutcomes: Readonly<Record<string, AuthAnalyticsCodeVerificationOutcome>> = {
  OTP_CODE_INVALID: "invalid_code", OTP_SESSION_EXPIRED: "expired_code",
  OTP_CHALLENGE_CONSUMED: "code_already_used", OTP_TOO_MANY_ATTEMPTS: "rate_limited",
};

async function readCodeRequestFact(c: Context<AuthAppEnv>): Promise<AuthAnalyticsFact | null> {
  if (!c.res.headers.get("content-type")?.includes("application/json")) return null;
  const result = await c.res.clone().json() as Readonly<{ csrfToken?: string; ok?: boolean; idToken?: string }>;
  if (c.res.ok && result.ok === true && typeof result.idToken === "string") return null;
  if (c.res.ok && typeof result.csrfToken !== "string") return null;
  return { eventName: "auth_code_request_finished", method: "email",
    action: c.req.query("action") === "resend" ? "resend" : "initial",
    outcome: c.res.ok ? "accepted" : c.res.status === 429 ? "rate_limited" : "server_error" };
}

async function readCodeVerificationFact(c: Context<AuthAppEnv>): Promise<AuthAnalyticsFact | null> {
  if (!c.res.headers.get("content-type")?.includes("application/json")) return null;
  const result = await c.res.clone().json() as Readonly<{ code?: string; ok?: boolean; idToken?: string }>;
  if (c.res.ok && result.ok === true && typeof result.idToken === "string") {
    return { eventName: "auth_code_verification_finished", method: "email", outcome: "verified" };
  }
  // A later redemption/storage failure cannot establish a failed OTP verification.
  const outcome = typeof result.code === "string" ? verificationOutcomes[result.code] : undefined;
  return outcome === undefined ? null : { eventName: "auth_code_verification_finished", method: "email", outcome };
}

function collectEmailAuthFacts(
  readFact: (c: Context<AuthAppEnv>) => Promise<AuthAnalyticsFact | null>,
): MiddlewareHandler<AuthAppEnv> {
  return async (c, next) => {
    startCollectingAuthEvents(c);
    try {
      await next();
      const fact = await readFact(c);
      if (fact !== null) await reportAuthFact(c, fact);
    } finally {
      await sendCollectedAuthEvents(c);
    }
  };
}

export const emailCodeRequestFacts = collectEmailAuthFacts(readCodeRequestFact);
export const emailCodeVerificationFacts = collectEmailAuthFacts(readCodeVerificationFact);
