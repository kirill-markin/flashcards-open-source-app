import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthLogger } from "./logger.js";
import type { AuthTraceId } from "./sentry.js";

export type AuthAppEnv = {
  Variables: {
    requestId: string;
    traceId: AuthTraceId | null;
    logger: AuthLogger;
  };
};

export type AuthPublicErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_EMAIL"
  | "PASSWORD_SIGN_IN_FAILED"
  | "RATE_LIMITED"
  | "OTP_TOO_MANY_ATTEMPTS"
  | "OTP_SEND_FAILED"
  | "OTP_SESSION_EXPIRED"
  | "OTP_CHALLENGE_CONSUMED"
  | "OTP_CODE_INVALID"
  | "OTP_VERIFY_FAILED"
  | "REFRESH_TOKEN_MISSING"
  | "REFRESH_TOKEN_FAILED"
  | "REVOKE_TOKEN_MISSING"
  | "REVOKE_TOKEN_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export function getRequestId(context: Context<AuthAppEnv>): string {
  return context.get("requestId");
}

export function getTraceId(context: Context<AuthAppEnv>): AuthTraceId | null {
  return context.get("traceId");
}

export function getRequestLogger(context: Context<AuthAppEnv>): AuthLogger {
  return context.get("logger");
}

export function jsonAuthError(
  context: Context<AuthAppEnv>,
  statusCode: ContentfulStatusCode,
  code: AuthPublicErrorCode,
  error: string,
): Response {
  const requestId = getRequestId(context);
  const traceId = getTraceId(context);
  const logger = getRequestLogger(context);

  logger({
    domain: "auth",
    action: "request_error",
    requestId,
    traceId,
    route: context.req.path,
    statusCode,
    code,
  });

  return context.json({
    error,
    requestId,
    code,
  }, statusCode);
}
