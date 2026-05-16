/**
 * Agent-only OTP bootstrap route for terminal clients. It returns a short
 * opaque handle instead of a signed payload so agents do not need to repeat
 * the full Cognito session blob in the next request.
 */
import { Hono } from "hono";
import { initiateEmailOtp } from "../server/cognitoAuth.js";
import { type AuthAppEnv, getRequestId } from "../server/apiErrors.js";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../server/agentEnvelope.js";
import { getDemoEmailPassword } from "../server/demoEmailAccess.js";
import {
  createAgentOtpChallenge,
  reissueLatestAgentOtpChallenge,
} from "../server/agentOtpChallenges.js";
import {
  decideOtpRateLimit,
  recordOtpSendDecision,
  type OtpRateLimitDecision,
} from "../server/otpRateLimit.js";
import { log, maskEmail } from "../server/logger.js";
import { getPublicAuthBaseUrl, getPublicApiBaseUrl } from "../server/publicUrls.js";
import { isTransientDatabaseError } from "../server/databaseErrors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POST_EMAIL_DELIVERY_DB_FAILURE_INSTRUCTIONS = "A verification email may already be in the user's inbox, but this response could not create a usable agent verification handle. Do not retry this same send-code request immediately because it may send another email. Ask the user to wait briefly and check their email. If sign-in is still needed, start a fresh flow with POST /api/agent/send-code and use only the latest email code and latest otpSessionToken.";

type AgentSendCodeDependencies = Readonly<{
  initiateEmailOtp: (email: string) => Promise<Readonly<{ session: string }>>;
  getDemoEmailPassword: (email: string) => Promise<string | null>;
  decideOtpRateLimit: (email: string, ipAddress: string) => Promise<OtpRateLimitDecision>;
  recordOtpSendDecision: (
    email: string,
    ipAddress: string,
    decision: "sent" | "suppressed_email_limit" | "blocked_ip_limit",
    otpSessionToken: string | null,
  ) => Promise<void>;
  createAgentOtpChallenge: (email: string, cognitoSession: string, nowMs: number) => Promise<string>;
  reissueLatestAgentOtpChallenge: (email: string, nowMs: number) => Promise<string | null>;
  now: () => number;
}>;

function createDemoAgentSession(email: string): string {
  return `demo-agent-session:${email}`;
}

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

/**
 * Creates the terminal-first send-code app with injectable dependencies so the
 * rate-limit and OTP-handle behavior can be tested without live services.
 */
export function createAgentSendCodeApp(dependencies: AgentSendCodeDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/agent/send-code", async (c) => {
    let body: { email?: string };
    try {
      body = await c.req.json<{ email?: string }>();
    } catch {
      return c.json(
        createAgentErrorEnvelope(
          c.req.url,
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
          c.req.url,
          "INVALID_EMAIL",
          "Enter a valid email address.",
          "Provide a valid email address, then call POST /api/agent/send-code again.",
        ),
        400,
      );
    }

    const requestId = getRequestId(c);
    const demoPassword = await dependencies.getDemoEmailPassword(email);
    const authBaseUrl = getPublicAuthBaseUrl(c.req.url);
    const apiBaseUrl = getPublicApiBaseUrl(c.req.url);

    if (demoPassword !== null) {
      const otpSessionToken = await dependencies.createAgentOtpChallenge(
        email,
        createDemoAgentSession(email),
        dependencies.now(),
      );

      return c.json(createAgentEnvelope(
        c.req.url,
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
        "A verification code has been sent to the user's email. Ask for the 8-digit code from the email, then call verify_code with code, otpSessionToken, and a label for this agent connection. Read payload from data.* and do not expect resource fields at the top level. Select the next endpoint from instructions and confirm it with actions.",
      ));
    }

    const ipAddress = getClientIpAddress(c.req.raw);
    const rateLimitDecision = await dependencies.decideOtpRateLimit(email, ipAddress);

    if (rateLimitDecision.kind === "block_ip_limit") {
      await dependencies.recordOtpSendDecision(email, ipAddress, "blocked_ip_limit", null);
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
          c.req.url,
          "RATE_LIMITED",
          "Too many requests. Try again later.",
          "Wait before requesting another code from this IP address, then retry POST /api/agent/send-code.",
        ),
        429,
      );
    }

    let otpSessionToken = "";
    if (rateLimitDecision.kind === "suppress_email_limit") {
      otpSessionToken = await dependencies.reissueLatestAgentOtpChallenge(email, dependencies.now()) ?? "";
      if (otpSessionToken === "") {
        return c.json(
          createAgentErrorEnvelope(
            c.req.url,
            "RATE_LIMITED",
            "Too many requests. Try again later.",
            "Wait before requesting another code for this email address, then retry POST /api/agent/send-code.",
          ),
          429,
        );
      }
      await dependencies.recordOtpSendDecision(email, ipAddress, "suppressed_email_limit", null);
    } else {
      let session: string;
      try {
        session = (await dependencies.initiateEmailOtp(email)).session;
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
            c.req.url,
            "OTP_SEND_FAILED",
            "Could not send a code. Try again.",
            "Retry POST /api/agent/send-code with the same email. If the issue persists, try later.",
          ),
          500,
        );
      }

      try {
        otpSessionToken = await dependencies.createAgentOtpChallenge(email, session, dependencies.now());
        await dependencies.recordOtpSendDecision(email, ipAddress, "sent", null);
      } catch (error) {
        if (!isTransientDatabaseError(error)) {
          throw error;
        }

        log({
          domain: "auth",
          action: "agent_send_code_error",
          requestId,
          route: c.req.path,
          maskedEmail: maskEmail(email),
          ipAddress,
          statusCode: 503,
          code: "SERVICE_UNAVAILABLE",
          reasonCategory: "post_email_database_error",
          error: error instanceof Error ? error.message : String(error),
        });
        return c.json(
          createAgentErrorEnvelope(
            c.req.url,
            "SERVICE_UNAVAILABLE",
            "A verification email may have been sent, but the agent verification flow could not be completed.",
            POST_EMAIL_DELIVERY_DB_FAILURE_INSTRUCTIONS,
          ),
          503,
        );
      }
    }

    return c.json(createAgentEnvelope(
      c.req.url,
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
      "A verification code has been sent to the user's email. Ask for the 8-digit code from the email, then call verify_code with code, otpSessionToken, and a label for this agent connection. Read payload from data.* and do not expect resource fields at the top level. Select the next endpoint from instructions and confirm it with actions.",
    ));
  });

  return app;
}

const app = createAgentSendCodeApp({
  initiateEmailOtp,
  getDemoEmailPassword,
  decideOtpRateLimit,
  recordOtpSendDecision,
  createAgentOtpChallenge,
  reissueLatestAgentOtpChallenge,
  now: () => Date.now(),
});

export default app;
