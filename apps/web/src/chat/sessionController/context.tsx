import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { formatAiLimitReachedMessageForHeldUsage } from "../shared/chatAiLimitPolicy";
import { formatChatAttachmentLimitMessages } from "../shared/chatSizePolicy";
import {
  useChatSessionController,
  type ChatSessionController,
} from "./useController";

type Props = Readonly<{
  children: ReactNode;
}>;

const ChatSessionControllerContext = createContext<ChatSessionController | null>(null);

export function ChatSessionControllerProvider(props: Props): ReactElement {
  const { children } = props;
  const appData = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { locale, t, formatDate, formatNumber } = useI18n();
  const activeWorkspaceId = appData.activeWorkspace?.workspaceId ?? null;
  const runSync = appData.runSync;
  const setAppErrorMessage = appData.setErrorMessage;

  const handleToolRunPostSyncRequested = useCallback(async (): Promise<void> => {
    // Web now matches the shared client rule: AI-driven data refreshes come
    // from one post-run sync after any tool-backed run, not from chat-specific
    // invalidation callbacks.
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await runSync();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        indexedDbOpenRecoveryState.throwIfFailed();
      }
      const message = error instanceof Error ? error.message : String(error);
      setAppErrorMessage(`Chat sync failed. ${message}`);
      throw error;
    }
  }, [indexedDbOpenRecoveryState, runSync, setAppErrorMessage]);

  const controller = useChatSessionController({
    indexedDbOpenRecoveryState,
    workspaceId: activeWorkspaceId,
    isRemoteReady: appData.sessionVerificationState === "verified",
    uiLocale: locale,
    onToolRunPostSyncRequested: handleToolRunPostSyncRequested,
    uiMessages: {
      activeRunInProgress: t("chatPanel.errors.activeRunInProgress"),
      formatAiLimitReached: (aiUsage) => formatAiLimitReachedMessageForHeldUsage({ aiUsage, t, formatDate }),
      attachmentLimits: formatChatAttachmentLimitMessages({ t, formatNumber }),
      attachmentUnsupported: t("chatPanel.alerts.attachmentUnsupported"),
      attachmentUploadFailed: t("chatPanel.alerts.attachmentUploadFailed"),
      errorFallbacks: {
        emptyBackendResponse: t("chatPanel.errors.emptyBackendResponse"),
        upstreamHtmlResponse: t("chatPanel.errors.upstreamHtmlResponse"),
      },
      genericChatFailed: t("chatPanel.errors.genericFailure"),
      liveStreamEndedBeforeCompletion: t("chatPanel.errors.liveStreamEndedBeforeCompletion"),
      newChatFailedPrefix: t("chatPanel.errors.newChatFailedPrefix"),
      ownOpenAIKeyErrorPrefix: t("chatPanel.errors.ownOpenAIKeyPrefix"),
      refreshFailedPrefix: t("chatPanel.errors.refreshFailedPrefix"),
      remoteNotReady: t("chatPanel.transientErrors.remoteNotReady"),
      requestFailedPrefix: t("chatPanel.errors.requestFailedPrefix"),
      requestTooLarge: t("chatPanel.alerts.attachmentLimit"),
      stopFailedPrefix: t("chatPanel.errors.stopFailedPrefix"),
      transcriptionUnexpectedSessionId: t("chatPanel.errors.transcriptionUnexpectedSessionId"),
      unexpectedSessionId: t("chatPanel.errors.unexpectedSessionId"),
      workspaceRequired: t("chatPanel.transientErrors.workspaceRequired"),
    },
  });

  return (
    <ChatSessionControllerContext.Provider value={controller}>
      {children}
    </ChatSessionControllerContext.Provider>
  );
}

export function useChatSession(): ChatSessionController {
  const context = useContext(ChatSessionControllerContext);
  if (context === null) {
    throw new Error("useChatSession must be used within ChatSessionControllerProvider");
  }

  return context;
}

export function useOptionalChatSession(): ChatSessionController | null {
  return useContext(ChatSessionControllerContext);
}
