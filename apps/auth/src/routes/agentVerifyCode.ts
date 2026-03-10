/**
 * Agent-only OTP completion route. Successful verification returns a long-
 * lived API key immediately so terminal bots never need refresh-token logic.
 */
import { Hono } from "hono";
import { type AuthAppEnv, getRequestId } from "../server/apiErrors.js";
import {
  createAgentApiKeyFromIdToken,
  normalizeAgentApiKeyLabel,
} from "../server/agentApiKeys.js";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../server/agentEnvelope.js";
import { isAgentOtpExpired, parseAgentOtpSessionToken } from "../server/agentOtp.js";
import { verifyEmailOtp } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";
import { getPublicApiBaseUrl } from "../server/publicUrls.js";

const app = new Hono<AuthAppEnv>();

const CODE_RE = /^\d{8}$/;

type VerifyFailureResult = Readonly<{
  code: "OTP_SESSION_EXPIRED" | "OTP_CHALLENGE_CONSUMED" | "OTP_CODE_INVALID" | "OTP_VERIFY_FAILED";
  message: string;
}>;

function classifyVerifyFailure(error: unknown): VerifyFailureResult {
  const message = error instanceof Error ? error.message : String(error);
  const cognitoType = error instanceof Error && "cognitoType" in error && typeof error.cognitoType === "string"
    ? error.cognitoType
    : "";
  const normalizedMessage = message.toLowerCase();
  const normalizedType = cognitoType.toLowerCase();

  if (
    normalizedMessage.includes("session can only be used once")
    || normalizedMessage.includes("invalid session for the user")
  ) {
    return { code: "OTP_CHALLENGE_CONSUMED", message: "Code already used. Request a new one." };
  }

  if (
    normalizedType.includes("expired")
    || normalizedMessage.includes("expired")
    || normalizedMessage.includes("session expired")
  ) {
    return { code: "OTP_SESSION_EXPIRED", message: "Code expired. Request a new one." };
  }

  if (
    normalizedType.includes("codemismatch")
    || normalizedMessage.includes("code mismatch")
    || normalizedMessage.includes("invalid code")
  ) {
    return { code: "OTP_CODE_INVALID", message: "Enter a valid 8-digit code." };
  }

  return { code: "OTP_VERIFY_FAILED", message: "Could not verify the code. Try again." };
}

app.post("/api/agent/verify-code", async (c) => {
  let body: { code?: string; otpSessionToken?: string; label?: string };
  try {
    body = await c.req.json<{ code?: string; otpSessionToken?: string; label?: string }>();
  } catch {
    return c.json(
      createAgentErrorEnvelope(
        "INVALID_REQUEST",
        "Invalid request.",
        "Provide code, otpSessionToken, and label, then call this endpoint again.",
      ),
      400,
    );
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const otpSessionToken = typeof body.otpSessionToken === "string" ? body.otpSessionToken.trim() : "";
  const rawLabel = typeof body.label === "string" ? body.label : "";

  if (!CODE_RE.test(code)) {
    return c.json(
      createAgentErrorEnvelope(
        "OTP_CODE_INVALID",
        "Enter a valid 8-digit code.",
        "Ask the user for the latest 8-digit email code, then retry verify_code.",
      ),
      400,
    );
  }

  if (otpSessionToken === "") {
    return c.json(
      createAgentErrorEnvelope(
        "OTP_SESSION_EXPIRED",
        "Code expired. Request a new one.",
        "Call POST /api/agent/send-code again to start a fresh verification flow.",
      ),
      400,
    );
  }

  let label: string;
  try {
    label = normalizeAgentApiKeyLabel(rawLabel);
  } catch (error) {
    return c.json(
      createAgentErrorEnvelope(
        "INVALID_REQUEST",
        error instanceof Error ? error.message : "Invalid label.",
        "Provide a short human-readable label for this agent connection, then retry verify_code.",
      ),
      400,
    );
  }

  let payload: ReturnType<typeof parseAgentOtpSessionToken>;
  try {
    payload = parseAgentOtpSessionToken(otpSessionToken);
  } catch {
    return c.json(
      createAgentErrorEnvelope(
        "OTP_SESSION_EXPIRED",
        "Code expired. Request a new one.",
        "Call POST /api/agent/send-code again to start a fresh verification flow.",
      ),
      400,
    );
  }

  if (isAgentOtpExpired(payload, Date.now())) {
    return c.json(
      createAgentErrorEnvelope(
        "OTP_SESSION_EXPIRED",
        "Code expired. Request a new one.",
        "Call POST /api/agent/send-code again to request a fresh code.",
      ),
      400,
    );
  }

  const requestId = getRequestId(c);
  try {
    const tokens = await verifyEmailOtp(payload.e, code, payload.s);
    const createdKey = await createAgentApiKeyFromIdToken(tokens.idToken, label);
    const apiBaseUrl = getPublicApiBaseUrl(c.req.url);

    return c.json(createAgentEnvelope(
      {
        apiKey: createdKey.apiKey,
        authorizationScheme: "ApiKey",
        apiBaseUrl,
        connection: createdKey.connection,
      },
      [{
        name: "load_account",
        method: "GET",
        url: `${apiBaseUrl}/me`,
        auth: {
          scheme: "ApiKey",
        },
      }],
      "Store the API key securely. Use it for all future API requests in the Authorization header as: ApiKey <apiKey>. Next, call load_account.",
    ));
  } catch (error) {
    const failure = classifyVerifyFailure(error);
    log({
      domain: "auth",
      action: "agent_verify_code_error",
      requestId,
      route: c.req.path,
      statusCode: 400,
      code: failure.code,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      createAgentErrorEnvelope(
        failure.code,
        failure.message,
        failure.code === "OTP_CODE_INVALID"
          ? "Ask the user for the latest 8-digit email code, then retry verify_code."
          : "Start a fresh login by calling POST /api/agent/send-code again.",
      ),
      400,
    );
  }
});

export default app;
