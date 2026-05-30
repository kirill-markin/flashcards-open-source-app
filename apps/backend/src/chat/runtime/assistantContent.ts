import {
  appendAssistantTextContent,
  finalizePendingToolCallContent,
  upsertReasoningSummaryContent,
  upsertToolCallContent,
} from "../history";
import {
  INTERRUPTED_TOOL_CALL_OUTPUT,
} from "../store";
import type {
  ChatStreamEvent,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "../types";
import type {
  ChatRuntimeDependencies,
} from "./dependencies";

const INCOMPLETE_TOOL_CALL_PROVIDER_STATUS = "incomplete";

export function createToolCallContentPart(
  event: Extract<ChatStreamEvent, { type: "tool_call" }>,
): ToolCallContentPart {
  return {
    type: "tool_call",
    id: event.id,
    name: event.name,
    status: event.status,
    providerStatus: event.providerStatus ?? null,
    input: event.input ?? null,
    output: event.output ?? null,
    streamPosition: {
      itemId: event.itemId,
      responseIndex: event.responseIndex,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: event.sequenceNumber,
    },
  };
}

export function createReasoningSummaryContentPart(
  event: Extract<ChatStreamEvent, { type: "reasoning_summary" }>,
): ReasoningSummaryContentPart {
  return {
    type: "reasoning_summary",
    summary: event.summary,
    streamPosition: {
      itemId: event.itemId,
      responseIndex: event.responseIndex,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: event.sequenceNumber,
    },
  };
}

export function applyAssistantDelta(
  content: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "delta" }>,
): ReadonlyArray<ContentPart> {
  return appendAssistantTextContent(content, {
    text: event.text,
    streamPosition: {
      itemId: event.itemId,
      responseIndex: event.responseIndex,
      outputIndex: event.outputIndex,
      contentIndex: event.contentIndex,
      sequenceNumber: event.sequenceNumber,
    },
  });
}

export async function updateAssistantInProgress(
  dependencies: ChatRuntimeDependencies,
  userId: string,
  workspaceId: string,
  assistantItemId: string,
  assistantContent: ReadonlyArray<ContentPart>,
): Promise<void> {
  await dependencies.updateAssistantMessageItem(userId, workspaceId, {
    itemId: assistantItemId,
    content: assistantContent,
    state: "in_progress",
  });
}

export async function persistToolCallProgress(
  dependencies: ChatRuntimeDependencies,
  userId: string,
  workspaceId: string,
  assistantItemId: string,
  assistantContent: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "tool_call" }>,
  seenInvalidationVersions: Map<string, number>,
): Promise<void> {
  if (event.status !== "completed" || event.refreshRoute !== true) {
    await updateAssistantInProgress(
      dependencies,
      userId,
      workspaceId,
      assistantItemId,
      assistantContent,
    );
    return;
  }

  const existingVersion = seenInvalidationVersions.get(event.id);
  if (existingVersion !== undefined) {
    await updateAssistantInProgress(
      dependencies,
      userId,
      workspaceId,
      assistantItemId,
      assistantContent,
    );
    return;
  }

  const mainContentInvalidationVersion = await dependencies.updateAssistantMessageItemAndInvalidateMainContent(
    userId,
    workspaceId,
    {
      itemId: assistantItemId,
      content: assistantContent,
      state: "in_progress",
    },
  );
  seenInvalidationVersions.set(event.id, mainContentInvalidationVersion);
}

export function upsertAssistantToolCallContent(
  content: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "tool_call" }>,
): ReadonlyArray<ContentPart> {
  return upsertToolCallContent(content, createToolCallContentPart(event));
}

export function upsertAssistantReasoningSummaryContent(
  content: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "reasoning_summary" }>,
): ReadonlyArray<ContentPart> {
  return upsertReasoningSummaryContent(
    content,
    createReasoningSummaryContentPart(event),
  );
}

export function finalizeAssistantToolCalls(
  assistantContent: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return finalizePendingToolCallContent(
    assistantContent,
    INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
    INTERRUPTED_TOOL_CALL_OUTPUT,
  );
}
