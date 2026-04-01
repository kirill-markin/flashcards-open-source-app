import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createNewChatSession,
  getChatSnapshot,
  startChatRun,
  stopChatRun,
} from "../api";
import type { PendingAttachment } from "./FileAttachment";
import {
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  ATTACHMENT_LIMIT_ERROR_MESSAGE,
  buildContentParts,
  sanitizeErrorText,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import {
  getChatComposerAction,
  getEffectiveSnapshotRunState,
  isChatRunActive,
  type ChatComposerAction,
  type ChatRunState,
} from "./streamRecovery";
import {
  OPTIMISTIC_ASSISTANT_STATUS_TEXT,
  useChatHistory,
  type StoredMessage,
} from "./useChatHistory";
import { defaultChatConfig, loadStoredChatConfig, storeChatConfig } from "./chatConfig";
import type { ChatSessionSnapshot } from "./chatSessionSnapshot";
import {
  loadChatSessionWarmStartSnapshot,
  storeChatSessionWarmStartSnapshot,
  type WarmStartChatSessionSnapshot,
} from "./chatSessionWarmStart";
import { consumeChatLiveStream, type ChatLiveEvent } from "./liveStream";
import type {
  ChatConfig,
  ChatLiveStream,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "../types";

type UseChatSessionControllerParams = Readonly<{
  workspaceId: string | null;
  isRemoteReady: boolean;
  onMainContentInvalidated: (mainContentInvalidationVersion: number) => void;
}>;

export type SendChatMessageParams = Readonly<{
  clientRequestId: string;
  text: string;
  attachments: ReadonlyArray<PendingAttachment>;
}>;

export type SendChatMessageResult = Readonly<{
  accepted: boolean;
}>;

export type ChatSessionController = Readonly<{
  messages: ReturnType<typeof useChatHistory>["messages"];
  runState: ChatRunState;
  isHistoryLoaded: boolean;
  isAssistantRunActive: boolean;
  isLiveStreamConnected: boolean;
  isStopping: boolean;
  currentSessionId: string | null;
  mainContentInvalidationVersion: number;
  chatConfig: ChatConfig;
  composerAction: ChatComposerAction;
  composerNotice: string | null;
  acceptServerSessionId: (sessionId: string) => void;
  sendMessage: (params: SendChatMessageParams) => Promise<SendChatMessageResult>;
  stopMessage: () => Promise<void>;
  clearConversation: () => Promise<void>;
}>;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorText(500, error.message);
  }

  return String(error);
}

function isChatApiError(error: unknown): error is Readonly<{
  statusCode: number;
  code: string | null;
}> {
  if (error instanceof ApiError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const code = "code" in error ? error.code : undefined;
  return typeof statusCode === "number" && (typeof code === "string" || code === null);
}

type ActiveLiveStreamConnection = Readonly<{
  sessionId: string;
  abortController: AbortController;
}>;

type StreamPosition = Readonly<{
  itemId: string;
  responseIndex?: number;
  outputIndex: number;
  contentIndex: number | null;
  sequenceNumber: number | null;
}>;

function areStreamPositionsEqual(
  left: StreamPosition | undefined,
  right: StreamPosition | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  return left.itemId === right.itemId
    && left.responseIndex === right.responseIndex
    && left.outputIndex === right.outputIndex
    && left.contentIndex === right.contentIndex
    && left.sequenceNumber === right.sequenceNumber;
}

function areContentPartsEqual(
  left: ReadonlyArray<ContentPart>,
  right: ReadonlyArray<ContentPart>,
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart?.type !== rightPart?.type) {
      return false;
    }

    switch (leftPart?.type) {
      case "text":
        if (rightPart.type !== "text" || leftPart.text !== rightPart.text) {
          return false;
        }
        break;
      case "image":
        if (
          rightPart.type !== "image"
          || leftPart.mediaType !== rightPart.mediaType
          || leftPart.base64Data !== rightPart.base64Data
        ) {
          return false;
        }
        break;
      case "file":
        if (
          rightPart.type !== "file"
          || leftPart.mediaType !== rightPart.mediaType
          || leftPart.base64Data !== rightPart.base64Data
          || leftPart.fileName !== rightPart.fileName
        ) {
          return false;
        }
        break;
      case "tool_call":
        if (
          rightPart.type !== "tool_call"
          || leftPart.id !== rightPart.id
          || leftPart.name !== rightPart.name
          || leftPart.status !== rightPart.status
          || leftPart.providerStatus !== rightPart.providerStatus
          || leftPart.input !== rightPart.input
          || leftPart.output !== rightPart.output
          || areStreamPositionsEqual(leftPart.streamPosition, rightPart.streamPosition) === false
        ) {
          return false;
        }
        break;
      case "reasoning_summary":
        if (
          rightPart.type !== "reasoning_summary"
          || leftPart.reasoningId !== rightPart.reasoningId
          || leftPart.summary !== rightPart.summary
          || leftPart.status !== rightPart.status
          || areStreamPositionsEqual(leftPart.streamPosition, rightPart.streamPosition) === false
        ) {
          return false;
        }
        break;
      default:
        return false;
    }
  }

  return true;
}

function areMessagesEqual(
  left: ReadonlyArray<StoredMessage>,
  right: ReadonlyArray<StoredMessage>,
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftMessage = left[index];
    const rightMessage = right[index];

    if (
      leftMessage?.role !== rightMessage?.role
      || leftMessage.timestamp !== rightMessage.timestamp
      || leftMessage.isError !== rightMessage.isError
      || leftMessage.isStopped !== rightMessage.isStopped
      || areContentPartsEqual(leftMessage.content, rightMessage.content) === false
    ) {
      return false;
    }
  }

  return true;
}

function areChatConfigsEqual(left: ChatConfig, right: ChatConfig): boolean {
  return left.provider.id === right.provider.id
    && left.provider.label === right.provider.label
    && left.model.id === right.model.id
    && left.model.label === right.model.label
    && left.model.badgeLabel === right.model.badgeLabel
    && left.reasoning.effort === right.reasoning.effort
    && left.reasoning.label === right.reasoning.label
    && left.features.modelPickerEnabled === right.features.modelPickerEnabled
    && left.features.dictationEnabled === right.features.dictationEnabled
    && left.features.attachmentsEnabled === right.features.attachmentsEnabled;
}

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return document.visibilityState === "visible";
}

function toAssistantToolCallContentPart(
  event: Extract<ChatLiveEvent, { type: "assistant_tool_call" }>,
): ToolCallContentPart {
  return {
    type: "tool_call",
    id: event.toolCallId,
    name: event.name,
    status: event.status,
    providerStatus: event.providerStatus ?? null,
    input: event.input,
    output: event.output,
    streamPosition: {
      itemId: event.itemId,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: null,
    },
  };
}

function toAssistantReasoningSummaryContentPart(
  event: Extract<ChatLiveEvent, { type: "assistant_reasoning_started" | "assistant_reasoning_summary" | "assistant_reasoning_done" }>,
): ReasoningSummaryContentPart {
  const summary = event.type === "assistant_reasoning_summary" ? event.summary : "";
  const status = event.type === "assistant_reasoning_done" ? "completed" : "started";

  return {
    type: "reasoning_summary",
    reasoningId: event.reasoningId,
    summary,
    status,
    streamPosition: {
      itemId: event.reasoningId,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: null,
    },
  };
}

export function useChatSessionController(
  params: UseChatSessionControllerParams,
): ChatSessionController {
  const { workspaceId, isRemoteReady, onMainContentInvalidated } = params;
  const initialWarmStartSnapshotRef = useRef<WarmStartChatSessionSnapshot | null>(
    loadChatSessionWarmStartSnapshot(workspaceId),
  );
  const initialWarmStartSnapshot = initialWarmStartSnapshotRef.current;
  const {
    messages,
    replaceMessages,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantText,
    upsertAssistantToolCall,
    upsertAssistantReasoningSummary,
    completeAssistantReasoningSummary,
    finishAssistantMessage,
    markAssistantError,
    clearHistory,
  } = useChatHistory(initialWarmStartSnapshot?.messages ?? []);

  const [isHistoryLoaded, setIsHistoryLoaded] = useState<boolean>(
    initialWarmStartSnapshot !== null || workspaceId === null,
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    initialWarmStartSnapshot?.sessionId ?? null,
  );
  const [runState, setRunState] = useState<ChatRunState>("idle");
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [mainContentInvalidationVersion, setMainContentInvalidationVersion] = useState<number>(
    initialWarmStartSnapshot?.mainContentInvalidationVersion ?? 0,
  );
  const [chatConfig, setChatConfig] = useState<ChatConfig>(
    initialWarmStartSnapshot?.chatConfig ?? loadStoredChatConfig(),
  );
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [isLiveStreamConnected, setIsLiveStreamConnected] = useState<boolean>(false);

  const lastSnapshotUpdatedAtRef = useRef<number | null>(initialWarmStartSnapshot?.updatedAt ?? null);
  const hasObservedMainContentInvalidationVersionRef = useRef<boolean>(false);
  const lastMainContentInvalidationVersionRef = useRef<number>(0);
  const hydratedWorkspaceIdRef = useRef<string | null>(initialWarmStartSnapshot?.workspaceId ?? null);
  const stoppedSessionIdsRef = useRef<Set<string>>(new Set());
  const activeLiveConnectionRef = useRef<ActiveLiveStreamConnection | null>(null);
  const runStateRef = useRef<ChatRunState>("idle");
  const messagesRef = useRef<ReadonlyArray<StoredMessage>>(messages);
  const chatConfigRef = useRef<ChatConfig>(chatConfig);
  const snapshotRequestVersionRef = useRef<number>(0);
  const isDocumentVisibleRef = useRef<boolean>(isDocumentVisible());
  const visibilityResumePromiseRef = useRef<Promise<void> | null>(null);
  const liveCursorRef = useRef<string | null>(null);

  const isAssistantRunActive = isChatRunActive(runState);
  const composerAction = getChatComposerAction(runState);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatConfigRef.current = chatConfig;
  }, [chatConfig]);

  const setKnownLiveCursor = useCallback((cursor: string | null): void => {
    liveCursorRef.current = cursor;
  }, []);

  const detachLiveStream = useCallback((sessionId: string | null): void => {
    const activeConnection = activeLiveConnectionRef.current;
    if (activeConnection === null) {
      return;
    }

    if (sessionId !== null && activeConnection.sessionId !== sessionId) {
      return;
    }

    activeConnection.abortController.abort();
    activeLiveConnectionRef.current = null;
    setIsLiveStreamConnected(false);
  }, []);

  const finalizeInterruptedRun = useCallback((message: string): void => {
    markAssistantError(message);
    setRunState("interrupted");
    setIsStopping(false);
    setIsLiveStreamConnected(false);
    activeLiveConnectionRef.current = null;
  }, [markAssistantError]);

  const applyLiveEvent = useCallback((event: ChatLiveEvent): void => {
    if (event.type === "assistant_delta") {
      setKnownLiveCursor(event.cursor);
      appendAssistantText(event.text);
      return;
    }

    if (event.type === "assistant_tool_call") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantToolCall(toAssistantToolCallContentPart(event));
      return;
    }

    if (event.type === "assistant_reasoning_summary") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantReasoningSummary(toAssistantReasoningSummaryContentPart(event));
      return;
    }

    if (event.type === "assistant_reasoning_started") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantReasoningSummary(toAssistantReasoningSummaryContentPart(event));
      return;
    }

    if (event.type === "assistant_reasoning_done") {
      setKnownLiveCursor(event.cursor);
      completeAssistantReasoningSummary(event.reasoningId);
      return;
    }

    if (event.type === "assistant_message_done") {
      setKnownLiveCursor(event.cursor);
      finishAssistantMessage(event.isError, event.isStopped);
      setRunState(event.isError ? "interrupted" : "idle");
      setIsStopping(false);
      return;
    }

    if (event.type === "run_state") {
      const nextRunState = event.runState === "interrupted" ? "interrupted" : event.runState;
      setRunState(nextRunState);
      if (nextRunState !== "running") {
        setIsStopping(false);
      }
      return;
    }

    if (event.type === "error") {
      finalizeInterruptedRun(`AI live stream failed. ${sanitizeErrorText(500, event.message)}`);
      return;
    }

    if (event.type === "repair_status" || event.type === "stop_ack") {
      return;
    }

    finalizeInterruptedRun("AI live stream reset is required.");
  }, [
    appendAssistantText,
    finalizeInterruptedRun,
    finishAssistantMessage,
    upsertAssistantReasoningSummary,
    upsertAssistantToolCall,
    completeAssistantReasoningSummary,
    setKnownLiveCursor,
  ]);

  const startLiveStream = useCallback((
    sessionId: string,
    liveStream: ChatLiveStream | null,
    afterCursor: string | null,
  ): void => {
    detachLiveStream(null);

    if (isDocumentVisibleRef.current === false) {
      return;
    }

    if (liveStream === null) {
      finalizeInterruptedRun("AI live stream is unavailable for the active run.");
      return;
    }

    const abortController = new AbortController();
    activeLiveConnectionRef.current = { sessionId, abortController };
    setIsLiveStreamConnected(false);

    void consumeChatLiveStream({
      liveStream,
      sessionId,
      afterCursor,
      signal: abortController.signal,
      onEvent: (event) => {
        if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
          return;
        }

        setIsLiveStreamConnected(true);
        applyLiveEvent(event);
      },
    }).then(() => {
      if (abortController.signal.aborted) {
        return;
      }

      if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      setIsStopping(false);
      if (runStateRef.current === "running") {
        markAssistantError("AI live stream ended before the run finished.");
        setRunState("interrupted");
      }
    }).catch((error: unknown) => {
      if (abortController.signal.aborted) {
        return;
      }

      if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      finalizeInterruptedRun(toErrorMessage(error));
    });
  }, [applyLiveEvent, detachLiveStream, finalizeInterruptedRun, markAssistantError]);

  const applyWarmStartSnapshot = useCallback((nextWorkspaceId: string): boolean => {
    const warmStartSnapshot = loadChatSessionWarmStartSnapshot(nextWorkspaceId);
    if (warmStartSnapshot === null) {
      return false;
    }

    detachLiveStream(null);
    replaceMessages(warmStartSnapshot.messages);
    setCurrentSessionId(warmStartSnapshot.sessionId);
    setRunState("idle");
    setIsStopping(false);
    setIsLiveStreamConnected(false);
    setMainContentInvalidationVersion(warmStartSnapshot.mainContentInvalidationVersion);
    setChatConfig(warmStartSnapshot.chatConfig);
    setComposerNotice(null);
    setIsHistoryLoaded(true);
    lastSnapshotUpdatedAtRef.current = warmStartSnapshot.updatedAt;
    hydratedWorkspaceIdRef.current = nextWorkspaceId;
    setKnownLiveCursor(null);
    return true;
  }, [detachLiveStream, replaceMessages, setKnownLiveCursor]);

  const loadChatSnapshot = useCallback(async (
    sessionId: string | undefined,
    replaceHistory: boolean,
    requestVersion: number,
  ): Promise<ChatSessionSnapshot | null> => {
    const snapshot = await getChatSnapshot(sessionId);
    if (requestVersion !== snapshotRequestVersionRef.current) {
      return null;
    }

    const isUserStoppedSession = stoppedSessionIdsRef.current.has(snapshot.sessionId);
    const effectiveRunState = getEffectiveSnapshotRunState(snapshot.runState, isUserStoppedSession);
    const nextMainContentInvalidationVersion = snapshot.mainContentInvalidationVersion;

    const shouldReplaceVisibleMessages = replaceHistory
      && areMessagesEqual(messagesRef.current, snapshot.messages) === false;
    const shouldUpdateChatConfig = areChatConfigsEqual(chatConfigRef.current, snapshot.chatConfig) === false;

    setCurrentSessionId(snapshot.sessionId);
    setKnownLiveCursor(snapshot.liveCursor);
    setRunState(effectiveRunState);
    setMainContentInvalidationVersion(nextMainContentInvalidationVersion);
    if (shouldUpdateChatConfig) {
      setChatConfig(snapshot.chatConfig);
    }
    setComposerNotice(null);
    storeChatConfig(snapshot.chatConfig);

    if (hasObservedMainContentInvalidationVersionRef.current) {
      if (nextMainContentInvalidationVersion > lastMainContentInvalidationVersionRef.current) {
        onMainContentInvalidated(nextMainContentInvalidationVersion);
      }
    } else {
      hasObservedMainContentInvalidationVersionRef.current = true;
    }
    lastMainContentInvalidationVersionRef.current = nextMainContentInvalidationVersion;

    if (shouldReplaceVisibleMessages) {
      replaceMessages(snapshot.messages);
    }

    lastSnapshotUpdatedAtRef.current = lastSnapshotUpdatedAtRef.current === null
      ? snapshot.updatedAt
      : Math.max(lastSnapshotUpdatedAtRef.current, snapshot.updatedAt);

    return {
      ...snapshot,
      runState: effectiveRunState,
    };
  }, [onMainContentInvalidated, replaceMessages, setKnownLiveCursor]);

  const resetControllerState = useCallback((clearHistoryImmediately: boolean): void => {
    setCurrentSessionId(null);
    setRunState("idle");
    setIsStopping(false);
    setIsLiveStreamConnected(false);
    setMainContentInvalidationVersion(0);
    setComposerNotice(null);
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = null;
    stoppedSessionIdsRef.current.clear();
    setKnownLiveCursor(null);
    detachLiveStream(null);

    if (clearHistoryImmediately) {
      replaceMessages([]);
      setIsHistoryLoaded(false);
    }
  }, [detachLiveStream, replaceMessages, setKnownLiveCursor]);

  const refreshVisibleSnapshot = useCallback((): void => {
    if (
      isDocumentVisibleRef.current === false
      || workspaceId === null
      || isRemoteReady === false
      || isHistoryLoaded === false
      || visibilityResumePromiseRef.current !== null
    ) {
      return;
    }

    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;

    let refreshPromise: Promise<void> | null = null;
    refreshPromise = (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(currentSessionId ?? undefined, true, requestVersion);
        if (snapshot === null || isDocumentVisibleRef.current === false) {
          return;
        }

        if (snapshot.runState === "running") {
          startLiveStream(snapshot.sessionId, snapshot.liveStream, snapshot.liveCursor);
          return;
        }

        detachLiveStream(snapshot.sessionId);
      } catch (error) {
        if (isDocumentVisibleRef.current === false) {
          return;
        }

        setComposerNotice(`Chat refresh failed. ${toErrorMessage(error)}`);
      } finally {
        if (visibilityResumePromiseRef.current === refreshPromise) {
          visibilityResumePromiseRef.current = null;
        }
      }
    })();

    visibilityResumePromiseRef.current = refreshPromise;
  }, [
    currentSessionId,
    detachLiveStream,
    isHistoryLoaded,
    isRemoteReady,
    loadChatSnapshot,
    startLiveStream,
    workspaceId,
  ]);

  useEffect(() => {
    let isDisposed = false;
    const isWorkspaceTransition = hydratedWorkspaceIdRef.current !== workspaceId;

    if (workspaceId === null) {
      snapshotRequestVersionRef.current += 1;
      resetControllerState(true);
      hydratedWorkspaceIdRef.current = null;
      setIsHistoryLoaded(true);
      return () => {
        isDisposed = true;
      };
    }

    if (!isRemoteReady) {
      if (isWorkspaceTransition) {
        const didApplyWarmStartSnapshot = applyWarmStartSnapshot(workspaceId);
        if (didApplyWarmStartSnapshot === false) {
          resetControllerState(true);
        }
      }
      snapshotRequestVersionRef.current += 1;
      return () => {
        isDisposed = true;
      };
    }

    if (isWorkspaceTransition) {
      resetControllerState(true);
    }

    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(undefined, true, requestVersion);
        if (isDisposed || snapshot === null) {
          return;
        }

        hydratedWorkspaceIdRef.current = workspaceId;
        setCurrentSessionId(snapshot.sessionId);
        if (snapshot.runState === "running" && isDocumentVisibleRef.current) {
          startLiveStream(snapshot.sessionId, snapshot.liveStream, snapshot.liveCursor);
        }
      } catch (error) {
        if (isDisposed) {
          return;
        }

        if (isWorkspaceTransition && messagesRef.current.length === 0) {
          replaceMessages([{
            role: "assistant",
            content: [{ type: "text", text: `Chat failed to load. ${toErrorMessage(error)}` }],
            timestamp: Date.now(),
            isError: true,
            isStopped: false,
          }]);
        } else if (messagesRef.current.length === 0) {
          setComposerNotice(`Chat refresh failed. ${toErrorMessage(error)}`);
        }
      } finally {
        if (!isDisposed) {
          setIsHistoryLoaded(true);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [
    applyWarmStartSnapshot,
    isRemoteReady,
    loadChatSnapshot,
    replaceMessages,
    resetControllerState,
    startLiveStream,
    workspaceId,
  ]);

  useEffect(() => {
    if (workspaceId === null || currentSessionId === null || isHistoryLoaded === false) {
      return;
    }

    storeChatSessionWarmStartSnapshot(workspaceId, {
      sessionId: currentSessionId,
      runState,
      updatedAt: lastSnapshotUpdatedAtRef.current ?? Date.now(),
      mainContentInvalidationVersion,
      liveCursor: null,
      liveStream: null,
      chatConfig,
      messages,
    });
  }, [
    chatConfig,
    currentSessionId,
    isHistoryLoaded,
    mainContentInvalidationVersion,
    messages,
    runState,
    workspaceId,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = (): void => {
      const nextIsVisible = isDocumentVisible();
      isDocumentVisibleRef.current = nextIsVisible;

      if (nextIsVisible === false) {
        detachLiveStream(null);
        return;
      }

      refreshVisibleSnapshot();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [detachLiveStream, refreshVisibleSnapshot]);

  useEffect(() => {
    return () => {
      detachLiveStream(null);
    };
  }, [detachLiveStream]);

  const sendMessage = useCallback(async (
    sendParams: SendChatMessageParams,
  ): Promise<SendChatMessageResult> => {
    if (workspaceId === null || !isRemoteReady || !isHistoryLoaded || isAssistantRunActive || isStopping) {
      return { accepted: false };
    }

    const contentParts: ReadonlyArray<ContentPart> = buildContentParts(sendParams.text, sendParams.attachments);
    if (contentParts.length === 0) {
      return { accepted: false };
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestBody = {
      sessionId: currentSessionId ?? undefined,
      clientRequestId: sendParams.clientRequestId,
      content: contentParts,
      timezone,
    };

    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      markAssistantError(ATTACHMENT_LIMIT_ERROR_MESSAGE);
      return { accepted: false };
    }
    setComposerNotice(null);

    try {
      const response = await startChatRun(requestBody);
      appendUserMessage(contentParts);
      startAssistantMessage(OPTIMISTIC_ASSISTANT_STATUS_TEXT);
      stoppedSessionIdsRef.current.clear();
      setRunState("running");
      setIsStopping(false);
      setCurrentSessionId(response.sessionId);
      setChatConfig(response.chatConfig);
      storeChatConfig(response.chatConfig);
      if (isDocumentVisibleRef.current) {
        // Existing sessions must resume after the latest known cursor so stale
        // terminal events cannot finish the new optimistic assistant bubble.
        startLiveStream(response.sessionId, response.liveStream, liveCursorRef.current);
      }
      return { accepted: true };
    } catch (error) {
      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        setComposerNotice("A response is already in progress. Wait for it to finish or stop it before sending another message.");
        return { accepted: false };
      }

      setComposerNotice(`Chat request failed. ${toErrorMessage(error)}`);
      setRunState("idle");
      return { accepted: false };
    }
  }, [
    appendUserMessage,
    currentSessionId,
    isAssistantRunActive,
    isHistoryLoaded,
    isRemoteReady,
    isStopping,
    markAssistantError,
    startAssistantMessage,
    startLiveStream,
    workspaceId,
  ]);

  const stopMessage = useCallback(async (): Promise<void> => {
    if (currentSessionId === null || !isAssistantRunActive || isStopping) {
      return;
    }

    stoppedSessionIdsRef.current.add(currentSessionId);
    setIsStopping(true);

    try {
      const response = await stopChatRun(currentSessionId);
      if (response.stopped && response.stillRunning === false && activeLiveConnectionRef.current === null) {
        finishAssistantMessage(false, true);
        setRunState("idle");
        setIsStopping(false);
      }
    } catch (error) {
      markAssistantError(`Chat stop failed. ${toErrorMessage(error)}`);
      setRunState("interrupted");
    } finally {
      if (activeLiveConnectionRef.current === null) {
        setIsStopping(false);
      }
    }
  }, [currentSessionId, finishAssistantMessage, isAssistantRunActive, isStopping, markAssistantError]);

  const clearConversation = useCallback(async (): Promise<void> => {
    if (workspaceId === null) {
      detachLiveStream(null);
      snapshotRequestVersionRef.current += 1;
      clearHistory();
      setCurrentSessionId(null);
      setRunState("idle");
      return;
    }

    if (currentSessionId !== null && isAssistantRunActive) {
      await stopChatRun(currentSessionId);
    }

    snapshotRequestVersionRef.current += 1;
    detachLiveStream(null);
    const response = await createNewChatSession(currentSessionId ?? undefined);
    clearHistory();
    stoppedSessionIdsRef.current.clear();
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = null;
    setCurrentSessionId(response.sessionId);
    setRunState("idle");
    setIsStopping(false);
    setIsLiveStreamConnected(false);
    setMainContentInvalidationVersion(0);
    setChatConfig(response.chatConfig);
    setComposerNotice(null);
    storeChatConfig(response.chatConfig);
  }, [clearHistory, currentSessionId, detachLiveStream, isAssistantRunActive, workspaceId]);

  return {
    messages,
    runState,
    isHistoryLoaded,
    isAssistantRunActive,
    isLiveStreamConnected,
    isStopping,
    currentSessionId,
    mainContentInvalidationVersion,
    chatConfig: chatConfig ?? defaultChatConfig,
    composerAction,
    composerNotice,
    acceptServerSessionId: setCurrentSessionId,
    sendMessage,
    stopMessage,
    clearConversation,
  };
}
