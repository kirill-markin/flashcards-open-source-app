import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../appData";
import type { PendingAttachment } from "./FileAttachment";
import {
  adoptPendingChatDraftIfNeeded,
  createChatDraftContent,
  loadChatDraftWorkspaceState,
  readChatDraftForSession,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
  type ChatDraftContent,
  type StoredChatDraft,
} from "./chatDraftStorage";
import { useOptionalChatSession } from "./ChatSessionControllerContext";

export type ChatDraft = Readonly<{
  workspaceId: string | null;
  sessionId: string | null;
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
}>;

type ChatDraftContextValue = Readonly<{
  draft: ChatDraft;
  focusComposerRequestVersion: number;
  replaceInputText: (nextInputText: string) => void;
  updateInputText: (updateDraftText: (currentInputText: string) => string) => void;
  replacePendingAttachments: (nextPendingAttachments: ReadonlyArray<PendingAttachment>) => void;
  replaceDraftForSession: (sessionId: string | null, nextDraft: ChatDraftContent) => void;
  requestComposerFocus: () => void;
  clearDraft: () => void;
  clearDraftForSession: (sessionId: string | null) => void;
}>;

type Props = Readonly<{
  children: ReactNode;
}>;

const ChatDraftContext = createContext<ChatDraftContextValue | null>(null);

function createEmptyChatDraft(workspaceId: string | null): ChatDraft {
  return {
    workspaceId,
    sessionId: null,
    inputText: "",
    pendingAttachments: [],
  };
}

export function ChatDraftProvider(props: Props): ReactElement {
  const { children } = props;
  const appData = useAppData();
  const activeWorkspaceId = appData.activeWorkspace?.workspaceId ?? null;
  const session = useOptionalChatSession();
  const activeSessionId = session?.currentSessionId ?? null;
  const [draftsBySessionId, setDraftsBySessionId] = useState<Record<string, StoredChatDraft>>(() =>
    loadChatDraftWorkspaceState(activeWorkspaceId));
  const [focusComposerRequestVersion, setFocusComposerRequestVersion] = useState<number>(0);
  const didAdoptPendingDraftRef = useRef<boolean>(false);

  useEffect(() => {
    setDraftsBySessionId(loadChatDraftWorkspaceState(activeWorkspaceId));
    didAdoptPendingDraftRef.current = false;
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeSessionId === null) {
      didAdoptPendingDraftRef.current = false;
      return;
    }

    if (activeWorkspaceId === null || didAdoptPendingDraftRef.current) {
      return;
    }

    setDraftsBySessionId((currentDrafts) => {
      const nextDrafts = adoptPendingChatDraftIfNeeded(currentDrafts, activeSessionId);
      if (nextDrafts === currentDrafts) {
        didAdoptPendingDraftRef.current = true;
        return currentDrafts;
      }

      didAdoptPendingDraftRef.current = true;
      return nextDrafts;
    });
  }, [activeSessionId, activeWorkspaceId]);

  useEffect(() => {
    storeChatDraftWorkspaceState(activeWorkspaceId, draftsBySessionId);
  }, [activeWorkspaceId, draftsBySessionId]);

  const draft = getActiveDraft(activeWorkspaceId, activeSessionId, draftsBySessionId);

  function replaceDraftForSession(sessionId: string | null, nextDraft: ChatDraftContent): void {
    setDraftsBySessionId((currentDrafts) => replaceChatDraftForSession(currentDrafts, sessionId, nextDraft));
  }

  function clearDraftForSession(sessionId: string | null): void {
    replaceDraftForSession(sessionId, createChatDraftContent("", []));
  }

  function replaceInputText(nextInputText: string): void {
    replaceDraftForSession(activeSessionId, createChatDraftContent(nextInputText, draft.pendingAttachments));
  }

  function updateInputText(updateDraftText: (currentInputText: string) => string): void {
    replaceDraftForSession(activeSessionId, createChatDraftContent(updateDraftText(draft.inputText), draft.pendingAttachments));
  }

  function replacePendingAttachments(nextPendingAttachments: ReadonlyArray<PendingAttachment>): void {
    replaceDraftForSession(activeSessionId, createChatDraftContent(draft.inputText, nextPendingAttachments));
  }

  function clearDraft(): void {
    clearDraftForSession(activeSessionId);
  }

  function requestComposerFocus(): void {
    setFocusComposerRequestVersion((currentVersion) => currentVersion + 1);
  }

  return (
    <ChatDraftContext.Provider
      value={{
        draft,
        focusComposerRequestVersion,
        replaceInputText,
        updateInputText,
        replacePendingAttachments,
        replaceDraftForSession,
        requestComposerFocus,
        clearDraft,
        clearDraftForSession,
      }}
    >
      {children}
    </ChatDraftContext.Provider>
  );
}

function getActiveDraft(
  workspaceId: string | null,
  sessionId: string | null,
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
): ChatDraft {
  if (workspaceId === null) {
    return createEmptyChatDraft(null);
  }

  const resolvedDraft = readChatDraftForSession(draftsBySessionId, sessionId);
  if (resolvedDraft !== null) {
    return {
      workspaceId,
      sessionId,
      inputText: resolvedDraft.inputText,
      pendingAttachments: resolvedDraft.pendingAttachments,
    };
  }

  return createEmptyChatDraft(workspaceId);
}

export function useChatDraft(): ChatDraftContextValue {
  const context = useContext(ChatDraftContext);
  if (context === null) {
    throw new Error("useChatDraft must be used within ChatDraftProvider");
  }

  return context;
}

export function useOptionalChatDraft(): ChatDraftContextValue | null {
  return useContext(ChatDraftContext);
}
