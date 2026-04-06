import { transactionWithWorkspaceScope, type DatabaseExecutor, type WorkspaceDatabaseScope } from "../../db";
import {
  clearActiveChatComposerSuggestionGenerationWithExecutor,
  createFollowUpChatComposerSuggestionGenerationWithExecutor,
} from "./composerSuggestionService";
import { finalizePendingToolCallContent } from "../history";
import { buildUserStoppedAssistantContent, buildUserStoppedChatRunUpdatePlan, insertChatItemWithExecutor, updateChatItemWithExecutor } from "./messageService";
import { listChatMessagesWithExecutor } from "./readService";
import { resolveRequestedChatSessionWithExecutor, updateChatSessionRunStateWithExecutor } from "./sessionService";
import { selectChatSessionForUpdateRowWithExecutor } from "./repository";
import type {
  CompleteChatRunParams,
  PersistAssistantCancelledParams,
  PersistAssistantTerminalErrorParams,
} from "./types";
import {
  FAILED_TOOL_CALL_OUTPUT,
  INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
} from "./types";

export const completeChatRun = async (
  userId: string,
  workspaceId: string,
  params: CompleteChatRunParams,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    await updateChatItemWithExecutor(
      executor,
      scope,
      {
        itemId: params.assistantItemId,
        content: params.assistantContent,
        state: "completed",
        assistantOpenAIItems: params.assistantOpenAIItems,
      },
    );

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      params.sessionId,
      "idle",
      null,
      null,
    );
    await createFollowUpChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      params.sessionId,
      params.assistantItemId,
      params.composerSuggestions ?? [],
    );
  });

export const persistAssistantTerminalError = async (
  userId: string,
  workspaceId: string,
  params: PersistAssistantTerminalErrorParams,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const finalizedAssistantContent = finalizePendingToolCallContent(
      params.assistantContent,
      INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
      FAILED_TOOL_CALL_OUTPUT,
    );

    if (finalizedAssistantContent.length === 0) {
      await updateChatItemWithExecutor(executor, { userId, workspaceId }, {
        itemId: params.assistantItemId,
        content: [{ type: "text", text: params.errorMessage }],
        state: "error",
        assistantOpenAIItems: params.assistantOpenAIItems,
      });
    } else {
      await updateChatItemWithExecutor(executor, { userId, workspaceId }, {
        itemId: params.assistantItemId,
        content: finalizedAssistantContent,
        state: "completed",
        assistantOpenAIItems: params.assistantOpenAIItems,
      });
      await insertChatItemWithExecutor(executor, { userId, workspaceId }, {
        sessionId: params.sessionId,
        role: "assistant",
        state: "error",
        content: [{ type: "text", text: params.errorMessage }],
      });
    }

    await updateChatSessionRunStateWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      params.sessionState,
      null,
      null,
    );
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      params.sessionState === "interrupted" ? "run_interrupted" : "run_failed",
    );
  });

export const persistAssistantCancelled = async (
  userId: string,
  workspaceId: string,
  params: PersistAssistantCancelledParams,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await updateChatItemWithExecutor(executor, { userId, workspaceId }, {
      itemId: params.assistantItemId,
      content: buildUserStoppedAssistantContent(params.assistantContent),
      state: "cancelled",
      assistantOpenAIItems: params.assistantOpenAIItems,
    });

    await updateChatSessionRunStateWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      "idle",
      null,
      null,
    );
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      "run_cancelled",
    );
  });

export const cancelActiveChatRunByUserWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<boolean> => {
  await resolveRequestedChatSessionWithExecutor(executor, scope, sessionId);
  const lockedSession = await selectChatSessionForUpdateRowWithExecutor(executor, scope, sessionId);
  if (lockedSession.status !== "running") {
    return false;
  }

  const messages = await listChatMessagesWithExecutor(executor, scope, sessionId);
  const updatePlan = buildUserStoppedChatRunUpdatePlan(messages);

  if (updatePlan.assistantItem !== null && updatePlan.assistantContent !== null) {
    await updateChatItemWithExecutor(executor, scope, {
      itemId: updatePlan.assistantItem.itemId,
      content: updatePlan.assistantContent,
      state: "cancelled",
      assistantOpenAIItems: updatePlan.assistantOpenAIItems ?? undefined,
    });
  }

  await updateChatSessionRunStateWithExecutor(
    executor,
    scope,
    sessionId,
    updatePlan.sessionState,
    null,
    null,
  );
  await clearActiveChatComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    sessionId,
    "run_cancelled",
  );
  return true;
};

export const cancelActiveChatRunByUser = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<boolean> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    cancelActiveChatRunByUserWithExecutor(executor, { userId, workspaceId }, sessionId));
