import type OpenAI from "openai";
import { HttpError } from "../../errors";
import { ensureAIChatSyncDevice } from "../../aiChatSyncIdentity";
import { executeAgentSql } from "../../aiTools/agentSql";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "../../aiTools/agentToolOperations";
import { parseSqlStatement, splitSqlStatements } from "../../aiTools/sqlDialect";
import { isSqlMutationStatement } from "../../aiTools/agentSqlShared";
import {
  OPENAI_SQL_TOOL,
  SQL_TOOL_ARGUMENT_VALIDATOR,
  SQL_TOOL_NAME,
} from "../../aiTools/sqlToolContract";

export type OpenAIToolContext = Readonly<{
  userId: string;
  workspaceId: string;
}>;

export type ExecutedChatToolCall = Readonly<{
  output: string;
  isMutating: boolean;
  succeeded: boolean;
}>;

type OpenAIToolDependencies = Readonly<{
  executeAgentSql: typeof executeAgentSql;
  createToolDependencies: () => AgentToolOperationDependencies;
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

function createToolDependencies(): AgentToolOperationDependencies {
  return {
    ...DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
    ensureAgentSyncDevice: async (workspaceId: string, userId: string): Promise<string> =>
      ensureAIChatSyncDevice(workspaceId, userId, "web"),
  };
}

function createToolSuccessResult(
  payload: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify({
    ok: true,
    tool: SQL_TOOL_NAME,
    ...payload,
  });
}

function createToolErrorResult(payload: ToolErrorPayload): string {
  return JSON.stringify({
    ok: false,
    tool: SQL_TOOL_NAME,
    ...payload,
  });
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
      dependencies.createToolDependencies(),
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
