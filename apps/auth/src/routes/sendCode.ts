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
import { initiateEmailOtp } from "../server/cognitoAuth.js";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { sign, verify } from "../server/crypto.js";
import {
  decideOtpRateLimit,
  loadLatestSentOtpSessionToken,
  recordOtpSendDecision,
} from "../server/otpRateLimit.js";
import { log, maskEmail } from "../server/logger.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      return jsonAuthError(c, 400, "INVALID_EMAIL", "Enter a valid email address.");
    }

    const requestId = getRequestId(c);
    const ipAddress = getClientIpAddress(c.req.raw);
    const rateLimitDecision = await dependencies.decideOtpRateLimit(email, ipAddress);

    if (rateLimitDecision.kind === "block_ip_limit") {
      await dependencies.recordOtpSendDecision(email, ipAddress, "blocked_ip_limit", null);
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
        return jsonAuthError(c, 429, "RATE_LIMITED", "Too many requests. Try again later.");
      }

      let payload: OtpPayload;
      try {
        payload = dependencies.parseSignedOtpSessionToken(existingOtpSessionToken);
      } catch {
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
        log({
          domain: "auth",
          action: "send_code_error",
          requestId,
          route: c.req.path,
          statusCode: 500,
          code: "OTP_SEND_FAILED",
          error: err instanceof Error ? err.message : String(err),
        });
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
      await dependencies.recordOtpSendDecision(email, ipAddress, "sent", signed);
    }

    setCookie(c, "otp_session", signed, {
      path: "/",
      maxAge: 180,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });

    return c.json({ ok: true, csrfToken, otpSessionToken: signed });
  });

  return app;
}

const app = createSendCodeApp({
  initiateEmailOtp,
  decideOtpRateLimit,
  loadLatestSentOtpSessionToken,
  recordOtpSendDecision,
  createCsrfToken: () => randomBytes(32).toString("hex"),
  signPayload: sign,
  parseSignedOtpSessionToken: parseOtpPayload,
  jitterDelay,
  now: () => Date.now(),
});

export default app;
