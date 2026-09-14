import { createHash } from "node:crypto";
import { createAgentEnvelope } from "../agent/envelope";
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
  buildReadInstructions,
  isSqlMutationStatement,
  isSqlReadStatement,
  previewSqlStatement,
  type AgentSqlBatchExecutionResult,
  type AgentSqlContext,
  type AgentSqlExecutionResult,
  type AgentSqlMutationExecutionResult,
  type AgentSqlPayload,
  type AgentSqlReadExecutionResult,
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
 * This is the rejecting form, and it stays the answer for every read that
 * cannot be partial, among them a read batch, where dropping rows would mean
 * picking which statement loses them, and `SHOW TABLES` and `DESCRIBE`, whose
 * payloads are small and whose truncated schema listing would be worse than an
 * error. Only a single `SELECT` can come back partial; every other single
 * read enters `truncateReadResultToSizeBudget` below and is handed
 * straight back here. That `SELECT` comes back partial whenever dropping
 * rows leaves at least one row that fits, and rejects with a message of
 * its own when no row count leaves one. Nothing is committed on a read
 * either way, and the remedies here are concrete: narrow the result set, or
 * split the batch.
 *
 * Writes must never reach this: their transaction is already committed when the
 * size is measured, so they shrink the emitted payload instead (see the
 * reducers below).
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
 * Rebuilds a `SELECT` result around the first `rowCount` of its rows, marked as
 * the partial answer it now is.
 *
 * Only the rows shrink. `totalRowCount` keeps reporting everything the statement
 * produced after WHERE, UNNEST, and any GROUP BY, which is what makes the
 * partial answer judgeable, and `hasMore` becomes true because dropping at least
 * one row always leaves rows a larger `OFFSET` can still read.
 *
 * The instructions are rebuilt rather than appended to: `buildReadInstructions`
 * is where the read contract is stated, and a truncated read needs the truncated
 * wording of that same sentence rather than a second one contradicting it.
 */
function takeSelectRowPrefix(
  result: AgentSqlReadExecutionResult,
  rowCount: number,
): AgentSqlReadExecutionResult {
  const rows = result.data.rows.slice(0, rowCount);

  return {
    data: {
      ...result.data,
      rows,
      rowCount: rows.length,
      rowsTruncated: true,
      hasMore: true,
    },
    instructions: buildReadInstructions("select", true, true),
  };
}

/**
 * The rejection a `SELECT` with rows takes when dropping rows never leaves at
 * least one row that fits: one row does not fit the budget on its own, so no
 * row count reaches it.
 *
 * It carries its own message rather than the generic one, because a size
 * reported without saying it was measured on one row reads as the whole
 * result's size, and because the generic remedies point the wrong way here: a
 * smaller LIMIT only reduces the row count, while the offending row is always
 * the first of the requested page, so stepping past it - a larger OFFSET, or a
 * WHERE filter that excludes it - is what usually lets the caller read on. The
 * message hedges that step for both of the reasons it names: the next row can
 * be over budget too, and this rejection also fires when the echoed statement
 * rather than the row fills the budget, where stepping past changes nothing and
 * only shortening the statement helps. The `QUERY_RESULT_TOO_LARGE` code is
 * kept so existing telemetry queries still match.
 */
function rejectOversizedSingleSelectRow(singleRowChars: number): never {
  throw new HttpError(
    400,
    `A single row of this result is too large to return, or the submitted statement fills the budget by itself (${singleRowChars} characters measured on the smallest answer this query has, limit ${MAX_SQL_RESULT_CHARS}). It is the first row of the page you asked for, so a smaller LIMIT cannot help, but stepping past it usually does: repeat the same query, with the same ORDER BY, at an OFFSET one larger than this query's (OFFSET 1 when it had none), or add a WHERE filter that excludes this row, and the rows after it come back normally when they are smaller; if the next row is also over budget, or the submitted statement is what fills it, the same error repeats. To read the row itself, SELECT fewer or narrower columns, leaving out long text columns such as back_text, or shorten the text stored in the row. A very long submitted statement counts toward the same budget, so shorten the statement when it is a large one.`,
    "QUERY_RESULT_TOO_LARGE",
  );
}

/**
 * Emits the largest leading prefix of an oversized single `SELECT` that fits the
 * result-size budget, instead of rejecting the read outright.
 *
 * A rejection leaves the caller guessing a narrower query from nothing; a
 * partial answer carrying `data.rowsTruncated` and `data.totalRowCount` lets it
 * decide whether what it already received is enough. Nothing is committed on a
 * read, so a partial answer costs only the rows it does not carry, all of which
 * a larger `OFFSET` still reaches.
 *
 * The prefix is found by binary search over the row count rather than by
 * predicting where to cut: serialized size grows monotonically with the prefix
 * length, so the search finds the exact largest fitting prefix, and a handful of
 * measurement passes on a payload that is already an outlier is cheaper than
 * being clever about it.
 *
 * The rule the branches below implement: a single `SELECT` is truncated to the
 * rows that fit whenever dropping rows leaves at least one row that fits, and
 * every other oversized read is rejected. A truncated answer therefore always
 * carries at least one row, so the caller can see the shape of the data.
 *
 * Of the rejections, a `SELECT` that did return rows but that no row count
 * brings under the budget goes through `rejectOversizedSingleSelectRow`,
 * measured on the one-row payload it would have been emitted in: the size of
 * the smallest answer this query has is what tells the caller the rows
 * themselves are too large and that no smaller row count would have helped.
 * Every other one takes the generic message of
 * `assertSqlResultWithinSizeBudget`.
 */
function truncateReadResultToSizeBudget(
  result: AgentSqlReadExecutionResult,
  requestUrl: string,
): AgentSqlEmission<AgentSqlReadExecutionResult> {
  const resultChars = measureAgentSqlEnvelopeChars(result, requestUrl);
  if (resultChars <= MAX_SQL_RESULT_CHARS) {
    return { result, resultChars };
  }

  if (result.data.statementType !== "select" || result.data.rows.length === 0) {
    return assertSqlResultWithinSizeBudget(result, requestUrl);
  }

  if (result.data.rows.length === 1) {
    rejectOversizedSingleSelectRow(resultChars);
  }

  let lowestRowCount = 1;
  let highestRowCount = result.data.rows.length - 1;
  let largestFitting: AgentSqlEmission<AgentSqlReadExecutionResult> | null = null;

  while (lowestRowCount <= highestRowCount) {
    const candidateRowCount = Math.floor((lowestRowCount + highestRowCount) / 2);
    const candidate = takeSelectRowPrefix(result, candidateRowCount);
    const candidateChars = measureAgentSqlEnvelopeChars(candidate, requestUrl);
    if (candidateChars <= MAX_SQL_RESULT_CHARS) {
      largestFitting = { result: candidate, resultChars: candidateChars };
      lowestRowCount = candidateRowCount + 1;
    } else {
      highestRowCount = candidateRowCount - 1;
    }
  }

  if (largestFitting === null) {
    rejectOversizedSingleSelectRow(
      measureAgentSqlEnvelopeChars(takeSelectRowPrefix(result, 1), requestUrl),
    );
  }

  return largestFitting;
}

/**
 * Appended to the instructions of a committed write whose returned rows had to
 * be dropped, so the model knows they are missing by design.
 */
const OMITTED_MUTATION_ROWS_INSTRUCTION =
  "The affected rows were omitted from this result because the payload exceeded the result-size budget. The write itself succeeded, so do not repeat it: a follow-up SELECT still recovers the rows an INSERT or UPDATE left in place, but the rows a DELETE removed are gone, so split the work into smaller batches to keep them next time.";

/**
 * Appended to the instructions of a committed write whose echoed statement text
 * had to shrink, so the model does not read the preview back as the statement
 * that ran.
 */
const OMITTED_MUTATION_SQL_INSTRUCTION =
  "The echoed statement text in data.sql and data.normalizedSql was shortened where it exceeded the preview length, because the payload exceeded the result-size budget. The write itself succeeded and the statement that ran is unchanged, so do not repeat it.";

/**
 * The reducers' first lever: it replaces the echoed statement text with a
 * preview. The echo is text the caller itself submitted and still holds, so
 * shortening it discards nothing the caller cannot reproduce, which is why it
 * runs before the returned rows are dropped. It is also the only lever a
 * committed write whose own SQL dominates the payload has, such as a long
 * DELETE without a RETURNING clause, or a batch of them, which returns no rows.
 *
 * A field that already fits the preview length keeps the submitted statement in
 * full, so the lever shortens the echo where it is long rather than both fields
 * alike.
 *
 * Only the echo shrinks: the statement that ran is the submitted one, which is
 * why `data.sqlOmitted` and the appended instruction exist to keep a model from
 * reading the preview back as the statement it sent.
 */
function shortenMutationSqlEcho(
  result: AgentSqlMutationExecutionResult,
): AgentSqlMutationExecutionResult {
  return {
    data: {
      ...result.data,
      sql: previewSqlStatement(result.data.sql),
      normalizedSql: previewSqlStatement(result.data.normalizedSql),
      sqlOmitted: true,
    },
    instructions: `${result.instructions} ${OMITTED_MUTATION_SQL_INSTRUCTION}`,
  };
}

/**
 * Batch counterpart of the lever above. A batch echoes the submitted SQL in the
 * same two top-level fields, so it shrinks the same way.
 */
function shortenBatchSqlEcho(
  result: AgentSqlBatchExecutionResult,
): AgentSqlBatchExecutionResult {
  return {
    data: {
      ...result.data,
      sql: previewSqlStatement(result.data.sql),
      normalizedSql: previewSqlStatement(result.data.normalizedSql),
      sqlOmitted: true,
    },
    instructions: `${result.instructions} ${OMITTED_MUTATION_SQL_INSTRUCTION}`,
  };
}

/**
 * Applies the echo lever only when it measurably shrinks the emitted payload,
 * and reports the size measured on whichever result it returns.
 *
 * The lever is not free: `sqlOmitted: true` and its appended sentence add more
 * characters than a marginal truncation removes, and `previewSqlStatement`
 * returns an already short statement unchanged, so a per-field length
 * comparison would let a "reduction" grow the payload while the marker and its
 * prose claim it shrank to fit the budget. Measuring the whole shortened
 * envelope is the only comparison those two claims match, and taking it on the
 * object returned here keeps the emitted result and its reported size from
 * disagreeing.
 */
function shortenSqlEchoIfSmaller<Result extends AgentSqlExecutionResult>(
  result: Result,
  resultChars: number,
  shortenSqlEcho: (result: Result) => Result,
  requestUrl: string,
): Readonly<{ result: Result; resultChars: number }> {
  const shortenedResult = shortenSqlEcho(result);
  const shortenedChars = measureAgentSqlEnvelopeChars(shortenedResult, requestUrl);
  if (shortenedChars >= resultChars) {
    return { result, resultChars };
  }

  return { result: shortenedResult, resultChars: shortenedChars };
}

/**
 * Shrinks an oversized committed write result instead of rejecting it.
 *
 * `executeSqlMutationStatement` and `executeSqlMutationBatch` return after their
 * transaction committed, so answering with `QUERY_RESULT_TOO_LARGE` would report
 * a successful write as a failure and invite the caller to retry it and
 * duplicate the data. The counts, the records the write touched, and the
 * atomicity contract stay intact whatever is reduced, and `data.rowsOmitted` and
 * `data.sqlOmitted` both record their reduction structurally in the emitted
 * payload, so a model reads either without parsing the appended instruction
 * prose. Only `rowsOmitted` also reaches our telemetry record.
 *
 * The echoed SQL is shortened first: it is text the caller itself submitted and
 * still holds, while the rows a DELETE ... RETURNING gives back are the one
 * mutation result nothing can recover. The rows are dropped only when shortening
 * the echo left the payload over budget. Each marker and its appended prose
 * report a reduction that happened, never the budget verdict that asked for one,
 * so a write that returned no rows is never marked as having lost any, and an
 * echo whose shortening would not make the emitted payload smaller is left
 * alone rather than marked as shortened.
 */
function reduceMutationResultToSizeBudget(
  result: AgentSqlMutationExecutionResult,
  requestUrl: string,
): AgentSqlEmission<AgentSqlMutationExecutionResult> {
  const resultChars = measureAgentSqlEnvelopeChars(result, requestUrl);
  if (resultChars <= MAX_SQL_RESULT_CHARS) {
    return { result, resultChars };
  }

  const shortened = shortenSqlEchoIfSmaller(result, resultChars, shortenMutationSqlEcho, requestUrl);
  if (shortened.resultChars <= MAX_SQL_RESULT_CHARS || result.data.rows.length === 0) {
    return shortened;
  }

  const withoutRowsResult: AgentSqlMutationExecutionResult = {
    data: {
      ...shortened.result.data,
      rows: [],
      rowsOmitted: true,
    },
    instructions: `${shortened.result.instructions} ${OMITTED_MUTATION_ROWS_INSTRUCTION}`,
  };

  return {
    result: withoutRowsResult,
    resultChars: measureAgentSqlEnvelopeChars(withoutRowsResult, requestUrl),
  };
}

/**
 * Batch counterpart of the reducer above. The rows reduction is all-or-nothing:
 * the budget covers the whole emitted payload, so every statement loses its rows
 * even when its own rows were small, and the single `data.rowsOmitted` marker
 * describes exactly that. A batch in which no statement returned a row stops
 * after the echo lever, for the same reason the single reducer leaves such a
 * write's rows alone.
 */
function reduceBatchMutationResultToSizeBudget(
  result: AgentSqlBatchExecutionResult,
  requestUrl: string,
): AgentSqlEmission<AgentSqlBatchExecutionResult> {
  const resultChars = measureAgentSqlEnvelopeChars(result, requestUrl);
  if (resultChars <= MAX_SQL_RESULT_CHARS) {
    return { result, resultChars };
  }

  const shortened = shortenSqlEchoIfSmaller(result, resultChars, shortenBatchSqlEcho, requestUrl);
  const hasRowsToDrop = result.data.statements.some((statement) => statement.rows.length > 0);
  if (shortened.resultChars <= MAX_SQL_RESULT_CHARS || !hasRowsToDrop) {
    return shortened;
  }

  const withoutRowsResult: AgentSqlBatchExecutionResult = {
    data: {
      ...shortened.result.data,
      statements: shortened.result.data.statements.map((statement) => ({
        ...statement,
        rows: [],
      })),
      rowsOmitted: true,
    },
    instructions: `${shortened.result.instructions} ${OMITTED_MUTATION_ROWS_INSTRUCTION}`,
  };

  return {
    result: withoutRowsResult,
    resultChars: measureAgentSqlEnvelopeChars(withoutRowsResult, requestUrl),
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
 * Reads the payload's own omission marker. Read payloads carry none, because no
 * read drops all of its rows: an oversized single `SELECT` keeps the rows that
 * fit and marks itself `data.rowsTruncated`, which this record has no field of
 * its own for, whenever dropping rows leaves at least one row that fits, and
 * every other oversized read is rejected.
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
        return truncateReadResultToSizeBudget(
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
