/**
 * Backend-owned run executor for persisted chat sessions.
 * The worker uses this module to consume provider events, update the assistant item incrementally, and finalize run state independently of client connections.
 */
import OpenAI from "openai";
import { startChatTurnObservation } from "../telemetry/langfuse";
import {
  appendAssistantTextContent,
  finalizePendingToolCallContent,
  upsertReasoningSummaryContent,
  upsertToolCallContent,
} from "./history";
import { startOpenAILoop } from "./openai/loop";
import type { ServerChatMessage } from "./openai/replayItems";
import {
  completeClaimedChatRun,
  persistClaimedChatRunCancelled,
  persistClaimedChatRunTerminalError,
  touchClaimedChatRunHeartbeat,
} from "./runs";
import {
  INTERRUPTED_TOOL_CALL_OUTPUT,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
} from "./store";
import type {
  ChatStreamEvent,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "./types";
import { CHAT_RUN_HEARTBEAT_INTERVAL_MS } from "./workerLease";

const INCOMPLETE_TOOL_CALL_PROVIDER_STATUS = "incomplete";

type ChatRunDiagnostics = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  messageCount: number;
  hasAttachments: boolean;
  attachmentFileNames: ReadonlyArray<string>;
}>;

export type StartPersistedChatRunParams = Readonly<{
  runId: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  timezone: string;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  diagnostics: ChatRunDiagnostics;
}>;

export class ChatRunOwnershipLostError extends Error {
  public constructor(runId: string) {
    super(`Chat run ownership lost: ${runId}`);
    this.name = "ChatRunOwnershipLostError";
  }
}

export type ChatRuntimeDependencies = Readonly<{
  startChatTurnObservation: typeof startChatTurnObservation;
  startOpenAILoop: typeof startOpenAILoop;
  completeChatRun: typeof completeClaimedChatRun;
  persistAssistantCancelled: typeof persistClaimedChatRunCancelled;
  persistAssistantTerminalError: typeof persistClaimedChatRunTerminalError;
  touchChatRunHeartbeat: typeof touchClaimedChatRunHeartbeat;
  updateAssistantMessageItem: typeof updateAssistantMessageItem;
  updateAssistantMessageItemAndInvalidateMainContent: typeof updateAssistantMessageItemAndInvalidateMainContent;
  beginTaskProtection: () => Promise<void>;
  endTaskProtection: () => Promise<void>;
}>;

const DEFAULT_CHAT_RUNTIME_DEPENDENCIES: ChatRuntimeDependencies = {
  startChatTurnObservation,
  startOpenAILoop,
  completeChatRun: completeClaimedChatRun,
  persistAssistantCancelled: persistClaimedChatRunCancelled,
  persistAssistantTerminalError: persistClaimedChatRunTerminalError,
  touchChatRunHeartbeat: touchClaimedChatRunHeartbeat,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
  beginTaskProtection: async (): Promise<void> => undefined,
  endTaskProtection: async (): Promise<void> => undefined,
};

/**
 * Narrows the provider abort case used when a user stop request interrupts the active run.
 */
function isUserAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || (error instanceof Error && error.name === "AbortError");
}

/**
 * Converts one streamed tool-call event into the persisted assistant content-part shape.
 */
function createToolCallContentPart(
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

/**
 * Converts one streamed reasoning summary into the persisted assistant content-part shape.
 */
function createReasoningSummaryContentPart(
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

/**
 * Applies one streamed assistant text delta to the persisted assistant content array.
 */
function applyAssistantDelta(
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

/**
 * Persists the in-progress assistant item after ordinary streamed updates.
 */
async function updateAssistantInProgress(
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

/**
 * Persists tool-call progress and invalidates main content when a completed tool requests a UI refresh.
 */
async function persistToolCallProgress(
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

/**
 * Finalizes any open tool calls when the run stops before a terminal provider event arrives.
 */
function finalizeAssistantToolCalls(
  assistantContent: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return finalizePendingToolCallContent(
    assistantContent,
    INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
    INTERRUPTED_TOOL_CALL_OUTPUT,
  );
}

/**
 * Runs one persisted chat session using injectable dependencies for tests and worker orchestration.
 */
export async function runPersistedChatSessionWithDeps(
  params: StartPersistedChatRunParams,
  dependencies: ChatRuntimeDependencies,
): Promise<void> {
  let assistantContent: ReadonlyArray<ContentPart> = [];
  let isFinalized = false;
  let stopRequestedByUser = false;
  let ownershipLost = false;
  const seenInvalidationVersions = new Map<string, number>();
  const abortController = new AbortController();
  const heartbeatTimer = setInterval(() => {
    void dependencies.touchChatRunHeartbeat(
      params.userId,
      params.workspaceId,
      params.runId,
      new Date(),
    ).then((state) => {
      if (state.ownershipLost) {
        ownershipLost = true;
        abortController.abort();
        return;
      }

      if (state.cancellationRequested) {
        stopRequestedByUser = true;
        abortController.abort();
      }
    }).catch((): void => undefined);
  }, CHAT_RUN_HEARTBEAT_INTERVAL_MS);

  try {
    await dependencies.beginTaskProtection();
    const initialHeartbeatState = await dependencies.touchChatRunHeartbeat(
      params.userId,
      params.workspaceId,
      params.runId,
      new Date(),
    );
    if (initialHeartbeatState.ownershipLost) {
      throw new ChatRunOwnershipLostError(params.runId);
    }
    stopRequestedByUser = initialHeartbeatState.cancellationRequested;
    if (stopRequestedByUser) {
      abortController.abort();
    }

    await dependencies.startChatTurnObservation(
      {
        requestId: params.requestId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        model: params.diagnostics.model,
        turnIndex: params.diagnostics.messageCount,
        runState: "running",
        turnInput: params.turnInput,
      },
      async (rootObservation): Promise<void> => {
        const started = await dependencies.startOpenAILoop({
          requestId: params.requestId,
          userId: params.userId,
          workspaceId: params.workspaceId,
          sessionId: params.sessionId,
          timezone: params.timezone,
          localMessages: params.localMessages,
          turnInput: params.turnInput,
          rootObservation,
          signal: abortController.signal,
        });

        for await (const event of started.events) {
          if (stopRequestedByUser || ownershipLost) {
            break;
          }

          if (event.type === "delta") {
            assistantContent = applyAssistantDelta(assistantContent, event);
            await updateAssistantInProgress(
              dependencies,
              params.userId,
              params.workspaceId,
              params.assistantItemId,
              assistantContent,
            );
          } else if (event.type === "tool_call") {
            assistantContent = upsertToolCallContent(assistantContent, createToolCallContentPart(event));
            await persistToolCallProgress(
              dependencies,
              params.userId,
              params.workspaceId,
              params.assistantItemId,
              assistantContent,
              event,
              seenInvalidationVersions,
            );
          } else if (event.type === "reasoning_summary") {
            assistantContent = upsertReasoningSummaryContent(
              assistantContent,
              createReasoningSummaryContentPart(event),
            );
            await updateAssistantInProgress(
              dependencies,
              params.userId,
              params.workspaceId,
              params.assistantItemId,
              assistantContent,
            );
          } else if (event.type === "error") {
            assistantContent = finalizeAssistantToolCalls(assistantContent);
            await dependencies.persistAssistantTerminalError(params.userId, params.workspaceId, {
              runId: params.runId,
              sessionId: params.sessionId,
              assistantItemId: params.assistantItemId,
              assistantContent,
              errorMessage: event.message,
              sessionState: "idle",
            });
            isFinalized = true;
          }
        }

        if (ownershipLost) {
          throw new ChatRunOwnershipLostError(params.runId);
        }

        if (stopRequestedByUser) {
          assistantContent = finalizeAssistantToolCalls(assistantContent);
          await dependencies.persistAssistantCancelled(params.userId, params.workspaceId, {
            runId: params.runId,
            sessionId: params.sessionId,
            assistantItemId: params.assistantItemId,
            assistantContent,
          });
          isFinalized = true;
          return;
        }

        if (!isFinalized) {
          const completion = await started.completion;
          assistantContent = finalizeAssistantToolCalls(assistantContent);
          await dependencies.completeChatRun(params.userId, params.workspaceId, {
            runId: params.runId,
            sessionId: params.sessionId,
            assistantItemId: params.assistantItemId,
            assistantContent,
            assistantOpenAIItems: completion.openaiItems,
          });
          isFinalized = true;
        }
      },
    );
  } catch (error) {
    if (ownershipLost || error instanceof ChatRunOwnershipLostError) {
      return;
    }

    if (stopRequestedByUser && isUserAbortError(error)) {
      assistantContent = finalizeAssistantToolCalls(assistantContent);
      await dependencies.persistAssistantCancelled(params.userId, params.workspaceId, {
        runId: params.runId,
        sessionId: params.sessionId,
        assistantItemId: params.assistantItemId,
        assistantContent,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    await dependencies.persistAssistantTerminalError(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      errorMessage: message,
      sessionState: "idle",
    });
  } finally {
    clearInterval(heartbeatTimer);
    await dependencies.endTaskProtection();
  }
}

/**
 * Runs one persisted chat session with the production runtime dependencies.
 */
export async function runPersistedChatSession(
  params: StartPersistedChatRunParams,
): Promise<void> {
  return runPersistedChatSessionWithDeps(params, DEFAULT_CHAT_RUNTIME_DEPENDENCIES);
}
