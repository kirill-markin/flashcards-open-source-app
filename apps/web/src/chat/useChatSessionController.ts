import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatSnapshot,
  resetChatSession,
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
}>;

export type SendChatMessageParams = Readonly<{
  text: string;
  attachments: ReadonlyArray<PendingAttachment>;
}>;

export type ChatSessionController = Readonly<{
  messages: ReturnType<typeof useChatHistory>["messages"];
  runState: ChatRunState;
  isHistoryLoaded: boolean;
  isAssistantRunActive: boolean;
  isLiveStreamConnected: boolean;
  isStopping: boolean;
  currentSessionId: string | null;
  chatConfig: ChatConfig;
  composerAction: ChatComposerAction;
  acceptServerSessionId: (sessionId: string) => void;
  sendMessage: (params: SendChatMessageParams) => Promise<void>;
  stopMessage: () => Promise<void>;
  clearConversation: () => Promise<void>;
}>;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorText(500, error.message);
  }

  return String(error);
}

export function useChatSessionController(
  params: UseChatSessionControllerParams,
): ChatSessionController {
  const { workspaceId } = params;
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
  const [chatConfig, setChatConfig] = useState<ChatConfig>(() => loadStoredChatConfig());

  const lastSnapshotUpdatedAtRef = useRef<number | null>(null);
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

    setCurrentSessionId(snapshot.sessionId);
    setRunState(effectiveRunState);
    setChatConfig(snapshot.chatConfig);
    storeChatConfig(snapshot.chatConfig);

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
  }, [replaceMessages]);

  useEffect(() => {
    let isDisposed = false;

    setIsHistoryLoaded(false);
    setCurrentSessionId(null);
    setRunState("idle");
    setIsStopping(false);
    lastSnapshotUpdatedAtRef.current = null;
    stoppedSessionIdsRef.current.clear();
    replaceMessages([]);

    if (workspaceId === null) {
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
  }, [loadChatSnapshot, replaceMessages, workspaceId]);

  useEffect(() => {
    if (!isHistoryLoaded || currentSessionId === null || runState !== "running") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadChatSnapshot(currentSessionId, true).catch((error) => {
        markAssistantError(`Chat failed to refresh. ${toErrorMessage(error)}`);
        setRunState("interrupted");
      });
    }, ACTIVE_RUN_SNAPSHOT_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [currentSessionId, isHistoryLoaded, loadChatSnapshot, markAssistantError, runState]);

  const sendMessage = useCallback(async (
    sendParams: SendChatMessageParams,
  ): Promise<void> => {
    if (workspaceId === null || !isHistoryLoaded || isAssistantRunActive || isStopping) {
      return;
    }

    const contentParts: ReadonlyArray<ContentPart> = buildContentParts(sendParams.text, sendParams.attachments);
    if (contentParts.length === 0) {
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestBody = {
      sessionId: currentSessionId ?? undefined,
      content: contentParts,
      timezone,
    };

    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      markAssistantError(ATTACHMENT_LIMIT_ERROR_MESSAGE);
      return;
    }

    appendUserMessage(contentParts);
    startAssistantMessage(OPTIMISTIC_ASSISTANT_STATUS_TEXT);
    stoppedSessionIdsRef.current.clear();
    setRunState("running");

    try {
      const response = await startChatRun(requestBody);
      setCurrentSessionId(response.sessionId);
      setChatConfig(response.chatConfig);
      storeChatConfig(response.chatConfig);
      await loadChatSnapshot(response.sessionId, true);
    } catch (error) {
      markAssistantError(`Chat request failed. ${toErrorMessage(error)}`);
      setRunState("idle");
    }
  }, [
    appendUserMessage,
    currentSessionId,
    isAssistantRunActive,
    isHistoryLoaded,
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
      try {
        await stopChatRun(currentSessionId);
      } catch (error) {
        markAssistantError(`Chat stop failed. ${toErrorMessage(error)}`);
        return;
      }
    }

    try {
      const response = await resetChatSession(currentSessionId ?? undefined);
      clearHistory();
      stoppedSessionIdsRef.current.clear();
      lastSnapshotUpdatedAtRef.current = null;
      setCurrentSessionId(response.sessionId);
      setRunState("idle");
      setChatConfig(response.chatConfig);
      storeChatConfig(response.chatConfig);
    } catch (error) {
      markAssistantError(`Chat reset failed. ${toErrorMessage(error)}`);
    }
  }, [clearHistory, currentSessionId, isAssistantRunActive, markAssistantError, workspaceId]);

  return {
    messages,
    runState,
    isHistoryLoaded,
    isAssistantRunActive,
    isLiveStreamConnected: false,
    isStopping,
    currentSessionId,
    chatConfig: chatConfig ?? defaultChatConfig,
    composerAction,
    acceptServerSessionId: setCurrentSessionId,
    sendMessage,
    stopMessage,
    clearConversation,
  };
}
