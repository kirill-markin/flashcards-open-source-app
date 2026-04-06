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
  const refreshLocalData = appData.refreshLocalData;
  const setAppErrorMessage = appData.setErrorMessage;

  const handleMainContentInvalidated = useCallback((mainContentInvalidationVersion: number): void => {
    if (mainContentInvalidationVersion <= 0) {
      return;
    }

    void refreshLocalData().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setAppErrorMessage(`Chat content refresh failed. ${message}`);
    });
  }, [refreshLocalData, setAppErrorMessage]);

  const controller = useChatSessionController({
    workspaceId: activeWorkspaceId,
    isRemoteReady: appData.sessionVerificationState === "verified",
    onMainContentInvalidated: handleMainContentInvalidated,
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
