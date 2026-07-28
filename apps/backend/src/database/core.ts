import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import {
  getDatabaseUrl,
  getDatabaseUrlWithAbortSignal,
} from "./config";
import {
  getDatabaseErrorFields,
  logDatabasePoolError,
  toDatabaseBoundaryError,
  toDatabaseCommitBoundaryError,
} from "./transient";
import {
  captureBackendRuntimeWarning,
  createBackendRuntimeObservationScope,
} from "../observability/runtime";
import {
  queryWithPostgresDeadline,
  repeatableReadReadOnlyTransactionWithPostgresDeadline,
  repeatableReadTransactionWithPostgresDeadline,
  resolvePostgresPoolUntilDeadline,
  transactionWithPostgresDeadline,
  validateDatabaseDeadline,
} from "./deadline";

let pool: pg.Pool | undefined;
const databaseDeadlineStorage = new AsyncLocalStorage<number>();

export type SqlValue = string | number | boolean | Date | null | ReadonlyArray<string> | ReadonlyArray<number>;

export type UserDatabaseScope = Readonly<{
  userId: string;
}>;

export type WorkspaceDatabaseScope = Readonly<{
  userId: string;
  workspaceId: string;
}>;

export type DatabaseExecutor = Readonly<{
  query<Row extends pg.QueryResultRow>(
    text: string,
    params: ReadonlyArray<SqlValue>,
  ): Promise<pg.QueryResult<Row>>;
}>;

function createDatabasePool(connectionString: string): pg.Pool {
  const ssl = process.env.DB_SECRET_ARN ? true : false;
  const databasePool = new pg.Pool({ connectionString, ssl });
  databasePool.on("error", (error: Error): void => {
    logDatabasePoolError("main", error);
  });
  return databasePool;
}

async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  const connectionString = await getDatabaseUrl();
  if (pool) return pool;
  pool = createDatabasePool(connectionString);
  return pool;
}

async function initializePoolUntilDeadline(
  deadlineAtMs: number,
  abortSignal: AbortSignal,
): Promise<pg.Pool> {
  if (pool) return pool;
  const connectionString = await getDatabaseUrlWithAbortSignal(
    abortSignal,
    deadlineAtMs,
  );
  abortSignal.throwIfAborted();
  validateDatabaseDeadline(deadlineAtMs);
  if (pool) return pool;

  const databasePool = createDatabasePool(connectionString);
  try {
    abortSignal.throwIfAborted();
    validateDatabaseDeadline(deadlineAtMs);
  } catch (error) {
    await databasePool.end();
    throw error;
  }
  pool = databasePool;
  return pool;
}

async function getPoolUntilDeadline(deadlineAtMs: number): Promise<pg.Pool> {
  return resolvePostgresPoolUntilDeadline(
    deadlineAtMs,
    async (abortSignal) => initializePoolUntilDeadline(deadlineAtMs, abortSignal),
  );
}

function resolveEffectiveDatabaseDeadline(deadlineAtMs: number): number {
  const inheritedDeadlineAtMs = databaseDeadlineStorage.getStore();
  return inheritedDeadlineAtMs === undefined
    ? deadlineAtMs
    : Math.min(deadlineAtMs, inheritedDeadlineAtMs);
}

export function runDatabaseOperationsWithDeadline<Result>(
  deadlineAtMs: number,
  callback: () => Promise<Result>,
): Promise<Result> {
  const effectiveDeadlineAtMs = resolveEffectiveDatabaseDeadline(deadlineAtMs);
  validateDatabaseDeadline(effectiveDeadlineAtMs);
  return databaseDeadlineStorage.run(effectiveDeadlineAtMs, callback);
}

async function executeQuery<Row extends pg.QueryResultRow>(
  executor: pg.Pool | pg.PoolClient,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  try {
    return await executor.query<Row>(text, params as Array<unknown>);
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }
}

async function applyDatabaseScopeInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  await executor.query(
    [
      "SELECT",
      "set_config('app.user_id', $1, true),",
      "set_config('app.workspace_id', $2, true)",
    ].join(" "),
    [userId, workspaceId ?? ""],
  );
}

async function commitTransaction(client: pg.PoolClient): Promise<unknown | null> {
  try {
    await client.query("COMMIT");
    return null;
  } catch (error) {
    return error;
  }
}

async function rollbackTransaction(client: pg.PoolClient): Promise<unknown | null> {
  try {
    await client.query("ROLLBACK");
    return null;
  } catch (rollbackError) {
    return rollbackError;
  }
}

function toClientReleaseError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function logUnsafeTransactionRollbackFailure(originalError: unknown, rollbackError: unknown): void {
  const originalFields = getDatabaseErrorFields(originalError);
  const rollbackFields = getDatabaseErrorFields(rollbackError);
  captureBackendRuntimeWarning({
    action: "unsafe_transaction_rollback_failed",
    scope: createBackendRuntimeObservationScope(),
    details: {
      originalSqlState: originalFields.sqlState,
      originalErrorCode: originalFields.errorCode,
      originalErrorClass: originalFields.errorClass,
      originalErrorMessage: originalFields.errorMessage,
      rollbackSqlState: rollbackFields.sqlState,
      rollbackErrorCode: rollbackFields.errorCode,
      rollbackErrorClass: rollbackFields.errorClass,
      rollbackErrorMessage: rollbackFields.errorMessage,
    },
  });
}

function tryLogUnsafeTransactionRollbackFailure(originalError: unknown, rollbackError: unknown): void {
  try {
    logUnsafeTransactionRollbackFailure(originalError, rollbackError);
  } catch {
    // Observability must not mask the original transaction failure.
  }
}

export async function applyUserDatabaseScopeInExecutor(
  executor: DatabaseExecutor,
  scope: UserDatabaseScope,
): Promise<void> {
  await applyDatabaseScopeInExecutor(executor, scope.userId, null);
}

export async function applyWorkspaceDatabaseScopeInExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<void> {
  await applyDatabaseScopeInExecutor(executor, scope.userId, scope.workspaceId);
}

/**
 * Executes one privileged query without applying any request scope.
 * Only auth/bootstrap/system code should use this entrypoint.
 */
export async function unsafeQuery<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  const deadlineAtMs = databaseDeadlineStorage.getStore();
  if (deadlineAtMs !== undefined) {
    return unsafeQueryWithDeadline(deadlineAtMs, text, params);
  }
  return executeQuery<Row>(await getPool(), text, params);
}

export async function unsafeQueryWithDeadline<Row extends pg.QueryResultRow>(
  deadlineAtMs: number,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  const effectiveDeadlineAtMs = resolveEffectiveDatabaseDeadline(deadlineAtMs);
  validateDatabaseDeadline(effectiveDeadlineAtMs);
  return queryWithPostgresDeadline<Row>(
    await getPoolUntilDeadline(effectiveDeadlineAtMs),
    effectiveDeadlineAtMs,
    text,
    params,
  );
}

/**
 * Opens one privileged transaction without applying any request scope.
 * Callers must set any needed user/workspace scope explicitly.
 */
export async function unsafeTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const deadlineAtMs = databaseDeadlineStorage.getStore();
  if (deadlineAtMs !== undefined) {
    return unsafeTransactionWithDeadline(deadlineAtMs, callback);
  }
  return unsafeTransactionWithBeginStatement("BEGIN", callback);
}

export async function unsafeTransactionWithDeadline<Result>(
  deadlineAtMs: number,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const effectiveDeadlineAtMs = resolveEffectiveDatabaseDeadline(deadlineAtMs);
  validateDatabaseDeadline(effectiveDeadlineAtMs);
  return transactionWithPostgresDeadline(
    await getPoolUntilDeadline(effectiveDeadlineAtMs),
    effectiveDeadlineAtMs,
    callback,
  );
}

export async function unsafeRepeatableReadTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const deadlineAtMs = databaseDeadlineStorage.getStore();
  if (deadlineAtMs !== undefined) {
    return repeatableReadTransactionWithPostgresDeadline(
      await getPoolUntilDeadline(deadlineAtMs),
      deadlineAtMs,
      callback,
    );
  }
  return unsafeTransactionWithBeginStatement(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    callback,
  );
}

export async function unsafeRepeatableReadReadOnlyTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const deadlineAtMs = databaseDeadlineStorage.getStore();
  if (deadlineAtMs !== undefined) {
    return repeatableReadReadOnlyTransactionWithPostgresDeadline(
      await getPoolUntilDeadline(deadlineAtMs),
      deadlineAtMs,
      callback,
    );
  }
  return unsafeTransactionWithBeginStatement(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    callback,
  );
}

async function unsafeTransactionWithBeginStatement<Result>(
  beginStatement: string,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  let client: pg.PoolClient;
  try {
    client = await (await getPool()).connect();
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }

  const executor: DatabaseExecutor = {
    query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      return executeQuery<Row>(client, text, params);
    },
  };

  let releaseError: Error | undefined;
  try {
    try {
      await client.query(beginStatement);
    } catch (error) {
      releaseError = toClientReleaseError(error);
      throw toDatabaseBoundaryError(error);
    }

    let result: Result;
    try {
      result = await callback(executor);
    } catch (error) {
      const rollbackError = await rollbackTransaction(client);
      if (rollbackError !== null) {
        releaseError = toClientReleaseError(rollbackError);
        tryLogUnsafeTransactionRollbackFailure(error, rollbackError);
        throw toDatabaseBoundaryError(error);
      }

      throw toDatabaseBoundaryError(error);
    }

    const commitError = await commitTransaction(client);
    if (commitError !== null) {
      releaseError = toClientReleaseError(commitError);
      throw toDatabaseCommitBoundaryError(commitError);
    }

    return result;
  } finally {
    if (releaseError === undefined) {
      client.release();
    } else {
      client.release(releaseError);
    }
  }
}
