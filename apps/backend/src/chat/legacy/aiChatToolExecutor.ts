import { createAgentEnvelope, createAgentErrorEnvelope } from "../../agentEnvelope";
import { executeAgentSql } from "../../aiTools/agentSql";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "../../aiTools/agentToolOperations";
import { ensureAIChatSyncDevice } from "../../aiChatSyncIdentity";
import { HttpError } from "../../errors";

export type AIChatToolExecutionContext = Readonly<{
  requestUrl: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
  devicePlatform: "ios" | "android" | "web";
}>;

function createAIChatAgentDependencies(
  devicePlatform: "ios" | "android" | "web",
): AgentToolOperationDependencies {
  return {
    ...DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
    ensureAgentSyncDevice: async (workspaceId: string, userId: string): Promise<string> => ensureAIChatSyncDevice(
      workspaceId,
      userId,
      devicePlatform,
    ),
  };
}

function toToolErrorOutput(
  context: AIChatToolExecutionContext,
  error: unknown,
): string {
  if (error instanceof HttpError) {
    return JSON.stringify(createAgentErrorEnvelope(
      context.requestUrl,
      error.code ?? "QUERY_INVALID_SQL",
      error.message,
      "Correct the SQL and try again.",
      context.requestId,
      error.details ?? undefined,
    ));
  }

  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify(createAgentErrorEnvelope(
    context.requestUrl,
    "AI_CHAT_TOOL_EXECUTION_FAILED",
    message,
    "The tool call failed on the backend. Read error.message and correct the next tool call.",
    context.requestId,
  ));
}

export async function executeAIChatSqlTool(
  context: AIChatToolExecutionContext,
  sql: string,
): Promise<string> {
  try {
    const result = await executeAgentSql({
      userId: context.userId,
      workspaceId: context.workspaceId,
      selectedWorkspaceId: context.selectedWorkspaceId,
      connectionId: `ai-chat:${context.devicePlatform}:chat`,
    }, sql, createAIChatAgentDependencies(context.devicePlatform));

    return JSON.stringify(createAgentEnvelope(
      context.requestUrl,
      result.data,
      result.instructions,
    ));
  } catch (error) {
    return toToolErrorOutput(context, error);
  }
}
