import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createNewChatSession,
  getChatSnapshot,
  startChatRun,
  stopChatRun,
} from "../api";
import type { ContentPart } from "../types";
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
} from "./useChatHistory";
import { defaultChatConfig, loadStoredChatConfig, storeChatConfig } from "./chatConfig";
import type { ChatSessionSnapshot } from "./chatSessionSnapshot";
import { consumeChatLiveStream, type ChatLiveEvent } from "./liveStream";
import type {
  ChatConfig,
  ChatLiveStream,
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
  } = useChatHistory();

  const [isHistoryLoaded, setIsHistoryLoaded] = useState<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [runState, setRunState] = useState<ChatRunState>("idle");
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [mainContentInvalidationVersion, setMainContentInvalidationVersion] = useState<number>(0);
  const [chatConfig, setChatConfig] = useState<ChatConfig>(() => loadStoredChatConfig());
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [isLiveStreamConnected, setIsLiveStreamConnected] = useState<boolean>(false);

  const lastSnapshotUpdatedAtRef = useRef<number | null>(null);
  const hasObservedMainContentInvalidationVersionRef = useRef<boolean>(false);
  const lastMainContentInvalidationVersionRef = useRef<number>(0);
  const hydratedWorkspaceIdRef = useRef<string | null>(null);
  const stoppedSessionIdsRef = useRef<Set<string>>(new Set());
  const activeLiveConnectionRef = useRef<ActiveLiveStreamConnection | null>(null);
  const runStateRef = useRef<ChatRunState>("idle");

  const isAssistantRunActive = isChatRunActive(runState);
  const composerAction = getChatComposerAction(runState);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

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
      appendAssistantText(event.text);
      return;
    }

    if (event.type === "assistant_tool_call") {
      upsertAssistantToolCall(toAssistantToolCallContentPart(event));
      return;
    }

    if (event.type === "assistant_reasoning_summary") {
      upsertAssistantReasoningSummary(toAssistantReasoningSummaryContentPart(event));
      return;
    }

    if (event.type === "assistant_reasoning_started") {
      upsertAssistantReasoningSummary(toAssistantReasoningSummaryContentPart(event));
      return;
    }

    if (event.type === "assistant_reasoning_done") {
      completeAssistantReasoningSummary(event.reasoningId);
      return;
    }

    if (event.type === "assistant_message_done") {
      finishAssistantMessage(event.isError, event.isStopped);
      if (event.isError) {
        setRunState("interrupted");
      }
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
  ]);

  const startLiveStream = useCallback((
    sessionId: string,
    liveStream: ChatLiveStream | null,
    afterCursor: string | null,
  ): void => {
    detachLiveStream(null);

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

  const loadChatSnapshot = useCallback(async (
    sessionId: string | undefined,
    replaceHistory: boolean,
  ): Promise<ChatSessionSnapshot> => {
    const snapshot = await getChatSnapshot(sessionId);
    const isUserStoppedSession = stoppedSessionIdsRef.current.has(snapshot.sessionId);
    const effectiveRunState = getEffectiveSnapshotRunState(snapshot.runState, isUserStoppedSession);
    const nextMainContentInvalidationVersion = snapshot.mainContentInvalidationVersion;

    setCurrentSessionId(snapshot.sessionId);
    setRunState(effectiveRunState);
    setMainContentInvalidationVersion(nextMainContentInvalidationVersion);
    setChatConfig(snapshot.chatConfig);
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

    if (replaceHistory && (lastSnapshotUpdatedAtRef.current === null || snapshot.updatedAt > lastSnapshotUpdatedAtRef.current)) {
      replaceMessages(snapshot.messages);
    }

    lastSnapshotUpdatedAtRef.current = lastSnapshotUpdatedAtRef.current === null
      ? snapshot.updatedAt
      : Math.max(lastSnapshotUpdatedAtRef.current, snapshot.updatedAt);

    return {
      ...snapshot,
      runState: effectiveRunState,
    };
  }, [onMainContentInvalidated, replaceMessages]);

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
    detachLiveStream(null);

    if (clearHistoryImmediately) {
      replaceMessages([]);
      setIsHistoryLoaded(false);
    }
  }, [detachLiveStream, replaceMessages]);

  useEffect(() => {
    let isDisposed = false;
    const isWorkspaceTransition = hydratedWorkspaceIdRef.current !== workspaceId;

    if (workspaceId === null) {
      resetControllerState(true);
      hydratedWorkspaceIdRef.current = null;
      setIsHistoryLoaded(true);
      return () => {
        isDisposed = true;
      };
    }

    if (!isRemoteReady) {
      if (isWorkspaceTransition) {
        resetControllerState(true);
      }
      setComposerNotice("Restoring session...");
      return () => {
        isDisposed = true;
      };
    }

    if (isWorkspaceTransition) {
      resetControllerState(true);
    }

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(undefined, true);
        if (isDisposed) {
          return;
        }

        hydratedWorkspaceIdRef.current = workspaceId;
        setCurrentSessionId(snapshot.sessionId);
        if (snapshot.runState === "running") {
          startLiveStream(snapshot.sessionId, snapshot.liveStream, snapshot.liveCursor);
        }
      } catch (error) {
        if (isDisposed) {
          return;
        }

        if (isWorkspaceTransition) {
          replaceMessages([{
            role: "assistant",
            content: [{ type: "text", text: `Chat failed to load. ${toErrorMessage(error)}` }],
            timestamp: Date.now(),
            isError: true,
            isStopped: false,
          }]);
        } else {
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
  }, [isRemoteReady, loadChatSnapshot, replaceMessages, resetControllerState, startLiveStream, workspaceId]);

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
      startLiveStream(response.sessionId, response.liveStream, null);
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
      clearHistory();
      setCurrentSessionId(null);
      setRunState("idle");
      return;
    }

    if (currentSessionId !== null && isAssistantRunActive) {
      await stopChatRun(currentSessionId);
    }

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
