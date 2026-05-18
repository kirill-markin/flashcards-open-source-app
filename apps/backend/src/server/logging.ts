import { AuthError } from "../auth";
import { HttpError } from "../errors";
import { sanitizeBackendTelemetryValue } from "../observability/sanitizer";
import {
  addBackendSentryBreadcrumb,
  createBackendObservationScope,
  getBackendErrorLogDetails,
  type AdminQueryDetails,
  type BackendObservationScope,
  type BackendErrorLogDetails,
} from "../observability/sentry";

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ErrorLogContext = BackendErrorLogDetails;

type AdminQueryLogPayload = Readonly<{
  requestId: string;
}> & AdminQueryDetails;

type CloudWatchAdminQueryDetails = Omit<AdminQueryDetails, "adminEmail"> & Readonly<{
  adminEmail: string;
}>;

export function getErrorLogContext(error: unknown): ErrorLogContext {
  return getBackendErrorLogDetails(error);
}

function getDatabaseSqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === "string" && code !== "" ? code : null;
}

function redactAdminEmailForCloudWatch(adminEmail: string): string {
  const sanitizedValue = sanitizeBackendTelemetryValue(adminEmail);
  if (typeof sanitizedValue !== "string") {
    throw new Error("Expected sanitized adminEmail to remain a string");
  }

  return sanitizedValue === adminEmail ? "<redacted-admin-email>" : sanitizedValue;
}

function createCloudWatchAdminQueryDetails(details: AdminQueryDetails): CloudWatchAdminQueryDetails {
  return {
    adminEmail: redactAdminEmailForCloudWatch(details.adminEmail),
    statementCount: details.statementCount,
    durationMs: details.durationMs,
    success: details.success,
    sqlFingerprint: details.sqlFingerprint,
  };
}

export function logRequestError(
  requestId: string,
  path: string,
  method: string,
  error: AuthError | HttpError | unknown,
): void {
  const errorContext = getErrorLogContext(error);
  const baseRecord = {
    domain: "backend",
    action: "request_error",
    requestId,
    path,
    method,
  };

  if (error instanceof AuthError) {
    console.error(JSON.stringify({
      ...baseRecord,
      statusCode: error.statusCode,
      code: "AUTH_UNAUTHORIZED",
      ...errorContext,
    }));
    return;
  }

  if (error instanceof HttpError) {
    console.error(JSON.stringify({
      ...baseRecord,
      statusCode: error.statusCode,
      code: error.code,
      validationIssues: summarizeValidationIssues(error),
      ...errorContext,
    }));
    return;
  }

  console.error(JSON.stringify({
    ...baseRecord,
    statusCode: 500,
    code: "INTERNAL_ERROR",
    sqlState: getDatabaseSqlState(error),
    ...errorContext,
  }));
}

export function logAdminQueryEvent(
  payload: AdminQueryLogPayload,
): void {
  const scope: BackendObservationScope = createBackendObservationScope(
    "backend-api",
    payload.requestId,
    "/admin/reports/query",
    "POST",
    null,
    null,
    null,
    null,
    null,
  );
  const details: AdminQueryDetails = {
    adminEmail: payload.adminEmail,
    statementCount: payload.statementCount,
    durationMs: payload.durationMs,
    success: payload.success,
    sqlFingerprint: payload.sqlFingerprint,
  };

  console.log(JSON.stringify({
    domain: "backend",
    action: "admin_query",
    ...scope,
    ...createCloudWatchAdminQueryDetails(details),
  }));

  addBackendSentryBreadcrumb({
    action: "admin_query",
    scope,
    details,
  });
}

export function summarizeValidationIssues(
  error: HttpError | unknown,
): ReadonlyArray<Readonly<{ path: string; code: string }>> {
  if (!(error instanceof HttpError)) {
    return [];
  }

  const validationIssues = error.details?.validationIssues ?? [];
  return validationIssues.map((issue) => ({
    path: issue.path,
    code: issue.code,
  }));
}
