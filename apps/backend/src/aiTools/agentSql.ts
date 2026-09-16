import { createHash } from "node:crypto";
import { HttpError } from "../shared/errors";
import { logAgentSqlEvent } from "../server/logging";
import { executeWithinAgentSqlDatabaseTimeBudget } from "./agentSql/databaseTimeBudget";
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
  assertSqlResultWithinSizeBudget,
  reduceBatchMutationResultToSizeBudget,
  reduceMutationResultToSizeBudget,
  truncateReadResultToSizeBudget,
  type AgentSqlEmission,
} from "./agentSql/resultBudget";
import {
  isSqlMutationStatement,
  isSqlReadStatement,
  type AgentSqlContext,
  type AgentSqlExecutionResult,
  type AgentSqlMutationStatement,
  type AgentSqlPayload,
  type AgentSqlReadStatement,
  type AgentSqlSinglePayload,
} from "./agentSql/shared";
import { executeSqlMutationStatement } from "./agentSql/singleMutation";
import { buildInvalidSqlError } from "./sqlErrors";
import { MAX_SQL_BATCH_STATEMENT_COUNT } from "./toolContract/sqlToolLimits";

export type {
  AgentSqlExecutionResult,
  AgentSqlPayload,
} from "./agentSql/shared";

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

function getAgentSqlFingerprint(sql: string): string {
  return createHash("sha256")
    .update(sql)
    .digest("hex");
}

function getSingleStatementRowOrAffectedCount(payload: AgentSqlSinglePayload): number {
  return "rowCount" in payload ? payload.rowCount : payload.affectedCount;
}

function getAgentSqlRowOrAffectedCount(payload: AgentSqlPayload): number {
  if (payload.statementType === "batch") {
    return payload.statements.reduce(
      (total, statement) => total + getSingleStatementRowOrAffectedCount(statement),
      0,
    );
  }

  return getSingleStatementRowOrAffectedCount(payload);
}

function getAgentSqlStatementCount(payload: AgentSqlPayload): number {
  return payload.statementType === "batch" ? payload.statementCount : 1;
}

/**
 * Reads the payload's own omission marker. Read payloads carry none, because no
 * read drops all of its rows: an oversized single `SELECT` keeps the rows that
 * fit and marks itself `data.rowsTruncated`, which `getAgentSqlRowsTruncated`
 * below records separately, whenever dropping rows leaves at least one row that
 * fits, and every other oversized read is rejected on the MCP and REST
 * surfaces, while the chat surface caps its tool output instead of rejecting.
 */
function getAgentSqlRowsOmitted(payload: AgentSqlPayload): boolean {
  return "rowsOmitted" in payload ? payload.rowsOmitted : false;
}

/**
 * Reads the payload's own truncation marker, the read counterpart of
 * `getAgentSqlRowsOmitted` above.
 *
 * Only a single read payload carries the marker, so a mutation and a batch
 * record `null` rather than `false`: neither can be truncated, and `false`
 * there would read as a payload that was measured and kept whole.
 */
function getAgentSqlRowsTruncated(payload: AgentSqlPayload): boolean | null {
  return "rowsTruncated" in payload ? payload.rowsTruncated : null;
}

function getAgentSqlErrorCode(error: unknown): string | null {
  return error instanceof HttpError ? error.code : null;
}

/**
 * Reads the dialect's reason for a rejection defensively: the first validation
 * issue code carried by the failure, treated as an opaque value. The dialect
 * owns that vocabulary (today it is one constant everywhere, later it will be
 * specific), so nothing here may depend on which values appear.
 */
function getAgentSqlDialectReason(error: unknown): string | null {
  if (error instanceof HttpError) {
    const validationIssues = error.details?.validationIssues ?? [];
    return validationIssues.length === 0 ? null : validationIssues[0].code;
  }

  return null;
}

/**
 * Reads the same minification-safe `error.name` that `getBackendErrorLogDetails`
 * records. The constructor binding is not usable here: backend Lambdas are
 * bundled with esbuild `minify: true` and no `keepNames`, so `constructor.name`
 * would be a mangled label that changes between deploys.
 */
function getAgentSqlErrorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Emits exactly one structured `agent_sql` record per execution, on success and
 * on failure alike, so the failure ratio of the agent SQL surface is computable
 * per surface and per caller instead of being invisible.
 *
 * It must stay wrapped around the executor bodies below, i.e. *inside*
 * `runSqlQuery` / `runSqlExecute` / `runChatSqlQuery` / `runChatSqlExecute`. The MCP tool handlers in
 * `apps/backend/src/mcp/server.ts` catch their own errors and answer with a
 * `CallToolResult`, so nothing above them ever reaches `app.onError`; anything
 * recorded higher up would leave every MCP dialect rejection unobserved, which
 * is the blind spot this exists to close.
 *
 * The record carries no error message on purpose. Dialect and batch errors quote
 * the offending SQL fragment verbatim, so the text carries flashcard content,
 * and no delimiter heuristic can strip it reliably: an unquoted or typographic
 * operand (`... WHERE front_text = Paris`) has no delimiter to find. Only the
 * low-cardinality dimensions below are recorded, and unexpected failures still
 * reach Sentry with their full message and stack through
 * `captureBackendException`, so nothing debuggable is lost.
 *
 * `execute` hands over the emitted result together with the size the budget
 * helpers already measured for it, so `resultChars` is the size of the payload
 * the surface really sent and can never drift from the size the guard enforces.
 *
 * The wrapped execution is also the one place every agent SQL surface passes
 * through, so it is where the database time budget is applied. It bounds the
 * database work of the execution, not `durationMs`, which is measured from here
 * and so also covers the post-commit server-facts drain that the budget
 * deliberately leaves outside itself: a committing write is legitimately
 * recorded above the budget by that tail. An execution the budget cancels is
 * recorded here as a failure like any other. Nothing else is changed on the way
 * through.
 */
async function withAgentSqlTelemetry<Result extends AgentSqlExecutionResult>(
  context: AgentSqlContext,
  sql: string,
  execute: () => Promise<AgentSqlEmission<Result>>,
): Promise<Result> {
  const startedAt = Date.now();
  const executionDetails = {
    userId: context.userId,
    workspaceId: context.workspaceId,
    surface: context.surface,
    caller: context.caller ?? null,
    connectionId: context.connectionId,
    sqlLength: sql.length,
    sqlFingerprint: getAgentSqlFingerprint(sql),
  };

  try {
    const { result, resultChars } = await executeWithinAgentSqlDatabaseTimeBudget(execute);
    logAgentSqlEvent({
      ...executionDetails,
      succeeded: true,
      statementType: result.data.statementType,
      resource: result.data.resource,
      statementCount: getAgentSqlStatementCount(result.data),
      rowOrAffectedCount: getAgentSqlRowOrAffectedCount(result.data),
      resultChars,
      rowsOmitted: getAgentSqlRowsOmitted(result.data),
      rowsTruncated: getAgentSqlRowsTruncated(result.data),
      durationMs: Date.now() - startedAt,
      errorCode: null,
      dialectReason: null,
      errorClass: null,
    });

    return result;
  } catch (error) {
    logAgentSqlEvent({
      ...executionDetails,
      succeeded: false,
      statementType: null,
      resource: null,
      statementCount: null,
      rowOrAffectedCount: null,
      resultChars: null,
      rowsOmitted: null,
      rowsTruncated: null,
      durationMs: Date.now() - startedAt,
      errorCode: getAgentSqlErrorCode(error),
      dialectReason: getAgentSqlDialectReason(error),
      errorClass: getAgentSqlErrorClass(error),
    });

    throw error;
  }
}

function parseSqlQueryBatch(sql: string): ReadonlyArray<AgentSqlReadStatement> {
  const statements = parseSqlBatch(sql);
  if (statements.every(isSqlReadStatement)) {
    return statements;
  }

  throw buildInvalidSqlError(
    "sql_query is read-only and accepts only SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT statements. Use sql_execute for INSERT, UPDATE, and DELETE.",
  );
}

function parseSqlExecuteBatch(sql: string): ReadonlyArray<AgentSqlMutationStatement> {
  const statements = parseSqlBatch(sql);
  if (statements.every(isSqlMutationStatement)) {
    return statements;
  }

  throw buildInvalidSqlError(
    "sql_execute is write-only and accepts only INSERT, UPDATE, and DELETE statements. Use sql_query for SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT.",
  );
}

/**
 * Read entrypoint for the in-app chat `sql_query` tool: the direction rule of
 * `runSqlQuery` without its result-size budget, because the chat caps its own
 * tool output in `apps/backend/src/chat/openai/tools/toolResults.ts`, so it builds no
 * agent envelope and reports no emitted size.
 */
export async function runChatSqlQuery(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies,
) {
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => {
    const statements = parseSqlQueryBatch(sql);

    return {
      result: statements.length === 1
        ? await executeSqlReadStatement(dependencies, context, sql, statements[0])
        : await executeSqlReadBatch(dependencies, context, sql, statements, toStatementSqls(sql, statements)),
      resultChars: null,
    };
  });
}

/**
 * Write entrypoint for the in-app chat `sql_execute` tool: the direction rule
 * of `runSqlExecute` without its result-size budget, for the same reason as
 * `runChatSqlQuery`.
 */
export async function runChatSqlExecute(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies,
) {
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => {
    const statements = parseSqlExecuteBatch(sql);

    return {
      result: statements.length === 1
        ? await executeSqlMutationStatement(dependencies, context, sql, statements[0])
        : await executeSqlMutationBatch(dependencies, context, sql, statements, toStatementSqls(sql, statements)),
      resultChars: null,
    };
  });
}

/**
 * Read-only entrypoint for the split external agent SQL surface (MCP
 * `sql_query` tool and `POST /agent/sql/query`). Parses the batch, rejects any
 * mutation with an actionable error that points at `sql_execute`, then runs the
 * existing read executors.
 *
 * `requestUrl` is the URL the calling surface builds its agent envelope from,
 * needed here so the result-size budget measures the emitted envelope.
 *
 * The statement-direction parser guard (`parseSqlQueryBatch`) rejects
 * caller-authored writes. The repository read helpers reached from SELECT
 * statements also open repeatable-read `READ ONLY` transactions, so the
 * `readOnlyHint: true` annotation has a database-level guard as defense in
 * depth.
 */
export async function runSqlQuery(
  context: AgentSqlContext,
  sql: string,
  requestUrl: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => {
    const statements = parseSqlQueryBatch(sql);
    const statementSqls = toStatementSqls(sql, statements);

    if (statements.length === 1) {
      return truncateReadResultToSizeBudget(
        await executeSqlReadStatement(dependencies, context, sql, statements[0]),
        requestUrl,
      );
    }

    return assertSqlResultWithinSizeBudget(
      await executeSqlReadBatch(dependencies, context, sql, statements, statementSqls),
      requestUrl,
    );
  });
}

/**
 * Write entrypoint for the split external agent SQL surface (MCP `sql_execute`
 * tool and `POST /agent/sql/execute`). Parses the batch, rejects any read with
 * an actionable error that points at `sql_query`, then runs the existing atomic
 * mutation executors.
 *
 * `requestUrl` is the URL the calling surface builds its agent envelope from,
 * needed here so the result-size budget measures the emitted envelope.
 */
export async function runSqlExecute(
  context: AgentSqlContext,
  sql: string,
  requestUrl: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => {
    const statements = parseSqlExecuteBatch(sql);
    const statementSqls = toStatementSqls(sql, statements);

    if (statements.length === 1) {
      return reduceMutationResultToSizeBudget(
        await executeSqlMutationStatement(dependencies, context, sql, statements[0]),
        requestUrl,
      );
    }

    return reduceBatchMutationResultToSizeBudget(
      await executeSqlMutationBatch(dependencies, context, sql, statements, statementSqls),
      requestUrl,
    );
  });
}
