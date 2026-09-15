/**
 * Tool execution bridge for backend-owned OpenAI chat.
 * The runtime always routes provider tool calls through this module so SQL validation and output envelopes stay consistent.
 */
import type OpenAI from "openai";
import { z } from "zod";
import { hasCognitoIdentityMappingForUser } from "../../../auth/userIdentities";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import { GeneratedMediaPromotionStorageTransientError } from "../../../mediaAssets/storage";
import { resolveAccessibleChatWorkspaceId } from "../../../server/requestContext";
import { HttpError } from "../../../shared/errors";
import {
  ensureAIChatSyncReplica,
  ensureAIChatSyncReplicaWithDeadline,
} from "../../../sync/identity/aiChatIdentity";
import { listUserWorkspacesWithStatsForSelectedWorkspace } from "../../../workspaces";
import { runChatSqlExecute, runChatSqlQuery } from "../../../aiTools/agentSql";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "../../../aiTools/agentSql/operations";
import {
  previewSqlStatement,
  type AgentSqlPayload,
  type AgentSqlReadPayload,
} from "../../../aiTools/agentSql/shared";
import { createAgentRemediationInstructions } from "../../../aiTools/toolContract/remediationInstructions";
import { GUIDE_TOPICS } from "../../../aiTools/toolContract/sqlToolContract";
import { unboundAgentToolAction } from "../../../aiTools/toolRegistry/actions";
import {
  findAgentToolSpecForSurface,
  listAgentToolSpecsForSurface,
  GET_GUIDE_TOOL_SPEC,
  LIST_WORKSPACES_TOOL_SPEC,
  SQL_EXECUTE_TOOL_INPUT_SCHEMA,
  SQL_EXECUTE_TOOL_SPEC,
  SQL_QUERY_TOOL_INPUT_SCHEMA,
  SQL_QUERY_TOOL_SPEC,
} from "../../../aiTools/toolRegistry/specs";
import type { AgentToolContext, AgentToolSpec } from "../../../aiTools/toolRegistry/types";
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
  /**
   * The error class of a failed call whose tool reports no SQL telemetry, so such a failure still
   * names its cause in the exported metadata and still marks its observation. The SQL tools report
   * their class inside `sqlTelemetry` and leave this null; the generated-image tool leaves it null
   * on purpose, because it returns expected product outcomes such as `limit_reached` through the
   * same error envelope and exports those as its own status instead.
   */
  toolErrorClass: string | null;
}>;

export type OpenAIToolDependencies = Readonly<{
  runChatSqlQuery: typeof runChatSqlQuery;
  runChatSqlExecute: typeof runChatSqlExecute;
  createToolDependencies: (context: OpenAIToolContext) => AgentToolOperationDependencies;
  resolveAccessibleChatWorkspaceId: typeof resolveAccessibleChatWorkspaceId;
  listUserWorkspacesWithStatsForSelectedWorkspace: typeof listUserWorkspacesWithStatsForSelectedWorkspace;
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
  /** What to do about the failure, from the shared per-code remediation module. */
  instructions: string;
  /** The statement the failed call was asked to run; absent on a tool that runs none. */
  sql?: string | null;
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
 * Rebuilds the envelope around a preview slice of `envelope[fieldKey]` that fits
 * `MAX_TOOL_OUTPUT_CHARS`, measuring every candidate instead of predicting its size.
 *
 * The marker overhead only seeds the first preview length. The slice is JSON-escaped into a
 * string field, and `omittedChars` gains decimal digits as the preview shrinks, so no single
 * arithmetic pass lands on the budget. Every overflowing pass cuts the preview by the overflow it
 * just measured, which is at least one character, so the loop reaches either a fitting result or a
 * preview of nothing.
 *
 * It shrinks; it does not search. A pass subtracts measured output characters from a preview
 * length whose characters can each cost more than one output character once escaped, so the slice
 * it stops on fits but can be shorter than the longest one that would have. Unlike
 * `capReadEnvelopeByRows`, nothing here finds a maximum.
 *
 * A preview of nothing is not a fit. It is what the returned string carries when everything that
 * survives an empty preview - the other fields, the markers, and the JSON scaffolding - is over
 * budget together, and shrinking that rest is the caller's problem, not this loop's.
 */
function capEnvelopeFieldToBudget(
  envelope: Readonly<Record<string, unknown>>,
  fieldKey: string,
): string {
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

  let previewLength = Math.max(0, MAX_TOOL_OUTPUT_CHARS - buildCapped(0).length);
  let capped = buildCapped(previewLength);
  while (capped.length > MAX_TOOL_OUTPUT_CHARS && previewLength > 0) {
    previewLength = Math.max(0, previewLength - (capped.length - MAX_TOOL_OUTPUT_CHARS));
    capped = buildCapped(previewLength);
  }

  return capped;
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
 * When the preview alone cannot bring the envelope under budget, the top-level `sql` echo is
 * replaced with `previewSqlStatement` and the envelope rebuilt: the echo is text the caller
 * submitted and still holds, which is why the write paths in
 * `apps/backend/src/aiTools/agentSql/resultBudget.ts` reach for the same lever first. It runs only
 * once the preview has failed, so an ordinary capped result keeps its full echo, and it is a no-op
 * where the envelope carries no string `sql`, which is what a failure that never parsed a
 * statement passes.
 *
 * Only `envelope[fieldKey]` and that echo shrink. Every other field is carried through untouched,
 * so the returned string fits `MAX_TOOL_OUTPUT_CHARS` unless what it carries regardless of the
 * preview - those remaining fields as serialized, the shortened echo, the empty preview key, the
 * `truncated`/`omittedChars` markers, and the JSON scaffolding around them - exceeds the budget
 * together. A failure carrying a long database error message is the reachable case of that: the
 * message need not fill the budget on its own to push the rest of the envelope past it, and the
 * result comes back over budget with the preview already driven to nothing.
 *
 * What brings an oversized `SELECT` here is a separate question with more than one answer: a
 * single row too large to fit does it, and so does a statement echo that fills the budget by
 * itself, which is the pair of causes the rejection message in
 * `apps/backend/src/aiTools/agentSql/resultBudget.ts` hedges between.
 */
function capSerializedEnvelope(
  envelope: Readonly<Record<string, unknown>>,
  fieldKey: string,
): string {
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) {
    return serialized;
  }

  const capped = capEnvelopeFieldToBudget(envelope, fieldKey);
  if (capped.length <= MAX_TOOL_OUTPUT_CHARS) {
    return capped;
  }

  const sqlEcho = envelope.sql;
  if (typeof sqlEcho !== "string") {
    return capped;
  }

  const shortenedSqlEcho = previewSqlStatement(sqlEcho);
  if (shortenedSqlEcho === sqlEcho) {
    return capped;
  }

  return capEnvelopeFieldToBudget({ ...envelope, sql: shortenedSqlEcho }, fieldKey);
}

type SqlToolSuccessPayload = Readonly<{
  sql: string;
  data: AgentSqlPayload;
  instructions: string;
}>;

function buildSqlToolEnvelope(
  toolName: string,
  payload: SqlToolSuccessPayload,
): Readonly<Record<string, unknown>> {
  return {
    ok: true,
    tool: toolName,
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
 * It names `data.limit` only to keep a model from paginating straight past the dropped rows.
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
 * `apps/backend/src/aiTools/agentSql/resultBudget.ts` because neither half of that budget transfers: it
 * measures a built agent envelope, and it measures it against `MAX_SQL_RESULT_CHARS`, while the
 * chat emits this `{ ok, tool, ... }` shape under a smaller limit of its own.
 */
function capReadEnvelopeByRows(
  toolName: string,
  payload: SqlToolSuccessPayload,
  data: AgentSqlReadPayload,
): string | null {
  const serializeRowPrefix = (rowCount: number): string =>
    JSON.stringify(buildSqlToolEnvelope(toolName, {
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
function createToolSuccessResult(toolName: string, payload: SqlToolSuccessPayload): string {
  const envelope = buildSqlToolEnvelope(toolName, payload);
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) {
    return serialized;
  }

  const data = payload.data;
  if (data.statementType === "select" && data.rows.length > 0) {
    const rowCapped = capReadEnvelopeByRows(toolName, payload, data);
    if (rowCapped !== null) {
      return rowCapped;
    }
  }

  return capSerializedEnvelope(envelope, "data");
}

function createToolErrorResult(toolName: string, payload: ToolErrorPayload): string {
  return capSerializedEnvelope(
    {
      ok: false,
      tool: toolName,
      ...payload,
    },
    "details",
  );
}

/**
 * The status the chat remediates a failed tool call as. A call whose arguments never parsed -
 * malformed JSON, or arguments the tool schema rejects - is the model's to fix rather than ours,
 * so it is remediated as a rejected request instead of as a server-side failure.
 */
function getChatToolFailureStatusCode(error: unknown): number {
  if (error instanceof HttpError) {
    return error.statusCode;
  }

  return error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
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

const OPENAI_SQL_TOOL_PARAMETERS: OpenAI.Responses.FunctionTool["parameters"] = {
  type: "object",
  properties: {
    sql: {
      type: "string",
    },
    workspaceId: {
      type: "string",
    },
  },
  required: ["sql"],
  additionalProperties: false,
};

const OPENAI_SQL_QUERY_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: SQL_QUERY_TOOL_SPEC.name,
  description: SQL_QUERY_TOOL_SPEC.description,
  strict: false,
  parameters: OPENAI_SQL_TOOL_PARAMETERS,
};

const OPENAI_SQL_EXECUTE_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: SQL_EXECUTE_TOOL_SPEC.name,
  description: SQL_EXECUTE_TOOL_SPEC.description,
  strict: false,
  parameters: OPENAI_SQL_TOOL_PARAMETERS,
};

/**
 * The topic enum is spelled from `GUIDE_TOPICS`, so a topic added to the registry reaches this
 * surface with it. The parameter carries no description on purpose: the tool description already
 * names what each topic covers, and every character of both is re-sent on every model call of a
 * turn, which is the cost this tool exists to remove.
 */
const OPENAI_GET_GUIDE_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: GET_GUIDE_TOOL_SPEC.name,
  description: GET_GUIDE_TOOL_SPEC.description,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: [...GUIDE_TOPICS],
      },
    },
    required: ["topic"],
    additionalProperties: false,
  },
};

const OPENAI_LIST_WORKSPACES_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: LIST_WORKSPACES_TOOL_SPEC.name,
  description: LIST_WORKSPACES_TOOL_SPEC.description,
  strict: false,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/**
 * How each registry tool is advertised to OpenAI. The JSON Schema stays hand-written rather than
 * derived from the spec's zod schema so the payload the provider receives is exactly what it is;
 * the name and description come from the spec, which is the single inventory both surfaces read.
 * Hand-written is not unchecked: `requireChatFunctionTool` compares the two at module load.
 */
const CHAT_FUNCTION_TOOLS: Readonly<Record<string, OpenAI.Responses.FunctionTool | undefined>> = {
  [SQL_QUERY_TOOL_SPEC.name]: OPENAI_SQL_QUERY_TOOL,
  [SQL_EXECUTE_TOOL_SPEC.name]: OPENAI_SQL_EXECUTE_TOOL,
  [LIST_WORKSPACES_TOOL_SPEC.name]: OPENAI_LIST_WORKSPACES_TOOL,
  [GET_GUIDE_TOOL_SPEC.name]: OPENAI_GET_GUIDE_TOOL,
};

/**
 * The argument names and the required list of one hand-written schema, read the way the provider
 * reads them.
 */
function readAdvertisedSchemaKeys(
  parameters: OpenAI.Responses.FunctionTool["parameters"],
): Readonly<{ properties: ReadonlyArray<string>; required: ReadonlyArray<string> }> {
  const properties = parameters?.properties;
  const required = parameters?.required;
  return {
    properties: typeof properties === "object" && properties !== null ? Object.keys(properties) : [],
    required: Array.isArray(required)
      ? required.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

/**
 * The same two facts read off the spec's own schema. Requiredness comes from what that schema does
 * with `{}` - one issue per argument a call cannot omit - rather than from a zod internal, so it
 * stays whatever the tool actually rejects.
 */
function readSpecSchemaKeys(
  spec: AgentToolSpec,
): Readonly<{ properties: ReadonlyArray<string>; required: ReadonlyArray<string> }> {
  const inputSchema = spec.inputSchema;
  if (!(inputSchema instanceof z.ZodObject)) {
    throw new Error(
      `Tool ${spec.name} is listed for the chat surface but does not declare an object input schema.`,
    );
  }

  const parsedEmptyObject = inputSchema.safeParse({});
  return {
    properties: Object.keys(inputSchema.shape),
    required: parsedEmptyObject.success
      ? []
      : Array.from(new Set(
        parsedEmptyObject.error.issues
          .map((issue) => issue.path[0])
          .filter((key): key is string => typeof key === "string"),
      )),
  };
}

function toComparableKeyList(keys: ReadonlyArray<string>): string {
  return [...keys].sort().join(", ");
}

/**
 * Resolves the hand-written metadata of one chat tool and fails at module load when it disagrees
 * with the spec about the argument set or about which arguments are required.
 *
 * The specs are co-owned with MCP, so an argument added there - the MCP SQL specs already grew an
 * optional `workspaceId` - would otherwise reach the chat model as something else: an added
 * optional argument would be invisible to it, and an added required one would fail every call
 * inside the spec's own parse against a schema the model was never shown. Property types stay
 * unguarded; the one enum that could drift is spread from `GUIDE_TOPICS`.
 */
function requireChatFunctionTool(spec: AgentToolSpec): OpenAI.Responses.FunctionTool {
  const functionTool = CHAT_FUNCTION_TOOLS[spec.name];
  if (functionTool === undefined) {
    throw new Error(
      `Tool ${spec.name} is listed for the chat surface but carries no OpenAI function-tool metadata.`,
    );
  }

  const advertised = readAdvertisedSchemaKeys(functionTool.parameters);
  const declared = readSpecSchemaKeys(spec);
  if (
    toComparableKeyList(advertised.properties) !== toComparableKeyList(declared.properties)
    || toComparableKeyList(advertised.required) !== toComparableKeyList(declared.required)
  ) {
    throw new Error(
      `Tool ${spec.name} is advertised to OpenAI with arguments (${toComparableKeyList(advertised.properties)}) of which (${toComparableKeyList(advertised.required)}) are required, while its registry spec declares arguments (${toComparableKeyList(declared.properties)}) of which (${toComparableKeyList(declared.required)}) are required.`,
    );
  }

  return functionTool;
}

export const OPENAI_CHAT_TOOLS: ReadonlyArray<OpenAI.Responses.FunctionTool> =
  listAgentToolSpecsForSurface("chat").map((spec) => requireChatFunctionTool(spec));

const DEFAULT_OPENAI_TOOL_DEPENDENCIES: OpenAIToolDependencies = {
  runChatSqlQuery,
  runChatSqlExecute,
  createToolDependencies,
  resolveAccessibleChatWorkspaceId,
  listUserWorkspacesWithStatsForSelectedWorkspace,
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
    ? [...OPENAI_CHAT_TOOLS, OPENAI_GENERATED_IMAGE_TOOL]
    : OPENAI_CHAT_TOOLS;
}

type GeneratedImageExecutionState =
  Omit<
    ExecutedChatToolCall,
    "output" | "generatedImageTelemetry" | "sqlTelemetry" | "toolErrorClass"
  > & Readonly<{
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
    toolErrorClass: null,
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
 * The chat's half of a registry tool context, with the chat's own SQL executor and its per-run
 * operation dependencies.
 *
 * The session's workspace is the selected default, so an omitted workspaceId stays on the workspace
 * the user has open, and it stays `selectedWorkspaceId` so `isSelected` keeps pointing at the open
 * workspace whichever workspace a call targets, while agent_sql records carry the targeted
 * `workspaceId`. An explicit workspaceId goes through the same resolver that admitted the session's
 * workspace at the chat HTTP layer, which admits only a workspace the user is a member of.
 */
function buildChatAgentToolContext(
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): AgentToolContext {
  return {
    userId: context.userId,
    selectedWorkspaceId: context.workspaceId,
    connectionId: "chat-v2",
    caller: null,
    sqlSurface: "chat-tool",
    resolveWorkspaceId: async (explicitWorkspaceId) => dependencies.resolveAccessibleChatWorkspaceId(
      { userId: context.userId, selectedWorkspaceId: context.workspaceId },
      explicitWorkspaceId,
    ),
    actions: {
      // The chat registers sql_query, sql_execute, list_workspaces, and the static guide, so every
      // action none of them reaches is named as unbound: giving the chat a tool that reaches one
      // has to inject its action here first.
      runSqlQuery: async (sqlContext, sql) => dependencies.runChatSqlQuery(
        sqlContext,
        sql,
        dependencies.createToolDependencies(context),
      ),
      runSqlExecute: async (sqlContext, sql) => dependencies.runChatSqlExecute(
        sqlContext,
        sql,
        dependencies.createToolDependencies(context),
      ),
      listUserWorkspacesWithStatsForSelectedWorkspace:
        dependencies.listUserWorkspacesWithStatsForSelectedWorkspace,
      nextReviewCard: unboundAgentToolAction("nextReviewCard", "chat"),
      revealAnswer: unboundAgentToolAction("revealAnswer", "chat"),
      submitAgentReview: unboundAgentToolAction("submitAgentReview", "chat"),
    },
  };
}

type SqlToolInputSchema = typeof SQL_QUERY_TOOL_INPUT_SCHEMA | typeof SQL_EXECUTE_TOOL_INPUT_SCHEMA;

/**
 * Turns one registry SQL tool call into a chat tool-call result: the `{ ok, tool, sql, ... }`
 * envelope, its `MAX_TOOL_OUTPUT_CHARS` budget, and the Langfuse telemetry are the chat's own and
 * have no counterpart on the external surfaces.
 *
 * The arguments are parsed here as well as inside the spec because this envelope echoes the
 * statement that ran, and the echo has to be the trimmed string the executor received.
 *
 * A write invalidates main content only when it landed in the session's workspace, because clients
 * refresh only the workspace they have open; a write into another workspace reaches it through
 * ordinary sync once the user switches there. Both ids compare as lowercase: the schema lowercases
 * the argument, and the chat HTTP layer lowercases the session's id before the run is created.
 */
async function executeSqlChatToolCall(
  spec: AgentToolSpec<AgentSqlPayload>,
  inputSchema: SqlToolInputSchema,
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): Promise<ExecutedChatToolCall> {
  const sql = getSqlFromRawArguments(rawArguments);
  const isMutating = spec.name === SQL_EXECUTE_TOOL_SPEC.name;
  const startedAt = Date.now();

  try {
    const parsed = inputSchema.parse(JSON.parse(rawArguments));
    const result = await spec.execute(
      buildChatAgentToolContext(context, dependencies),
      parsed,
    );

    return {
      output: createToolSuccessResult(spec.name, {
        sql: parsed.sql,
        data: result.data,
        instructions: result.instructions,
      }),
      isMutating,
      succeeded: true,
      shouldInvalidateMainContent: isMutating
        && (parsed.workspaceId === undefined || parsed.workspaceId === context.workspaceId),
      stopReason: null,
      generatedImageTelemetry: null,
      toolErrorClass: null,
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
    const instructions = createAgentRemediationInstructions(
      error instanceof HttpError ? error.code : null,
      getChatToolFailureStatusCode(error),
      { surface: "chat", toolName: spec.name },
    );
    const payload: ToolErrorPayload = error instanceof HttpError
      ? {
        sql,
        error: serializeToolError(error),
        instructions,
        code: error.code ?? undefined,
        details: error.details ?? undefined,
      }
      : {
        sql,
        error: serializeToolError(error),
        instructions,
      };

    return {
      output: createToolErrorResult(spec.name, payload),
      isMutating,
      succeeded: false,
      shouldInvalidateMainContent: false,
      stopReason: null,
      generatedImageTelemetry: null,
      toolErrorClass: null,
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
 * Turns one call of a registry tool that writes nothing - `get_guide` or `list_workspaces` - into a
 * chat tool-call result, in the same `{ ok, tool, data, instructions }` envelope the SQL tools
 * return, carrying no SQL telemetry.
 *
 * A failure, including arguments the schema rejects, comes back as the same `{ ok: false }`
 * envelope a failed SQL call returns rather than as a throw, because a thrown tool call ends the
 * run: the model repairs its call and continues on its own remediation instructions instead.
 */
async function executeReadOnlyChatToolCall<Data>(
  spec: AgentToolSpec<Data>,
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): Promise<ExecutedChatToolCall> {
  try {
    const result = await spec.execute(
      buildChatAgentToolContext(context, dependencies),
      JSON.parse(rawArguments),
    );

    return {
      output: capSerializedEnvelope(
        {
          ok: true,
          tool: spec.name,
          data: result.data,
          instructions: result.instructions,
        },
        "data",
      ),
      isMutating: false,
      succeeded: true,
      shouldInvalidateMainContent: false,
      stopReason: null,
      generatedImageTelemetry: null,
      sqlTelemetry: null,
      toolErrorClass: null,
    };
  } catch (error) {
    return {
      output: createToolErrorResult(spec.name, {
        error: serializeToolError(error),
        instructions: createAgentRemediationInstructions(
          error instanceof HttpError ? error.code : null,
          getChatToolFailureStatusCode(error),
          { surface: "chat", toolName: spec.name },
        ),
      }),
      isMutating: false,
      succeeded: false,
      shouldInvalidateMainContent: false,
      stopReason: null,
      generatedImageTelemetry: null,
      sqlTelemetry: null,
      toolErrorClass: serializeToolError(error).name,
    };
  }
}

type ChatToolRunner = (
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
) => Promise<ExecutedChatToolCall>;

/**
 * How each registry tool the chat exposes turns into a chat tool-call result. The registry decides
 * which tools exist; this decides how one is rendered for this surface, which is the chat's own
 * concern and differs per tool.
 */
const CHAT_TOOL_RUNNERS: Readonly<Record<string, ChatToolRunner | undefined>> = {
  [SQL_QUERY_TOOL_SPEC.name]: (rawArguments, context, dependencies) => executeSqlChatToolCall(
    SQL_QUERY_TOOL_SPEC,
    SQL_QUERY_TOOL_INPUT_SCHEMA,
    rawArguments,
    context,
    dependencies,
  ),
  [SQL_EXECUTE_TOOL_SPEC.name]: (rawArguments, context, dependencies) => executeSqlChatToolCall(
    SQL_EXECUTE_TOOL_SPEC,
    SQL_EXECUTE_TOOL_INPUT_SCHEMA,
    rawArguments,
    context,
    dependencies,
  ),
  [LIST_WORKSPACES_TOOL_SPEC.name]: (rawArguments, context, dependencies) =>
    executeReadOnlyChatToolCall(LIST_WORKSPACES_TOOL_SPEC, rawArguments, context, dependencies),
  [GET_GUIDE_TOOL_SPEC.name]: (rawArguments, context, dependencies) =>
    executeReadOnlyChatToolCall(GET_GUIDE_TOOL_SPEC, rawArguments, context, dependencies),
};

function requireChatToolRunner(toolName: string): ChatToolRunner {
  const spec = findAgentToolSpecForSurface("chat", toolName);
  if (spec === null) {
    throw new Error(`Unsupported OpenAI tool call: ${toolName}`);
  }

  const runner = CHAT_TOOL_RUNNERS[spec.name];
  if (runner === undefined) {
    throw new Error(`Tool ${spec.name} is listed for the chat surface but carries no chat runner.`);
  }

  return runner;
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

  return requireChatToolRunner(toolName)(rawArguments, context, dependencies);
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
