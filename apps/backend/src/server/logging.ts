import { AuthError, authVerificationTemporarilyUnavailableCode } from "../auth";
import { HttpError } from "../shared/errors";
import { createBackendFailureDetails } from "../observability/failureDetails";
import { sanitizeBackendTelemetryValue } from "../observability/sanitizer";
import {
  addBackendBreadcrumb,
  addBackendSentryBreadcrumb,
  createBackendObservationScope,
  getBackendErrorLogDetails,
  type AdminQueryDetails,
  type AgentSqlDetails,
  type BackendObservationScope,
  type BackendService,
  type BackendErrorLogDetails,
  type RequestErrorDetails,
} from "../observability/sentry";

export {
  createBackendFailureDetails,
  summarizeValidationIssues,
} from "../observability/failureDetails";

export type ErrorLogContext = BackendErrorLogDetails;

type AdminQueryLogPayload = Readonly<{
  requestId: string;
}> & AdminQueryDetails;

type CloudWatchAdminQueryDetails = Omit<AdminQueryDetails, "adminEmail"> & Readonly<{
  adminEmail: string;
}>;

type AgentSqlLogPayload = Readonly<{
  userId: string;
  workspaceId: string;
}> & AgentSqlDetails;

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
    if (error.code === authVerificationTemporarilyUnavailableCode) {
      return false;
    }

    return error.statusCode >= 500;
  }

  return true;
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
    ...(details.mediaAssetStorage === undefined ? {} : { mediaAssetStorage: details.mediaAssetStorage }),
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

/**
 * The shared agent SQL executor runs in two Lambdas: the chat tool executes
 * inside the chat worker, while the REST agent routes and the MCP transport
 * execute inside the backend API. Map the surface onto the emitting service so
 * the record's `service` matches the log group it lands in.
 */
function getAgentSqlService(surface: AgentSqlDetails["surface"]): BackendService {
  return surface === "chat-tool" ? "chat-worker" : "backend-api";
}

/**
 * Emits the single structured record for one agent SQL execution, following the
 * `logAdminQueryEvent` convention above (fingerprint + statement count +
 * duration + outcome, never the raw SQL). Unlike the admin variant nothing here
 * needs a CloudWatch-specific redaction, so this goes through the shared
 * `addBackendBreadcrumb` helper that writes the sanitized CloudWatch record and
 * the Sentry breadcrumb in one call.
 *
 * The route is synthetic (`agent-sql/<surface>`) because the same executor is
 * reached from an MCP tool call, a REST route, and the in-app chat tool.
 */
export function logAgentSqlEvent(payload: AgentSqlLogPayload): void {
  const scope: BackendObservationScope = createBackendObservationScope(
    getAgentSqlService(payload.surface),
    null,
    `agent-sql/${payload.surface}`,
    "POST",
    payload.userId,
    payload.workspaceId,
    null,
    null,
    null,
    null,
    null,
  );
  const details: AgentSqlDetails = {
    surface: payload.surface,
    caller: payload.caller,
    connectionId: payload.connectionId,
    succeeded: payload.succeeded,
    statementType: payload.statementType,
    resource: payload.resource,
    statementCount: payload.statementCount,
    rowOrAffectedCount: payload.rowOrAffectedCount,
    durationMs: payload.durationMs,
    sqlLength: payload.sqlLength,
    sqlFingerprint: payload.sqlFingerprint,
    errorCode: payload.errorCode,
    dialectReason: payload.dialectReason,
    errorClass: payload.errorClass,
  };

  addBackendBreadcrumb({
    action: "agent_sql",
    scope,
    details,
  });
}
