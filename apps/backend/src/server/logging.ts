import { AuthError } from "../auth";
import { HttpError } from "../errors";

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDatabaseSqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === "string" && code !== "" ? code : null;
}

export function logRequestError(
  requestId: string,
  path: string,
  method: string,
  error: AuthError | HttpError | unknown,
): void {
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
      errorClass: "AuthError",
      statusCode: error.statusCode,
      code: "AUTH_UNAUTHORIZED",
    }));
    return;
  }

  if (error instanceof HttpError) {
    console.error(JSON.stringify({
      ...baseRecord,
      errorClass: "HttpError",
      statusCode: error.statusCode,
      code: error.code,
      details: error.details,
    }));
    return;
  }

  console.error(JSON.stringify({
    ...baseRecord,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: getInternalErrorMessage(error),
    sqlState: getDatabaseSqlState(error),
  }));
}

export function logCloudRouteEvent(
  action: string,
  payload: Record<string, unknown>,
  isError: boolean,
): void {
  const logger = isError ? console.error : console.log;
  logger(JSON.stringify({
    domain: "backend",
    action,
    ...payload,
  }));
}

export function summarizeValidationIssues(
  error: HttpError | unknown,
): ReadonlyArray<Readonly<{ path: string; code: string }>> {
  if (!(error instanceof HttpError) || error.details === null) {
    return [];
  }

  return error.details.validationIssues.map((issue) => ({
    path: issue.path,
    code: issue.code,
  }));
}
