import type OpenAI from "openai";
import { z } from "zod";
import { REVIEW_RATINGS } from "../../../agent/reviewContract";
import { nextReviewCard, revealAnswer, submitAgentReview } from "../../../agent/reviews";
import { hasCognitoIdentityMappingForUser } from "../../../auth/userIdentities";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import { GeneratedMediaPromotionStorageTransientError } from "../../../mediaAssets/storage";
import { resolveAccessibleChatWorkspaceId } from "../../../server/requestContext";
import { createPublicHttpErrorDetails, HttpError } from "../../../shared/errors";
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
import type { AgentSqlPayload } from "../../../aiTools/agentSql/shared";
import { createAgentRemediationInstructions } from "../../../aiTools/toolContract/remediationInstructions";
import { GUIDE_TOPICS } from "../../../aiTools/toolContract/sqlToolContract";
import {
  findAgentToolSpecForSurface,
  listAgentToolSpecsForSurface,
  GET_GUIDE_TOOL_SPEC,
  LIST_WORKSPACES_TOOL_SPEC,
  NEXT_REVIEW_CARD_TOOL_SPEC,
  REVEAL_ANSWER_TOOL_SPEC,
  SQL_EXECUTE_TOOL_INPUT_SCHEMA,
  SQL_EXECUTE_TOOL_SPEC,
  SQL_QUERY_TOOL_INPUT_SCHEMA,
  SQL_QUERY_TOOL_SPEC,
  SUBMIT_REVIEW_TOOL_SPEC,
  type AgentReviewPayload,
} from "../../../aiTools/toolRegistry/specs";
import type { AgentToolContext, AgentToolSpec } from "../../../aiTools/toolRegistry/types";
import { generateCardImage, type GeneratedCardImageObservationContext } from "../../cardImages";
import { isOpenAIImageGenerationProviderError } from "../../cardImages/provider/openaiAdapter";
import {
  GeneratedCardImageDeadlineExceededError,
  GeneratedCardImageGenerationLimitReachedError,
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
import {
  createSqlToolSuccessResult,
  createToolErrorResult,
  createToolSuccessResult,
  type ToolErrorPayload,
} from "./toolResults";

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
  ensureAIChatSyncReplica: typeof ensureAIChatSyncReplica;
  ensureAIChatSyncReplicaWithDeadline: typeof ensureAIChatSyncReplicaWithDeadline;
  generateCardImage: typeof generateCardImage;
  nextReviewCard: typeof nextReviewCard;
  revealAnswer: typeof revealAnswer;
  submitAgentReview: typeof submitAgentReview;
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

const OPENAI_NEXT_REVIEW_CARD_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: NEXT_REVIEW_CARD_TOOL_SPEC.name,
  description: NEXT_REVIEW_CARD_TOOL_SPEC.description,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      workspaceId: {
        type: "string",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
      },
      deckId: {
        type: "string",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

const OPENAI_REVEAL_ANSWER_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: REVEAL_ANSWER_TOOL_SPEC.name,
  description: REVEAL_ANSWER_TOOL_SPEC.description,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      workspaceId: {
        type: "string",
      },
      cardId: {
        type: "string",
      },
    },
    required: ["cardId"],
    additionalProperties: false,
  },
};

/**
 * The rating enum is spelled from `REVIEW_RATINGS`, so a rating added to the shared contract reaches
 * this surface with it, the way the guide topics are spread above. `reviewedTimeZone` and `reviewId`
 * are model-supplied like every other argument: the schema is shared with MCP and
 * `requireChatFunctionTool` forbids advertising a subset of it, so where this surface's timezone
 * comes from is stated in the chat system prompt instead of in the shared tool description.
 */
const OPENAI_SUBMIT_REVIEW_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: SUBMIT_REVIEW_TOOL_SPEC.name,
  description: SUBMIT_REVIEW_TOOL_SPEC.description,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      workspaceId: {
        type: "string",
      },
      cardId: {
        type: "string",
      },
      reviewId: {
        type: "string",
      },
      rating: {
        type: "string",
        enum: [...REVIEW_RATINGS],
      },
      reviewedTimeZone: {
        type: "string",
      },
    },
    required: ["cardId", "reviewId", "rating", "reviewedTimeZone"],
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
  [NEXT_REVIEW_CARD_TOOL_SPEC.name]: OPENAI_NEXT_REVIEW_CARD_TOOL,
  [REVEAL_ANSWER_TOOL_SPEC.name]: OPENAI_REVEAL_ANSWER_TOOL,
  [SUBMIT_REVIEW_TOOL_SPEC.name]: OPENAI_SUBMIT_REVIEW_TOOL,
};

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
 * unguarded; the two enums that could drift are spread from `GUIDE_TOPICS` and `REVIEW_RATINGS`.
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
  ensureAIChatSyncReplica,
  ensureAIChatSyncReplicaWithDeadline,
  generateCardImage,
  nextReviewCard,
  revealAnswer,
  submitAgentReview,
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
    if (error instanceof GeneratedCardImageGenerationLimitReachedError) {
      const code = error.ceiling === "daily"
        ? "daily_generation_limit_reached"
        : "monthly_generation_limit_reached";
      return createGeneratedImageResult(
        {
          ok: false,
          code,
          retryable: false,
          ...(attempt === null ? {} : { attempt }),
          limit: error.limit,
          resetsAt: error.resetsAt,
        },
        {
          attempt,
          status: code,
          succeeded: false,
          isMutating: false,
          shouldInvalidateMainContent: false,
          stopReason: null,
        },
      );
    }
    // Only the code is matched: the same 404 status and wording are also raised after the provider
    // was paid, and that one must keep failing the run instead of becoming a tool result.
    if (
      error instanceof HttpError
      && error.code === "GENERATED_CARD_IMAGE_CARD_NOT_FOUND"
    ) {
      return createGeneratedImageErrorResult(
        "card_not_found",
        attempt !== null && attempt < maximumGeneratedCardImageAttemptsPerRun,
        attempt,
        false,
        null,
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
      nextReviewCard: dependencies.nextReviewCard,
      revealAnswer: dependencies.revealAnswer,
      // There is no agent connection behind this surface, so the review event is stored against the
      // workspace's AI-chat replica, the same sync actor the chat's SQL writes carry. Binding the
      // review write without one would attribute every chat review to the placeholder connection id
      // above, which names no connection at all.
      submitAgentReview: async (reviewContext, request) => dependencies.submitAgentReview(
        reviewContext,
        request,
        async (replicaContext) => dependencies.ensureAIChatSyncReplica(
          replicaContext.workspaceId,
          replicaContext.userId,
          "web",
          context.signal,
        ),
      ),
    },
  };
}

type SqlToolInputSchema = typeof SQL_QUERY_TOOL_INPUT_SCHEMA | typeof SQL_EXECUTE_TOOL_INPUT_SCHEMA;

/**
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
      output: createSqlToolSuccessResult(spec.name, {
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
        details: createPublicHttpErrorDetails(error.details) ?? undefined,
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
 * A failure, including arguments the schema rejects, comes back as the same `{ ok: false }`
 * envelope a failed SQL call returns, carrying an `HttpError`'s `code` and `details`, rather than
 * as a throw, because a thrown tool call ends the run: the model repairs its call and continues on
 * its own remediation instructions instead.
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
      output: createToolSuccessResult(spec.name, {
        data: result.data,
        instructions: result.instructions,
      }),
      isMutating: false,
      succeeded: true,
      shouldInvalidateMainContent: false,
      stopReason: null,
      generatedImageTelemetry: null,
      sqlTelemetry: null,
      toolErrorClass: null,
    };
  } catch (error) {
    const instructions = createAgentRemediationInstructions(
      error instanceof HttpError ? error.code : null,
      getChatToolFailureStatusCode(error),
      { surface: "chat", toolName: spec.name },
    );
    const payload: ToolErrorPayload = error instanceof HttpError
      ? {
        error: serializeToolError(error),
        instructions,
        code: error.code ?? undefined,
        details: createPublicHttpErrorDetails(error.details) ?? undefined,
      }
      : {
        error: serializeToolError(error),
        instructions,
      };

    return {
      output: createToolErrorResult(spec.name, payload),
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

/**
 * The review loop itself is served by `get_guide` topic `review_flow`, so a review result points at
 * it instead of carrying the shared `REVIEW_FLOW_INSTRUCTIONS`: a graded card runs three review
 * calls, and those ~2,000 characters would be re-sent on every later model call of the turn and
 * replayed in every later turn of the session.
 */
const CHAT_REVIEW_RESULT_INSTRUCTIONS =
  "Review one card at a time: speak only frontText, wait for the learner's attempt, call reveal_answer for that cardId, grade the attempt yourself, then call submit_review with a fresh reviewId. Call get_guide with topic review_flow for the rating scale and the full grading rules before your first grading in this conversation. A null card means nothing is due now, so stop rather than calling again.";

/**
 * One review call, rendered for this surface.
 *
 * `submit_review` is the only mutating review tool, and it invalidates main content only when the
 * review landed in the session's workspace, because clients refresh only the workspace they have
 * open - the rule `executeSqlChatToolCall` applies to a write.
 *
 * A failure carries its `code` and `details` the way a failed SQL call does, because the review
 * codes are answered from those fields: `REVIEW_EVENT_CONFLICT` reports the card's stored schedule
 * in `details.reviewSchedule` instead of submitting again.
 *
 * Card text long enough to exceed the tool-output budget comes back as a JSON preview, so the model
 * would grade against a truncated answer. Accepted: nothing bounds card text server-side, and the
 * envelope that is capped still carries its instructions.
 */
async function executeReviewChatToolCall(
  spec: AgentToolSpec<AgentReviewPayload>,
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): Promise<ExecutedChatToolCall> {
  const isMutating = spec.name === SUBMIT_REVIEW_TOOL_SPEC.name;

  try {
    const result = await spec.execute(
      buildChatAgentToolContext(context, dependencies),
      JSON.parse(rawArguments),
    );

    return {
      output: createToolSuccessResult(spec.name, {
        data: result.data,
        instructions: CHAT_REVIEW_RESULT_INSTRUCTIONS,
      }),
      isMutating,
      succeeded: true,
      shouldInvalidateMainContent: isMutating && result.data.workspaceId === context.workspaceId,
      stopReason: null,
      generatedImageTelemetry: null,
      sqlTelemetry: null,
      toolErrorClass: null,
    };
  } catch (error) {
    const instructions = createAgentRemediationInstructions(
      error instanceof HttpError ? error.code : null,
      getChatToolFailureStatusCode(error),
      { surface: "chat", toolName: spec.name },
    );
    const payload: ToolErrorPayload = error instanceof HttpError
      ? {
        error: serializeToolError(error),
        instructions,
        code: error.code ?? undefined,
        details: createPublicHttpErrorDetails(error.details) ?? undefined,
      }
      : {
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
  [NEXT_REVIEW_CARD_TOOL_SPEC.name]: (rawArguments, context, dependencies) =>
    executeReviewChatToolCall(NEXT_REVIEW_CARD_TOOL_SPEC, rawArguments, context, dependencies),
  [REVEAL_ANSWER_TOOL_SPEC.name]: (rawArguments, context, dependencies) =>
    executeReviewChatToolCall(REVEAL_ANSWER_TOOL_SPEC, rawArguments, context, dependencies),
  [SUBMIT_REVIEW_TOOL_SPEC.name]: (rawArguments, context, dependencies) =>
    executeReviewChatToolCall(SUBMIT_REVIEW_TOOL_SPEC, rawArguments, context, dependencies),
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
