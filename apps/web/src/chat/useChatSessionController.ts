import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createNewChatSession,
  getChatSnapshot,
  getChatSnapshotWithResumeDiagnostics,
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
import type { ChatLiveEvent } from "./liveStream";
import { useChatLiveSession } from "./useChatLiveSession";
import type {
  ChatConfig,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "../types";

const CHAT_DEBUG_LOG_PREFIX = "chat_debug ";
const CHAT_DEBUG_STORAGE_KEY = "flashcards-chat-debug";

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
  errorDialogMessage: string | null;
  dismissErrorDialog: () => void;
  acceptServerSessionId: (sessionId: string) => void;
  sendMessage: (params: SendChatMessageParams) => Promise<SendChatMessageResult>;
  stopMessage: () => Promise<void>;
  clearConversation: () => Promise<void>;
}>;

type ChatDebugDetailValue = string | number | boolean | null;
type ChatDebugDetails = Readonly<Record<string, ChatDebugDetailValue>>;

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
      || leftMessage.itemId !== rightMessage.itemId
      || leftMessage.cursor !== rightMessage.cursor
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

function extractStoredMessageTextContent(message: StoredMessage): string {
  return message.content.reduce<string>((result, part) => {
    if (part.type !== "text") {
      return result;
    }

    if (part.text === OPTIMISTIC_ASSISTANT_STATUS_TEXT) {
      return result;
    }

    return result + part.text;
  }, "").trim();
}

function extractAssistantErrorMessage(
  messages: ReadonlyArray<StoredMessage>,
): string | null {
  const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  if (assistantMessage === undefined || assistantMessage.isError === false) {
    return null;
  }

  const messageText = extractStoredMessageTextContent(assistantMessage);
  return messageText === "" ? null : messageText;
}

function extractLatestAssistantMessageText(
  messages: ReadonlyArray<StoredMessage>,
): string | null {
  const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  if (assistantMessage === undefined) {
    return null;
  }

  const messageText = extractStoredMessageTextContent(assistantMessage);
  return messageText === "" ? null : messageText;
}

function createChatControllerDebugId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `chat-controller-${String(Date.now())}`;
}

function isChatDebugLoggingEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("chatDebug") === "1") {
    return true;
  }

  return window.localStorage.getItem(CHAT_DEBUG_STORAGE_KEY) === "true";
}

function logChatControllerDebug(
  controllerId: string,
  event: string,
  details: ChatDebugDetails,
): void {
  if (isChatDebugLoggingEnabled() === false) {
    return;
  }

  console.info(`${CHAT_DEBUG_LOG_PREFIX}${JSON.stringify({
    source: "useChatSessionController",
    controllerId,
    event,
    ...details,
  })}`);
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
  const controllerIdRef = useRef<string>(createChatControllerDebugId());
  const controllerId = controllerIdRef.current;
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
  const [errorDialogMessage, setErrorDialogMessage] = useState<string | null>(null);

  const lastSnapshotUpdatedAtRef = useRef<number | null>(initialWarmStartSnapshot?.updatedAt ?? null);
  const hasObservedMainContentInvalidationVersionRef = useRef<boolean>(false);
  const lastMainContentInvalidationVersionRef = useRef<number>(0);
  const hydratedWorkspaceIdRef = useRef<string | null>(initialWarmStartSnapshot?.workspaceId ?? null);
  const runStateRef = useRef<ChatRunState>("idle");
  const messagesRef = useRef<ReadonlyArray<StoredMessage>>(messages);
  const chatConfigRef = useRef<ChatConfig>(chatConfig);
  const onMainContentInvalidatedRef = useRef<(mainContentInvalidationVersion: number) => void>(onMainContentInvalidated);
  const snapshotRequestVersionRef = useRef<number>(0);
  const visibilityResumePromiseRef = useRef<Promise<void> | null>(null);
  const refreshVisibleSnapshotRef = useRef<() => void>(() => {});
  const reconcileTerminalSnapshotRef = useRef<() => void>(() => {});
  const liveCursorRef = useRef<string | null>(null);
  const resumeAttemptCounterRef = useRef<number>(0);

  const isAssistantRunActive = isChatRunActive(runState);
  const composerAction = getChatComposerAction(runState);

  const debugLog = useCallback((event: string, details: ChatDebugDetails): void => {
    logChatControllerDebug(controllerId, event, details);
  }, [controllerId]);

  useEffect(() => {
    debugLog("controller_mounted", {
      workspaceId,
      isRemoteReady,
      currentSessionId,
      isHistoryLoaded,
    });
  }, []);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  const updateRunState = useCallback((nextRunState: ChatRunState): void => {
    runStateRef.current = nextRunState;
    setRunState(nextRunState);
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatConfigRef.current = chatConfig;
  }, [chatConfig]);

  useEffect(() => {
    onMainContentInvalidatedRef.current = onMainContentInvalidated;
  }, [onMainContentInvalidated]);

  const setKnownLiveCursor = useCallback((cursor: string | null): void => {
    liveCursorRef.current = cursor;
  }, []);

  const dismissErrorDialog = useCallback((): void => {
    setErrorDialogMessage(null);
  }, []);

  const showErrorDialog = useCallback((message: string): void => {
    setComposerNotice(null);
    setErrorDialogMessage(message);
  }, []);

  const nextResumeAttemptId = useCallback((): number => {
    const nextAttemptId = resumeAttemptCounterRef.current + 1;
    resumeAttemptCounterRef.current = nextAttemptId;
    return nextAttemptId;
  }, []);

  const finalizeInterruptedRun = useCallback((message: string): void => {
    showErrorDialog(message);
    updateRunState("interrupted");
    setIsStopping(false);
  }, [showErrorDialog, updateRunState]);

  const applyLiveEvent = useCallback((event: ChatLiveEvent): void => {
    if (event.type === "assistant_delta") {
      setKnownLiveCursor(event.cursor);
      appendAssistantText(event.text, event.itemId, event.cursor ?? null);
      return;
    }

    if (event.type === "assistant_tool_call") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantToolCall(toAssistantToolCallContentPart(event), event.itemId, event.cursor ?? null);
      return;
    }

    if (event.type === "assistant_reasoning_summary") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantReasoningSummary(
        toAssistantReasoningSummaryContentPart(event),
        event.itemId,
        event.cursor ?? null,
      );
      return;
    }

    if (event.type === "assistant_reasoning_started") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantReasoningSummary(
        toAssistantReasoningSummaryContentPart(event),
        event.itemId,
        event.cursor ?? null,
      );
      return;
    }

    if (event.type === "assistant_reasoning_done") {
      setKnownLiveCursor(event.cursor);
      completeAssistantReasoningSummary(event.reasoningId, event.itemId, event.cursor ?? null);
      return;
    }

    if (event.type === "assistant_message_done") {
      setKnownLiveCursor(event.cursor);
      const didFinish = finishAssistantMessage(
        event.content,
        event.itemId,
        event.cursor ?? null,
        event.isError,
        event.isStopped,
      );
      if (didFinish === false) {
        reconcileTerminalSnapshotRef.current();
        return;
      }
      updateRunState(event.isError ? "interrupted" : "idle");
      setIsStopping(false);
      if (event.isError) {
        showErrorDialog(
          extractLatestAssistantMessageText(messagesRef.current)
            ?? "AI chat failed.",
        );
      }
      return;
    }

    if (event.type === "repair_status") {
      return;
    }

    if (event.outcome === "reset_required") {
      reconcileTerminalSnapshotRef.current();
      return;
    }

    setIsStopping(false);
    if (event.outcome === "completed" || event.outcome === "stopped") {
      updateRunState("idle");
      return;
    }

    updateRunState("interrupted");
    showErrorDialog(
      event.message
        ?? extractLatestAssistantMessageText(messagesRef.current)
        ?? "AI chat failed.",
    );
  }, [
    appendAssistantText,
    finishAssistantMessage,
    showErrorDialog,
    upsertAssistantReasoningSummary,
    upsertAssistantToolCall,
    completeAssistantReasoningSummary,
    setKnownLiveCursor,
    updateRunState,
  ]);

  const {
    isLiveStreamConnected,
    isDocumentVisibleRef,
    hasActiveLiveConnection,
    startLiveStream,
    detachLiveStream,
  } = useChatLiveSession({
    applyLiveEvent,
    finalizeInterruptedRun: (message) => {
      finalizeInterruptedRun(toErrorMessage(new Error(message)));
    },
    onVisibleResumeRequested: () => {
      refreshVisibleSnapshotRef.current();
    },
    onLiveAttachConnected: () => {
      setErrorDialogMessage(null);
    },
    onUnexpectedStreamEnd: (sessionId, runId) => {
      setIsStopping(false);
      if (runStateRef.current !== "running") {
        return;
      }

      const requestVersion = snapshotRequestVersionRef.current + 1;
      snapshotRequestVersionRef.current = requestVersion;
      void (async (): Promise<void> => {
        try {
          const snapshot = await loadChatSnapshot(sessionId, true, requestVersion, "unexpected_stream_end", null);
          if (snapshot === null) {
            return;
          }

          const snapshotErrorMessage = extractAssistantErrorMessage(snapshot.conversation.messages);
          if (snapshotErrorMessage !== null) {
            updateRunState("interrupted");
            showErrorDialog(snapshotErrorMessage);
            return;
          }

          if (snapshot.activeRun !== null && snapshot.activeRun.runId === runId) {
            updateRunState("interrupted");
            showErrorDialog("AI live stream ended before the run finished.");
          }
        } catch (error) {
          updateRunState("interrupted");
          showErrorDialog(`Chat refresh failed. ${toErrorMessage(error)}`);
        }
      })();
    },
  });

  const startSnapshotLiveStream = useCallback((
    snapshot: ChatSessionSnapshot,
    resumeAttemptId: number | null,
  ): void => {
    if (snapshot.activeRun === null) {
      detachLiveStream(snapshot.sessionId, null);
      return;
    }

    startLiveStream(
      snapshot.sessionId,
      snapshot.activeRun.runId,
      snapshot.activeRun.live.stream,
      snapshot.activeRun.live.cursor,
      resumeAttemptId,
    );
  }, [detachLiveStream, startLiveStream]);

  const applyWarmStartSnapshot = useCallback((nextWorkspaceId: string): boolean => {
    const warmStartSnapshot = loadChatSessionWarmStartSnapshot(nextWorkspaceId);
    if (warmStartSnapshot === null) {
      return false;
    }

    detachLiveStream(null, null);
    replaceMessages(warmStartSnapshot.messages);
    setCurrentSessionId(warmStartSnapshot.sessionId);
    updateRunState("idle");
    setIsStopping(false);
    setMainContentInvalidationVersion(warmStartSnapshot.mainContentInvalidationVersion);
    setChatConfig(warmStartSnapshot.chatConfig);
    setComposerNotice(null);
    setErrorDialogMessage(null);
    setIsHistoryLoaded(true);
    lastSnapshotUpdatedAtRef.current = warmStartSnapshot.updatedAt;
    hydratedWorkspaceIdRef.current = nextWorkspaceId;
    setKnownLiveCursor(null);
    return true;
  }, [detachLiveStream, replaceMessages, setKnownLiveCursor, updateRunState]);

  const loadChatSnapshot = useCallback(async (
    sessionId: string | undefined,
    replaceHistory: boolean,
    requestVersion: number,
    trigger: string,
    resumeAttemptId: number | null,
  ): Promise<ChatSessionSnapshot | null> => {
    debugLog("snapshot_request_started", {
      workspaceId,
      currentSessionId: sessionId ?? null,
      replaceHistory,
      requestVersion,
      trigger,
    });
    try {
      const snapshot = resumeAttemptId === null
        ? await getChatSnapshot(sessionId)
        : await getChatSnapshotWithResumeDiagnostics(sessionId, { resumeAttemptId });
      if (requestVersion !== snapshotRequestVersionRef.current) {
        return null;
      }

      const nextRunState: ChatRunState = snapshot.activeRun === null ? "idle" : "running";
      const nextMainContentInvalidationVersion = snapshot.conversation.mainContentInvalidationVersion;

      const shouldReplaceVisibleMessages = replaceHistory
        && areMessagesEqual(messagesRef.current, snapshot.conversation.messages) === false;
      const shouldUpdateChatConfig = areChatConfigsEqual(chatConfigRef.current, snapshot.chatConfig) === false;

      setCurrentSessionId(snapshot.sessionId);
      setKnownLiveCursor(snapshot.activeRun?.live.cursor ?? null);
      updateRunState(nextRunState);
      setMainContentInvalidationVersion(nextMainContentInvalidationVersion);
      if (shouldUpdateChatConfig) {
        setChatConfig(snapshot.chatConfig);
      }
      setComposerNotice(null);
      storeChatConfig(snapshot.chatConfig);

      if (hasObservedMainContentInvalidationVersionRef.current) {
        if (nextMainContentInvalidationVersion > lastMainContentInvalidationVersionRef.current) {
          onMainContentInvalidatedRef.current(nextMainContentInvalidationVersion);
        }
      } else {
        hasObservedMainContentInvalidationVersionRef.current = true;
      }
      lastMainContentInvalidationVersionRef.current = nextMainContentInvalidationVersion;

      if (shouldReplaceVisibleMessages) {
        replaceMessages(snapshot.conversation.messages);
      }

      lastSnapshotUpdatedAtRef.current = lastSnapshotUpdatedAtRef.current === null
        ? snapshot.conversation.updatedAt
        : Math.max(lastSnapshotUpdatedAtRef.current, snapshot.conversation.updatedAt);

      debugLog("snapshot_request_succeeded", {
        workspaceId,
        currentSessionId: snapshot.sessionId,
        replaceHistory,
        requestVersion,
        trigger,
        runState: nextRunState,
        messageCount: snapshot.conversation.messages.length,
      });

      return snapshot;
    } catch (error) {
      debugLog("snapshot_request_failed", {
        workspaceId,
        currentSessionId: sessionId ?? null,
        replaceHistory,
        requestVersion,
        trigger,
        message: toErrorMessage(error),
      });
      throw error;
    }
  }, [debugLog, replaceMessages, setKnownLiveCursor, updateRunState, workspaceId]);

  const reconcileTerminalSnapshot = useCallback((): void => {
    if (workspaceId === null || isRemoteReady === false) {
      return;
    }

    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(
          currentSessionId ?? undefined,
          true,
          requestVersion,
          "terminal_reconcile",
          null,
        );
        if (snapshot === null) {
          return;
        }

        if (isDocumentVisibleRef.current && snapshot.activeRun !== null) {
          startSnapshotLiveStream(snapshot, null);
          return;
        }

        detachLiveStream(snapshot.sessionId, null);
      } catch (error) {
        detachLiveStream(null, null);
        updateRunState("interrupted");
        setIsStopping(false);
        showErrorDialog(`Chat refresh failed. ${toErrorMessage(error)}`);
      }
    })();
  }, [
    currentSessionId,
    detachLiveStream,
    isDocumentVisibleRef,
    isRemoteReady,
    loadChatSnapshot,
    showErrorDialog,
    startSnapshotLiveStream,
    updateRunState,
    workspaceId,
  ]);

  useEffect(() => {
    reconcileTerminalSnapshotRef.current = reconcileTerminalSnapshot;
  }, [reconcileTerminalSnapshot]);

  const refreshVisibleSnapshot = useCallback((): void => {
    if (
      isDocumentVisibleRef.current === false
      || workspaceId === null
      || isRemoteReady === false
      || isHistoryLoaded === false
      || hasActiveLiveConnection()
      || visibilityResumePromiseRef.current !== null
    ) {
      return;
    }

    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;
    const resumeAttemptId = nextResumeAttemptId();

    let refreshPromise: Promise<void> | null = null;
    refreshPromise = (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(
          currentSessionId ?? undefined,
          true,
          requestVersion,
          "visible_resume",
          resumeAttemptId,
        );
        if (snapshot === null || isDocumentVisibleRef.current === false) {
          return;
        }

        if (snapshot.activeRun !== null) {
          startSnapshotLiveStream(snapshot, resumeAttemptId);
          return;
        }

        detachLiveStream(snapshot.sessionId, null);
      } catch (error) {
        if (isDocumentVisibleRef.current === false) {
          return;
        }

        detachLiveStream(null, null);
        updateRunState("interrupted");
        setIsStopping(false);
        showErrorDialog(`Chat refresh failed. ${toErrorMessage(error)}`);
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
    hasActiveLiveConnection,
    isHistoryLoaded,
    isRemoteReady,
    isDocumentVisibleRef,
    loadChatSnapshot,
    nextResumeAttemptId,
    startSnapshotLiveStream,
    workspaceId,
    showErrorDialog,
    updateRunState,
  ]);

  refreshVisibleSnapshotRef.current = refreshVisibleSnapshot;

  const resetControllerState = useCallback((clearHistoryImmediately: boolean): void => {
    setCurrentSessionId(null);
    updateRunState("idle");
    setIsStopping(false);
    setMainContentInvalidationVersion(0);
    setComposerNotice(null);
    setErrorDialogMessage(null);
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = null;
    setKnownLiveCursor(null);
    detachLiveStream(null, null);

    if (clearHistoryImmediately) {
      replaceMessages([]);
      setIsHistoryLoaded(false);
    }
  }, [detachLiveStream, replaceMessages, setKnownLiveCursor, updateRunState]);

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
          hydratedWorkspaceIdRef.current = workspaceId;
        }
      }
      snapshotRequestVersionRef.current += 1;
      return () => {
        isDisposed = true;
      };
    }

    if (isWorkspaceTransition) {
      resetControllerState(true);
      hydratedWorkspaceIdRef.current = workspaceId;
    }

    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(undefined, true, requestVersion, "initial_hydration", null);
        if (isDisposed || snapshot === null) {
          return;
        }

        hydratedWorkspaceIdRef.current = workspaceId;
        setCurrentSessionId(snapshot.sessionId);
        if (snapshot.activeRun !== null && isDocumentVisibleRef.current) {
          startSnapshotLiveStream(snapshot, null);
        }
      } catch (error) {
        if (isDisposed) {
          return;
        }

        if (isWorkspaceTransition && messagesRef.current.length === 0) {
          replaceMessages([]);
        }

        showErrorDialog(`Chat refresh failed. ${toErrorMessage(error)}`);
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
    showErrorDialog,
    startSnapshotLiveStream,
    workspaceId,
  ]);

  useEffect(() => {
    if (workspaceId === null || currentSessionId === null || isHistoryLoaded === false) {
      return;
    }

    storeChatSessionWarmStartSnapshot(workspaceId, {
      sessionId: currentSessionId,
      conversationScopeId: currentSessionId,
      conversation: {
        updatedAt: lastSnapshotUpdatedAtRef.current ?? Date.now(),
        mainContentInvalidationVersion,
        messages,
      },
      chatConfig,
      activeRun: null,
    });
  }, [
    chatConfig,
    currentSessionId,
    isHistoryLoaded,
    mainContentInvalidationVersion,
    messages,
    workspaceId,
  ]);

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
      showErrorDialog(ATTACHMENT_LIMIT_ERROR_MESSAGE);
      return { accepted: false };
    }
    setComposerNotice(null);
    setErrorDialogMessage(null);

    try {
      const response = await startChatRun(requestBody);
      appendUserMessage(contentParts);
      startAssistantMessage(OPTIMISTIC_ASSISTANT_STATUS_TEXT);
      updateRunState(response.activeRun === null ? "idle" : "running");
      setIsStopping(false);
      setCurrentSessionId(response.sessionId);
      setChatConfig(response.chatConfig);
      storeChatConfig(response.chatConfig);
      setKnownLiveCursor(response.activeRun?.live.cursor ?? null);
      if (response.activeRun === null) {
        reconcileTerminalSnapshotRef.current();
      } else if (isDocumentVisibleRef.current) {
        // Existing sessions must resume after the latest known cursor so stale
        // terminal events cannot finish the new optimistic assistant bubble.
        startLiveStream(
          response.sessionId,
          response.activeRun.runId,
          response.activeRun.live.stream,
          response.activeRun.live.cursor,
          null,
        );
      }
      return { accepted: true };
    } catch (error) {
      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        showErrorDialog("A response is already in progress. Wait for it to finish or stop it before sending another message.");
        return { accepted: false };
      }

      showErrorDialog(`Chat request failed. ${toErrorMessage(error)}`);
      updateRunState("idle");
      return { accepted: false };
    }
  }, [
    appendUserMessage,
    currentSessionId,
    isAssistantRunActive,
    isHistoryLoaded,
    isRemoteReady,
    isStopping,
    startAssistantMessage,
    startLiveStream,
    setKnownLiveCursor,
    showErrorDialog,
    updateRunState,
    workspaceId,
  ]);

  const stopMessage = useCallback(async (): Promise<void> => {
    if (currentSessionId === null || !isAssistantRunActive || isStopping) {
      return;
    }

    setIsStopping(true);

    try {
      const response = await stopChatRun(currentSessionId);
      if (response.stopped && response.stillRunning === false && hasActiveLiveConnection() === false) {
        reconcileTerminalSnapshotRef.current();
        updateRunState("idle");
        setIsStopping(false);
      }
    } catch (error) {
      showErrorDialog(`Chat stop failed. ${toErrorMessage(error)}`);
      updateRunState("interrupted");
    } finally {
      if (hasActiveLiveConnection() === false) {
        setIsStopping(false);
      }
    }
  }, [currentSessionId, hasActiveLiveConnection, isAssistantRunActive, isStopping, showErrorDialog, updateRunState]);

  const clearConversation = useCallback(async (): Promise<void> => {
    if (workspaceId === null) {
      detachLiveStream(null, null);
      snapshotRequestVersionRef.current += 1;
      clearHistory();
      setCurrentSessionId(null);
      updateRunState("idle");
      return;
    }

    if (currentSessionId !== null && isAssistantRunActive) {
      await stopChatRun(currentSessionId);
    }

    snapshotRequestVersionRef.current += 1;
    detachLiveStream(null, null);
    const response = await createNewChatSession(currentSessionId ?? undefined);
    clearHistory();
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = null;
    setKnownLiveCursor(null);
    setCurrentSessionId(response.sessionId);
    updateRunState("idle");
    setIsStopping(false);
    setMainContentInvalidationVersion(0);
    setChatConfig(response.chatConfig);
    setComposerNotice(null);
    setErrorDialogMessage(null);
    storeChatConfig(response.chatConfig);
  }, [clearHistory, currentSessionId, detachLiveStream, isAssistantRunActive, setKnownLiveCursor, updateRunState, workspaceId]);

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
    errorDialogMessage,
    dismissErrorDialog,
    acceptServerSessionId: setCurrentSessionId,
    sendMessage,
    stopMessage,
    clearConversation,
  };
}
