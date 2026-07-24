/**
 * Tool execution bridge for backend-owned OpenAI chat.
 * The runtime always routes provider tool calls through this module so SQL validation and output envelopes stay consistent.
 */
import type OpenAI from "openai";
import { HttpError } from "../../../shared/errors";
import { ensureAIChatSyncReplica } from "../../../sync/identity/aiChatIdentity";
import { executeAgentSql } from "../../../aiTools/agentSql";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "../../../aiTools/agentSql/operations";
import { parseSqlStatement, splitSqlStatements } from "../../../aiTools/sqlDialect";
import { isSqlMutationStatement } from "../../../aiTools/agentSql/shared";
import {
  OPENAI_SQL_TOOL,
  SQL_TOOL_ARGUMENT_VALIDATOR,
  SQL_TOOL_NAME,
} from "../../../aiTools/toolContract/sqlToolContract";
import type { ChatRunClaimToken } from "../../runs";

export type OpenAIToolContext = Readonly<{
  userId: string;
  workspaceId: string;
  claimToken: ChatRunClaimToken;
  signal: AbortSignal | null;
}>;

export type ExecutedChatToolCall = Readonly<{
  output: string;
  isMutating: boolean;
  succeeded: boolean;
}>;

type OpenAIToolDependencies = Readonly<{
  executeAgentSql: typeof executeAgentSql;
  createToolDependencies: (context: OpenAIToolContext) => AgentToolOperationDependencies;
}>;

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
      ensureAIChatSyncReplica(workspaceId, userId, "web", context.signal),
  };
}

/**
 * Caps a single oversized envelope field by replacing it with a truncated preview string.
 * Returns the serialized envelope when it already fits, otherwise rebuilds it with the heavy
 * field swapped for a `<fieldKey>Preview` slice plus `truncated`/`omittedChars` markers so the
 * model still receives valid JSON and can tell the result was capped and re-query more narrowly.
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
  // preview slice so the final string is a hard bound at or below MAX_TOOL_OUTPUT_CHARS.
  const reservedLength = buildCapped(0).length;
  const firstPass = buildCapped(Math.max(0, MAX_TOOL_OUTPUT_CHARS - reservedLength));
  if (firstPass.length <= MAX_TOOL_OUTPUT_CHARS) {
    return firstPass;
  }

  const overflow = firstPass.length - MAX_TOOL_OUTPUT_CHARS;
  return buildCapped(Math.max(0, MAX_TOOL_OUTPUT_CHARS - reservedLength - overflow));
}

function createToolSuccessResult(
  payload: Readonly<Record<string, unknown>>,
): string {
  return capSerializedEnvelope(
    {
      ok: true,
      tool: SQL_TOOL_NAME,
      ...payload,
    },
    "data",
  );
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

export const OPENAI_CHAT_TOOLS: ReadonlyArray<OpenAI.Responses.FunctionTool> = [OPENAI_SQL_TOOL];

const DEFAULT_OPENAI_TOOL_DEPENDENCIES: OpenAIToolDependencies = {
  executeAgentSql,
  createToolDependencies,
};

/**
 * Executes one provider tool call with injectable dependencies for tests and loop orchestration.
 */
export async function executeChatToolCallWithDependencies(
  toolName: string,
  rawArguments: string,
  context: OpenAIToolContext,
  dependencies: OpenAIToolDependencies,
): Promise<ExecutedChatToolCall> {
  if (toolName !== SQL_TOOL_NAME) {
    throw new Error(`Unsupported OpenAI tool call: ${toolName}`);
  }

  const sql = getSqlFromRawArguments(rawArguments);
  const isMutating = getIsMutatingSql(sql);

  try {
    const parsed = SQL_TOOL_ARGUMENT_VALIDATOR.parse(JSON.parse(rawArguments));
    const result = await dependencies.executeAgentSql(
      {
        userId: context.userId,
        workspaceId: context.workspaceId,
        selectedWorkspaceId: context.workspaceId,
        connectionId: "chat-v2",
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
