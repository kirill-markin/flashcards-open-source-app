import { transactionWithWorkspaceScope, type DatabaseExecutor, type WorkspaceDatabaseScope } from "../../db";
import type { ContentPart } from "../types";
import { mapChatItemRow, toChatItemPayload, buildLocalChatMessages } from "./mappers";
import {
  insertChatItemRowWithExecutor,
  listChatItemRowsWithExecutor,
  updateChatItemAndInvalidateMainContentRowWithExecutor,
  updateChatItemRowWithExecutor,
} from "./repository";
import type {
  InsertChatItemParams,
  PersistedChatMessageItem,
  UpdateChatMessageItemAndInvalidateMainContentParams,
  UpdateChatMessageItemParams,
  UserStoppedChatRunUpdatePlan,
} from "./types";
import {
  INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
  STOPPED_BY_USER_TOOL_OUTPUT,
} from "./types";

export { buildLocalChatMessages };

export async function insertChatItemWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: InsertChatItemParams,
): Promise<PersistedChatMessageItem> {
  const row = await insertChatItemRowWithExecutor(
    executor,
    scope,
    params.sessionId,
    params.state,
    toChatItemPayload(params.role, params.content, params.assistantOpenAIItems),
  );
  return mapChatItemRow(row);
}

export async function updateChatItemWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: UpdateChatMessageItemParams,
): Promise<PersistedChatMessageItem> {
  const row = await updateChatItemRowWithExecutor(
    executor,
    scope,
    params.itemId,
    toChatItemPayload("assistant", params.content, params.assistantOpenAIItems),
    params.state,
  );
  return mapChatItemRow(row);
}

async function updateChatItemAndInvalidateMainContentWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: UpdateChatMessageItemAndInvalidateMainContentParams,
): Promise<Readonly<{
  item: PersistedChatMessageItem;
  mainContentInvalidationVersion: number;
}>> {
  const row = await updateChatItemAndInvalidateMainContentRowWithExecutor(
    executor,
    scope,
    params.itemId,
    toChatItemPayload("assistant", params.content, params.assistantOpenAIItems),
    params.state,
  );

  return {
    item: mapChatItemRow(row),
    mainContentInvalidationVersion: typeof row.main_content_invalidation_version === "number"
      ? row.main_content_invalidation_version
      : Number.parseInt(row.main_content_invalidation_version, 10),
  };
}

export const updateAssistantMessageItem = async (
  userId: string,
  workspaceId: string,
  params: UpdateChatMessageItemParams,
): Promise<PersistedChatMessageItem> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    updateChatItemWithExecutor(executor, { userId, workspaceId }, params));

export const updateAssistantMessageItemAndInvalidateMainContent = async (
  userId: string,
  workspaceId: string,
  params: UpdateChatMessageItemAndInvalidateMainContentParams,
): Promise<number> => {
  const result = await transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    updateChatItemAndInvalidateMainContentWithExecutor(executor, { userId, workspaceId }, params));
  return result.mainContentInvalidationVersion;
};

export const buildUserStoppedAssistantContent = (
  content: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> =>
  content.map((part) => {
    if (part.type !== "tool_call" || part.status !== "started") {
      return part;
    }

    return {
      ...part,
      status: "completed",
      providerStatus: INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
      output: part.output ?? STOPPED_BY_USER_TOOL_OUTPUT,
    };
  });

export const buildUserStoppedChatRunUpdatePlan = (
  messages: ReadonlyArray<PersistedChatMessageItem>,
): UserStoppedChatRunUpdatePlan => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.state !== "in_progress") {
      continue;
    }

    return {
      assistantItem: message,
      assistantContent: buildUserStoppedAssistantContent(message.content),
      assistantOpenAIItems: message.openaiItems ?? null,
      sessionState: "idle",
    };
  }

  return {
    assistantItem: null,
    assistantContent: null,
    assistantOpenAIItems: null,
    sessionState: "idle",
  };
};

export const listChatMessagesWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> => {
  const rows = await listChatItemRowsWithExecutor(executor, scope, sessionId);
  return rows.map((row) => mapChatItemRow(row));
};
