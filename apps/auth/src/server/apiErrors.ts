import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { log } from "./logger.js";

export type AuthAppEnv = {
  Variables: {
    requestId: string;
  };
};

export type AuthPublicErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_EMAIL"
  | "OTP_SEND_FAILED"
  | "OTP_SESSION_EXPIRED"
  | "OTP_CODE_INVALID"
  | "OTP_VERIFY_FAILED"
  | "REFRESH_TOKEN_MISSING"
  | "REFRESH_TOKEN_FAILED"
  | "REVOKE_TOKEN_MISSING"
  | "REVOKE_TOKEN_FAILED"
  | "INTERNAL_ERROR";

export function getRequestId(context: Context<AuthAppEnv>): string {
  return context.get("requestId");
}

export function jsonAuthError(
  context: Context<AuthAppEnv>,
  statusCode: ContentfulStatusCode,
  code: AuthPublicErrorCode,
  error: string,
): Response {
  const requestId = getRequestId(context);

  log({
    domain: "auth",
    action: "request_error",
    requestId,
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
