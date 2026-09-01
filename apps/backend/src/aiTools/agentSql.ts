import { createHash } from "node:crypto";
import { createAgentEnvelope } from "../agent/envelope";
import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../database";
import { getDatabaseErrorFields } from "../database/transient";
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
 * One execution's emitted result paired with the size the budget helpers below
 * measured for it, so telemetry records the payload the surface really sent
 * without measuring it a second, possibly different way.
 *
 * `resultChars` is null on the in-app chat surface, which builds no agent
 * envelope and therefore has no emitted envelope to measure.
 */
type AgentSqlEmission<Result extends AgentSqlExecutionResult> = Readonly<{
  result: Result;
  resultChars: number | null;
}>;

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
): AgentSqlEmission<T> {
  const resultChars = measureAgentSqlEnvelopeChars(result, requestUrl);
  if (resultChars > MAX_SQL_RESULT_CHARS) {
    throw new HttpError(
      400,
      `The result payload is too large (${resultChars} characters, limit ${MAX_SQL_RESULT_CHARS}). Narrow the query and retry: add or lower LIMIT, SELECT fewer columns, or add WHERE filters to return fewer or smaller rows.`,
      "QUERY_RESULT_TOO_LARGE",
    );
  }

  return { result, resultChars };
}

/**
 * Appended to the instructions of a committed write whose payload had to shrink,
 * so the model knows the rows are missing by design.
 */
const OMITTED_MUTATION_ROWS_INSTRUCTION =
  "The affected rows were omitted from this result because the payload exceeded the result-size budget. The write itself succeeded, so do not repeat it: a follow-up SELECT still recovers the rows an INSERT or UPDATE left in place, but the rows a DELETE removed are gone, so split the work into smaller batches to keep them next time.";

/**
 * Shrinks an oversized committed write result instead of rejecting it.
 *
 * `executeSqlMutationStatement` and `executeSqlMutationBatch` return after their
 * transaction committed, so answering with `QUERY_RESULT_TOO_LARGE` would report
 * a successful write as a failure and invite the caller to retry it and
 * duplicate the data. Only the returned rows are dropped; the counts, the echoed
 * SQL, and the atomicity contract stay intact, and `data.rowsOmitted` records
 * the reduction structurally so a model and our telemetry can both read it
 * without parsing the appended instruction prose.
 *
 * The rows are the only thing this reducer can drop, so a write that returned
 * none, such as a DELETE without a RETURNING clause, is emitted untouched with
 * `rowsOmitted: false` and a `resultChars` above the budget. The marker and the
 * appended prose report a reduction that happened, never the budget verdict
 * that asked for one, so they cannot claim rows the caller never had.
 */
function reduceMutationResultToSizeBudget(
  result: AgentSqlMutationExecutionResult,
  requestUrl: string,
): AgentSqlEmission<AgentSqlMutationExecutionResult> {
  const resultChars = measureAgentSqlEnvelopeChars(result, requestUrl);
  const hasRowsToDrop = result.data.rows.length > 0;
  if (resultChars <= MAX_SQL_RESULT_CHARS || !hasRowsToDrop) {
    return { result, resultChars };
  }

  const reducedResult: AgentSqlMutationExecutionResult = {
    data: {
      ...result.data,
      rows: [],
      rowsOmitted: true,
    },
    instructions: `${result.instructions} ${OMITTED_MUTATION_ROWS_INSTRUCTION}`,
  };

  return {
    result: reducedResult,
    resultChars: measureAgentSqlEnvelopeChars(reducedResult, requestUrl),
  };
}

/**
 * Batch counterpart of the reducer above. The reduction is all-or-nothing: the
 * budget covers the whole emitted payload, so every statement loses its rows
 * even when its own rows were small, and the single `data.rowsOmitted` marker
 * describes exactly that. A batch in which no statement returned a row is
 * emitted untouched for the same reason the single reducer leaves such a write
 * alone.
 */
function reduceBatchMutationResultToSizeBudget(
  result: AgentSqlBatchExecutionResult,
  requestUrl: string,
): AgentSqlEmission<AgentSqlBatchExecutionResult> {
  const resultChars = measureAgentSqlEnvelopeChars(result, requestUrl);
  const hasRowsToDrop = result.data.statements.some((statement) => statement.rows.length > 0);
  if (resultChars <= MAX_SQL_RESULT_CHARS || !hasRowsToDrop) {
    return { result, resultChars };
  }

  const reducedResult: AgentSqlBatchExecutionResult = {
    data: {
      ...result.data,
      statements: result.data.statements.map((statement) => ({
        ...statement,
        rows: [],
      })),
      rowsOmitted: true,
    },
    instructions: `${result.instructions} ${OMITTED_MUTATION_ROWS_INSTRUCTION}`,
  };

  return {
    result: reducedResult,
    resultChars: measureAgentSqlEnvelopeChars(reducedResult, requestUrl),
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

/**
 * Reads the payload's own omission marker. Read payloads carry none, and a read
 * never omits rows: it rejects an oversized result instead.
 */
function getAgentSqlRowsOmitted(payload: AgentSqlPayload): boolean {
  return "rowsOmitted" in payload ? payload.rowsOmitted : false;
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
 * Wall-clock budget for the database work of one agent SQL execution.
 *
 * Nothing else bounds how long an agent's statement runs: the dialect's row
 * limits bound what comes back, not the work it takes to get there. The
 * tightest surface such a statement reaches is MCP, whose Lambda is killed at
 * 30 s and whose HTTP API integration gives up at 29 s
 * (`infra/aws/lib/gateways/mcp-gateway.ts`), and a killed Lambda answers
 * nothing at all: the caller gets an opaque API Gateway 5xx, the `agent_sql`
 * record below is never written, and the invocation counts as a Lambda error.
 *
 * The 29 s is not all this budget's to spend, and what is left of it is the
 * value:
 *
 *   29 s  MCP integration timeout
 *   - 8 s post-commit analytics tail
 *   - 6 s cold start, token verification, envelope building and the response
 *   = 15 s
 *
 * The tail is the term this deadline cannot shorten. A write that commits then
 * drains the server facts it collected on the analytics pool, outside this
 * deadline and after the transaction returned, for up to the 4 s budget plus
 * one operation of up to 4 s already in flight
 * (`apps/backend/src/productAnalytics/serverFacts/postCommitBudget.ts`, which
 * sizes that ceiling against the same 29 s). Its wall time is therefore
 * additive: at 20 s this budget would leave a committing write about a second
 * of the request for everything else, which is the killed Lambda again.
 *
 * The 6 s is the rest of one MCP request: a VPC cold start that loads a secret
 * and opens a TLS connection to Postgres, OAuth token verification, SQL
 * parsing, and the envelope and JSON response after the statement. Far above
 * what a warm invocation spends, and well under the 10 s the direct image
 * ingestion route reserves for its own on-demand init
 * (`directImageIngestionMaximumOnDemandInitSeconds`), whose Lambda carries the
 * sharp bundle this one does not.
 *
 * What the value costs, stated rather than hidden. Against a median execution
 * of 80 ms, the slowest this surface has served were a five-statement batch at
 * 17.0 s and a SELECT returning four rows at 13.8 s, whose cost is the scan
 * behind the rows and not the rows. Both were measured before this deadline,
 * and the deadline is not free: publishing one moves the execution onto the
 * `deadline.ts` executor, which re-arms `statement_timeout` and `lock_timeout`
 * against the remaining budget before every statement, so each executor query
 * costs a second round trip. Their number follows rows touched rather than the
 * caller's statement count - one affected row on the mutation path is four
 * executor queries, so a full `MAX_SQL_BATCH_STATEMENT_COUNT` x
 * `MAX_SQL_RECORD_LIMIT` batch is tens of thousands of them. Less therefore
 * fits under 15 s than those two wall times suggest: the batch ends in the
 * error below instead of answering, and the SELECT is marginal at best. That is
 * the intent - both are on the same curve as the two executions that reached
 * 30 s and killed the Lambda - and raising the value to keep them is what the
 * arithmetic above forbids. Re-arming once per transaction would buy the cost
 * back and is deliberately not done: a timeout armed at transaction start with
 * the whole budget lets a late statement outlive the deadline on the server,
 * which is the runaway this exists to prevent.
 */
const AGENT_SQL_DATABASE_TIME_BUDGET_MS = 15_000;

// Bounds the cause walk below, which follows errors this process wrapped rather than any input, so
// the real chains are one or two links long. The bound only keeps a cyclic `cause` from hanging a
// request thread.
const AGENT_SQL_ERROR_CAUSE_MAX_DEPTH = 8;

function matchesDatabaseTimeBudgetExpiry(error: unknown): boolean {
  if (error instanceof DatabaseDeadlineExceededError) {
    return true;
  }

  const { sqlState } = getDatabaseErrorFields(error);
  return sqlState === "57014" || sqlState === "55P03";
}

/**
 * Recognizes every way that budget expires. One deadline becomes three bounds
 * in `apps/backend/src/database/deadline.ts`: a client-side timer, a Postgres
 * `statement_timeout`, and a `lock_timeout` derived from the same deadline. So
 * the same expiry arrives as a `DatabaseDeadlineExceededError`, as SQLSTATE
 * 57014, or as SQLSTATE 55P03, depending on which of them fired first.
 *
 * The cause chain is walked because a batch reaches this through
 * `wrapBatchExecutionError`, which reports which statement failed and keeps the
 * failure it wraps as the `cause`. Reading only the outermost error would
 * classify every batch expiry as an unexpected server error, on the very shape
 * that spends the most time.
 */
function isAgentSqlDatabaseTimeBudgetExpiry(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < AGENT_SQL_ERROR_CAUSE_MAX_DEPTH; depth += 1) {
    if (matchesDatabaseTimeBudgetExpiry(current)) {
      return true;
    }
    if (!(current instanceof Error)) {
      return false;
    }
    current = current.cause;
  }

  return false;
}

/**
 * Keeps whatever context wrapped the expiry in front of the remedy. For a batch
 * that context is `wrapBatchExecutionError`'s `SQL batch statement N failed`,
 * the only thing that says which statement of the batch spent the budget, and
 * the locator every other batch failure on this surface already carries. It is
 * dropped when the expiry is the outermost error, where the driver's own
 * wording says nothing the remedy does not.
 *
 * That context can quote the caller's own SQL back to them, which is fine here
 * and is why the `agent_sql` record deliberately carries no message at all.
 */
function buildDatabaseTimeBudgetExpiryMessage(error: unknown): string {
  const remedy = `The statement exceeded the ${AGENT_SQL_DATABASE_TIME_BUDGET_MS} ms database time budget and was cancelled, so it changed nothing. Narrow the work and retry: add or lower LIMIT, add WHERE filters to touch fewer rows, or split a batch into fewer statements.`;
  if (matchesDatabaseTimeBudgetExpiry(error)) {
    return remedy;
  }

  const context = error instanceof Error ? error.message : String(error);
  return `${context} ${remedy}`;
}

/**
 * Runs one execution's database work under the budget above and reports an
 * expired budget the way the result-size budget reports an oversized payload:
 * an actionable 400 naming the limit, rather than the opaque INTERNAL_ERROR
 * that an unmapped driver error becomes on both the MCP and the REST surface.
 * Nothing survives the cancellation, since the statement takes its transaction
 * down with it, so the caller is told to narrow the work rather than to go and
 * check what landed.
 */
async function executeWithinDatabaseTimeBudget<Result extends AgentSqlExecutionResult>(
  execute: () => Promise<AgentSqlEmission<Result>>,
): Promise<AgentSqlEmission<Result>> {
  try {
    return await runDatabaseOperationsWithDeadline(
      Date.now() + AGENT_SQL_DATABASE_TIME_BUDGET_MS,
      execute,
    );
  } catch (error) {
    if (!isAgentSqlDatabaseTimeBudgetExpiry(error)) {
      throw error;
    }

    throw new HttpError(
      400,
      buildDatabaseTimeBudgetExpiryMessage(error),
      "QUERY_TIME_LIMIT_EXCEEDED",
    );
  }
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
    const { result, resultChars } = await executeWithinDatabaseTimeBudget(execute);
    logAgentSqlEvent({
      ...executionDetails,
      succeeded: true,
      statementType: result.data.statementType,
      resource: result.data.resource,
      statementCount: getAgentSqlStatementCount(result.data),
      rowOrAffectedCount: getAgentSqlRowOrAffectedCount(result.data),
      resultChars,
      rowsOmitted: getAgentSqlRowsOmitted(result.data),
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
      durationMs: Date.now() - startedAt,
      errorCode: getAgentSqlErrorCode(error),
      dialectReason: getAgentSqlDialectReason(error),
      errorClass: getAgentSqlErrorClass(error),
    });

    throw error;
  }
}

async function executeAgentSqlStatements(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
): Promise<AgentSqlExecutionResult> {
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
 * Combined entrypoint for the in-app chat `sql` tool. It builds no agent
 * envelope and has no result-size budget of its own (the chat surface truncates
 * the tool output separately), so it reports no emitted size.
 */
export async function executeAgentSql(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => ({
    result: await executeAgentSqlStatements(dependencies, context, sql),
    resultChars: null,
  }));
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
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => {
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
  return withAgentSqlTelemetry(context, sql, async (): Promise<AgentSqlEmission<AgentSqlExecutionResult>> => {
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
