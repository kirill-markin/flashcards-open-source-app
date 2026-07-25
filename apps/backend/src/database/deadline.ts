import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "./core";
import {
  getDatabaseErrorFields,
  logDatabasePoolError,
  toDatabaseBoundaryError,
  toDatabaseCommitBoundaryError,
  toDatabaseCommitOutcomeUnknownError,
  type DatabaseBoundaryErrorFields,
} from "./transient";

const maximumTimerDelayMs = 2_147_483_647;
const rollbackReserveMs = 250;
const queryReadTimeoutMessage = "Query read timeout";
const timeoutConfigurationSql = [
  "SELECT",
  "set_config('statement_timeout', $1, true),",
  "set_config('lock_timeout', $2, true)",
].join(" ");

export type DatabaseDeadlinePhase =
  | "pool_checkout"
  | "transaction_begin"
  | "transaction_callback"
  | "executor_operations"
  | "statement"
  | "before_commit"
  | "rollback";

type DeadlineQueryConfig = pg.QueryConfig<Array<SqlValue>> & Readonly<{
  query_timeout: number;
}>;

export class DatabaseDeadlineExceededError extends Error {
  readonly code = "DATABASE_DEADLINE_EXCEEDED";

  constructor(
    readonly phase: DatabaseDeadlinePhase,
    readonly deadlineAtMs: number,
    cause: unknown | null,
  ) {
    super(
      `Database deadline exceeded. phase=${phase}; deadlineAtMs=${deadlineAtMs}`,
      cause === null ? undefined : { cause },
    );
    this.name = "DatabaseDeadlineExceededError";
  }
}

export class DatabaseTransactionRolledBackError extends Error implements DatabaseBoundaryErrorFields {
  readonly code = "DATABASE_TRANSACTION_ROLLED_BACK";
  readonly sqlState: string | null;
  readonly errorCode: string | null;
  readonly databaseErrorClass: string;
  readonly databaseErrorMessage: string;

  constructor(sourceError: unknown | null) {
    super("PostgreSQL rolled back the transaction instead of committing it.");
    this.name = "DatabaseTransactionRolledBackError";
    if (sourceError === null) {
      this.sqlState = null;
      this.errorCode = null;
      this.databaseErrorClass = "UnknownDatabaseError";
      this.databaseErrorMessage = "PostgreSQL did not provide the original transaction error.";
    } else {
      const fields = getDatabaseErrorFields(sourceError);
      this.sqlState = fields.sqlState;
      this.errorCode = fields.errorCode;
      this.databaseErrorClass = fields.errorClass;
      this.databaseErrorMessage = fields.errorMessage;
    }
  }
}

export function validateDatabaseDeadline(deadlineAtMs: number): void {
  if (!Number.isSafeInteger(deadlineAtMs) || deadlineAtMs < 1) {
    throw new RangeError("Database deadline must be a positive absolute epoch-millisecond safe integer.");
  }
  if (deadlineAtMs <= Date.now()) {
    throw new DatabaseDeadlineExceededError("pool_checkout", deadlineAtMs, null);
  }
}

function remainingTimeMs(deadlineAtMs: number, phase: DatabaseDeadlinePhase): number {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw new DatabaseDeadlineExceededError(phase, deadlineAtMs, null);
  }
  return Math.min(remainingMs, maximumTimerDelayMs);
}

function toReleaseError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isQueryReadTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === queryReadTimeoutMessage;
}

function createQueryConfig(
  text: string,
  params: ReadonlyArray<SqlValue>,
  queryTimeoutMs: number,
): DeadlineQueryConfig {
  return {
    text,
    values: [...params],
    query_timeout: queryTimeoutMs,
  };
}

function executePromiseUntilDeadline<Result>(
  operation: () => Promise<Result>,
  deadlineAtMs: number,
  phase: DatabaseDeadlinePhase,
  onDeadline: (error: DatabaseDeadlineExceededError) => void,
): Promise<Result> {
  const remainingMs = remainingTimeMs(deadlineAtMs, phase);
  const operationPromise = Promise.resolve().then(operation);

  return new Promise<Result>((resolve, reject) => {
    let settled = false;

    const rejectWithDeadline = (): void => {
      if (settled) return;
      settled = true;
      const error = new DatabaseDeadlineExceededError(phase, deadlineAtMs, null);
      onDeadline(error);
      reject(error);
    };

    const timer = setTimeout(rejectWithDeadline, remainingMs);
    void operationPromise.then(
      (result) => {
        if (settled) return;
        if (Date.now() >= deadlineAtMs) {
          clearTimeout(timer);
          rejectWithDeadline();
          return;
        }
        clearTimeout(timer);
        settled = true;
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        if (Date.now() >= deadlineAtMs) {
          clearTimeout(timer);
          rejectWithDeadline();
          return;
        }
        clearTimeout(timer);
        settled = true;
        reject(error);
      },
    );
  });
}

export function resolvePostgresPoolUntilDeadline(
  deadlineAtMs: number,
  provider: (abortSignal: AbortSignal) => Promise<pg.Pool>,
): Promise<pg.Pool> {
  validateDatabaseDeadline(deadlineAtMs);
  const abortController = new AbortController();
  return executePromiseUntilDeadline(
    async () => provider(abortController.signal),
    deadlineAtMs,
    "pool_checkout",
    (error) => abortController.abort(error),
  );
}

async function connectUntilDeadline(pool: pg.Pool, deadlineAtMs: number): Promise<pg.PoolClient> {
  const remainingMs = remainingTimeMs(deadlineAtMs, "pool_checkout");
  let connectPromise: Promise<pg.PoolClient>;
  try {
    connectPromise = pool.connect();
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }

  return new Promise<pg.PoolClient>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DatabaseDeadlineExceededError("pool_checkout", deadlineAtMs, null));
    }, remainingMs);

    void connectPromise.then(
      (client) => {
        if (settled) {
          client.release();
          return;
        }
        if (Date.now() >= deadlineAtMs) {
          clearTimeout(timer);
          settled = true;
          reject(new DatabaseDeadlineExceededError("pool_checkout", deadlineAtMs, null));
          client.release();
          return;
        }
        clearTimeout(timer);
        settled = true;
        resolve(client);
      },
      (error: unknown) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        reject(toDatabaseBoundaryError(error));
      },
    ).catch((error: unknown) => {
      logDatabasePoolError("deadline-late-checkout-release", error);
    });
  });
}

async function executeClientQuery<Row extends pg.QueryResultRow>(
  client: pg.PoolClient,
  deadlineAtMs: number,
  phase: Exclude<DatabaseDeadlinePhase, "pool_checkout" | "before_commit">,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  const queryTimeoutMs = remainingTimeMs(deadlineAtMs, phase);
  try {
    const result = await client.query<Row, Array<SqlValue>>(
      createQueryConfig(text, params, queryTimeoutMs),
    );
    if (Date.now() >= deadlineAtMs) {
      throw new DatabaseDeadlineExceededError(phase, deadlineAtMs, null);
    }
    return result;
  } catch (error) {
    if (error instanceof DatabaseDeadlineExceededError) throw error;
    if (isQueryReadTimeout(error)) {
      throw new DatabaseDeadlineExceededError(phase, deadlineAtMs, error);
    }
    throw toDatabaseBoundaryError(error);
  }
}

async function configureTransactionTimeouts(
  client: pg.PoolClient,
  deadlineAtMs: number,
): Promise<void> {
  const remainingMs = remainingTimeMs(deadlineAtMs, "statement");
  const statementTimeoutMs = Math.max(1, remainingMs - rollbackReserveMs);
  const lockTimeoutMs = Math.max(1, statementTimeoutMs - 1);
  await executeClientQuery(
    client,
    deadlineAtMs,
    "statement",
    timeoutConfigurationSql,
    [`${statementTimeoutMs}ms`, `${lockTimeoutMs}ms`],
  );
}

async function rollbackTransaction(
  client: pg.PoolClient,
  deadlineAtMs: number,
): Promise<unknown | null> {
  try {
    await executeClientQuery(client, deadlineAtMs, "rollback", "ROLLBACK", []);
    return null;
  } catch (error) {
    return error;
  }
}

async function executeCommit(
  client: pg.PoolClient,
  deadlineAtMs: number,
  statementError: unknown | null,
): Promise<void> {
  const queryTimeoutMs = remainingTimeMs(deadlineAtMs, "before_commit");
  let commitPromise: Promise<pg.QueryResult<pg.QueryResultRow>>;
  try {
    commitPromise = client.query(createQueryConfig("COMMIT", [], queryTimeoutMs));
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }

  let result: pg.QueryResult<pg.QueryResultRow>;
  try {
    result = await commitPromise;
  } catch (error) {
    if (error instanceof pg.DatabaseError) {
      throw error;
    }
    if (isQueryReadTimeout(error)) {
      throw toDatabaseCommitOutcomeUnknownError(error);
    }
    throw toDatabaseCommitBoundaryError(error);
  }

  if (result.command === "ROLLBACK") {
    throw new DatabaseTransactionRolledBackError(statementError);
  }
  if (result.command !== "COMMIT") {
    throw new Error(`PostgreSQL returned an unexpected transaction result. command=${result.command}`);
  }
}

function executeCallbackUntilDeadline<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
  executor: DatabaseExecutor,
  deadlineAtMs: number,
  closeExecutor: () => void,
  onDeadline: (error: DatabaseDeadlineExceededError) => void,
): Promise<Result> {
  return executePromiseUntilDeadline(
    async () => {
      try {
        const result = await callback(executor);
        closeExecutor();
        return result;
      } catch (error) {
        closeExecutor();
        throw error;
      }
    },
    deadlineAtMs,
    "transaction_callback",
    onDeadline,
  );
}

async function settleStartedExecutorOperations(
  pendingOperations: ReadonlySet<Promise<unknown>>,
  deadlineAtMs: number,
  onDeadline: (error: DatabaseDeadlineExceededError) => void,
): Promise<void> {
  const operations = [...pendingOperations];
  if (operations.length === 0) return;

  let firstError: unknown = null;
  let hasError = false;
  const settlementPromise = Promise.all(operations.map(async (operation) => {
    try {
      await operation;
    } catch (error) {
      if (!hasError) {
        firstError = error;
        hasError = true;
      }
    }
  }));

  await executePromiseUntilDeadline(
    async () => settlementPromise,
    deadlineAtMs,
    "executor_operations",
    onDeadline,
  );
  if (hasError) throw firstError;
}

export async function transactionWithPostgresDeadline<Result>(
  pool: pg.Pool,
  deadlineAtMs: number,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  validateDatabaseDeadline(deadlineAtMs);
  const client = await connectUntilDeadline(pool, deadlineAtMs);
  let releaseError: Error | undefined;
  let statementError: unknown | null = null;
  let executorAcceptingOperations = true;
  let executorFailureError: Error | null = null;
  const pendingExecutorOperations = new Set<Promise<unknown>>();
  const executorClosedError = new Error(
    "Database transaction executor cannot be used after its callback completes.",
  );
  const closeExecutor = (): void => {
    executorAcceptingOperations = false;
  };
  const failExecutor = (error: Error): void => {
    executorAcceptingOperations = false;
    executorFailureError = error;
  };
  try {
    try {
      await executeClientQuery(client, deadlineAtMs, "transaction_begin", "BEGIN", []);
    } catch (error) {
      releaseError = toReleaseError(error);
      throw error;
    }

    const executor: DatabaseExecutor = {
      query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        if (!executorAcceptingOperations) {
          const rejection = Promise.reject(executorFailureError ?? executorClosedError);
          void rejection.catch(() => {});
          return rejection;
        }

        const operation = (async (): Promise<pg.QueryResult<Row>> => {
          try {
            await configureTransactionTimeouts(client, deadlineAtMs);
            if (executorFailureError !== null) throw executorFailureError;
            return await executeClientQuery(client, deadlineAtMs, "statement", text, params);
          } catch (error) {
            statementError ??= error;
            throw error;
          }
        })();
        pendingExecutorOperations.add(operation);
        void operation.then(
          () => pendingExecutorOperations.delete(operation),
          () => pendingExecutorOperations.delete(operation),
        );
        return operation;
      },
    };

    let result!: Result;
    try {
      let callbackError: unknown = null;
      let hasCallbackError = false;
      try {
        result = await executeCallbackUntilDeadline(
          callback,
          executor,
          deadlineAtMs,
          closeExecutor,
          failExecutor,
        );
      } catch (error) {
        if (
          error instanceof DatabaseDeadlineExceededError
          && error.phase === "transaction_callback"
        ) {
          throw error;
        }
        callbackError = error;
        hasCallbackError = true;
      }

      let operationError: unknown = null;
      let hasOperationError = false;
      try {
        await settleStartedExecutorOperations(
          pendingExecutorOperations,
          deadlineAtMs,
          failExecutor,
        );
      } catch (error) {
        if (
          error instanceof DatabaseDeadlineExceededError
          && error.phase === "executor_operations"
        ) {
          throw error;
        }
        operationError = error;
        hasOperationError = true;
      }

      if (hasCallbackError) throw callbackError;
      if (hasOperationError) throw operationError;
      remainingTimeMs(deadlineAtMs, "before_commit");
    } catch (error) {
      closeExecutor();
      if (
        error instanceof DatabaseDeadlineExceededError
        && (
          error.phase === "transaction_callback"
          || error.phase === "executor_operations"
        )
      ) {
        failExecutor(error);
        releaseError = error;
        throw error;
      }
      if (Date.now() >= deadlineAtMs) {
        releaseError = toReleaseError(error);
        failExecutor(releaseError);
        throw error;
      }
      const rollbackError = await rollbackTransaction(client, deadlineAtMs);
      if (rollbackError !== null) {
        releaseError = toReleaseError(rollbackError);
        logDatabasePoolError("deadline-transaction-rollback", rollbackError);
      }
      throw error;
    }

    try {
      await executeCommit(client, deadlineAtMs, statementError);
    } catch (error) {
      if (!(error instanceof DatabaseTransactionRolledBackError)) {
        releaseError = toReleaseError(error);
      }
      throw error;
    }
    return result;
  } finally {
    client.release(releaseError);
  }
}

export async function queryWithPostgresDeadline<Row extends pg.QueryResultRow>(
  pool: pg.Pool,
  deadlineAtMs: number,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return transactionWithPostgresDeadline(
    pool,
    deadlineAtMs,
    async (executor) => executor.query<Row>(text, params),
  );
}
