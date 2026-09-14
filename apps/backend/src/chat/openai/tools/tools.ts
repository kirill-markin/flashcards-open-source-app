/**
 * Tool execution bridge for backend-owned OpenAI chat.
 * The runtime always routes provider tool calls through this module so SQL validation and output envelopes stay consistent.
 */
import type OpenAI from "openai";
import { hasCognitoIdentityMappingForUser } from "../../../auth/userIdentities";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import { GeneratedMediaPromotionStorageTransientError } from "../../../mediaAssets/storage";
import { HttpError } from "../../../shared/errors";
import {
  ensureAIChatSyncReplica,
  ensureAIChatSyncReplicaWithDeadline,
} from "../../../sync/identity/aiChatIdentity";
import { executeAgentSql } from "../../../aiTools/agentSql";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "../../../aiTools/agentSql/operations";
import { parseSqlStatement, splitSqlStatements } from "../../../aiTools/sqlDialect";
import {
  isSqlMutationStatement,
  type AgentSqlPayload,
  type AgentSqlReadPayload,
} from "../../../aiTools/agentSql/shared";
import {
  OPENAI_SQL_TOOL,
  SQL_TOOL_ARGUMENT_VALIDATOR,
  SQL_TOOL_NAME,
} from "../../../aiTools/toolContract/sqlToolContract";
import { generateCardImage, type GeneratedCardImageObservationContext } from "../../cardImages";
import { isOpenAIImageGenerationProviderError } from "../../cardImages/provider/openaiAdapter";
import {
  GeneratedCardImageDeadlineExceededError,
  GeneratedCardImageProviderOutcomeUnknownError,
  GeneratedCardImageStagingOutcomeUnknownError,
} from "../../cardImages/providerTypes";
import { InactiveChatRunClaimError, type ChatRunClaimToken } from "../../runs";
import {
  bindGeneratedCardImageAttemptPayload,
  maximumGeneratedCardImageAttemptsPerRun,
  reserveGeneratedCardImageAttempt,
  type BindGeneratedCardImageAttemptPayloadParams,
  type GeneratedCardImageAttemptReservation,
  type GeneratedCardImageAttemptReservationParams,
  type GeneratedCardImageImmutablePayload,
} from "./generatedImageAttemptBudget";
import {
  GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR,
  GENERATED_IMAGE_TOOL_NAME,
  OPENAI_GENERATED_IMAGE_TOOL,
} from "./generatedImageToolContract";

export type OpenAIToolContext = Readonly<{
  runId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  claimToken: ChatRunClaimToken;
  operationKey: string;
  generatedImageEligible: boolean;
  signal: AbortSignal | null;
  generatedImageOperationDeadlineMs: number;
  generatedImageObservationContext: GeneratedCardImageObservationContext;
}>;

export type GeneratedImageToolTelemetry = Readonly<{
  attempt: number | null;
  status: string;
}>;

/**
 * Structured outcome of one SQL tool call, exported to Langfuse by the tool executor.
 * A failed SQL call returns an error envelope to the model instead of throwing, so this
 * is the only signal that tells the failure apart from a successful call.
 * `dialectReason` is read as an opaque value: the dialect owns its vocabulary of codes.
 */
export type SqlToolTelemetry = Readonly<{
  succeeded: boolean;
  errorCode: string | null;
  errorClass: string | null;
  dialectReason: string | null;
  statementType: string | null;
  statementCount: number | null;
  rowOrAffectedCount: number | null;
  durationMs: number;
}>;

export type ExecutedChatToolCall = Readonly<{
  output: string;
  isMutating: boolean;
  succeeded: boolean;
  shouldInvalidateMainContent: boolean;
  stopReason: "deadline_reached" | "run_inactive" | null;
  generatedImageTelemetry: GeneratedImageToolTelemetry | null;
  sqlTelemetry: SqlToolTelemetry | null;
}>;

export type OpenAIToolDependencies = Readonly<{
  executeAgentSql: typeof executeAgentSql;
  createToolDependencies: (context: OpenAIToolContext) => AgentToolOperationDependencies;
  reserveGeneratedCardImageAttempt: (
    params: GeneratedCardImageAttemptReservationParams,
  ) => Promise<GeneratedCardImageAttemptReservation>;
  bindGeneratedCardImageAttemptPayload: (
    params: BindGeneratedCardImageAttemptPayloadParams,
  ) => Promise<GeneratedCardImageImmutablePayload>;
  hasCognitoIdentityMappingForUser: typeof hasCognitoIdentityMappingForUser;
  ensureAIChatSyncReplicaWithDeadline: typeof ensureAIChatSyncReplicaWithDeadline;
  generateCardImage: typeof generateCardImage;
}>;

type GeneratedImageToolSafeErrorCode = "MEDIA_ASSET_STORAGE_UNAVAILABLE";

function getGeneratedImageToolSafeErrorCode(
  error: unknown,
): GeneratedImageToolSafeErrorCode | null {
  return error instanceof GeneratedMediaPromotionStorageTransientError
    && error.constructor === GeneratedMediaPromotionStorageTransientError
    && error.code === "S3_TRANSIENT"
    ? "MEDIA_ASSET_STORAGE_UNAVAILABLE"
    : null;
}

type ToolErrorPayload = Readonly<{
  error: Readonly<{
    name: string;
    message: string;
  }>;
  sql: string | null;
  code?: string;
  details?: unknown;
}>;

/**
 * Upper bound for a single serialized tool-call output.
 * Each tool result is appended to the loop continuation and re-sent on every later model
 * call in the turn, so one large SQL result set inflates every subsequent request and can
 * trigger context_length_exceeded. ~24K chars leaves roughly 6K tokens of headroom per result.
 */
const MAX_TOOL_OUTPUT_CHARS = 24_000 as const;

function createToolDependencies(context: OpenAIToolContext): AgentToolOperationDependencies {
  return {
    ...DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
    ensureAgentSyncReplica: async (workspaceId: string, userId: string): Promise<string> =>
      ensureAIChatSyncReplica(
        workspaceId,
        userId,
        "web",
        context.signal,
      ),
  };
}

/**
 * Caps a single oversized envelope field by replacing it with a truncated preview string.
 * Returns the serialized envelope when it already fits, otherwise rebuilds it with the heavy
 * field swapped for a `<fieldKey>Preview` slice plus `truncated`/`omittedChars` markers so the
 * model still receives valid JSON and can tell the result was capped and re-query more narrowly.
 *
 * The slice cuts at a character offset, so the preview itself is a JSON fragment the model can
 * read only as text. That is the right trade wherever nothing better exists, and this is where
 * every shape that cannot lose part of itself and still make sense ends up: a failure's
 * `details`, a write echoing a long statement, a read batch, `SHOW TABLES`, `DESCRIBE`. A single
 * `SELECT` drops whole rows instead (see `capReadEnvelopeByRows`) and only falls back here when
 * not even one row fits.
 *
 * Only `envelope[fieldKey]` is replaced. Everything else is carried through untouched - the
 * top-level `sql` echo above all - so a payload whose non-`data` parts alone exceed
 * `MAX_TOOL_OUTPUT_CHARS` is returned over budget. What brings an oversized `SELECT` here is a
 * separate question with more than one answer: a single row too large to fit does it, and so does
 * a statement echo that fills the budget by itself, which is the pair of causes the rejection
 * message in `apps/backend/src/aiTools/agentSql.ts` hedges between.
 */
function capSerializedEnvelope(
  envelope: Readonly<Record<string, unknown>>,
  fieldKey: string,
): string {
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) {
    return serialized;
  }

  const serializedField = JSON.stringify(envelope[fieldKey] ?? null);
  const { [fieldKey]: _omitted, ...rest } = envelope;
  const previewKey = `${fieldKey}Preview`;
  const buildCapped = (previewLength: number): string =>
    JSON.stringify({
      ...rest,
      [previewKey]: serializedField.slice(0, previewLength),
      truncated: true,
      omittedChars: serializedField.length - Math.min(previewLength, serializedField.length),
    });

  // Reserve headroom for the marker fields, then trim once more for JSON escaping of the
  // preview slice. Neither pass is a hard bound: `omittedChars` is recomputed on every
  // `buildCapped` call and grows as the preview shrinks, so it can gain decimal digits between
  // passes that neither the reserved headroom nor the overflow correction accounts for, leaving
  // the returned string a few characters over MAX_TOOL_OUTPUT_CHARS.
  const reservedLength = buildCapped(0).length;
  const firstPass = buildCapped(Math.max(0, MAX_TOOL_OUTPUT_CHARS - reservedLength));
  if (firstPass.length <= MAX_TOOL_OUTPUT_CHARS) {
    return firstPass;
  }

  const overflow = firstPass.length - MAX_TOOL_OUTPUT_CHARS;
  return buildCapped(Math.max(0, MAX_TOOL_OUTPUT_CHARS - reservedLength - overflow));
}

type SqlToolSuccessPayload = Readonly<{
  sql: string;
  data: AgentSqlPayload;
  instructions: string;
}>;

function buildSqlToolEnvelope(
  payload: SqlToolSuccessPayload,
): Readonly<Record<string, unknown>> {
  return {
    ok: true,
    tool: SQL_TOOL_NAME,
    ...payload,
  };
}

/**
 * The instructions a read carries once rows have been dropped, so the model reports what it
 * received as the partial answer it is instead of as the whole result set.
 *
 * It replaces the arriving instructions rather than extending them, for the same reason the
 * external surfaces rebuild theirs: an untruncated read is handed out saying `data.rowsTruncated`
 * is false and no row was dropped, which a truncated payload contradicts outright, so keeping
 * that sentence alongside this one would send the model two opposite readings of the same field.
 * What the rest of the arriving string carries - the dialect note, the row cap, the pagination
 * hint, and pointers to envelope fields the chat does not emit - the chat system prompt already
 * states for this surface.
 *
 * It names `data.limit` only to keep a model from paginating straight past the dropped rows, and
 * gives no resume recipe on purpose: the chat exposes one combined `sql` tool, so a model that
 * needs the rest simply asks again.
 */
const TRUNCATED_READ_ROWS_INSTRUCTION =
  "This answer is partial: data.rows carries only the leading rows of the result, because the whole result did not fit the size limit of a single tool result, and data.rowsTruncated is true because the rest were dropped here rather than by your query. data.rowCount counts the rows you received and data.totalRowCount how many rows the statement produced, so compare the two before you answer and tell the user the answer is partial whenever the rows you are missing could change it. data.limit is still the limit you asked for rather than the number of rows delivered, so continuing from data.offset + data.limit would skip the rows dropped here. Nothing was written, so when those rows matter, ask again for less at a time: select fewer or narrower columns, add WHERE filters, or aggregate instead of listing rows.";

/**
 * Shrinks an oversized single `SELECT` to the largest leading run of rows whose serialized
 * envelope fits `MAX_TOOL_OUTPUT_CHARS`, marked as the partial answer it is.
 *
 * Only the rows shrink. `data.totalRowCount` is left exactly as it arrived, so the model still
 * sees how many rows the statement produced while `data.rowCount` counts the rows it actually
 * received, `data.hasMore` becomes true because dropping rows always leaves rows behind, and the
 * instructions are replaced with the truncated wording rather than appended to.
 *
 * The prefix is found by binary search over the row count rather than by predicting where to
 * cut: serialized size grows with the prefix length, so the search finds the exact largest
 * fitting prefix, and a handful of measurement passes on a payload that is already an outlier
 * is cheaper than being clever about it. The search stops one row short of the whole page,
 * because a payload that kept every row is not a truncated one and must not be marked as such.
 *
 * Returns null when not even one row fits, which is the caller's signal to fall back to the
 * preview slice: a partial answer carrying no row shows the model neither the data nor its
 * shape, and the chat has no rejection path here, so something bounded still has to go back.
 *
 * This is the chat's own loop rather than the read budget of
 * `apps/backend/src/aiTools/agentSql.ts` because neither half of that budget transfers: it
 * measures a built agent envelope, and it measures it against `MAX_SQL_RESULT_CHARS`, while the
 * chat emits this `{ ok, tool, ... }` shape under a smaller limit of its own.
 */
function capReadEnvelopeByRows(
  payload: SqlToolSuccessPayload,
  data: AgentSqlReadPayload,
): string | null {
  const serializeRowPrefix = (rowCount: number): string =>
    JSON.stringify(buildSqlToolEnvelope({
      ...payload,
      data: {
        ...data,
        rows: data.rows.slice(0, rowCount),
        rowCount,
        rowsTruncated: true,
        hasMore: true,
      },
      instructions: TRUNCATED_READ_ROWS_INSTRUCTION,
    }));

  let lowestRowCount = 1;
  let highestRowCount = data.rows.length - 1;
  let largestFitting: string | null = null;

  while (lowestRowCount <= highestRowCount) {
    const candidateRowCount = Math.floor((lowestRowCount + highestRowCount) / 2);
    const candidate = serializeRowPrefix(candidateRowCount);
    if (candidate.length <= MAX_TOOL_OUTPUT_CHARS) {
      largestFitting = candidate;
      lowestRowCount = candidateRowCount + 1;
    } else {
      highestRowCount = candidateRowCount - 1;
    }
  }

  return largestFitting;
}

/**
 * Serializes one successful SQL tool call, shrunk toward `MAX_TOOL_OUTPUT_CHARS` when the whole
 * envelope does not fit.
 *
 * An oversized single `SELECT` loses rows from the end rather than the tail of its serialized
 * `data`, so the model keeps whole rows it can read as data and learns from `data.rowsTruncated`
 * and `data.totalRowCount` exactly what it is missing. A row-capped result is measured whole, so
 * it does fit. Everything else falls back to the preview slice and to the softer bound documented
 * on `capSerializedEnvelope`: every shape that is not a single `SELECT` carrying rows, and every
 * `SELECT` for which `capReadEnvelopeByRows` finds no fitting prefix of rows, whatever put the
 * envelope over budget.
 */
function createToolSuccessResult(payload: SqlToolSuccessPayload): string {
  const envelope = buildSqlToolEnvelope(payload);
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) {
    return serialized;
  }

  const data = payload.data;
  if (data.statementType === "select" && data.rows.length > 0) {
    const rowCapped = capReadEnvelopeByRows(payload, data);
    if (rowCapped !== null) {
      return rowCapped;
    }
  }

  return capSerializedEnvelope(envelope, "data");
}

function createToolErrorResult(payload: ToolErrorPayload): string {
  return capSerializedEnvelope(
    {
      ok: false,
      tool: SQL_TOOL_NAME,
      ...payload,
    },
    "details",
  );
}

function serializeToolError(error: unknown): Readonly<{
  name: string;
  message: string;
}> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function getSqlFromRawArguments(rawArguments: string): string | null {
  try {
    const parsed = JSON.parse(rawArguments) as Readonly<{ sql?: unknown }>;
    return typeof parsed.sql === "string" ? parsed.sql : null;
  } catch {
    return null;
  }
}

function getIsMutatingSql(sql: string | null): boolean {
  if (sql === null) {
    return false;
  }

  try {
    const statements = splitSqlStatements(sql).map((statementSql) => parseSqlStatement(statementSql));
    return statements.length > 0 && statements.every(isSqlMutationStatement);
  } catch {
    return false;
  }
}

function getSqlStatementCount(payload: AgentSqlPayload): number {
  return payload.statementType === "batch" ? payload.statementCount : 1;
}

function getSqlRowOrAffectedCount(payload: AgentSqlPayload): number | null {
  switch (payload.statementType) {
    case "batch":
      return payload.affectedCountTotal;
    case "insert":
    case "update":
    case "delete":
      return payload.affectedCount;
    default:
      return payload.rowCount;
  }
}

/**
 * Reads the dialect reason of a failed SQL tool call without depending on the dialect vocabulary.
 * The value is whatever the dialect reports today and stays valid when those codes change.
 */
function getSqlDialectReason(error: unknown): string | null {
  return error instanceof HttpError
    ? error.details?.validationIssues?.[0]?.code ?? null
    : null;
}

export const OPENAI_CHAT_TOOLS: ReadonlyArray<OpenAI.Responses.FunctionTool> = [OPENAI_SQL_TOOL];

const DEFAULT_OPENAI_TOOL_DEPENDENCIES: OpenAIToolDependencies = {
  executeAgentSql,
  createToolDependencies,
  reserveGeneratedCardImageAttempt,
  bindGeneratedCardImageAttemptPayload,
  hasCognitoIdentityMappingForUser,
  ensureAIChatSyncReplicaWithDeadline,
  generateCardImage,
};

export function buildOpenAIChatTools(
  generatedImageEligible: boolean,
): ReadonlyArray<OpenAI.Responses.FunctionTool> {
  return generatedImageEligible
    ? [OPENAI_SQL_TOOL, OPENAI_GENERATED_IMAGE_TOOL]
    : OPENAI_CHAT_TOOLS;
}

type GeneratedImageExecutionState =
  Omit<ExecutedChatToolCall, "output" | "generatedImageTelemetry" | "sqlTelemetry"> & Readonly<{
    attempt: number | null;
    status: string;
  }>;

function createGeneratedImageResult(
  payload: Readonly<Record<string, unknown>>,
  execution: GeneratedImageExecutionState,
): ExecutedChatToolCall {
  const { attempt, status, ...executionResult } = execution;
  return {
    output: JSON.stringify({ tool: GENERATED_IMAGE_TOOL_NAME, ...payload }),
    ...executionResult,
    generatedImageTelemetry: { attempt, status },
    sqlTelemetry: null,
  };
}

function createGeneratedImageErrorResult(
  code: string,
  retryable: boolean,
  attempt: number | null,
  shouldInvalidateMainContent: boolean,
  stopReason: ExecutedChatToolCall["stopReason"],
): ExecutedChatToolCall {
  return createGeneratedImageResult(
    { ok: false, code, retryable, ...(attempt === null ? {} : { attempt }) },
    {
      attempt,
      status: code,
      succeeded: false,
      isMutating: false,
      shouldInvalidateMainContent,
      stopReason,
    },
  );
}

type GeneratedImageOperationSignals = Readonly<{
  operation: AbortSignal;
  deadline: AbortSignal;
}>;

function createOperationSignals(
  runSignal: AbortSignal | null,
  operationDeadlineMs: number,
): GeneratedImageOperationSignals {
  const remainingMs = operationDeadlineMs - Date.now();
  const deadlineSignal = remainingMs <= 0
    ? AbortSignal.abort(new GeneratedCardImageDeadlineExceededError(null))
    : AbortSignal.timeout(remainingMs);
  return {
    operation: runSignal === null
      ? deadlineSignal
      : AbortSignal.any([runSignal, deadlineSignal]),
    deadline: deadlineSignal,
  };
}

async function executeGeneratedImageToolCall(
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): Promise<ExecutedChatToolCall> {
  context.signal?.throwIfAborted();
  if (context.generatedImageEligible === false) {
    return createGeneratedImageErrorResult(
      "sign_in_required",
      false,
      null,
      false,
      null,
    );
  }
  const operationSignals = createOperationSignals(
    context.signal,
    context.generatedImageOperationDeadlineMs,
  );
  const operationSignal = operationSignals.operation;
  let attempt: number | null = null;
  try {
    operationSignal.throwIfAborted();
    const reservation = await dependencies.reserveGeneratedCardImageAttempt({
      userId: context.userId,
      workspaceId: context.workspaceId,
      runId: context.runId,
      sessionId: context.sessionId,
      claimToken: context.claimToken,
      operationKey: context.operationKey,
      databaseDeadlineAtMs: context.generatedImageOperationDeadlineMs,
    });
    operationSignal.throwIfAborted();
    if (reservation.status === "run_inactive") {
      return createGeneratedImageErrorResult("run_inactive", false, null, false, "run_inactive");
    }
    if (reservation.status === "limit_reached") {
      return createGeneratedImageErrorResult("limit_reached", false, null, false, null);
    }
    attempt = reservation.attempt;

    let immutablePayload = reservation.payload;
    if (immutablePayload === null) {
      let rawArgumentsValue: unknown;
      try {
        rawArgumentsValue = JSON.parse(rawArguments);
      } catch {
        return createGeneratedImageErrorResult(
          "invalid_arguments",
          reservation.attempt < maximumGeneratedCardImageAttemptsPerRun,
          reservation.attempt,
          false,
          null,
        );
      }
      const parsed = GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.safeParse(rawArgumentsValue);
      if (parsed.success === false) {
        return createGeneratedImageErrorResult(
          "invalid_arguments",
          reservation.attempt < maximumGeneratedCardImageAttemptsPerRun,
          reservation.attempt,
          false,
          null,
        );
      }
      immutablePayload = await dependencies.bindGeneratedCardImageAttemptPayload({
        userId: context.userId,
        workspaceId: context.workspaceId,
        runId: context.runId,
        sessionId: context.sessionId,
        claimToken: context.claimToken,
        operationKey: context.operationKey,
        attempt: reservation.attempt,
        payload: parsed.data,
        databaseDeadlineAtMs: context.generatedImageOperationDeadlineMs,
      });
      operationSignal.throwIfAborted();
    }

    const signedIn = await dependencies.hasCognitoIdentityMappingForUser(
      context.userId, context.generatedImageOperationDeadlineMs,
    );
    operationSignal.throwIfAborted();
    if (signedIn === false) {
      return createGeneratedImageErrorResult(
        "sign_in_required",
        false,
        reservation.attempt,
        false,
        null,
      );
    }

    const replicaId = await dependencies.ensureAIChatSyncReplicaWithDeadline(
      context.workspaceId,
      context.userId,
      "web",
      operationSignal,
      context.generatedImageOperationDeadlineMs,
    );
    operationSignal.throwIfAborted();
    const result = await dependencies.generateCardImage({
      runId: context.runId,
      sessionId: context.sessionId,
      claimToken: context.claimToken,
      operationKey: context.operationKey,
      userId: context.userId,
      workspaceId: context.workspaceId,
      cardId: immutablePayload.cardId,
      targetSide: immutablePayload.targetSide,
      imagePrompt: immutablePayload.imagePrompt,
      altText: immutablePayload.altText,
      replicaId,
      observationContext: context.generatedImageObservationContext,
      signal: operationSignal,
      operationDeadlineMs: context.generatedImageOperationDeadlineMs,
    });
    const mutated = result.status === "queued";
    return createGeneratedImageResult(
      {
        ok: true,
        status: result.status,
        retryable: false,
        attempt: reservation.attempt,
        cardId: result.cardId,
        targetSide: result.targetSide,
        mediaAssetId: result.mediaAssetId,
        placeholderApplied: result.placeholderApplied,
      },
      {
        attempt: reservation.attempt,
        status: result.status,
        succeeded: true,
        isMutating: mutated,
        shouldInvalidateMainContent: result.placeholderApplied,
        stopReason: null,
      },
    );
  } catch (error) {
    if (
      error instanceof DatabaseCommitOutcomeUnknownError
      || error instanceof InactiveChatRunClaimError
      || error instanceof GeneratedCardImageProviderOutcomeUnknownError
      || error instanceof GeneratedCardImageStagingOutcomeUnknownError
    ) {
      throw error;
    }
    context.signal?.throwIfAborted();
    if (error instanceof TransientDatabaseHttpError) {
      throw error;
    }
    if (
      operationSignals.deadline.aborted
      && error === operationSignals.deadline.reason
    ) {
      return createGeneratedImageErrorResult(
        "deadline_reached",
        false,
        attempt,
        false,
        "deadline_reached",
      );
    }
    const safeErrorCode = getGeneratedImageToolSafeErrorCode(error);
    if (safeErrorCode !== null) {
      const retryable = attempt !== null
        && attempt < maximumGeneratedCardImageAttemptsPerRun;
      return createGeneratedImageErrorResult(
        safeErrorCode,
        retryable,
        attempt,
        false,
        null,
      );
    }
    if (isOpenAIImageGenerationProviderError(error)) {
      const providerStatus = error.status;
      const code = error.code === "moderation_blocked"
        ? "moderation_blocked"
        : providerStatus === 401 || providerStatus === 403
          ? "provider_permission_denied"
          : providerStatus === 429
            || (providerStatus !== null && providerStatus >= 500 && providerStatus <= 599)
            ? "provider_unavailable"
            : "provider_failed";
      const retryable = code === "provider_unavailable"
        && attempt !== null
        && attempt < maximumGeneratedCardImageAttemptsPerRun;
      return createGeneratedImageErrorResult(
        code,
        retryable,
        attempt,
        false,
        null,
      );
    }
    throw error;
  }
}

/**
 * Executes one provider tool call with injectable dependencies for tests and loop orchestration.
 */
export async function executeChatToolCallWithDependencies(
  toolName: string,
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): Promise<ExecutedChatToolCall> {
  if (toolName === GENERATED_IMAGE_TOOL_NAME) {
    return executeGeneratedImageToolCall(rawArguments, context, dependencies);
  }
  if (toolName !== SQL_TOOL_NAME) {
    throw new Error(`Unsupported OpenAI tool call: ${toolName}`);
  }

  const sql = getSqlFromRawArguments(rawArguments);
  const isMutating = getIsMutatingSql(sql);
  const startedAt = Date.now();

  try {
    const parsed = SQL_TOOL_ARGUMENT_VALIDATOR.parse(JSON.parse(rawArguments));
    const result = await dependencies.executeAgentSql(
      {
        userId: context.userId,
        workspaceId: context.workspaceId,
        selectedWorkspaceId: context.workspaceId,
        connectionId: "chat-v2",
        surface: "chat-tool",
      },
      parsed.sql,
      dependencies.createToolDependencies(context),
    );

    return {
      output: createToolSuccessResult({
        sql: parsed.sql,
        data: result.data,
        instructions: result.instructions,
      }),
      isMutating,
      succeeded: true,
      shouldInvalidateMainContent: isMutating,
      stopReason: null,
      generatedImageTelemetry: null,
      sqlTelemetry: {
        succeeded: true,
        errorCode: null,
        errorClass: null,
        dialectReason: null,
        statementType: result.data.statementType,
        statementCount: getSqlStatementCount(result.data),
        rowOrAffectedCount: getSqlRowOrAffectedCount(result.data),
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    const payload: ToolErrorPayload = error instanceof HttpError
      ? {
        sql,
        error: serializeToolError(error),
        code: error.code ?? undefined,
        details: error.details ?? undefined,
      }
      : {
        sql,
        error: serializeToolError(error),
      };

    return {
      output: createToolErrorResult(payload),
      isMutating,
      succeeded: false,
      shouldInvalidateMainContent: false,
      stopReason: null,
      generatedImageTelemetry: null,
      sqlTelemetry: {
        succeeded: false,
        errorCode: error instanceof HttpError ? error.code : null,
        errorClass: serializeToolError(error).name,
        dialectReason: getSqlDialectReason(error),
        statementType: null,
        statementCount: null,
        rowOrAffectedCount: null,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

/**
 * Executes one provider tool call with the production dependency set.
 */
export async function executeChatToolCall(
  toolName: string,
  rawArguments: string,
  context: OpenAIToolContext,
): Promise<ExecutedChatToolCall> {
  return executeChatToolCallWithDependencies(
    toolName,
    rawArguments,
    context,
    DEFAULT_OPENAI_TOOL_DEPENDENCIES,
  );
}
