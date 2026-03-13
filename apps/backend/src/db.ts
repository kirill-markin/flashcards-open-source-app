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

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return executeQuery<Row>(await getPool(), text, params);
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
