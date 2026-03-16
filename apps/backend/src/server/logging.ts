import { AuthError } from "../auth";
import { HttpError } from "../errors";

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ErrorSourceLocation = Readonly<{
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
}>;

export type ErrorLogContext = Readonly<{
  errorClass: string;
  errorMessage: string;
  errorStack: string | null;
}> & ErrorSourceLocation;

function parseErrorSourceLocation(stack: string | null): ErrorSourceLocation {
  if (stack === null) {
    return {
      sourceFile: null,
      sourceLine: null,
      sourceColumn: null,
    };
  }

  const stackLines = stack.split("\n");
  for (const stackLine of stackLines.slice(1)) {
    const trimmedLine = stackLine.trim();
    const match = /^\s*at .+ \((.+):(\d+):(\d+)\)$/.exec(trimmedLine)
      ?? /^\s*at (.+):(\d+):(\d+)$/.exec(trimmedLine)
      ?? /^(.+):(\d+):(\d+)$/.exec(trimmedLine);
    if (match === null) {
      continue;
    }

    return {
      sourceFile: match[1] ?? null,
      sourceLine: Number.parseInt(match[2] ?? "", 10),
      sourceColumn: Number.parseInt(match[3] ?? "", 10),
    };
  }

  return {
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

export function getErrorLogContext(error: unknown): ErrorLogContext {
  if (error instanceof Error) {
    return {
      errorClass: error.name,
      errorMessage: error.message,
      errorStack: error.stack ?? null,
      ...parseErrorSourceLocation(error.stack ?? null),
    };
  }

  return {
    errorClass: "UnknownError",
    errorMessage: String(error),
    errorStack: null,
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null,
  };
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
      details: error.details,
      validationIssues: error.details?.validationIssues ?? [],
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
