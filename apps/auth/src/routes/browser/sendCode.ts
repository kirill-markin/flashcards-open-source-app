/**
 * Email OTP initiation endpoint. Accepts an email address, calls Cognito
 * InitiateAuth with EMAIL_OTP challenge, and stores the Cognito session
 * in an HMAC-signed cookie. No database needed.
 *
 * Auto-creates the Cognito account if the user doesn't exist yet.
 *
 * A random delay (200-800 ms) is added before responding to equalise timing
 * between new and existing users, preventing email-existence enumeration.
 *
 * Security: HMAC-signed cookie + CSRF token + 3-min TTL.
 */
import { randomBytes, randomInt } from "node:crypto";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { initiateEmailOtp, signInWithPassword, type TokenResult } from "../../server/cognito/cognitoAuth.js";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../../server/apiErrors.js";
import {
  reportSignInCodeRequested,
  reportSignInFailed,
  reportSignInSucceeded,
} from "../../server/analytics/signInFunnel.js";
import { setBrowserSessionCookies } from "../../server/browserSession.js";
import { sign, verify } from "../../server/crypto.js";
import { getDemoEmailPassword } from "../../server/demoEmailAccess.js";
import { isReservedEmailDomain } from "../../server/reservedEmailDomains.js";
import {
  decideOtpRateLimit,
  loadLatestSentOtpSessionToken,
  recordOtpSendDecision,
} from "../../server/otp/otpRateLimit.js";
import { log, maskEmail } from "../../server/logger.js";
import { isTransientDatabaseError } from "../../server/databaseErrors.js";
import { isRejectedPasswordSignIn } from "../../server/cognito/passwordSignInErrors.js";
import { isCognitoInvalidEmailError } from "../../server/cognito/cognitoErrors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POST_EMAIL_DB_FAILURE_MESSAGE = "A verification email may have been sent, but sign-in could not be prepared.";

const JITTER_MIN_MS = 200;
const JITTER_MAX_MS = 800;
const jitterDelay = (): Promise<void> =>
  new Promise((resolve) => {
    const ms = randomInt(JITTER_MIN_MS, JITTER_MAX_MS);
    setTimeout(resolve, ms);
  });

type OtpPayload = Readonly<{
  s: string;
  e: string;
  csrf: string;
  t: number;
}>;

type SendCodeDependencies = Readonly<{
  initiateEmailOtp: (email: string) => Promise<Readonly<{ session: string }>>;
  signInWithPassword: (email: string, password: string) => Promise<TokenResult>;
  decideOtpRateLimit: (email: string, ipAddress: string) => Promise<Awaited<ReturnType<typeof decideOtpRateLimit>>>;
  loadLatestSentOtpSessionToken: (email: string, nowMs: number) => Promise<string | null>;
  recordOtpSendDecision: (
    email: string,
    ipAddress: string,
    decision: "sent" | "suppressed_email_limit" | "blocked_ip_limit",
    otpSessionToken: string | null,
  ) => Promise<void>;
  createCsrfToken: () => string;
  signPayload: (payload: string) => string;
  parseSignedOtpSessionToken: (otpSessionToken: string) => OtpPayload;
  getDemoEmailPassword: (email: string) => Promise<string | null>;
  setBrowserSessionCookies: (
    context: Parameters<typeof setBrowserSessionCookies>[0],
    sessionToken: string,
    refreshToken: string,
  ) => void;
  jitterDelay: () => Promise<void>;
  now: () => number;
}>;

function getClientIpAddress(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp !== null && cfConnectingIp.trim() !== "") {
    return cfConnectingIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor !== null && forwardedFor.trim() !== "") {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return "unknown";
}

function parseOtpPayload(otpSessionToken: string): OtpPayload {
  return JSON.parse(verify(otpSessionToken)) as OtpPayload;
}

export function createSendCodeApp(dependencies: SendCodeDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/send-code", async (c) => {
    let body: { email?: string };
    try {
      body = await c.req.json<{ email?: string }>();
    } catch {
      return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid request.");
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!EMAIL_RE.test(email) || email.length > 256) {
      // Every report below is best-effort, bounded and gated on the login page's own marker; the
      // rules are in server/analytics/signInFunnel.ts. `server_error` is the catalog's residual
      // value for a request refused before a code could be sent, and it therefore also carries a
      // mistyped address: the catalog has no value for one, and this item does not add one. Read it
      // on this route as "no code was sent", not as "the service broke".
      await reportSignInFailed(c, "server_error");
      return jsonAuthError(c, 400, "INVALID_EMAIL", "Enter a valid email address.");
    }

    const requestId = getRequestId(c);
    const demoPassword = await dependencies.getDemoEmailPassword(email);
    if (demoPassword !== null) {
      // This intentionally disables OTP protection for configured review account
      // emails. The allowlist is restricted to synthetic @example.com accounts.
      // Anyone who knows one of these emails and the shared insecure demo
      // password can sign in to that account without OTP.
      //
      // Only the Cognito call is guarded, so nothing after it can be reported to the person as a
      // rejected password.
      let tokens: TokenResult;
      try {
        tokens = await dependencies.signInWithPassword(email, demoPassword);
      } catch (error) {
        if (isRejectedPasswordSignIn(error)) {
          await reportSignInFailed(c, "invalid_code");
          return jsonAuthError(c, 401, "PASSWORD_SIGN_IN_FAILED", "Email or password is incorrect.");
        }

        log({
          domain: "auth",
          action: "send_code_demo_sign_in_error",
          requestId,
          route: c.req.path,
          statusCode: 500,
          code: "PASSWORD_SIGN_IN_FAILED",
          error: error instanceof Error ? error.message : String(error),
        });
        await reportSignInFailed(c, "server_error");
        return jsonAuthError(c, 500, "PASSWORD_SIGN_IN_FAILED", "Password sign-in failed. Try again.");
      }

      dependencies.setBrowserSessionCookies(c, tokens.idToken, tokens.refreshToken);
      log({
        domain: "auth",
        action: "send_code_demo_sign_in",
        requestId,
        route: c.req.path,
        maskedEmail: maskEmail(email),
      });
      // This branch completes a sign-in inside `send-code`, so it owes the same success sequence as
      // `verify-code`: the event, the identity link, and the retired visitor cookie. Without it this
      // path would mint visitor identities that are never linked and never revoked.
      await reportSignInSucceeded(c, tokens.idToken);
      return c.json({
        ok: true,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });
    }

    // Placed after the demo lookup on purpose: the review account allowlist above is restricted to
    // @example.com, so refusing reserved domains any earlier would break Apple and Google sign-in.
    // Cognito accepts these addresses and the asynchronous custom email sender cannot report back,
    // so without this branch the person is told a code was sent that Resend permanently refuses.
    if (isReservedEmailDomain(email)) {
      log({
        domain: "auth",
        action: "send_code_error",
        requestId,
        route: c.req.path,
        statusCode: 400,
        code: "INVALID_EMAIL",
        reasonCategory: "reserved_email_domain",
      });
      await reportSignInFailed(c, "server_error");
      return jsonAuthError(c, 400, "INVALID_EMAIL", "Enter a valid email address.");
    }

    const ipAddress = getClientIpAddress(c.req.raw);
    const rateLimitDecision = await dependencies.decideOtpRateLimit(email, ipAddress);

    if (rateLimitDecision.kind === "block_ip_limit") {
      await dependencies.recordOtpSendDecision(email, ipAddress, "blocked_ip_limit", null);
      await reportSignInFailed(c, "rate_limited");
      return jsonAuthError(c, 429, "RATE_LIMITED", "Too many requests. Try again later.");
    }

    let csrfToken: string;
    let signed: string;

    if (rateLimitDecision.kind === "suppress_email_limit") {
      const [existingOtpSessionToken] = await Promise.all([
        dependencies.loadLatestSentOtpSessionToken(email, dependencies.now()),
        dependencies.jitterDelay(),
      ]);
      if (existingOtpSessionToken === null) {
        await reportSignInFailed(c, "rate_limited");
        return jsonAuthError(c, 429, "RATE_LIMITED", "Too many requests. Try again later.");
      }

      let payload: OtpPayload;
      try {
        payload = dependencies.parseSignedOtpSessionToken(existingOtpSessionToken);
      } catch {
        await reportSignInFailed(c, "rate_limited");
        return jsonAuthError(c, 429, "RATE_LIMITED", "Too many requests. Try again later.");
      }

      csrfToken = payload.csrf;
      signed = existingOtpSessionToken;
      await dependencies.recordOtpSendDecision(email, ipAddress, "suppressed_email_limit", signed);
    } else {
      let session: string;
      try {
        const [result] = await Promise.all([dependencies.initiateEmailOtp(email), dependencies.jitterDelay()]);
        session = result.session;
      } catch (err) {
        if (isCognitoInvalidEmailError(err)) {
          log({
            domain: "auth",
            action: "send_code_error",
            requestId,
            route: c.req.path,
            statusCode: 400,
            code: "INVALID_EMAIL",
            reasonCategory: "provider_invalid_email",
            errorClass: err.cognitoType,
            errorCode: err.reasonCode,
            errorMessage: err.message,
          });
          await reportSignInFailed(c, "server_error");
          return jsonAuthError(c, 400, "INVALID_EMAIL", "Enter a valid email address.");
        }

        log({
          domain: "auth",
          action: "send_code_error",
          requestId,
          route: c.req.path,
          statusCode: 500,
          code: "OTP_SEND_FAILED",
          error: err instanceof Error ? err.message : String(err),
        });
        await reportSignInFailed(c, "server_error");
        return jsonAuthError(c, 500, "OTP_SEND_FAILED", "Could not send a code. Try again.");
      }

      log({ domain: "auth", action: "send_code", requestId, route: c.req.path, maskedEmail: maskEmail(email) });

      csrfToken = dependencies.createCsrfToken();
      const payload = JSON.stringify({
        s: session,
        e: email,
        csrf: csrfToken,
        t: dependencies.now(),
      });

      signed = dependencies.signPayload(payload);
      try {
        await dependencies.recordOtpSendDecision(email, ipAddress, "sent", signed);
      } catch (error) {
        if (!isTransientDatabaseError(error)) {
          throw error;
        }

        log({
          domain: "auth",
          action: "send_code_error",
          requestId,
          route: c.req.path,
          maskedEmail: maskEmail(email),
          ipAddress,
          statusCode: 503,
          code: "SERVICE_UNAVAILABLE",
          reasonCategory: "post_email_database_error",
          error: error instanceof Error ? error.message : String(error),
        });
        // An email may already be on its way, but this response carries no CSRF token and no OTP
        // session, so the person cannot go on: a failed sign-in attempt, and this one really is the
        // service.
        await reportSignInFailed(c, "server_error");
        // Avoid Retry-After here because replaying send-code can duplicate email delivery.
        return c.json({
          error: POST_EMAIL_DB_FAILURE_MESSAGE,
          requestId,
          code: "SERVICE_UNAVAILABLE",
        }, 503);
      }
    }

    setCookie(c, "otp_session", signed, {
      path: "/",
      maxAge: 180,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });

    // Reached by both branches above, including the suppressed one that hands back the code already
    // sent: either way the person asked for a code and can now enter one.
    await reportSignInCodeRequested(c);
    return c.json({ ok: true, csrfToken, otpSessionToken: signed });
  });

  return app;
}

const app = createSendCodeApp({
  initiateEmailOtp,
  signInWithPassword,
  decideOtpRateLimit,
  loadLatestSentOtpSessionToken,
  recordOtpSendDecision,
  createCsrfToken: () => randomBytes(32).toString("hex"),
  signPayload: sign,
  parseSignedOtpSessionToken: parseOtpPayload,
  getDemoEmailPassword,
  setBrowserSessionCookies,
  jitterDelay,
  now: () => Date.now(),
});

export default app;
