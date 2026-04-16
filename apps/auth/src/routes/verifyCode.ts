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
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { verifyEmailOtp } from "../server/cognitoAuth.js";
import { setBrowserSessionCookies } from "../server/browserSession.js";
import { getNormalizedCognitoErrorType } from "../server/cognitoErrors.js";
import { verify } from "../server/crypto.js";
import { log } from "../server/logger.js";
import {
  getOtpVerifyAttemptState,
  MAX_OTP_VERIFY_ATTEMPTS,
  recordOtpVerifyFailure,
  type OtpVerifyAttemptState,
  type OtpVerifyFailureRecordResult,
} from "../server/otpVerifyAttempts.js";

const CODE_RE = /^\d{8}$/;
const OTP_TTL_MS = 180_000; // 3 minutes

type OtpPayload = Readonly<{
  s: string;   // Cognito session
  e: string;   // email
  csrf: string; // CSRF token
  t: number;   // timestamp
}>;

type VerifyFailureResult = Readonly<{
  code: "OTP_SESSION_EXPIRED" | "OTP_CHALLENGE_CONSUMED" | "OTP_CODE_INVALID" | "OTP_VERIFY_FAILED";
  publicMessage: string;
  reasonCategory: string;
}>;

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

    const nowMs = dependencies.now();
    if (nowMs - payload.t > OTP_TTL_MS) {
      return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
    }

    const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
    const csrfMatch =
      csrfToken.length === payload.csrf.length &&
      timingSafeEqual(Buffer.from(csrfToken), Buffer.from(payload.csrf));
    if (!csrfMatch) {
      return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
    }

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!CODE_RE.test(code)) {
      return jsonAuthError(c, 400, "OTP_CODE_INVALID", "Enter a valid 8-digit code.");
    }

    const requestId = getRequestId(c);
    const attemptState = await dependencies.getOtpVerifyAttemptState(payload.e, payload.s, nowMs);
    if (attemptState.status === "locked") {
      logLockedVerifyAttempt(requestId, c.req.path, "Challenge is locked after too many invalid attempts");
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
        const result = await dependencies.recordOtpVerifyFailure(
          payload.e,
          payload.s,
          expiresAt,
          nowMs,
          MAX_OTP_VERIFY_ATTEMPTS,
        );
        if (result.locked) {
          logLockedVerifyAttempt(requestId, c.req.path, message);
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
      return jsonAuthError(c, 400, failure.code, failure.publicMessage);
    }

    dependencies.setBrowserSessionCookies(c, tokens.idToken, tokens.refreshToken);
    dependencies.clearOtpSessionCookie(c);

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
