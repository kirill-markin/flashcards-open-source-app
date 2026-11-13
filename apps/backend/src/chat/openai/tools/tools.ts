import type OpenAI from "openai";
import { z } from "zod";
import { REVIEW_RATINGS } from "../../../agent/reviewContract";
import { nextReviewCard, revealAnswer, submitAgentReview } from "../../../agent/reviews";
import { hasCognitoIdentityMappingForUser } from "../../../auth/userIdentities";
import type {
  ProductAnalyticsClientReportablePlatform,
  ProductAnalyticsDeviceType,
  ProductAnalyticsOsName,
} from "../../../productAnalytics/catalog";
import type { AiChatRunClientDevice } from "../../../productAnalytics/serverFacts/reviewAnswers";
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
import type { AgentSqlPayload, AgentSqlPayloadWithWorkspace } from "../../../aiTools/agentSql/shared";
import { createAgentToolErrorMessage } from "../../../aiTools/toolContract/remediationInstructions";
import { GUIDE_TOPICS } from "../../../aiTools/toolContract/sqlToolContract";
import {
  buildAgentSqlToolPayload,
  findAgentToolSpecForSurface,
  listAgentToolSpecsForSurface,
  GET_GUIDE_TOOL_SPEC,
  GET_USAGE_LIMITS_TOOL_SPEC,
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
import { generateCardImage } from "../../cardImages";
import {
  bindGeneratedCardImageAttemptPayload,
  reserveGeneratedCardImageAttempt,
} from "./generatedImageAttemptBudget";
import { GENERATED_IMAGE_TOOL_NAME, OPENAI_GENERATED_IMAGE_TOOL } from "./generatedImage/contract";
import {
  executeGeneratedImageToolCall,
  type GeneratedImageToolContext,
  type GeneratedImageToolDependencies,
} from "./generatedImage/runner";
import { executeBashToolCall } from "./bashTool";
import { BASH_TOOL_NAME, OPENAI_BASH_TOOL } from "./bashToolContract";
import { executeViewFileToolCall } from "./viewFileTool";
import { OPENAI_VIEW_FILE_TOOL, VIEW_FILE_TOOL_NAME } from "./viewFileToolContract";
import {
  loadAiUsageStatus,
  resolveAiUsageTierForFacts,
} from "../../../aiUsage";
import { resolveAccountKindForSignedInAuth } from "../../../billing/snapshot";
import {
  createSqlToolSuccessResult,
  createToolErrorResult,
  createToolSuccessResult,
  createWholeSqlToolSuccessResult,
  type ToolErrorPayload,
} from "./toolResults";

export type OpenAIToolContext = GeneratedImageToolContext & Readonly<{
  toolCallId: string;
  clientPlatform: ProductAnalyticsClientReportablePlatform | null;
  clientOsName: ProductAnalyticsOsName | null;
  clientDeviceType: ProductAnalyticsDeviceType | null;
  /**
   * Whether the request that started this run authenticated as a signed-in account, carried from
   * `ai.chat_runs.initiating_auth_is_signed_in`. It is the reading the chat route enforced this
   * turn's allowance with (`resolveAccountKindForTransport` in `apps/backend/src/chat/http/handlers.ts`)
   * and the one the worker attributes every usage fact by, so a tool that reports an allowance
   * resolves the account kind from it rather than asking the identity tables.
   */
  initiatingAuthIsSignedIn: boolean;
}>;

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
  sqlTelemetry: SqlToolTelemetry | null;
  toolErrorClass: string | null;
  /**
   * What the model receives in place of `output` during this run, such as the image `view_file` shows.
   * Stored replay items keep only its text (`stripViewedContentFromReplayItems`), so later turns see
   * `output` alone.
   */
  modelContent: ReadonlyArray<OpenAI.Responses.ResponseFunctionCallOutputItem> | null;
}>;

export type OpenAIToolDependencies = GeneratedImageToolDependencies & Readonly<{
  runChatSqlQuery: typeof runChatSqlQuery;
  runChatSqlExecute: typeof runChatSqlExecute;
  createToolDependencies: (context: OpenAIToolContext) => AgentToolOperationDependencies;
  resolveAccessibleChatWorkspaceId: typeof resolveAccessibleChatWorkspaceId;
  listUserWorkspacesWithStatsForSelectedWorkspace: typeof listUserWorkspacesWithStatsForSelectedWorkspace;
  ensureAIChatSyncReplica: typeof ensureAIChatSyncReplica;
  nextReviewCard: typeof nextReviewCard;
  revealAnswer: typeof revealAnswer;
  submitAgentReview: typeof submitAgentReview;
  loadAiUsageStatus: typeof loadAiUsageStatus;
}>;

/** There is no agent connection behind the chat, so its SQL runs under this fixed label. */
const chatSqlConnectionId = "chat-v2";

/**
 * The chat's SQL writes, from its tools and from the sandbox's SQL bridge, carry the workspace's
 * AI-chat replica. That replica names no device, so their analytics device is aiChatClient.
 */
function createChatSqlOperationDependencies(
  signal: AbortSignal | null,
  aiChatClient: AiChatRunClientDevice | null,
): AgentToolOperationDependencies {
  return {
    ...DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
    ensureAgentSyncReplica: async (workspaceId: string, userId: string): Promise<string> =>
      ensureAIChatSyncReplica(
        workspaceId,
        userId,
        "web",
        signal,
      ),
    aiChatClient,
  };
}

function createToolDependencies(context: OpenAIToolContext): AgentToolOperationDependencies {
  return createChatSqlOperationDependencies(context.signal, {
    platform: context.clientPlatform,
    osName: context.clientOsName,
    deviceType: context.clientDeviceType,
  });
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

const OPENAI_GET_USAGE_LIMITS_TOOL: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: GET_USAGE_LIMITS_TOOL_SPEC.name,
  description: GET_USAGE_LIMITS_TOOL_SPEC.description,
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
  [NEXT_REVIEW_CARD_TOOL_SPEC.name]: OPENAI_NEXT_REVIEW_CARD_TOOL,
  [REVEAL_ANSWER_TOOL_SPEC.name]: OPENAI_REVEAL_ANSWER_TOOL,
  [SUBMIT_REVIEW_TOOL_SPEC.name]: OPENAI_SUBMIT_REVIEW_TOOL,
  [GET_USAGE_LIMITS_TOOL_SPEC.name]: OPENAI_GET_USAGE_LIMITS_TOOL,
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
  resolveAiUsageTierForFacts,
  ensureAIChatSyncReplica,
  ensureAIChatSyncReplicaWithDeadline,
  generateCardImage,
  nextReviewCard,
  revealAnswer,
  submitAgentReview,
  loadAiUsageStatus,
};

export function buildOpenAIChatTools(
  generatedImageEligible: boolean,
): ReadonlyArray<OpenAI.Responses.FunctionTool> {
  return generatedImageEligible
    ? [...OPENAI_CHAT_TOOLS, OPENAI_BASH_TOOL, OPENAI_VIEW_FILE_TOOL, OPENAI_GENERATED_IMAGE_TOOL]
    : [...OPENAI_CHAT_TOOLS, OPENAI_BASH_TOOL, OPENAI_VIEW_FILE_TOOL];
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
    connectionId: chatSqlConnectionId,
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
      // above, which names no connection at all. That replica names no device, so the review's
      // analytics device is the one this run was started from. It is shared by every member and
      // session of the workspace, so one reviewId namespace covers all of them.
      submitAgentReview: async (reviewContext, request) => dependencies.submitAgentReview(
        reviewContext,
        request,
        async (replicaContext) => dependencies.ensureAIChatSyncReplica(
          replicaContext.workspaceId,
          replicaContext.userId,
          "web",
          context.signal,
        ),
        {
          platform: context.clientPlatform,
          osName: context.clientOsName,
          deviceType: context.clientDeviceType,
        },
      ),
      // This is the one surface a guest reaches, and a guest and an account carry different caps,
      // so the kind has to be right rather than assumed. It comes from the claim the request that
      // started this run authenticated with, which is the single reading the route enforced the
      // turn's allowance with and the worker attributed its usage facts by. Probing the Cognito
      // identity mapping instead would answer differently in a documented state: after a bound
      // guest upgrade the guest session stays live while its user_id is the account's own, so a call
      // still arriving on the guest credential is enforced against the guest cell and refused, while
      // the probe would say "account" and this tool would report the account's cap instead.
      loadAiUsageStatus: async (userId, now) => dependencies.loadAiUsageStatus(
        userId,
        resolveAccountKindForSignedInAuth(context.initiatingAuthIsSignedIn),
        now,
      ),
    },
  };
}

type SqlToolInputSchema = typeof SQL_QUERY_TOOL_INPUT_SCHEMA | typeof SQL_EXECUTE_TOOL_INPUT_SCHEMA;

type SqlToolFailure = Readonly<{
  output: string;
  sqlTelemetry: SqlToolTelemetry;
}>;

function createSqlToolSuccessTelemetry(data: AgentSqlPayload, startedAt: number): SqlToolTelemetry {
  return {
    succeeded: true,
    errorCode: null,
    errorClass: null,
    dialectReason: null,
    statementType: data.statementType,
    statementCount: getSqlStatementCount(data),
    rowOrAffectedCount: getSqlRowOrAffectedCount(data),
    durationMs: Date.now() - startedAt,
  };
}

/** What a failed registry tool call answers with, carrying an `HttpError`'s `code` and `details`. */
function createChatToolErrorPayload(toolName: string, error: unknown): ToolErrorPayload {
  const serializedError = serializeToolError(error);
  const toolError = {
    name: serializedError.name,
    message: createAgentToolErrorMessage(
      serializedError.message,
      error instanceof HttpError ? error.code : null,
      getChatToolFailureStatusCode(error),
      { surface: "chat", toolName },
    ),
  };

  return error instanceof HttpError
    ? {
      error: toolError,
      code: error.code ?? "REQUEST_FAILED",
      details: createPublicHttpErrorDetails(error.details) ?? undefined,
    }
    : { error: toolError };
}

/** The `{ ok: false }` envelope a failed SQL call answers with, echoing the statement it was sent. */
function createSqlToolFailure(
  toolName: string,
  sql: string | null,
  error: unknown,
  startedAt: number,
): SqlToolFailure {
  return {
    output: createToolErrorResult(toolName, { sql, ...createChatToolErrorPayload(toolName, error) }),
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
  spec: AgentToolSpec<AgentSqlPayloadWithWorkspace>,
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
      }),
      isMutating,
      succeeded: true,
      shouldInvalidateMainContent: isMutating
        && (parsed.workspaceId === undefined || parsed.workspaceId === context.workspaceId),
      stopReason: null,
      toolErrorClass: null,
      modelContent: null,
      sqlTelemetry: createSqlToolSuccessTelemetry(result.data, startedAt),
    };
  } catch (error) {
    const failure = createSqlToolFailure(spec.name, sql, error, startedAt);
    return {
      output: failure.output,
      isMutating,
      succeeded: false,
      shouldInvalidateMainContent: false,
      stopReason: null,
      toolErrorClass: null,
      modelContent: null,
      sqlTelemetry: failure.sqlTelemetry,
    };
  }
}

export type ChatSandboxSqlKind = "query" | "execute";

export type ChatSandboxSqlCall = Readonly<{
  /** The tool's JSON result, which the bridge answers with. */
  output: string;
  sqlTelemetry: SqlToolTelemetry;
}>;

/**
 * A read answer above this would exceed Lambda's 6 MB response limit and reach the sandbox as an
 * opaque gateway error. Only a read is refused for it: a write has already committed by then.
 */
const maximumChatSandboxReadOutputBytes = 4 * 1024 * 1024;

/**
 * One SQL call a `bash` command's code sent through the chat sandbox's SQL bridge
 * (`apps/backend/src/chatSandbox/sqlBridge/route.ts`), run the way `sql_query` and `sql_execute` run
 * theirs: the same argument schema, workspace resolver, chat executors and AI-chat replica, recorded as the
 * `chat-sandbox` surface, and answered with the same envelope. The success envelope is not cut to
 * `MAX_TOOL_OUTPUT_CHARS`, because the command's code reads it rather than the model.
 */
export async function executeChatSandboxSqlCall(
  kind: ChatSandboxSqlKind,
  sql: string,
  explicitWorkspaceId: string | null,
  session: Readonly<{ userId: string; workspaceId: string }>,
  runClientDevice: AiChatRunClientDevice,
): Promise<ChatSandboxSqlCall> {
  const toolName = kind === "query" ? SQL_QUERY_TOOL_SPEC.name : SQL_EXECUTE_TOOL_SPEC.name;
  const startedAt = Date.now();
  try {
    const rawInput = explicitWorkspaceId === null ? { sql } : { sql, workspaceId: explicitWorkspaceId };
    const parsed = kind === "query"
      ? SQL_QUERY_TOOL_INPUT_SCHEMA.parse(rawInput)
      : SQL_EXECUTE_TOOL_INPUT_SCHEMA.parse(rawInput);
    const workspaceId = await resolveAccessibleChatWorkspaceId(
      { userId: session.userId, selectedWorkspaceId: session.workspaceId },
      parsed.workspaceId,
    );
    const sqlContext = {
      userId: session.userId,
      workspaceId,
      selectedWorkspaceId: session.workspaceId,
      connectionId: chatSqlConnectionId,
      surface: "chat-sandbox",
      caller: null,
    } as const;
    const operationDependencies = createChatSqlOperationDependencies(null, runClientDevice);
    const result = kind === "query"
      ? await runChatSqlQuery(sqlContext, parsed.sql, operationDependencies)
      : await runChatSqlExecute(sqlContext, parsed.sql, operationDependencies);
    const output = createWholeSqlToolSuccessResult(toolName, {
      sql: parsed.sql,
      data: buildAgentSqlToolPayload(result.data, workspaceId),
    });
    if (kind === "query" && Buffer.byteLength(output) > maximumChatSandboxReadOutputBytes) {
      throw new HttpError(
        400,
        `The result is too large to return (${Buffer.byteLength(output)} bytes, limit ${maximumChatSandboxReadOutputBytes}). Read fewer rows per call: split a batch into separate calls, lower LIMIT, or SELECT fewer columns.`,
        "QUERY_RESULT_TOO_LARGE",
      );
    }

    return { output, sqlTelemetry: createSqlToolSuccessTelemetry(result.data, startedAt) };
  } catch (error) {
    return createSqlToolFailure(toolName, sql, error, startedAt);
  }
}

/**
 * A failure, including arguments the schema rejects, comes back as the same `{ ok: false }`
 * envelope a failed SQL call returns, carrying an `HttpError`'s `code` and `details`, rather than
 * as a throw, because a thrown tool call ends the run: the model repairs its call and continues from
 * the remediation in `error.message` instead.
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
      output: createToolSuccessResult(spec.name, result.data),
      isMutating: false,
      succeeded: true,
      shouldInvalidateMainContent: false,
      stopReason: null,
      sqlTelemetry: null,
      toolErrorClass: null,
      modelContent: null,
    };
  } catch (error) {
    return {
      output: createToolErrorResult(spec.name, createChatToolErrorPayload(spec.name, error)),
      isMutating: false,
      succeeded: false,
      shouldInvalidateMainContent: false,
      stopReason: null,
      sqlTelemetry: null,
      toolErrorClass: serializeToolError(error).name,
      modelContent: null,
    };
  }
}

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
 * would grade against a truncated answer. Accepted: nothing bounds card text server-side.
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
      output: createToolSuccessResult(spec.name, result.data),
      isMutating,
      succeeded: true,
      shouldInvalidateMainContent: isMutating && result.data.workspaceId === context.workspaceId,
      stopReason: null,
      sqlTelemetry: null,
      toolErrorClass: null,
      modelContent: null,
    };
  } catch (error) {
    return {
      output: createToolErrorResult(spec.name, createChatToolErrorPayload(spec.name, error)),
      isMutating,
      succeeded: false,
      shouldInvalidateMainContent: false,
      stopReason: null,
      sqlTelemetry: null,
      toolErrorClass: serializeToolError(error).name,
      modelContent: null,
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
  [GET_USAGE_LIMITS_TOOL_SPEC.name]: (rawArguments, context, dependencies) =>
    executeReadOnlyChatToolCall(GET_USAGE_LIMITS_TOOL_SPEC, rawArguments, context, dependencies),
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

  if (toolName === BASH_TOOL_NAME) {
    return executeBashToolCall(rawArguments, context);
  }

  if (toolName === VIEW_FILE_TOOL_NAME) {
    return executeViewFileToolCall(rawArguments, context);
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
