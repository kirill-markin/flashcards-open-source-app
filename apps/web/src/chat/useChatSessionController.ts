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
  ACTIVE_RUN_SNAPSHOT_POLL_INTERVAL_MS,
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
import type { ChatConfig } from "../types";

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

export function useChatSessionController(
  params: UseChatSessionControllerParams,
): ChatSessionController {
  const { workspaceId, isRemoteReady, onMainContentInvalidated } = params;
  const {
    messages,
    replaceMessages,
    appendUserMessage,
    startAssistantMessage,
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

  const lastSnapshotUpdatedAtRef = useRef<number | null>(null);
  const hasObservedMainContentInvalidationVersionRef = useRef<boolean>(false);
  const lastMainContentInvalidationVersionRef = useRef<number>(0);
  const stoppedSessionIdsRef = useRef<Set<string>>(new Set());

  const isAssistantRunActive = isChatRunActive(runState);
  const composerAction = getChatComposerAction(runState);

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

  useEffect(() => {
    let isDisposed = false;

    setIsHistoryLoaded(false);
    setCurrentSessionId(null);
    setRunState("idle");
    setIsStopping(false);
    setMainContentInvalidationVersion(0);
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = null;
    stoppedSessionIdsRef.current.clear();
    replaceMessages([]);

    if (workspaceId === null) {
      setComposerNotice(null);
      setIsHistoryLoaded(true);
      return () => {
        isDisposed = true;
      };
    }

    if (!isRemoteReady) {
      setComposerNotice("Restoring session...");
      setIsHistoryLoaded(true);
      return () => {
        isDisposed = true;
      };
    }

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadChatSnapshot(undefined, true);
        if (isDisposed) {
          return;
        }

        setCurrentSessionId(snapshot.sessionId);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        replaceMessages([{
          role: "assistant",
          content: [{ type: "text", text: `Chat failed to load. ${toErrorMessage(error)}` }],
          timestamp: Date.now(),
          isError: true,
          isStopped: false,
        }]);
      } finally {
        if (!isDisposed) {
          setIsHistoryLoaded(true);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [isRemoteReady, loadChatSnapshot, replaceMessages, workspaceId]);

  useEffect(() => {
    if (!isRemoteReady || !isHistoryLoaded || currentSessionId === null || runState !== "running") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadChatSnapshot(currentSessionId, true).catch((error) => {
        markAssistantError(`Chat failed to refresh. ${toErrorMessage(error)}`);
        setRunState("interrupted");
      });
    }, ACTIVE_RUN_SNAPSHOT_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [currentSessionId, isHistoryLoaded, isRemoteReady, loadChatSnapshot, markAssistantError, runState]);

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
      setCurrentSessionId(response.sessionId);
      setChatConfig(response.chatConfig);
      storeChatConfig(response.chatConfig);
      try {
        await loadChatSnapshot(response.sessionId, true);
      } catch (error) {
        setComposerNotice(`Chat started, but refresh failed. ${toErrorMessage(error)}`);
      }
      return { accepted: true };
    } catch (error) {
      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        const conflictMessage = "A response is already in progress. Wait for it to finish or stop it before sending another message.";
        if (currentSessionId !== null) {
          void loadChatSnapshot(currentSessionId, true)
            .catch(() => undefined)
            .finally(() => {
              setComposerNotice(conflictMessage);
            });
        } else {
          setComposerNotice(conflictMessage);
        }
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
    loadChatSnapshot,
    markAssistantError,
    startAssistantMessage,
    workspaceId,
  ]);

  const stopMessage = useCallback(async (): Promise<void> => {
    if (currentSessionId === null || !isAssistantRunActive || isStopping) {
      return;
    }

    stoppedSessionIdsRef.current.add(currentSessionId);
    setIsStopping(true);

    try {
      await stopChatRun(currentSessionId);
      await loadChatSnapshot(currentSessionId, true);
    } catch (error) {
      markAssistantError(`Chat stop failed. ${toErrorMessage(error)}`);
      setRunState("interrupted");
    } finally {
      setIsStopping(false);
    }
  }, [currentSessionId, isAssistantRunActive, isStopping, loadChatSnapshot, markAssistantError]);

  const clearConversation = useCallback(async (): Promise<void> => {
    if (workspaceId === null) {
      clearHistory();
      setCurrentSessionId(null);
      setRunState("idle");
      return;
    }

    if (currentSessionId !== null && isAssistantRunActive) {
      await stopChatRun(currentSessionId);
    }

    const response = await createNewChatSession(currentSessionId ?? undefined);
    clearHistory();
    stoppedSessionIdsRef.current.clear();
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = null;
    setCurrentSessionId(response.sessionId);
    setRunState("idle");
    setMainContentInvalidationVersion(0);
    setChatConfig(response.chatConfig);
    setComposerNotice(null);
    storeChatConfig(response.chatConfig);
  }, [clearHistory, currentSessionId, isAssistantRunActive, workspaceId]);

  return {
    messages,
    runState,
    isHistoryLoaded,
    isAssistantRunActive,
    isLiveStreamConnected: false,
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
