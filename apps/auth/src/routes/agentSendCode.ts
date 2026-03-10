/**
 * Agent-only OTP bootstrap route for terminal clients. It keeps the payload
 * intentionally small and always returns the next machine-readable action plus
 * an English explanation string for simpler agent prompting.
 */
import { Hono } from "hono";
import { initiateEmailOtp } from "../server/cognitoAuth.js";
import { type AuthAppEnv, getRequestId } from "../server/apiErrors.js";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../server/agentEnvelope.js";
import { createAgentOtpSessionToken } from "../server/agentOtp.js";
import {
  decideAgentOtpRateLimit,
  loadLatestSentAgentOtpSessionToken,
  recordAgentOtpSendDecision,
} from "../server/agentRateLimit.js";
import { log, maskEmail } from "../server/logger.js";
import { getPublicAuthBaseUrl, getPublicApiBaseUrl } from "../server/publicUrls.js";

const app = new Hono<AuthAppEnv>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

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

app.post("/api/agent/send-code", async (c) => {
  let body: { email?: string };
  try {
    body = await c.req.json<{ email?: string }>();
  } catch {
    return c.json(
      createAgentErrorEnvelope(
        "INVALID_REQUEST",
        "Invalid request.",
        "Provide an email string and call this endpoint again.",
      ),
      400,
    );
  }

  const email = normalizeEmail(body.email);
  if (!EMAIL_RE.test(email) || email.length > 256) {
    return c.json(
      createAgentErrorEnvelope(
        "INVALID_EMAIL",
        "Enter a valid email address.",
        "Provide a valid email address, then call POST /api/agent/send-code again.",
      ),
      400,
    );
  }

  const requestId = getRequestId(c);
  const ipAddress = getClientIpAddress(c.req.raw);
  const rateLimitDecision = await decideAgentOtpRateLimit(email, ipAddress);
  const authBaseUrl = getPublicAuthBaseUrl(c.req.url);
  const apiBaseUrl = getPublicApiBaseUrl(c.req.url);

  if (rateLimitDecision.kind === "block_ip_limit") {
    await recordAgentOtpSendDecision(email, ipAddress, "blocked_ip_limit", null);
    log({
      domain: "auth",
      action: "agent_send_code_blocked_ip_limit",
      requestId,
      route: c.req.path,
      maskedEmail: maskEmail(email),
      ipAddress,
      statusCode: 429,
    });
    return c.json(
      createAgentErrorEnvelope(
        "RATE_LIMITED",
        "Too many requests. Try again later.",
        "Wait before requesting another code from this IP address, then retry POST /api/agent/send-code.",
      ),
      429,
    );
  }

  let otpSessionToken: string | null = null;
  if (rateLimitDecision.kind === "suppress_email_limit") {
    // The email-level limiter intentionally reuses the last valid OTP token so
    // the user can continue with the most recent email without receiving more mail.
    otpSessionToken = await loadLatestSentAgentOtpSessionToken(email, Date.now());
    if (otpSessionToken === null) {
      return c.json(
        createAgentErrorEnvelope(
          "RATE_LIMITED",
          "Too many requests. Try again later.",
          "Wait before requesting another code for this email address, then retry POST /api/agent/send-code.",
        ),
        429,
      );
    }
    await recordAgentOtpSendDecision(email, ipAddress, "suppressed_email_limit", otpSessionToken);
  } else {
    try {
      const result = await initiateEmailOtp(email);
      otpSessionToken = createAgentOtpSessionToken(result.session, email);
      await recordAgentOtpSendDecision(email, ipAddress, "sent", otpSessionToken);
    } catch (error) {
      log({
        domain: "auth",
        action: "agent_send_code_error",
        requestId,
        route: c.req.path,
        maskedEmail: maskEmail(email),
        ipAddress,
        statusCode: 500,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        createAgentErrorEnvelope(
          "OTP_SEND_FAILED",
          "Could not send a code. Try again.",
          "Retry POST /api/agent/send-code with the same email. If the issue persists, try later.",
        ),
        500,
      );
    }
  }

  if (otpSessionToken === null || otpSessionToken === "") {
    return c.json(
      createAgentErrorEnvelope(
        "OTP_SEND_FAILED",
        "Could not prepare a verification session. Try again.",
        "Retry POST /api/agent/send-code. The previous email may still contain a valid code.",
      ),
      500,
    );
  }

  return c.json(createAgentEnvelope(
    {
      email,
      otpSessionToken,
      expiresInSeconds: 180,
      authBaseUrl,
      apiBaseUrl,
    },
    [{
      name: "verify_code",
      method: "POST",
      url: `${authBaseUrl}/api/agent/verify-code`,
      input: {
        required: ["code", "otpSessionToken", "label"],
      },
    }],
    "A verification code has been sent to the user's email. Ask for the 8-digit code from the email, then call verify_code with code, otpSessionToken, and a label for this agent connection.",
  ));
});

export default app;
