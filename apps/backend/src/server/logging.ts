import { AuthError } from "../auth";
import { HttpError } from "../errors";
import { sanitizeBackendTelemetryValue } from "../observability/sanitizer";
import {
  addBackendBreadcrumb,
  addBackendSentryBreadcrumb,
  createBackendObservationScope,
  getBackendErrorLogDetails,
  type AdminQueryDetails,
  type BackendObservationScope,
  type BackendErrorLogDetails,
  type BackendFailureDetails,
  type RequestErrorDetails,
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
  if (typeof error !== "object" || error === null) {
    return null;
  }

  if ("sqlState" in error) {
    const sqlState = (error as Readonly<{ sqlState?: unknown }>).sqlState;
    return typeof sqlState === "string" && sqlState !== "" ? sqlState : null;
  }

  if (!("code" in error)) {
    return null;
  }

  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

function shouldLogRequestErrorAtErrorLevel(error: AuthError | HttpError | unknown): boolean {
  if (error instanceof AuthError) {
    return false;
  }

  if (error instanceof HttpError) {
    return error.statusCode >= 500;
  }

  return true;
}

function getRequestErrorStatusCode(error: AuthError | HttpError | unknown): number {
  if (error instanceof AuthError || error instanceof HttpError) {
    return error.statusCode;
  }

  return 500;
}

function getRequestErrorCode(error: AuthError | HttpError | unknown): string | null {
  if (error instanceof AuthError) {
    return "AUTH_UNAUTHORIZED";
  }

  if (error instanceof HttpError) {
    return error.code;
  }

  return "INTERNAL_ERROR";
}

export function createBackendFailureDetails(error: AuthError | HttpError | unknown): BackendFailureDetails {
  return {
    statusCode: getRequestErrorStatusCode(error),
    code: getRequestErrorCode(error),
    message: getInternalErrorMessage(error),
    validationIssues: summarizeValidationIssues(error),
  };
}

function createRequestErrorDetails(error: AuthError | HttpError | unknown): RequestErrorDetails {
  return {
    ...createBackendFailureDetails(error),
    sqlState: getDatabaseSqlState(error),
    ...getErrorLogContext(error),
  };
}

function createErrorLevelRequestErrorDetails(
  details: RequestErrorDetails,
): Omit<RequestErrorDetails, "message"> {
  return {
    statusCode: details.statusCode,
    code: details.code,
    validationIssues: details.validationIssues,
    sqlState: details.sqlState,
    errorClass: details.errorClass,
    errorMessage: details.errorMessage,
    errorStack: details.errorStack,
    sourceFile: details.sourceFile,
    sourceLine: details.sourceLine,
    sourceColumn: details.sourceColumn,
  };
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
  const details = createRequestErrorDetails(error);
  if (shouldLogRequestErrorAtErrorLevel(error) === false) {
    addBackendBreadcrumb({
      action: "request_error",
      scope: createBackendObservationScope(
        "backend-api",
        requestId,
        path,
        method,
        null,
        null,
        null,
        null,
        null,
      ),
      details,
    });
    return;
  }

  const baseRecord = {
    domain: "backend",
    action: "request_error",
    requestId,
    path,
    method,
  };

  console.error(JSON.stringify({
    ...baseRecord,
    ...createErrorLevelRequestErrorDetails(details),
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
