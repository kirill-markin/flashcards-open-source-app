/**
 * Email OTP verification endpoint. Reads the OTP session from an HMAC-signed
 * cookie, validates the 8-digit code via Cognito RespondToAuthChallenge,
 * and on success sets session + refresh + logged_in cookies AND returns
 * tokens in the response body for mobile clients.
 *
 * CSRF token is compared with crypto.timingSafeEqual to prevent timing attacks.
 */
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../../server/apiErrors.js";
import type { AuthSignInFailureReason } from "../../server/analytics/catalog.js";
import { reportSignInFailed, reportSignInSucceeded } from "../../server/analytics/signInFunnel.js";
import { verifyEmailOtp } from "../../server/cognito/cognitoAuth.js";
import { setBrowserSessionCookies } from "../../server/browserSession.js";
import { getNormalizedCognitoErrorType } from "../../server/cognito/cognitoErrors.js";
import { verify } from "../../server/crypto.js";
import { isTransientDatabaseError } from "../../server/databaseErrors.js";
import { log } from "../../server/logger.js";
import {
  getOtpVerifyAttemptState,
  MAX_OTP_VERIFY_ATTEMPTS,
  recordOtpVerifyFailure,
  type OtpVerifyAttemptState,
  type OtpVerifyFailureRecordResult,
} from "../../server/otp/otpVerifyAttempts.js";

const CODE_RE = /^\d{8}$/;
const OTP_TTL_MS = 180_000; // 3 minutes
const INVALID_CODE_RECORD_DB_FAILURE_MESSAGE = "The code was rejected, but the invalid attempt could not be recorded.";

type OtpPayload = Readonly<{
  s: string;   // Cognito session
  e: string;   // email
  csrf: string; // CSRF token
  t: number;   // timestamp
}>;

type VerifyFailureCode = "OTP_SESSION_EXPIRED" | "OTP_CHALLENGE_CONSUMED" | "OTP_CODE_INVALID" | "OTP_VERIFY_FAILED";

type VerifyFailureResult = Readonly<{
  code: VerifyFailureCode;
  publicMessage: string;
  reasonCategory: string;
}>;

/**
 * The funnel reason each Cognito classification reports. Total by type, so a classification added to
 * `classifyVerifyFailure` cannot reach the catalog as a guess.
 */
const signInFailureReasonByVerifyFailureCode: Readonly<Record<VerifyFailureCode, AuthSignInFailureReason>> = {
  OTP_CODE_INVALID: "invalid_code",
  OTP_SESSION_EXPIRED: "expired_code",
  OTP_CHALLENGE_CONSUMED: "code_already_used",
  OTP_VERIFY_FAILED: "server_error",
};

type VerifyCodeDependencies = Readonly<{
  verifySignedOtpSession: (signedSession: string) => OtpPayload;
  getOtpVerifyAttemptState: (email: string, cognitoSession: string, nowMs: number) => Promise<OtpVerifyAttemptState>;
  recordOtpVerifyFailure: (
    email: string,
    cognitoSession: string,
    expiresAt: string,
    nowMs: number,
    maxAttempts: number,
  ) => Promise<OtpVerifyFailureRecordResult>;
  verifyEmailOtp: (email: string, code: string, session: string) => Promise<Awaited<ReturnType<typeof verifyEmailOtp>>>;
  setBrowserSessionCookies: (context: Parameters<typeof setBrowserSessionCookies>[0], sessionToken: string, refreshToken: string) => void;
  clearOtpSessionCookie: (context: Parameters<typeof deleteCookie>[0]) => void;
  now: () => number;
}>;

function classifyVerifyFailure(error: unknown): VerifyFailureResult {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();
  const normalizedType = getNormalizedCognitoErrorType(error);

  if (
    normalizedMessage.includes("session can only be used once")
    || normalizedMessage.includes("invalid session for the user")
  ) {
    return {
      code: "OTP_CHALLENGE_CONSUMED",
      publicMessage: "Code already used. Request a new one.",
      reasonCategory: "challenge_consumed",
    };
  }

  if (
    normalizedType.includes("expired")
    || normalizedMessage.includes("expired")
    || normalizedMessage.includes("session expired")
  ) {
    return {
      code: "OTP_SESSION_EXPIRED",
      publicMessage: "Code expired. Request a new one.",
      reasonCategory: "expired",
    };
  }

  if (
    normalizedType.includes("codemismatch")
    || normalizedMessage.includes("code mismatch")
    || normalizedMessage.includes("invalid code")
  ) {
    return {
      code: "OTP_CODE_INVALID",
      publicMessage: "Enter a valid 8-digit code.",
      reasonCategory: "invalid_code",
    };
  }

  return {
    code: "OTP_VERIFY_FAILED",
    publicMessage: "Could not verify the code. Try again.",
    reasonCategory: "provider_error",
  };
}

function logLockedVerifyAttempt(
  requestId: string,
  route: string,
  error: string,
): void {
  log({
    domain: "auth",
    action: "verify_code_error",
    requestId,
    route,
    statusCode: 429,
    code: "OTP_TOO_MANY_ATTEMPTS",
    reasonCategory: "too_many_attempts",
    error,
  });
}

export function createVerifyCodeApp(dependencies: VerifyCodeDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/verify-code", async (c) => {
    let body: { code?: string; csrfToken?: string; otpSessionToken?: string };
    try {
      body = await c.req.json<{ code?: string; csrfToken?: string; otpSessionToken?: string }>();
    } catch {
      return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid request.");
    }

    const signedSession = typeof body.otpSessionToken === "string" && body.otpSessionToken.length > 0
      ? body.otpSessionToken
      : (getCookie(c, "otp_session") ?? "");

    if (signedSession === "") {
      return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
    }

    let payload: OtpPayload;
    try {
      payload = dependencies.verifySignedOtpSession(signedSession);
    } catch {
      return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
    }

    const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
    // Compared by byte length, because bytes are what `timingSafeEqual` compares. `String.length` is
    // UTF-16 code units, so a supplied token of 64 code units holding one non-ASCII character passes
    // a code-unit pre-check and then makes `timingSafeEqual` throw `RangeError` on unequal byte
    // lengths. That throw is unreachable only while the pre-check measures the same thing the
    // comparison does, and this guard is now evaluated before the TTL branch answers, so the
    // hoist is response-neutral only with the lengths taken from the buffers themselves.
    //
    // The payload's own token is type-checked for the same reason the hoist needs care: this now
    // runs before the TTL branch answers, and `otpSessionToken` is taken from the request body, so a
    // third payload shape signed with this key would reach `Buffer.from(undefined)` here and turn a
    // `400` into a `500`. A payload carrying no `csrf` is a mismatch instead, and a mismatch rather
    // than an empty expected buffer, so it can never match a supplied empty string.
    const suppliedCsrf = Buffer.from(csrfToken);
    const expectedCsrf = typeof payload.csrf === "string" ? Buffer.from(payload.csrf) : null;
    const csrfMatch = expectedCsrf !== null
      && suppliedCsrf.length === expectedCsrf.length
      && timingSafeEqual(suppliedCsrf, expectedCsrf);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const codeIsWellFormed = CODE_RE.test(code);

    const nowMs = dependencies.now();
    if (nowMs - payload.t > OTP_TTL_MS) {
      // The one early guard that reports, and it catches a narrower population than its position
      // suggests. `routes/browser/sendCode.ts` writes `otp_session` with `maxAge: 180` against this
      // `OTP_TTL_MS` of 180_000, so the browser drops the cookie at essentially the instant the
      // server would call the payload expired: a login-page visitor who simply lets the code lapse
      // arrives with no cookie at all and returns at the empty-`signedSession` guard above, which
      // reports nothing. What reaches here is the race between `payload.t + OTP_TTL_MS` and that
      // max-age, which starts later by the database write and the response it rode on; the
      // rate-limit suppression branch of `send-code`, which re-issues an older token under a fresh
      // 180-second cookie and so can outlive its payload's TTL by the age of the token it reused;
      // and callers that pass `otpSessionToken` in the body and hold no cookie, which this branch
      // answers but which report nothing because they carry no visitor cookie either. Web
      // `expired_code` is therefore fed mostly by the classified `OTP_SESSION_EXPIRED` below —
      // Cognito expiring the session inside the jitter-sized gap before this TTL does — and not by
      // this branch. The guards around it stay silent because they are not a sign-in attempt a
      // person made — a stale tab, a mismatched CSRF token, a code that is not eight digits — while
      // this one is a person entering a code too late, which is exactly what `expired_code` counts.
      //
      // Which is why the report is gated on the two guards below rather than taken from the TTL
      // alone: an expired `otp_session` carrying no usable code at all would otherwise be counted as
      // a person who typed one too late. The gate is a condition and not a reordering because this
      // branch must keep answering first — moving it under the eight-digit check would turn
      // `OTP_SESSION_EXPIRED` into `OTP_CODE_INVALID` for an expired session with a malformed code,
      // and no measurement may change what a sign-in answers. Nothing real is lost to the gate: the
      // person this counts reaches here from a tab that already holds the CSRF token of the same
      // challenge and an eight-digit code, so both conditions hold for every expiry the UI produces.
      if (csrfMatch && codeIsWellFormed) {
        await reportSignInFailed(c, "expired_code");
      }
      return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
    }

    if (!csrfMatch) {
      return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
    }

    if (!codeIsWellFormed) {
      return jsonAuthError(c, 400, "OTP_CODE_INVALID", "Enter a valid 8-digit code.");
    }

    const requestId = getRequestId(c);
    const attemptState = await dependencies.getOtpVerifyAttemptState(payload.e, payload.s, nowMs);
    if (attemptState.status === "locked") {
      logLockedVerifyAttempt(requestId, c.req.path, "Challenge is locked after too many invalid attempts");
      await reportSignInFailed(c, "rate_limited");
      return jsonAuthError(c, 429, "OTP_TOO_MANY_ATTEMPTS", "Too many invalid attempts. Request a new code.");
    }

    const expiresAt = new Date(payload.t + OTP_TTL_MS).toISOString();
    let tokens: Awaited<ReturnType<typeof verifyEmailOtp>>;
    try {
      tokens = await dependencies.verifyEmailOtp(payload.e, code, payload.s);
    } catch (err) {
      const failure = classifyVerifyFailure(err);
      const message = err instanceof Error ? err.message : String(err);

      if (failure.code === "OTP_CODE_INVALID") {
        let result: OtpVerifyFailureRecordResult;
        try {
          result = await dependencies.recordOtpVerifyFailure(
            payload.e,
            payload.s,
            expiresAt,
            nowMs,
            MAX_OTP_VERIFY_ATTEMPTS,
          );
        } catch (error) {
          if (!isTransientDatabaseError(error)) {
            throw error;
          }

          log({
            domain: "auth",
            action: "verify_code_error",
            requestId,
            route: c.req.path,
            statusCode: 503,
            code: "SERVICE_UNAVAILABLE",
            reasonCategory: "invalid_code_record_database_error",
            error: error instanceof Error ? error.message : String(error),
          });
          // The code genuinely was rejected; the 503 is about the bookkeeping that could not record
          // it, so the funnel reports what happened to the person.
          await reportSignInFailed(c, "invalid_code");
          // Avoid Retry-After here because replaying verify-code can consume Cognito attempts.
          return c.json({
            error: INVALID_CODE_RECORD_DB_FAILURE_MESSAGE,
            requestId,
            code: "SERVICE_UNAVAILABLE",
          }, 503);
        }
        if (result.locked) {
          logLockedVerifyAttempt(requestId, c.req.path, message);
          await reportSignInFailed(c, "rate_limited");
          return jsonAuthError(c, 429, "OTP_TOO_MANY_ATTEMPTS", "Too many invalid attempts. Request a new code.");
        }
      }

      log({
        domain: "auth",
        action: "verify_code_error",
        requestId,
        route: c.req.path,
        statusCode: 400,
        code: failure.code,
        reasonCategory: failure.reasonCategory,
        error: message,
      });
      await reportSignInFailed(c, signInFailureReasonByVerifyFailureCode[failure.code]);
      return jsonAuthError(c, 400, failure.code, failure.publicMessage);
    }

    dependencies.setBrowserSessionCookies(c, tokens.idToken, tokens.refreshToken);
    dependencies.clearOtpSessionCookie(c);

    // Reports the sign-in and hands this browser's anonymous history to the account it just became.
    // Both are bounded and best-effort: the person is signed in above whatever happens here, and the
    // budget that keeps this from delaying the response is derived in server/analytics/signInFunnel.ts.
    await reportSignInSucceeded(c, tokens.idToken);

    return c.json({
      ok: true,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  });

  return app;
}

const app = createVerifyCodeApp({
  verifySignedOtpSession: (signedSession: string) => JSON.parse(verify(signedSession)) as OtpPayload,
  getOtpVerifyAttemptState,
  recordOtpVerifyFailure,
  verifyEmailOtp,
  setBrowserSessionCookies,
  clearOtpSessionCookie: (context) => {
    deleteCookie(context, "otp_session", { path: "/", secure: true });
  },
  now: () => Date.now(),
});

export default app;
