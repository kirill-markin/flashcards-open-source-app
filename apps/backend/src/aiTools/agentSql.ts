import { HttpError } from "../shared/errors";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "./agentSql/operations";
import {
  parseSqlStatement,
  splitSqlStatements,
  type ParsedSqlStatement,
} from "./sqlDialect";
import { executeSqlMutationBatch } from "./agentSql/batchMutation";
import { executeSqlReadBatch, executeSqlReadStatement } from "./agentSql/readExecution";
import {
  isSqlMutationStatement,
  isSqlReadStatement,
  type AgentSqlContext,
  type AgentSqlExecutionResult,
} from "./agentSql/shared";
import { executeSqlMutationStatement } from "./agentSql/singleMutation";
import { MAX_SQL_BATCH_STATEMENT_COUNT, MAX_SQL_RESULT_CHARS } from "./toolContract/sqlToolLimits";

export type {
  AgentSqlExecutionResult,
  AgentSqlPayload,
} from "./agentSql/shared";

function buildInvalidSqlError(message: string): HttpError {
  return new HttpError(400, message, "QUERY_INVALID_SQL", {
    validationIssues: [{
      path: "sql",
      code: "invalid_sql",
      message,
    }],
  });
}

function parseSingleStatementSql(sql: string): ParsedSqlStatement {
  try {
    return parseSqlStatement(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw buildInvalidSqlError(message);
  }
}

function splitStatementSqls(sql: string): ReadonlyArray<string> {
  try {
    return splitSqlStatements(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw buildInvalidSqlError(message);
  }
}

function parseBatchStatements(statementSqls: ReadonlyArray<string>): ReadonlyArray<ParsedSqlStatement> {
  return statementSqls.map((statementSql, index) => {
    try {
      return parseSqlStatement(statementSql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw buildInvalidSqlError(`SQL batch statement ${index + 1} failed: ${message}`);
    }
  });
}

function parseSqlBatch(sql: string): ReadonlyArray<ParsedSqlStatement> {
  const statementSqls = splitStatementSqls(sql);

  if (statementSqls.length === 0) {
    throw buildInvalidSqlError("sql must not be empty");
  }

  if (statementSqls.length > MAX_SQL_BATCH_STATEMENT_COUNT) {
    throw buildInvalidSqlError(`SQL batch must contain at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements`);
  }

  if (statementSqls.length === 1) {
    return [parseSingleStatementSql(sql)];
  }

  return parseBatchStatements(statementSqls);
}

function toStatementSqls(sql: string, statements: ReadonlyArray<ParsedSqlStatement>): ReadonlyArray<string> {
  if (statements.length === 1) {
    return [sql];
  }

  return splitStatementSqls(sql);
}

/**
 * Single source of truth for the agent SQL result-size budget shared by both
 * the MCP surface (`sql_query` / `sql_execute`) and the REST surface
 * (`POST /agent/sql/query` / `POST /agent/sql/execute`).
 *
 * The agent envelope serializes `result.data`, so the budget is measured
 * against the serialized `data` payload. On overflow we fail with an actionable
 * error (matching the repo's "clear, actionable errors / no silent fallbacks"
 * principle) instead of returning a payload that exceeds the directory's
 * tool-result token limit. The remedies are concrete: narrow the result set.
 */
function assertSqlResultWithinSizeBudget<T extends AgentSqlExecutionResult>(result: T): T {
  const serializedLength = JSON.stringify(result.data).length;
  if (serializedLength > MAX_SQL_RESULT_CHARS) {
    throw new HttpError(
      400,
      `The result payload is too large (${serializedLength} characters, limit ${MAX_SQL_RESULT_CHARS}). Narrow the query and retry: add or lower LIMIT, SELECT fewer columns, or add WHERE filters to return fewer or smaller rows.`,
      "QUERY_RESULT_TOO_LARGE",
    );
  }

  return result;
}

export async function executeAgentSql(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  const statements = parseSqlBatch(sql);
  const statementSqls = toStatementSqls(sql, statements);

  if (statements.every(isSqlReadStatement)) {
    if (statements.length === 1) {
      return executeSqlReadStatement(dependencies, context, sql, statements[0]);
    }

    return executeSqlReadBatch(dependencies, context, sql, statements, statementSqls);
  }

  if (statements.every(isSqlMutationStatement)) {
    if (statements.length === 1) {
      return executeSqlMutationStatement(dependencies, context, sql, statements[0]);
    }

    return executeSqlMutationBatch(dependencies, context, sql, statements, statementSqls);
  }

  throw buildInvalidSqlError("SQL batch must contain only read statements or only mutation statements");
}

/**
 * Read-only entrypoint for the split external agent SQL surface (MCP
 * `sql_query` tool and `POST /agent/sql/query`). Parses the batch, rejects any
 * mutation with an actionable error that points at `sql_execute`, then runs the
 * existing read executors.
 *
 * The statement-direction parser guard below (`isSqlReadStatement`) is the
 * enforcement boundary for `readOnlyHint: true`.
 *
 * Deliberate deviation from the plan step "wrap the query path in a
 * `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, reusing the
 * `admin/reportingDb.ts` pattern" (defense-in-depth so read-only is enforced at
 * the DB layer, not just the parser). That pattern wraps a single dedicated
 * `pg.PoolClient`; it does NOT compose with this surface for two reasons, so it
 * is intentionally not applied here:
 *   1. The read executors flow through the per-operation repository layer
 *      (`listAgentCardsOperation`, `loadAgentWorkspaceOperation`, etc. in
 *      `agentSql/operations.ts`). Each repository call acquires its own pooled
 *      connection and runs its own transaction, so there is no single client to
 *      thread one enclosing `READ ONLY` transaction through.
 *   2. SELECT-backed reads perform legitimate FSRS repair-on-read writes
 *      (`queryCardsPage` -> `validateOrResetCardRowsForRead` -> `resetCardRow`
 *      issues `UPDATE content.cards`). A strict `READ ONLY` transaction would
 *      reject that repair with "cannot execute UPDATE in a read-only
 *      transaction" and break correct read behavior.
 * This comment is the record of that reviewed decision; enforcement therefore
 * stays at the parser-guard layer.
 */
export async function runSqlQuery(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  const statements = parseSqlBatch(sql);
  const statementSqls = toStatementSqls(sql, statements);

  if (statements.every(isSqlReadStatement)) {
    if (statements.length === 1) {
      return assertSqlResultWithinSizeBudget(
        await executeSqlReadStatement(dependencies, context, sql, statements[0]),
      );
    }

    return assertSqlResultWithinSizeBudget(
      await executeSqlReadBatch(dependencies, context, sql, statements, statementSqls),
    );
  }

  throw buildInvalidSqlError(
    "sql_query is read-only and accepts only SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT statements. Use sql_execute for INSERT, UPDATE, and DELETE.",
  );
}

/**
 * Write entrypoint for the split external agent SQL surface (MCP `sql_execute`
 * tool and `POST /agent/sql/execute`). Parses the batch, rejects any read with
 * an actionable error that points at `sql_query`, then runs the existing atomic
 * mutation executors.
 */
export async function runSqlExecute(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  const statements = parseSqlBatch(sql);
  const statementSqls = toStatementSqls(sql, statements);

  if (statements.every(isSqlMutationStatement)) {
    if (statements.length === 1) {
      return assertSqlResultWithinSizeBudget(
        await executeSqlMutationStatement(dependencies, context, sql, statements[0]),
      );
    }

    return assertSqlResultWithinSizeBudget(
      await executeSqlMutationBatch(dependencies, context, sql, statements, statementSqls),
    );
  }

  throw buildInvalidSqlError(
    "sql_execute is write-only and accepts only INSERT, UPDATE, and DELETE statements. Use sql_query for SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT.",
  );
}
