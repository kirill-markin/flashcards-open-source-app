import { AccountConnectionError } from "../../server/social/accountConnectionContract.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type AuthAppEnv, jsonAuthError } from "../../server/apiErrors.js";
import { AuthAttemptError } from "../../server/social/attemptContract.js";
import { SocialProofError } from "../../server/social/providers.js";
import { PrincipalEnrollmentError } from "../../server/social/mailboxProof.js";
import { AppleRelayDeliveryDisabledError } from "../../server/social/appleNotifications.js";
import { AppleRevocationPendingError } from "../../server/social/appleCredential.js";
import { getDatabaseErrorSqlState, getDatabaseErrorMessage } from "../../server/databaseErrors.js";
import { isCognitoProviderOutage, isCognitoTypedError } from "../../server/cognito/cognitoErrors.js";
import { getSocialRequestSource } from "../../server/social/requestSource.js";
import { requireSocialRateLimit, type SocialPublicAction } from "../../server/social/rateLimit.js";
import { AccountTransportError } from "./accountTransport.js";
import { logWarning } from "../../server/logger.js";

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
  if (error instanceof AccountConnectionError) {
    return jsonAuthError(c, error.code === "ACCOUNT_CONNECTION_INVALID" ? 400 : error.code === "ACCOUNT_CONNECTION_RATE_LIMITED" ? 429 : 409,
      error.code, error.code === "ACCOUNT_CONNECTION_INVALID" ? "Invalid account connection action or binding."
        : error.code === "ACCOUNT_CONNECTION_RATE_LIMITED" ? "Too many mailbox requests. Start a fresh connection later."
          : "The connection proof expired or changed. Verify the accounts again.");
  }
  if (error instanceof AccountTransportError) return jsonAuthError(c, error.code === "SESSION_REQUIRED" ? 401 : 503, error.code, error.message);
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
      ? "This provider method is disabled. Sign in with another usable method, then explicitly re-enable it."
      : error.code === "PROVIDER_ENROLLMENT_CONFLICT"
        ? "This identity belongs to a different account or its enrollment changed. Sign in with that account's existing method; accounts cannot be merged during sign-in."
        : "Mailbox enrollment was rejected. Start a new provider sign-in and verify your mailbox.");
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
    return jsonAuthError(c, isCognitoProviderOutage(error) ? 503 : 409, "AUTH_ATTEMPT_RESTART_REQUIRED",
      "Email verification could not complete. Start a new provider sign-in and request a fresh code.");
  }
  const state = getDatabaseErrorSqlState(error);
  const message = getDatabaseErrorMessage(error);
  if (state === "P4201" || state === "P4202" || (c.req.path.includes("/api/account/connection")
    && ["23514", "54000", "P0A01", "55P03", "57014"].includes(state ?? ""))) {
    return jsonAuthError(c, 409, state === "P4202" ? "ACCOUNT_CONNECTION_PREVIEW_CHANGED" : "ACCOUNT_CONNECTION_RESTART_REQUIRED",
      state === "P4202" ? "The preview or choices changed. Reload the preview and explicitly confirm it again."
        : state === "54000" ? "This account exceeds the supported connection budget. Contact support."
          : "The connection expired, changed or is busy. Obtain fresh account proofs and review the preview.");
  }
  if (state === "P4101" || (state === "23514" && [
    "Verified provider method is disabled; start again",
    "Apple login method is disabled; explicit reauthorization is required",
  ].includes(message))) {
    logWarning({ domain: "auth", action: "error", code: "PROVIDER_METHOD_DISABLED", sqlState: state });
    return jsonAuthError(c, 409, "PROVIDER_METHOD_DISABLED",
      "This sign-in method was unlinked or cannot be automatically reconnected. Sign in with another method, then explicitly re-enable it in account settings.");
  }
  if (state === "P4102" || (state === "55006" && [
    "Apple revocation pending",
    "Apple revocation is pending; retry a fresh Apple sign-in after cleanup completes",
  ].includes(message))) {
    logWarning({ domain: "auth", action: "error", code: "APPLE_REVOCATION_PENDING", sqlState: state });
    return jsonAuthError(c, 409, "APPLE_REVOCATION_PENDING",
      "Apple sign-in cleanup is still running. Wait a moment, then start a fresh Apple sign-in.");
  }
  if (state === "P4103") {
    logWarning({ domain: "auth", action: "error", code: "APPLE_RECONNECT_PROOF_REQUIRED", sqlState: state });
    return jsonAuthError(c, 409, "APPLE_RECONNECT_PROOF_REQUIRED",
      "Apple consent or account security changed after this authorization. Start a fresh Apple sign-in after cleanup finishes.");
  }
  if (state === "23505") {
    logWarning({ domain: "auth", action: "error", code: "PROVIDER_ENROLLMENT_CONFLICT", sqlState: state });
    return jsonAuthError(c, 409, "PROVIDER_ENROLLMENT_CONFLICT",
      "This identity belongs to a different account. Sign in to that account with its existing method; accounts cannot be merged during sign-in.");
  }
  if (state === "23514" && message.startsWith("Cannot unlink the last usable method;")) {
    return jsonAuthError(c, 409, "LAST_USABLE_METHOD", "Link another provider or prove an existing non-relay email before unlinking this method.");
  }
  if (state === "23514" && message === "Provider method changed; reload account methods") {
    return jsonAuthError(c, 409, "PROVIDER_METHOD_CHANGED", "Reload sign-in methods and obtain a fresh proof before retrying.");
  }
  if (state === "23514" && message === "Disabled method changed or revocation is pending; start again after cleanup") {
    return jsonAuthError(c, 409, "PROVIDER_METHOD_CLEANUP_REQUIRED", "Wait for provider cleanup, reload methods, and obtain fresh proof before re-enabling.");
  }
  if (state === "23514" && message === "Recent bound current-account proof required; start again") {
    return jsonAuthError(c, 409, "FRESH_ACCOUNT_PROOF_REQUIRED", "Verify a current sign-in method again before managing providers.");
  }
  if (state === "23514" || state === "55006") {
    logWarning({ domain: "auth", action: "error", code: "AUTH_ATTEMPT_RESTART_REQUIRED", sqlState: state,
      reasonCategory: "social_lifecycle_refused" });
    return jsonAuthError(c, 409, "AUTH_ATTEMPT_RESTART_REQUIRED", "The sign-in lifecycle changed or its proof was consumed. Start a new provider sign-in.");
  }
  throw error;
}
