import pg from "pg";
import { getDatabaseUrl } from "./config.js";
import {
  getDatabaseErrorClass,
  getDatabaseErrorCode,
  getDatabaseErrorMessage,
  getDatabaseErrorSqlState,
} from "./server/databaseErrors.js";
import { logWarning } from "./server/logger.js";

let pool: pg.Pool | undefined;
// AuthHandler's share of the fleet-wide Postgres connection budget is stated per container, so the
// pool has to be bounded here for its reservedConcurrentExecutions to bound anything.
// Infrastructure owns the number: infra/aws/lib/gateways/api-gateway.ts checks the whole budget at
// synth time and infra/aws/lib/gateways/auth-gateway.ts sets DB_POOL_MAX_CONNECTIONS from the same
// constant, so the check governs what this container actually opens.
const authPoolMaxConnectionsEnvName = "DB_POOL_MAX_CONNECTIONS";
// Used for local runs. Same value and same floor reasoning as the backend pool in
// apps/backend/src/database/core.ts.
const defaultAuthPoolMaxConnections = 3;
// The pg default is 0, which waits for a free connection forever.
const authPoolConnectionTimeoutMs = 5_000;
// The exact messages pg raises when authPoolConnectionTimeoutMs expires: the first from pg-pool
// while queueing for a free slot, the other two from the client's own connect handshake. None
// carries a code or a SQLSTATE, so isTransientDatabaseError in ./server/databaseErrors.js matches
// nothing and the request would answer 500 instead of the 503 this class of failure deserves.
const authPoolConnectionTimeoutMessages: ReadonlySet<string> = new Set([
  "timeout exceeded when trying to connect",
  "timeout expired",
  "Connection terminated due to connection timeout",
]);

/**
 * Carries a pg connection timeout as ETIMEDOUT, which isTransientDatabaseError already recognizes,
 * so the auth error handler answers 503 with a Retry-After instead of a generic 500.
 */
class AuthPoolConnectionTimeoutError extends Error {
  readonly code = "ETIMEDOUT";

  constructor(cause: Error) {
    super(`PostgreSQL pool connection timed out. cause=${cause.message}`, { cause });
    this.name = "AuthPoolConnectionTimeoutError";
  }
}

function resolveAuthPoolMaxConnections(): number {
  const configuredValue = process.env[authPoolMaxConnectionsEnvName];
  if (configuredValue === undefined || configuredValue === "") {
    return defaultAuthPoolMaxConnections;
  }

  const parsedValue = Number(configuredValue);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < defaultAuthPoolMaxConnections) {
    throw new Error(
      `${authPoolMaxConnectionsEnvName} must be an integer of at least `
        + `${defaultAuthPoolMaxConnections}. value=${configuredValue}`,
    );
  }

  return parsedValue;
}

/**
 * Normalizes the errors the pool raises while it is still trying to hand out a connection. Once a
 * client is checked out these messages can no longer occur, so only checkout sites need this.
 */
function toAuthPoolBoundaryError(error: unknown): unknown {
  if (error instanceof Error && authPoolConnectionTimeoutMessages.has(error.message)) {
    return new AuthPoolConnectionTimeoutError(error);
  }

  return error;
}

type SqlValue = string | number | boolean | Date | null | ReadonlyArray<string>;

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

async function getPool(): Promise<pg.Pool> {
  if (pool !== undefined) {
    return pool;
  }

  const connectionString = await getDatabaseUrl();
  // Re-checked after the await, as apps/backend/src/database/core.ts does. decideOtpRateLimit runs
  // eight queries through Promise.all, so on a cold container eight callers reach this point
  // together; without the second check each would build its own pool and only the last would be
  // reachable to close, leaving the container holding several times the budgeted connections.
  if (pool !== undefined) {
    return pool;
  }

  const ssl = process.env.DB_SECRET_ARN ? true : false;
  pool = new pg.Pool({
    connectionString,
    ssl,
    max: resolveAuthPoolMaxConnections(),
    connectionTimeoutMillis: authPoolConnectionTimeoutMs,
  });
  pool.on("error", (error: Error) => {
    logWarning({
      domain: "auth",
      action: "database_pool_error",
      poolName: "auth",
      sqlState: getDatabaseErrorSqlState(error),
      errorCode: getDatabaseErrorCode(error),
      errorClass: getDatabaseErrorClass(error),
      errorMessage: getDatabaseErrorMessage(error),
    });
  });
  return pool;
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

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  const activePool = await getPool();
  try {
    // The pool checks a connection out before it runs the statement, so a checkout or handshake
    // timeout surfaces here too.
    return await activePool.query<Row>(text, params as Array<unknown>);
  } catch (error) {
    throw toAuthPoolBoundaryError(error);
  }
}

async function connectAuthClient(): Promise<pg.PoolClient> {
  const activePool = await getPool();
  try {
    return await activePool.connect();
  } catch (error) {
    throw toAuthPoolBoundaryError(error);
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

export async function transaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await connectAuthClient();
  const executor: DatabaseExecutor = {
    query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      return client.query<Row>(text, params as Array<unknown>);
    },
  };

  try {
    await client.query("BEGIN");
    const result = await callback(executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function transactionWithUserScope<Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return transaction(async (executor) => {
    await applyUserDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithWorkspaceScope<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return transaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function queryWithUserScope<Row extends pg.QueryResultRow>(
  scope: UserDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return transactionWithUserScope(scope, async (executor) => executor.query<Row>(text, params));
}

export async function queryWithWorkspaceScope<Row extends pg.QueryResultRow>(
  scope: WorkspaceDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return transactionWithWorkspaceScope(scope, async (executor) => executor.query<Row>(text, params));
}
