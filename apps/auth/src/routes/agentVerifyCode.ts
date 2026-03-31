/**
 * Agent-only OTP completion route. A short opaque OTP handle is resolved to
 * the server-side Cognito session, then exchanged for a long-lived API key.
 */
import { Hono } from "hono";
import { type AuthAppEnv, getRequestId } from "../server/apiErrors.js";
import {
  createAgentApiKeyFromIdToken,
  normalizeAgentApiKeyLabel,
  type CreatedAgentApiKey,
} from "../server/agentApiKeys.js";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../server/agentEnvelope.js";
import {
  lookupAgentOtpChallenge,
  markAgentOtpChallengeUsed,
  type AgentOtpChallengeLookup,
} from "../server/agentOtpChallenges.js";
import { verifyEmailOtp, type TokenResult } from "../server/cognitoAuth.js";
import { log } from "../server/logger.js";
import { getPublicApiBaseUrl } from "../server/publicUrls.js";
import {
  getOtpVerifyAttemptState,
  MAX_OTP_VERIFY_ATTEMPTS,
  recordOtpVerifyFailure,
  type OtpVerifyAttemptState,
  type OtpVerifyFailureRecordResult,
} from "../server/otpVerifyAttempts.js";

const CODE_RE = /^\d{8}$/;

type VerifyFailureResult = Readonly<{
  code: "OTP_SESSION_EXPIRED" | "OTP_CHALLENGE_CONSUMED" | "OTP_CODE_INVALID" | "OTP_VERIFY_FAILED";
  message: string;
}>;

type AgentVerifyCodeDependencies = Readonly<{
  lookupAgentOtpChallenge: (otpSessionToken: string, nowMs: number) => Promise<AgentOtpChallengeLookup>;
  getOtpVerifyAttemptState: (email: string, cognitoSession: string, nowMs: number) => Promise<OtpVerifyAttemptState>;
  recordOtpVerifyFailure: (
    email: string,
    cognitoSession: string,
    expiresAt: string,
    nowMs: number,
    maxAttempts: number,
  ) => Promise<OtpVerifyFailureRecordResult>;
  verifyEmailOtp: (email: string, code: string, session: string) => Promise<TokenResult>;
  markAgentOtpChallengeUsed: (email: string, cognitoSession: string, nowMs: number) => Promise<void>;
  normalizeAgentApiKeyLabel: (label: string) => string;
  createAgentApiKeyFromIdToken: (idToken: string, label: string) => Promise<CreatedAgentApiKey>;
  now: () => number;
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

/**
 * Creates the agent verify-code route with injectable dependencies so auth
 * tests can cover the new opaque handle flow without live Cognito or DB calls.
 */
export function createAgentVerifyCodeApp(dependencies: AgentVerifyCodeDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/agent/verify-code", async (c) => {
    let body: { code?: string; otpSessionToken?: string; label?: string };
    try {
      body = await c.req.json<{ code?: string; otpSessionToken?: string; label?: string }>();
    } catch {
      return c.json(
        createAgentErrorEnvelope(
          c.req.url,
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
          c.req.url,
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
          c.req.url,
          "OTP_SESSION_EXPIRED",
          "Code expired. Request a new one.",
          "Call POST /api/agent/send-code again to start a fresh verification flow.",
        ),
        400,
      );
    }

    let label: string;
    try {
      label = dependencies.normalizeAgentApiKeyLabel(rawLabel);
    } catch (error) {
      return c.json(
        createAgentErrorEnvelope(
          c.req.url,
          "INVALID_REQUEST",
          error instanceof Error ? error.message : "Invalid label.",
          "Provide a short human-readable label for this agent connection, then retry verify_code.",
        ),
        400,
      );
    }

    const challenge = await dependencies.lookupAgentOtpChallenge(otpSessionToken, dependencies.now());
    if (challenge.status === "invalid" || challenge.status === "expired" || challenge.status === "used") {
      return c.json(
        createAgentErrorEnvelope(
          c.req.url,
          "OTP_SESSION_EXPIRED",
          "Code expired. Request a new one.",
          "Call POST /api/agent/send-code again to request a fresh code.",
        ),
        400,
      );
    }

    const requestId = getRequestId(c);
    const attemptState = await dependencies.getOtpVerifyAttemptState(
      challenge.email,
      challenge.cognitoSession,
      dependencies.now(),
    );
    if (attemptState.status === "locked") {
      log({
        domain: "auth",
        action: "agent_verify_code_error",
        requestId,
        route: c.req.path,
        statusCode: 429,
        code: "OTP_TOO_MANY_ATTEMPTS",
        reasonCategory: "too_many_attempts",
        error: "Challenge is locked after too many invalid attempts",
      });
      return c.json(
        createAgentErrorEnvelope(
          c.req.url,
          "OTP_TOO_MANY_ATTEMPTS",
          "Too many invalid attempts. Request a new code.",
          "Start a fresh login by calling POST /api/agent/send-code again.",
        ),
        429,
      );
    }

    try {
      const tokens = await dependencies.verifyEmailOtp(challenge.email, code, challenge.cognitoSession);
      await dependencies.markAgentOtpChallengeUsed(challenge.email, challenge.cognitoSession, dependencies.now());
      const createdKey = await dependencies.createAgentApiKeyFromIdToken(tokens.idToken, label);
      const apiBaseUrl = getPublicApiBaseUrl(c.req.url);

      return c.json(createAgentEnvelope(
        c.req.url,
        {
          apiKey: createdKey.apiKey,
          authorizationScheme: "ApiKey",
          apiBaseUrl,
          connection: createdKey.connection,
        },
        [
          {
            name: "load_account",
            method: "GET",
            url: `${apiBaseUrl}/agent/me`,
            auth: {
              scheme: "ApiKey",
            },
          },
          {
            name: "list_workspaces",
            method: "GET",
            url: `${apiBaseUrl}/agent/workspaces`,
            auth: {
              scheme: "ApiKey",
            },
          },
          {
            name: "create_workspace",
            method: "POST",
            url: `${apiBaseUrl}/agent/workspaces`,
            input: {
              required: ["name"],
            },
            auth: {
              scheme: "ApiKey",
            },
          },
          {
            name: "select_workspace",
            method: "POST",
            urlTemplate: `${apiBaseUrl}/agent/workspaces/{workspaceId}/select`,
            input: {
              required: ["workspaceId"],
            },
            auth: {
              scheme: "ApiKey",
            },
          },
        ],
        `Store this long-lived API key now and do not rely on chat history alone. A new dialog or session on the same machine will not have this key unless it was saved outside this conversation. Prefer exporting it first as FLASHCARDS_OPEN_SOURCE_API_KEY; if needed, save it in a local .env file or another local file. If the user already allowed saving or writing in this conversation, do not ask again. Otherwise, ask only when the write is risky, more persistent than the user requested, or the destination is unclear. At minimum, save it somewhere persistent outside chat memory. Then bootstrap workspace selection with explicit endpoints: GET ${apiBaseUrl}/agent/me, GET ${apiBaseUrl}/agent/workspaces, and if selection is required call POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select (or POST ${apiBaseUrl}/agent/workspaces with {\"name\":\"Personal\"} when no workspaces exist). For routine low-risk writes, a clear user request already counts as permission. Ask again only for risky or unclear actions. Read payload from data.* and do not expect resource fields at the top level. Select the next endpoint from instructions and confirm it with actions. Example: export FLASHCARDS_OPEN_SOURCE_API_KEY='<PASTE_KEY_HERE>' && curl -H 'Authorization: ApiKey $FLASHCARDS_OPEN_SOURCE_API_KEY' '${apiBaseUrl}/agent/me'.`,
      ));
    } catch (error) {
      const failure = classifyVerifyFailure(error);
      if (failure.code === "OTP_CODE_INVALID") {
        const result = await dependencies.recordOtpVerifyFailure(
          challenge.email,
          challenge.cognitoSession,
          challenge.expiresAt,
          dependencies.now(),
          MAX_OTP_VERIFY_ATTEMPTS,
        );
        if (result.locked) {
          log({
            domain: "auth",
            action: "agent_verify_code_error",
            requestId,
            route: c.req.path,
            statusCode: 429,
            code: "OTP_TOO_MANY_ATTEMPTS",
            reasonCategory: "too_many_attempts",
            error: error instanceof Error ? error.message : String(error),
          });
          return c.json(
            createAgentErrorEnvelope(
              c.req.url,
              "OTP_TOO_MANY_ATTEMPTS",
              "Too many invalid attempts. Request a new code.",
              "Start a fresh login by calling POST /api/agent/send-code again.",
            ),
            429,
          );
        }
      }
      log({
        domain: "auth",
        action: "agent_verify_code_error",
        requestId,
        route: c.req.path,
        statusCode: 400,
        code: failure.code,
        reasonCategory: failure.code === "OTP_CODE_INVALID" ? "invalid_code" : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        createAgentErrorEnvelope(
          c.req.url,
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

  return app;
}

const app = createAgentVerifyCodeApp({
  lookupAgentOtpChallenge,
  getOtpVerifyAttemptState,
  recordOtpVerifyFailure,
  verifyEmailOtp,
  markAgentOtpChallengeUsed,
  normalizeAgentApiKeyLabel,
  createAgentApiKeyFromIdToken,
  now: () => Date.now(),
});

export default app;
