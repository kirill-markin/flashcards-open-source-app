import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../appData";
import {
  useChatSessionController,
  type ChatSessionController,
} from "./useChatSessionController";

type Props = Readonly<{
  children: ReactNode;
}>;

const ChatSessionControllerContext = createContext<ChatSessionController | null>(null);

export function ChatSessionControllerProvider(props: Props): ReactElement {
  const { children } = props;
  const appData = useAppData();
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
    onToolRunPostSyncRequested: handleToolRunPostSyncRequested,
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
