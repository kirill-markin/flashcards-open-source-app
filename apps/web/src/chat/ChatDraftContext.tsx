import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../appData";
import type { PendingAttachment } from "./FileAttachment";

export type ChatDraft = Readonly<{
  workspaceId: string | null;
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
}>;

type ChatDraftContextValue = Readonly<{
  draft: ChatDraft;
  replaceInputText: (nextInputText: string) => void;
  updateInputText: (updateDraftText: (currentInputText: string) => string) => void;
  replacePendingAttachments: (nextPendingAttachments: ReadonlyArray<PendingAttachment>) => void;
  clearDraft: () => void;
}>;

type Props = Readonly<{
  children: ReactNode;
}>;

const ChatDraftContext = createContext<ChatDraftContextValue | null>(null);

function createEmptyChatDraft(workspaceId: string | null): ChatDraft {
  return {
    workspaceId,
    inputText: "",
    pendingAttachments: [],
  };
}

export function ChatDraftProvider(props: Props): ReactElement {
  const { children } = props;
  const appData = useAppData();
  const activeWorkspaceId = appData.activeWorkspace?.workspaceId ?? null;
  const [draft, setDraft] = useState<ChatDraft>(() => createEmptyChatDraft(activeWorkspaceId));

  useEffect(() => {
    setDraft((currentDraft) => {
      if (currentDraft.workspaceId === activeWorkspaceId) {
        return currentDraft;
      }

      return createEmptyChatDraft(activeWorkspaceId);
    });
  }, [activeWorkspaceId]);

  function replaceInputText(nextInputText: string): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      workspaceId: activeWorkspaceId,
      inputText: nextInputText,
    }));
  }

  function updateInputText(updateDraftText: (currentInputText: string) => string): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      workspaceId: activeWorkspaceId,
      inputText: updateDraftText(currentDraft.inputText),
    }));
  }

  function replacePendingAttachments(nextPendingAttachments: ReadonlyArray<PendingAttachment>): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      workspaceId: activeWorkspaceId,
      pendingAttachments: nextPendingAttachments,
    }));
  }

  function clearDraft(): void {
    setDraft(createEmptyChatDraft(activeWorkspaceId));
  }

  return (
    <ChatDraftContext.Provider
      value={{
        draft,
        replaceInputText,
        updateInputText,
        replacePendingAttachments,
        clearDraft,
      }}
    >
      {children}
    </ChatDraftContext.Provider>
  );
}

export function useChatDraft(): ChatDraftContextValue {
  const context = useContext(ChatDraftContext);
  if (context === null) {
    throw new Error("useChatDraft must be used within ChatDraftProvider");
  }

  return context;
}
