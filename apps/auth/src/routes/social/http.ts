import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type AuthAppEnv, jsonAuthError } from "../../server/apiErrors.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { SocialProofError } from "../../server/social/providers.js";
import { PrincipalEnrollmentError } from "../../server/social/mailboxProof.js";
import { AppleRelayDeliveryDisabledError } from "../../server/social/appleNotifications.js";
import { AppleRevocationPendingError } from "../../server/social/appleCredential.js";
import { getDatabaseErrorSqlState } from "../../server/databaseErrors.js";
import { isCognitoTypedError } from "../../server/cognito/cognitoErrors.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit, type SocialPublicAction } from "../../server/social/rateLimit.js";

export async function requireSocialRequest(c: Context<AuthAppEnv>, action: SocialPublicAction): Promise<string> {
  c.header("Cache-Control", "no-store");
  const source = getSocialRequestSource();
  await requireSocialRateLimit(action, source);
  return source;
}

export async function readSocialBody(c: Context<AuthAppEnv>): Promise<string> {
  const reader = c.req.raw.body?.getReader();
  if (reader === undefined) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 24_576) {
        await reader.cancel();
        throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString("utf8");
}

export async function readSocialJson(c: Context<AuthAppEnv>): Promise<unknown> {
  if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
  const body = await readSocialBody(c);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
}

export function socialErrorResponse(c: Context<AuthAppEnv>, error: unknown): Response {
  if (error instanceof AuthAttemptError) {
    if (error.code === "AUTH_RATE_LIMITED") {
      c.header("Retry-After", "900");
      return jsonAuthError(c, 429, error.code, "Too many authentication requests. Try again later.");
    }
    return jsonAuthError(c, error.code === "AUTH_ATTEMPT_INVALID" ? 400 : 409, error.code,
      error.code === "AUTH_ATTEMPT_INVALID" ? "Invalid provider sign-in request." : "This sign-in expired or was consumed. Start a new provider sign-in.");
  }
  if (error instanceof SocialProofError) {
    const status: ContentfulStatusCode = error.code === "PROVIDER_UNAVAILABLE" ? 409
      : error.code === "PROVIDER_CONFIGURATION_INVALID" || error.code === "PROVIDER_TEMPORARILY_UNAVAILABLE" ? 503 : 400;
    return jsonAuthError(c, status, error.code, status === 503
      ? "Provider sign-in is temporarily unavailable. Start a new sign-in later."
      : error.code === "PROVIDER_UNAVAILABLE" ? "This provider has no available sign-in transport for this client."
        : "Provider verification failed. Start a new provider sign-in.");
  }
  if (error instanceof PrincipalEnrollmentError) {
    return jsonAuthError(c, 409, error.code, error.code === "PROVIDER_METHOD_DISABLED"
      ? "This provider method is disabled. Use verified email recovery."
      : "Mailbox or provider enrollment was rejected. Start a new provider sign-in and verify your mailbox.");
  }
  if (error instanceof AppleRevocationPendingError) return jsonAuthError(c, 409, error.code, error.message);
  if (error instanceof AppleRelayDeliveryDisabledError) {
    return jsonAuthError(c, 409, error.code, "Apple has disabled delivery to this relay address. Enable relay forwarding before requesting another email.");
  }
  if (isCognitoTypedError(error)) {
    const code = error.cognitoType;
    if (code === "TooManyRequestsException" || code === "LimitExceededException") {
      return jsonAuthError(c, 429, "AUTH_RATE_LIMITED", "Email verification was rate limited. Start a new sign-in later.");
    }
    return jsonAuthError(c, error.providerStatusCode >= 500 ? 503 : 409, "AUTH_ATTEMPT_RESTART_REQUIRED",
      "Email verification could not complete. Start a new provider sign-in and request a fresh code.");
  }
  const state = getDatabaseErrorSqlState(error);
  if (state === "23514" || state === "23505" || state === "55006") {
    return jsonAuthError(c, 409, "AUTH_ATTEMPT_RESTART_REQUIRED", "The sign-in lifecycle changed or its proof was consumed. Start a new provider sign-in.");
  }
  throw error;
}
