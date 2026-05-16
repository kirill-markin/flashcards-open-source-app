import { HttpError } from "./errors";

const transientDatabaseSqlStates: ReadonlySet<string> = new Set([
  "40001",
  "40P01",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "53300",
]);

const transientDatabaseNetworkCodes: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

const transientDatabaseMessageFragments: ReadonlyArray<string> = [
  "terminating connection due to administrator command",
  "connection terminated unexpectedly",
];

const transientDatabaseRetryMaxAttempts = 3;
const transientDatabaseRetryBaseDelayMs = 100;
const transientDatabaseRetryCapDelayMs = 750;

type TransientDatabaseRetryDependencies = Readonly<{
  sleep: (delayMs: number) => Promise<void>;
  random: () => number;
}>;

type DatabaseErrorFields = Readonly<{
  sqlState: string | null;
  errorCode: string | null;
  errorClass: string;
  errorMessage: string;
}>;

export type DatabaseBoundaryErrorFields = Readonly<{
  sqlState: string | null;
  errorCode: string | null;
  databaseErrorClass: string;
  databaseErrorMessage: string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readStringField(value: unknown, fieldName: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const fieldValue = value[fieldName];
  return typeof fieldValue === "string" && fieldValue !== "" ? fieldValue : null;
}

function getErrorClass(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "UnknownError";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getErrorCode(error: unknown): string | null {
  return readStringField(error, "code");
}

function getDatabaseBoundaryErrorCode(error: unknown): string | null {
  return readStringField(error, "errorCode");
}

function isSqlStateCode(code: string): boolean {
  return code.length === 5 && /^[0-9A-Z]+$/u.test(code) && !transientDatabaseNetworkCodes.has(code);
}

function getSqlStateFromCode(code: string | null): string | null {
  if (code === null || !isSqlStateCode(code)) {
    return null;
  }

  return code;
}

function isServiceUnavailableDatabaseError(error: unknown): boolean {
  return error instanceof TransientDatabaseHttpError;
}

function calculateTransientDatabaseRetryDelayMs(attempt: number, random: () => number): number {
  const exponentialDelayMs = transientDatabaseRetryBaseDelayMs * (2 ** (attempt - 1));
  const cappedDelayMs = Math.min(exponentialDelayMs, transientDatabaseRetryCapDelayMs);
  return Math.floor(random() * cappedDelayMs);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function toDatabaseBoundaryErrorFields(error: unknown): DatabaseBoundaryErrorFields {
  const fields = getDatabaseErrorFields(error);
  return {
    sqlState: fields.sqlState,
    errorCode: fields.errorCode,
    databaseErrorClass: fields.errorClass,
    databaseErrorMessage: fields.errorMessage,
  };
}

function logDatabaseTransientRetry(
  attempt: number,
  delayMs: number,
  error: unknown,
): void {
  console.warn(JSON.stringify({
    domain: "backend",
    action: "database_transient_retry",
    attempt,
    maxAttempts: transientDatabaseRetryMaxAttempts,
    delayMs,
    ...getDatabaseErrorFields(error),
  }));
}

export class TransientDatabaseHttpError extends HttpError implements DatabaseBoundaryErrorFields {
  readonly sqlState: string | null;
  readonly errorCode: string | null;
  readonly databaseErrorClass: string;
  readonly databaseErrorMessage: string;

  constructor(sourceError: unknown) {
    super(
      503,
      "Service is temporarily unavailable. Retry shortly.",
      "SERVICE_UNAVAILABLE",
    );
    const fields = toDatabaseBoundaryErrorFields(sourceError);
    this.sqlState = fields.sqlState;
    this.errorCode = fields.errorCode;
    this.databaseErrorClass = fields.databaseErrorClass;
    this.databaseErrorMessage = fields.databaseErrorMessage;
  }
}

export class DatabaseCommitOutcomeUnknownError extends HttpError implements DatabaseBoundaryErrorFields {
  readonly sqlState: string | null;
  readonly errorCode: string | null;
  readonly databaseErrorClass: string;
  readonly databaseErrorMessage: string;

  constructor(sourceError: unknown) {
    super(
      500,
      "Request outcome could not be confirmed. Check current state before retrying the request.",
      "DATABASE_COMMIT_OUTCOME_UNKNOWN",
    );
    const fields = toDatabaseBoundaryErrorFields(sourceError);
    this.sqlState = fields.sqlState;
    this.errorCode = fields.errorCode;
    this.databaseErrorClass = fields.databaseErrorClass;
    this.databaseErrorMessage = fields.databaseErrorMessage;
  }
}

export function getDatabaseErrorFields(error: unknown): DatabaseErrorFields {
  const code = getDatabaseBoundaryErrorCode(error) ?? getErrorCode(error);
  const sqlState = readStringField(error, "sqlState") ?? getSqlStateFromCode(code);
  const databaseErrorClass = readStringField(error, "databaseErrorClass");
  const databaseErrorMessage = readStringField(error, "databaseErrorMessage");
  return {
    sqlState,
    errorCode: code,
    errorClass: databaseErrorClass ?? getErrorClass(error),
    errorMessage: databaseErrorMessage ?? getErrorMessage(error),
  };
}

export function isTransientDatabaseError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code !== null && transientDatabaseSqlStates.has(code)) {
    return true;
  }

  if (code !== null && transientDatabaseNetworkCodes.has(code)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return transientDatabaseMessageFragments.some((fragment) => message.includes(fragment));
}

export function toDatabaseBoundaryError(error: unknown): unknown {
  if (!isTransientDatabaseError(error)) {
    return error;
  }

  return new TransientDatabaseHttpError(error);
}

export function toDatabaseCommitOutcomeUnknownError(error: unknown): HttpError {
  return new DatabaseCommitOutcomeUnknownError(error);
}

export function toDatabaseCommitBoundaryError(error: unknown): unknown {
  if (!isTransientDatabaseError(error)) {
    return toDatabaseBoundaryError(error);
  }

  return toDatabaseCommitOutcomeUnknownError(error);
}

export function logDatabasePoolError(poolName: string, error: unknown): void {
  console.warn(JSON.stringify({
    domain: "backend",
    action: "database_pool_error",
    poolName,
    ...getDatabaseErrorFields(error),
  }));
}

export async function retryTransientDatabaseOperationWithDependencies<Result>(
  operation: () => Promise<Result>,
  dependencies: TransientDatabaseRetryDependencies,
): Promise<Result> {
  let attempt = 1;
  let lastTransientError: unknown = null;

  while (attempt <= transientDatabaseRetryMaxAttempts) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDatabaseError(error) && !isServiceUnavailableDatabaseError(error)) {
        throw error;
      }

      lastTransientError = error;
      if (attempt === transientDatabaseRetryMaxAttempts) {
        throw error;
      }

      const delayMs = calculateTransientDatabaseRetryDelayMs(attempt, dependencies.random);
      logDatabaseTransientRetry(attempt, delayMs, error);
      await dependencies.sleep(delayMs);
      attempt += 1;
    }
  }

  throw lastTransientError;
}

export async function withTransientDatabaseRetry<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  return retryTransientDatabaseOperationWithDependencies(operation, {
    sleep,
    random: Math.random,
  });
}
