import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../appData";
import type { PendingAttachment } from "./FileAttachment";
import {
  createChatDraftContent,
  loadChatDraftWorkspaceState,
  readChatDraftForSession,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
  type ChatDraftContent,
  type StoredChatDraft,
} from "./chatDraftStorage";
import { useOptionalChatSession } from "./sessionController";

export type ChatDraft = Readonly<{
  workspaceId: string | null;
  sessionId: string | null;
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
}>;

export type ChatComposerSendPhase = "idle" | "preparingSend" | "startingRun";

type ChatDraftContextValue = Readonly<{
  draft: ChatDraft;
  composerSendPhase: ChatComposerSendPhase;
  focusComposerRequestVersion: number;
  replaceInputText: (nextInputText: string) => void;
  updateInputText: (updateDraftText: (currentInputText: string) => string) => void;
  replacePendingAttachments: (nextPendingAttachments: ReadonlyArray<PendingAttachment>) => void;
  replaceDraftForSession: (sessionId: string | null, nextDraft: ChatDraftContent) => void;
  replaceComposerSendPhase: (nextSendPhase: ChatComposerSendPhase) => void;
  requestComposerFocus: () => void;
  clearDraft: () => void;
  clearDraftForSession: (sessionId: string | null) => void;
}>;

type Props = Readonly<{
  children: ReactNode;
}>;

type TransientChatDraft = Readonly<{
  workspaceId: string | null;
  draft: ChatDraftContent;
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
  const [transientDraft, setTransientDraft] = useState<TransientChatDraft | null>(null);
  const [composerSendPhase, setComposerSendPhase] = useState<ChatComposerSendPhase>("idle");
  const [focusComposerRequestVersion, setFocusComposerRequestVersion] = useState<number>(0);

  useEffect(() => {
    setDraftsBySessionId(loadChatDraftWorkspaceState(activeWorkspaceId));
    setTransientDraft(null);
    setComposerSendPhase("idle");
  }, [activeWorkspaceId]);

  useEffect(() => {
    storeChatDraftWorkspaceState(activeWorkspaceId, draftsBySessionId);
  }, [activeWorkspaceId, draftsBySessionId]);

  useEffect(() => {
    if (activeWorkspaceId === null || activeSessionId === null || transientDraft === null) {
      return;
    }

    if (transientDraft.workspaceId !== activeWorkspaceId) {
      return;
    }

    setDraftsBySessionId((currentDrafts) => replaceChatDraftForSession(currentDrafts, activeSessionId, transientDraft.draft));
    setTransientDraft(null);
  }, [activeSessionId, activeWorkspaceId, transientDraft]);

  const draft = getActiveDraft(activeWorkspaceId, activeSessionId, draftsBySessionId, transientDraft);

  function replaceDraftForSession(sessionId: string | null, nextDraft: ChatDraftContent): void {
    if (sessionId === null) {
      setTransientDraft(isChatDraftContentEmpty(nextDraft)
        ? null
        : { workspaceId: activeWorkspaceId, draft: nextDraft });
      return;
    }

    if (transientDraft !== null && transientDraft.workspaceId === activeWorkspaceId) {
      setTransientDraft(null);
    }

    setDraftsBySessionId((currentDrafts) => replaceChatDraftForSession(currentDrafts, sessionId, nextDraft));
  }

  function clearDraftForSession(sessionId: string | null): void {
    if (sessionId === null) {
      setTransientDraft(null);
      return;
    }

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

  function replaceComposerSendPhase(nextSendPhase: ChatComposerSendPhase): void {
    setComposerSendPhase(nextSendPhase);
  }

  function requestComposerFocus(): void {
    setFocusComposerRequestVersion((currentVersion) => currentVersion + 1);
  }

  return (
    <ChatDraftContext.Provider
      value={{
        draft,
        composerSendPhase,
        focusComposerRequestVersion,
        replaceInputText,
        updateInputText,
        replacePendingAttachments,
        replaceDraftForSession,
        replaceComposerSendPhase,
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
  transientDraft: TransientChatDraft | null,
): ChatDraft {
  if (workspaceId === null) {
    return createEmptyChatDraft(null);
  }

  if (transientDraft !== null && transientDraft.workspaceId === workspaceId) {
    return {
      workspaceId,
      sessionId,
      inputText: transientDraft.draft.inputText,
      pendingAttachments: transientDraft.draft.pendingAttachments,
    };
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

function isChatDraftContentEmpty(draft: ChatDraftContent): boolean {
  return draft.inputText.trim() === "" && draft.pendingAttachments.length === 0;
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
