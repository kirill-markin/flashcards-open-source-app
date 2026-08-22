import { createHash } from "node:crypto";
import { createAgentEnvelope } from "../agent/envelope";
import { HttpError } from "../shared/errors";
import { logAgentSqlEvent } from "../server/logging";
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
  type AgentSqlBatchExecutionResult,
  type AgentSqlContext,
  type AgentSqlExecutionResult,
  type AgentSqlMutationExecutionResult,
  type AgentSqlPayload,
  type AgentSqlSinglePayload,
} from "./agentSql/shared";
import { executeSqlMutationStatement } from "./agentSql/singleMutation";
import { buildInvalidSqlError } from "./sqlErrors";
import { MAX_SQL_BATCH_STATEMENT_COUNT, MAX_SQL_RESULT_CHARS } from "./toolContract/sqlToolLimits";

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

/**
 * Measures what a surface actually emits for a result.
 *
 * The MCP tools (`buildToolResultText` in apps/backend/src/mcp/server.ts) and
 * the REST routes (Hono `context.json` in apps/backend/src/routes/agent.ts)
 * both send `JSON.stringify` of the `createAgentEnvelope` object, so building
 * the same envelope here is the one measurement both surfaces are bound by.
 */
function measureAgentSqlEnvelopeChars(result: AgentSqlExecutionResult, requestUrl: string): number {
  return JSON.stringify(createAgentEnvelope(requestUrl, result.data, result.instructions)).length;
}

/**
 * Read-path result-size budget shared by the MCP surface (`sql_query`) and the
 * REST surface (`POST /agent/sql/query`).
 *
 * On overflow we fail with an actionable error (matching the repo's "clear,
 * actionable errors / no silent fallbacks" principle) instead of returning a
 * payload that exceeds the directory's tool-result token limit. Nothing is
 * committed on a read, and the remedies are concrete: narrow the result set.
 *
 * Writes must never reach this: their transaction is already committed when the
 * size is measured, so they drop rows instead (see the reducers below).
 */
function assertSqlResultWithinSizeBudget<T extends AgentSqlExecutionResult>(
  result: T,
  requestUrl: string,
): T {
  const serializedLength = measureAgentSqlEnvelopeChars(result, requestUrl);
  if (serializedLength > MAX_SQL_RESULT_CHARS) {
    throw new HttpError(
      400,
      `The result payload is too large (${serializedLength} characters, limit ${MAX_SQL_RESULT_CHARS}). Narrow the query and retry: add or lower LIMIT, SELECT fewer columns, or add WHERE filters to return fewer or smaller rows.`,
      "QUERY_RESULT_TOO_LARGE",
    );
  }

  return result;
}

/**
 * Appended to the instructions of a committed write whose payload had to shrink,
 * so the model knows the rows are missing by design and how to get them.
 */
const OMITTED_MUTATION_ROWS_INSTRUCTION =
  "The affected rows were omitted from this result because the payload exceeded the result-size budget. The write itself succeeded, so do not repeat it: run a follow-up SELECT query if you need the affected rows.";

/**
 * Shrinks an oversized committed write result instead of rejecting it.
 *
 * `executeSqlMutationStatement` and `executeSqlMutationBatch` return after their
 * transaction committed, so answering with `QUERY_RESULT_TOO_LARGE` would report
 * a successful write as a failure and invite the caller to retry it and
 * duplicate the data. Only the returned rows are dropped; the counts, the echoed
 * SQL, and the atomicity contract stay intact.
 */
function reduceMutationResultToSizeBudget(
  result: AgentSqlMutationExecutionResult,
  requestUrl: string,
): AgentSqlMutationExecutionResult {
  if (measureAgentSqlEnvelopeChars(result, requestUrl) <= MAX_SQL_RESULT_CHARS) {
    return result;
  }

  return {
    data: {
      ...result.data,
      rows: [],
    },
    instructions: `${result.instructions} ${OMITTED_MUTATION_ROWS_INSTRUCTION}`,
  };
}

function reduceBatchMutationResultToSizeBudget(
  result: AgentSqlBatchExecutionResult,
  requestUrl: string,
): AgentSqlBatchExecutionResult {
  if (measureAgentSqlEnvelopeChars(result, requestUrl) <= MAX_SQL_RESULT_CHARS) {
    return result;
  }

  return {
    data: {
      ...result.data,
      statements: result.data.statements.map((statement) => ({
        ...statement,
        rows: [],
      })),
    },
    instructions: `${result.instructions} ${OMITTED_MUTATION_ROWS_INSTRUCTION}`,
  };
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
 * `executeAgentSql` / `runSqlQuery` / `runSqlExecute`. The MCP tool handlers in
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
 * Instrumentation only: the caller's result is returned and the caller's error
 * is rethrown untouched.
 */
async function withAgentSqlTelemetry<Result extends AgentSqlExecutionResult>(
  context: AgentSqlContext,
  sql: string,
  execute: () => Promise<Result>,
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
    const result = await execute();
    logAgentSqlEvent({
      ...executionDetails,
      succeeded: true,
      statementType: result.data.statementType,
      resource: result.data.resource,
      statementCount: getAgentSqlStatementCount(result.data),
      rowOrAffectedCount: getAgentSqlRowOrAffectedCount(result.data),
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
      durationMs: Date.now() - startedAt,
      errorCode: getAgentSqlErrorCode(error),
      dialectReason: getAgentSqlDialectReason(error),
      errorClass: getAgentSqlErrorClass(error),
    });

    throw error;
  }
}

export async function executeAgentSql(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  return withAgentSqlTelemetry(context, sql, async () => {
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
 * The statement-direction parser guard below (`isSqlReadStatement`) rejects
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
  return withAgentSqlTelemetry(context, sql, async () => {
    const statements = parseSqlBatch(sql);
    const statementSqls = toStatementSqls(sql, statements);

    if (statements.every(isSqlReadStatement)) {
      if (statements.length === 1) {
        return assertSqlResultWithinSizeBudget(
          await executeSqlReadStatement(dependencies, context, sql, statements[0]),
          requestUrl,
        );
      }

      return assertSqlResultWithinSizeBudget(
        await executeSqlReadBatch(dependencies, context, sql, statements, statementSqls),
        requestUrl,
      );
    }

    throw buildInvalidSqlError(
      "sql_query is read-only and accepts only SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT statements. Use sql_execute for INSERT, UPDATE, and DELETE.",
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
  return withAgentSqlTelemetry(context, sql, async () => {
    const statements = parseSqlBatch(sql);
    const statementSqls = toStatementSqls(sql, statements);

    if (statements.every(isSqlMutationStatement)) {
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
    }

    throw buildInvalidSqlError(
      "sql_execute is write-only and accepts only INSERT, UPDATE, and DELETE statements. Use sql_query for SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT.",
    );
  });
}
