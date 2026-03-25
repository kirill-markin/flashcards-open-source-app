import OpenAI from "openai";
import {
  appendAssistantTextContent,
  finalizePendingToolCallContent,
  upsertReasoningSummaryContent,
  upsertToolCallContent,
} from "./history";
import { startOpenAILoop } from "./openai/loop";
import type {
  ServerChatMessage,
  StoredOpenAIReplayItem,
} from "./openai/replayItems";
import {
  buildUserStoppedAssistantContent,
  completeChatRun,
  INTERRUPTED_TOOL_CALL_OUTPUT,
  persistAssistantCancelled,
  persistAssistantTerminalError,
  touchChatSessionHeartbeat,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
} from "./store";
import type {
  ChatStreamEvent,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "./types";

export const CHAT_RUN_HEARTBEAT_INTERVAL_MS = 5_000;
export const CHAT_RUN_STALE_HEARTBEAT_MS = 30_000;
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

type ChatRunSubscriber = Readonly<{
  push: (event: ChatStreamEvent) => void;
  close: () => void;
  createIterator: () => AsyncGenerator<ChatStreamEvent>;
}>;

type ActiveChatRun = {
  subscribers: Set<ChatRunSubscriber>;
  abortController: AbortController;
  stopRequestedByUser: boolean;
  cancellationState: "active" | "requested" | "persisted";
};

export type ChatRuntimeDependencies = Readonly<{
  startOpenAILoop: typeof startOpenAILoop;
  completeChatRun: typeof completeChatRun;
  persistAssistantCancelled: typeof persistAssistantCancelled;
  persistAssistantTerminalError: typeof persistAssistantTerminalError;
  touchChatSessionHeartbeat: typeof touchChatSessionHeartbeat;
  updateAssistantMessageItem: typeof updateAssistantMessageItem;
  updateAssistantMessageItemAndInvalidateMainContent: typeof updateAssistantMessageItemAndInvalidateMainContent;
  beginTaskProtection: () => Promise<void>;
  endTaskProtection: () => Promise<void>;
}>;

const activeChatRuns = new Map<string, ActiveChatRun>();

const DEFAULT_CHAT_RUNTIME_DEPENDENCIES: ChatRuntimeDependencies = {
  startOpenAILoop,
  completeChatRun,
  persistAssistantCancelled,
  persistAssistantTerminalError,
  touchChatSessionHeartbeat,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
  beginTaskProtection: async (): Promise<void> => undefined,
  endTaskProtection: async (): Promise<void> => undefined,
};

function isUserAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || (error instanceof Error && error.name === "AbortError");
}

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

function broadcastChatEvent(sessionId: string, event: ChatStreamEvent): void {
  const activeRun = activeChatRuns.get(sessionId);
  if (activeRun === undefined || activeRun.cancellationState !== "active") {
    return;
  }

  for (const subscriber of activeRun.subscribers) {
    subscriber.push(event);
  }
}

function closeSubscribers(sessionId: string): void {
  const activeRun = activeChatRuns.get(sessionId);
  if (activeRun === undefined) {
    return;
  }

  for (const subscriber of activeRun.subscribers) {
    subscriber.close();
  }
}

function getActiveChatRun(sessionId: string): ActiveChatRun | undefined {
  return activeChatRuns.get(sessionId);
}

function createChatRunSubscriber(sessionId: string): ChatRunSubscriber {
  const queuedEvents: Array<ChatStreamEvent> = [];
  let isClosed = false;
  let nextEventResolver: ((result: IteratorResult<ChatStreamEvent>) => void) | null = null;
  let subscriber: ChatRunSubscriber | null = null;

  const resolvePending = (result: IteratorResult<ChatStreamEvent>): void => {
    if (nextEventResolver === null) {
      return;
    }

    const resolver = nextEventResolver;
    nextEventResolver = null;
    resolver(result);
  };

  const nextEvent = async (): Promise<IteratorResult<ChatStreamEvent>> => {
    if (queuedEvents.length > 0) {
      const value = queuedEvents.shift();
      if (value === undefined) {
        throw new Error("Chat subscriber queue unexpectedly returned no event");
      }
      return { done: false, value };
    }

    if (isClosed) {
      return { done: true, value: undefined };
    }

    return new Promise<IteratorResult<ChatStreamEvent>>((resolve) => {
      nextEventResolver = resolve;
    });
  };

  subscriber = {
    push: (event: ChatStreamEvent): void => {
      if (isClosed) {
        return;
      }

      if (nextEventResolver !== null) {
        resolvePending({ done: false, value: event });
        return;
      }

      queuedEvents.push(event);
    },
    close: (): void => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      resolvePending({ done: true, value: undefined });
    },
    createIterator: async function* (): AsyncGenerator<ChatStreamEvent> {
      try {
        while (true) {
          const next = await nextEvent();
          if (next.done) {
            return;
          }

          yield next.value;
        }
      } finally {
        const activeRun = activeChatRuns.get(sessionId);
        if (activeRun !== undefined && subscriber !== null) {
          activeRun.subscribers.delete(subscriber);
        }
        if (subscriber !== null) {
          subscriber.close();
        }
      }
    },
  };

  return subscriber;
}

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

async function persistToolCallProgress(
  dependencies: ChatRuntimeDependencies,
  userId: string,
  workspaceId: string,
  assistantItemId: string,
  assistantContent: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "tool_call" }>,
  seenInvalidationVersions: Map<string, number>,
): Promise<Extract<ChatStreamEvent, { type: "tool_call" }>> {
  if (event.status !== "completed" || event.refreshRoute !== true) {
    await updateAssistantInProgress(
      dependencies,
      userId,
      workspaceId,
      assistantItemId,
      assistantContent,
    );
    return event;
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
    return {
      ...event,
      mainContentInvalidationVersion: existingVersion,
    };
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
  return {
    ...event,
    mainContentInvalidationVersion,
  };
}

function finalizeAssistantToolCalls(
  assistantContent: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return finalizePendingToolCallContent(
    assistantContent,
    INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
    INTERRUPTED_TOOL_CALL_OUTPUT,
  );
}

export async function runPersistedChatSessionWithDeps(
  params: StartPersistedChatRunParams,
  dependencies: ChatRuntimeDependencies,
): Promise<void> {
  let assistantContent: ReadonlyArray<ContentPart> = [];
  let assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem> | undefined;
  let isFinalized = false;
  const seenInvalidationVersions = new Map<string, number>();
  const heartbeatTimer = setInterval(() => {
    void dependencies.touchChatSessionHeartbeat(
      params.userId,
      params.workspaceId,
      params.sessionId,
      new Date(),
    ).catch((): void => undefined);
  }, CHAT_RUN_HEARTBEAT_INTERVAL_MS);

  const persistUserCancellationIfNeeded = async (): Promise<boolean> => {
    const activeRun = getActiveChatRun(params.sessionId);
    if (activeRun === undefined || activeRun.stopRequestedByUser !== true) {
      return false;
    }

    if (activeRun.cancellationState === "persisted") {
      return true;
    }

    assistantContent = buildUserStoppedAssistantContent(assistantContent);
    await dependencies.persistAssistantCancelled(params.userId, params.workspaceId, {
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
    });
    activeRun.cancellationState = "persisted";
    return true;
  };

  try {
    await dependencies.beginTaskProtection();
    await dependencies.touchChatSessionHeartbeat(
      params.userId,
      params.workspaceId,
      params.sessionId,
      new Date(),
    );

    const started = await dependencies.startOpenAILoop({
      requestId: params.requestId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      timezone: params.timezone,
      localMessages: params.localMessages,
      turnInput: params.turnInput,
      signal: getActiveChatRun(params.sessionId)?.abortController.signal,
    });

    for await (const event of started.events) {
      if (await persistUserCancellationIfNeeded()) {
        return;
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
        const eventToBroadcast = await persistToolCallProgress(
          dependencies,
          params.userId,
          params.workspaceId,
          params.assistantItemId,
          assistantContent,
          event,
          seenInvalidationVersions,
        );
        broadcastChatEvent(params.sessionId, eventToBroadcast);
        continue;
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
          sessionId: params.sessionId,
          assistantItemId: params.assistantItemId,
          assistantContent,
          errorMessage: event.message,
          sessionState: "idle",
        });
        isFinalized = true;
      }

      broadcastChatEvent(params.sessionId, event);
    }

    if (await persistUserCancellationIfNeeded()) {
      return;
    }

    if (!isFinalized) {
      const completion = await started.completion;
      assistantOpenAIItems = completion.openaiItems;
      assistantContent = finalizeAssistantToolCalls(assistantContent);
      await dependencies.completeChatRun(params.userId, params.workspaceId, {
        assistantItemId: params.assistantItemId,
        assistantContent,
        assistantOpenAIItems,
      });
      isFinalized = true;
    }
  } catch (error) {
    const activeRun = getActiveChatRun(params.sessionId);
    const stoppedByUser = activeRun?.stopRequestedByUser === true;

    if (stoppedByUser && isUserAbortError(error)) {
      await persistUserCancellationIfNeeded();
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    await dependencies.persistAssistantTerminalError(params.userId, params.workspaceId, {
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      errorMessage: message,
      sessionState: "idle",
    });
    broadcastChatEvent(params.sessionId, { type: "error", message });
  } finally {
    clearInterval(heartbeatTimer);
    closeSubscribers(params.sessionId);
    activeChatRuns.delete(params.sessionId);
    await dependencies.endTaskProtection();
  }
}

async function runPersistedChatSession(
  params: StartPersistedChatRunParams,
): Promise<void> {
  return runPersistedChatSessionWithDeps(params, DEFAULT_CHAT_RUNTIME_DEPENDENCIES);
}

export function hasActiveChatRun(sessionId: string): boolean {
  return activeChatRuns.get(sessionId)?.cancellationState === "active";
}

export function startPersistedChatRun(
  params: StartPersistedChatRunParams,
): AsyncGenerator<ChatStreamEvent> {
  if (activeChatRuns.has(params.sessionId)) {
    throw new Error(`Chat session already has an active in-process run: ${params.sessionId}`);
  }

  const abortController = new AbortController();
  const subscriber = createChatRunSubscriber(params.sessionId);
  activeChatRuns.set(params.sessionId, {
    subscribers: new Set([subscriber]),
    abortController,
    stopRequestedByUser: false,
    cancellationState: "active",
  });

  void runPersistedChatSession(params);

  return subscriber.createIterator();
}

export function stopActiveChatRun(sessionId: string): boolean {
  const activeRun = activeChatRuns.get(sessionId);
  if (activeRun === undefined || activeRun.cancellationState !== "active") {
    return false;
  }

  activeRun.stopRequestedByUser = true;
  activeRun.cancellationState = "requested";
  activeRun.abortController.abort();
  closeSubscribers(sessionId);
  return true;
}

export function markActiveChatRunCancellationPersisted(sessionId: string): void {
  const activeRun = activeChatRuns.get(sessionId);
  if (activeRun === undefined) {
    return;
  }

  activeRun.cancellationState = "persisted";
}

export function createActiveChatRunForTests(sessionId: string): void {
  if (activeChatRuns.has(sessionId)) {
    throw new Error(`Active chat run already exists for tests: ${sessionId}`);
  }

  activeChatRuns.set(sessionId, {
    subscribers: new Set(),
    abortController: new AbortController(),
    stopRequestedByUser: false,
    cancellationState: "active",
  });
}

export function clearActiveChatRunForTests(sessionId: string): void {
  activeChatRuns.delete(sessionId);
}
