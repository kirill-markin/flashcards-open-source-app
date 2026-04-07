import pg from "pg";
import { getDatabaseUrl } from "./config";

let pool: pg.Pool | undefined;

export type SqlValue = string | number | boolean | Date | null | ReadonlyArray<string>;

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
  if (!pool) {
    const connectionString = await getDatabaseUrl();
    const ssl = process.env.DB_SECRET_ARN ? true : false;
    pool = new pg.Pool({ connectionString, ssl });
  }
  return pool;
}

async function executeQuery<Row extends pg.QueryResultRow>(
  executor: pg.Pool | pg.PoolClient,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return executor.query<Row>(text, params as Array<unknown>);
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
  return executeQuery<Row>(await getPool(), text, params);
}

/**
 * Opens one privileged transaction without applying any request scope.
 * Callers must set any needed user/workspace scope explicitly.
 */
export async function unsafeTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await (await getPool()).connect();
  const executor: DatabaseExecutor = {
    query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      return executeQuery<Row>(client, text, params);
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
