import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import { USER_VISIBLE_ATTACHMENT_LIMIT_MB } from "../chatHelpers";
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
  const { locale, t, formatNumber } = useI18n();
  const activeWorkspaceId = appData.activeWorkspace?.workspaceId ?? null;
  const runSync = appData.runSync;
  const setAppErrorMessage = appData.setErrorMessage;

  const handleToolRunPostSyncRequested = useCallback(async (): Promise<void> => {
    // Web now matches the shared client rule: AI-driven data refreshes come
    // from one post-run sync after any tool-backed run, not from chat-specific
    // invalidation callbacks.
    try {
      await runSync();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAppErrorMessage(`Chat sync failed. ${message}`);
      throw error;
    }
  }, [runSync, setAppErrorMessage]);

  const controller = useChatSessionController({
    workspaceId: activeWorkspaceId,
    isRemoteReady: appData.sessionVerificationState === "verified",
    uiLocale: locale,
    onToolRunPostSyncRequested: handleToolRunPostSyncRequested,
    uiMessages: {
      activeRunInProgress: t("chatPanel.errors.activeRunInProgress"),
      attachmentLimit: t("chatPanel.alerts.attachmentLimit", {
        count: formatNumber(USER_VISIBLE_ATTACHMENT_LIMIT_MB),
      }),
      errorFallbacks: {
        emptyBackendResponse: t("chatPanel.errors.emptyBackendResponse"),
        upstreamHtmlResponse: t("chatPanel.errors.upstreamHtmlResponse"),
      },
      genericChatFailed: t("chatPanel.errors.genericFailure"),
      liveStreamEndedBeforeCompletion: t("chatPanel.errors.liveStreamEndedBeforeCompletion"),
      newChatFailedPrefix: t("chatPanel.errors.newChatFailedPrefix"),
      optimisticAssistantStatus: t("chatPanel.status.searchingCards"),
      refreshFailedPrefix: t("chatPanel.errors.refreshFailedPrefix"),
      remoteNotReady: t("chatPanel.transientErrors.remoteNotReady"),
      requestFailedPrefix: t("chatPanel.errors.requestFailedPrefix"),
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
