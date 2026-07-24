import type pg from "pg";
import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  unsafeRepeatableReadReadOnlyTransaction,
  unsafeTransaction,
  type DatabaseExecutor,
  type SqlValue,
  type UserDatabaseScope,
  type WorkspaceDatabaseScope,
} from "./core";
export {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
};
export type {
  DatabaseExecutor,
  SqlValue,
  UserDatabaseScope,
  WorkspaceDatabaseScope,
} from "./core";
export {
  SessionAdvisoryLockAbortedError, SessionAdvisoryLockTimeoutError, withSessionAdvisoryLock,
} from "./sessionAdvisoryLock";
export type { SessionAdvisoryLockInput } from "./sessionAdvisoryLock";

export async function transactionWithUserScope<Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeTransaction(async (executor) => {
    await applyUserDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithWorkspaceScope<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithUserScopeReadOnly<Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => {
    await applyUserDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithWorkspaceScopeReadOnly<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => {
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

export async function queryWithUserScopeReadOnly<Row extends pg.QueryResultRow>(
  scope: UserDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return transactionWithUserScopeReadOnly(scope, async (executor) => executor.query<Row>(text, params));
}

export async function queryWithWorkspaceScopeReadOnly<Row extends pg.QueryResultRow>(
  scope: WorkspaceDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return transactionWithWorkspaceScopeReadOnly(scope, async (executor) => executor.query<Row>(text, params));
}
