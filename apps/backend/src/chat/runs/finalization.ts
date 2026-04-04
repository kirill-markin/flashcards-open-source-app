import type {
  DatabaseExecutor,
  WorkspaceDatabaseScope,
} from "../../db";
import { finalizePendingToolCallContent } from "../history";
import type { ChatSessionRow, PersistedChatMessageItem } from "../store";
import {
  buildUserStoppedAssistantContent,
  insertChatItemWithExecutor,
  INTERRUPTED_TOOL_CALL_OUTPUT,
  listChatMessagesWithExecutor,
  updateChatItemWithExecutor,
  updateChatSessionRunStateWithExecutor,
} from "../store";
import { isChatRunHeartbeatStale } from "../workerLease";
import {
  createChatRunStatusUpdateFromRow,
  selectChatRunForUpdateWithExecutor,
  updateChatRunStatusWithExecutor,
  type ChatRunRow,
} from "./repository";
import type { ChatRunDiagnostics, ClaimedChatRun } from "./types";

function findAssistantItem(
  messages: ReadonlyArray<PersistedChatMessageItem>,
  assistantItemId: string,
): PersistedChatMessageItem | null {
  return messages.find((message) => message.itemId === assistantItemId) ?? null;
}

export async function finalizeCancelledRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  run: ChatRunRow,
): Promise<void> {
  const messages = await listChatMessagesWithExecutor(executor, scope, run.session_id);
  const assistantItem = findAssistantItem(messages, run.assistant_item_id);

  if (assistantItem !== null) {
    await updateChatItemWithExecutor(executor, scope, {
      itemId: assistantItem.itemId,
      content: buildUserStoppedAssistantContent(assistantItem.content),
      state: "cancelled",
      assistantOpenAIItems: assistantItem.openaiItems,
    });
  }

  await updateChatRunStatusWithExecutor(
    executor,
    scope,
    createChatRunStatusUpdateFromRow(run, {
      status: "cancelled",
      cancelRequestedAt: run.cancel_requested_at === null ? new Date() : undefined,
      finishedAt: new Date(),
      lastErrorMessage: null,
    }),
  );

  await updateChatSessionRunStateWithExecutor(
    executor,
    scope,
    run.session_id,
    "idle",
    null,
    null,
  );
}

export async function finalizeInterruptedRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  run: ChatRunRow,
  errorMessage: string,
): Promise<void> {
  const messages = await listChatMessagesWithExecutor(executor, scope, run.session_id);
  const assistantItem = findAssistantItem(messages, run.assistant_item_id);
  const assistantContent = assistantItem === null ? [] : finalizePendingToolCallContent(
    assistantItem.content,
    "incomplete",
    INTERRUPTED_TOOL_CALL_OUTPUT,
  );

  if (assistantItem !== null) {
    if (assistantContent.length === 0) {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: assistantItem.itemId,
        content: [{ type: "text", text: errorMessage }],
        state: "error",
        assistantOpenAIItems: assistantItem.openaiItems,
      });
    } else {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: assistantItem.itemId,
        content: assistantContent,
        state: "completed",
        assistantOpenAIItems: assistantItem.openaiItems,
      });
      await insertChatItemWithExecutor(executor, scope, {
        sessionId: run.session_id,
        role: "assistant",
        state: "error",
        content: [{ type: "text", text: errorMessage }],
      });
    }
  }

  await updateChatRunStatusWithExecutor(
    executor,
    scope,
    createChatRunStatusUpdateFromRow(run, {
      status: "interrupted",
      finishedAt: new Date(),
      lastErrorMessage: errorMessage,
    }),
  );

  await updateChatSessionRunStateWithExecutor(
    executor,
    scope,
    run.session_id,
    "interrupted",
    null,
    null,
  );
}

/**
 * Repairs a run only after its heartbeat is stale enough that no worker is
 * expected to still own it.
 * This is the only by-design recovery path that may finalize an abandoned run
 * after a real worker disappearance.
 */
export async function recoverStaleRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  session: ChatSessionRow,
): Promise<boolean> {
  if (session.status !== "running" || session.active_run_id === null) {
    return false;
  }

  const heartbeatAt = session.active_run_heartbeat_at === null
    ? null
    : new Date(session.active_run_heartbeat_at).getTime();
  if (!isChatRunHeartbeatStale(heartbeatAt, Date.now())) {
    return false;
  }

  const run = await selectChatRunForUpdateWithExecutor(executor, scope, session.active_run_id);
  if (run === null || (run.status !== "queued" && run.status !== "running")) {
    await updateChatSessionRunStateWithExecutor(executor, scope, session.session_id, "interrupted", null, null);
    return true;
  }

  await finalizeInterruptedRunWithExecutor(
    executor,
    scope,
    run,
    "Chat run interrupted before completion.",
  );
  return true;
}

/**
 * Builds the diagnostic payload that travels with a claimed run into the worker runtime.
 */
export function createDiagnostics(
  scope: WorkspaceDatabaseScope,
  run: ChatRunRow,
  localMessages: ClaimedChatRun["localMessages"],
): ChatRunDiagnostics {
  return {
    requestId: run.request_id,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    sessionId: run.session_id,
    model: run.model_id,
    messageCount: localMessages.length,
    hasAttachments: run.turn_input.some((part) => part.type !== "text"),
    attachmentFileNames: run.turn_input
      .filter((part): part is Extract<(typeof run.turn_input)[number], { type: "file" }> => part.type === "file")
      .map((part) => part.fileName),
  };
}
