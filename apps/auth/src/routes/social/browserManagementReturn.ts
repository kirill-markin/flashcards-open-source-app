import type { Context } from "hono";
import { getRequestId, getRequestLogger, jsonAuthError, type AuthAppEnv } from "../../server/apiErrors.js";
import * as Sentry from "@sentry/aws-serverless";
import { PrincipalSessionError } from "../../server/social/principalSessions.js";
import { isTransientDatabaseError } from "../../server/databaseErrors.js";
import { socialErrorResponse } from "./http.js";

import type { BrowserCallbackState } from "../../server/social/browserState.js";

export function managementReturnUri(state: BrowserCallbackState, status: "account_method_failed" | "account_method_cancelled", code: string): string {
  if (state.client !== "web" || state.intent === "login") throw new Error("Management return requires a browser management state");
  const destination = new URL(state.redirectUri);
  destination.hash = new URLSearchParams({ status, code }).toString();
  return destination.toString();
}
export async function browserManagementError(c: Context<AuthAppEnv>, state: BrowserCallbackState | null, response: Response): Promise<Response> {
  if (state === null || state.client !== "web" || state.intent === "login") return response;
  const result = await response.clone().json() as Readonly<{ code?: string }>;
  const code = typeof result.code === "string" && /^[A-Z_]{1,64}$/.test(result.code) ? result.code : "AUTH_ATTEMPT_RESTART_REQUIRED";
  return c.redirect(managementReturnUri(state, code === "PROVIDER_SIGN_IN_DENIED" ? "account_method_cancelled" : "account_method_failed", code), 303);
}

export async function browserManagementFailure(c: Context<AuthAppEnv>, state: BrowserCallbackState, error: unknown): Promise<Response> {
  let response: Response;
  try { response = socialErrorResponse(c, error); }
  catch (failure) {
    if (failure instanceof PrincipalSessionError) response = jsonAuthError(c, failure.statusCode, failure.code, failure.message);
    else {
      const statusCode = isTransientDatabaseError(failure) ? 503 : 500;
      getRequestLogger(c)({ domain: "auth", action: "request_error", requestId: getRequestId(c), route: c.req.path, statusCode,
        code: "AUTH_ATTEMPT_RESTART_REQUIRED", errorClass: failure instanceof Error ? failure.name : "UnknownError" });
      if (statusCode === 500) Sentry.captureException(failure, { tags: { service: "auth", route: c.req.path }, extra: { requestId: getRequestId(c) } });
      response = jsonAuthError(c, statusCode, "AUTH_ATTEMPT_RESTART_REQUIRED", "This change did not complete. Refresh methods and start again with fresh proof.");
    }
  }
  return browserManagementError(c, state, response);
}
