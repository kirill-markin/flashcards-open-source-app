import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../../appData";
import type { PendingAttachment } from "../attachments/FileAttachment";
import {
  areChatDraftContentsEqual,
  createChatDraftContent,
  loadChatDraftWorkspaceState,
  readStoredChatDraftForSession,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
  subscribeToChatDraftWorkspaceStateChanges,
  type ChatDraftContent,
  type StoredChatDraft,
} from "./chatDraftStorage";
import { useOptionalChatSession } from "../sessionController";

export type ChatDraft = Readonly<{
  workspaceId: string | null;
  sessionId: string | null;
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
  updatedAt: number | null;
}>;

export type ChatComposerSendPhase = "idle" | "preparingSend" | "startingRun";

type ChatDraftContextValue = Readonly<{
  draft: ChatDraft;
  composerSendPhase: ChatComposerSendPhase;
  focusComposerRequestVersion: number;
  replaceInputText: (nextInputText: string) => void;
  updateInputText: (updateDraftText: (currentInputText: string) => string) => void;
  replacePendingAttachments: (nextPendingAttachments: ReadonlyArray<PendingAttachment>) => void;
  moveDraftToSession: (sourceSessionId: string | null, sourceDraftUpdatedAt: number | null, targetSessionId: string, nextDraft: ChatDraftContent) => number | null;
  replaceDraftForSession: (sessionId: string | null, nextDraft: ChatDraftContent) => void;
  replaceComposerSendPhase: (nextSendPhase: ChatComposerSendPhase) => void;
  requestComposerFocus: () => void;
  suppressNextSessionDraftCarryover: (sourceSessionId: string | null) => void;
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

type DraftTarget = Readonly<{
  workspaceId: string | null;
  sessionId: string | null;
}>;

const ChatDraftContext = createContext<ChatDraftContextValue | null>(null);

function createEmptyChatDraft(workspaceId: string | null): ChatDraft {
  return {
    workspaceId,
    sessionId: null,
    inputText: "",
    pendingAttachments: [],
    updatedAt: null,
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
  const draftsBySessionIdRef = useRef<Readonly<Record<string, StoredChatDraft>>>(draftsBySessionId);
  const [transientDraft, setTransientDraft] = useState<TransientChatDraft | null>(null);
  const [composerSendPhase, setComposerSendPhase] = useState<ChatComposerSendPhase>("idle");
  const [focusComposerRequestVersion, setFocusComposerRequestVersion] = useState<number>(0);
  const previousDraftTargetRef = useRef<DraftTarget>({
    workspaceId: activeWorkspaceId,
    sessionId: activeSessionId,
  });
  const suppressedDraftCarryoverRef = useRef<DraftTarget | null>(null);

  useEffect(() => {
    const nextDraftsBySessionId = loadChatDraftWorkspaceState(activeWorkspaceId);
    draftsBySessionIdRef.current = nextDraftsBySessionId;
    setDraftsBySessionId(nextDraftsBySessionId);
    setTransientDraft(null);
    setComposerSendPhase("idle");
  }, [activeWorkspaceId]);

  useEffect(() => {
    draftsBySessionIdRef.current = draftsBySessionId;
  }, [draftsBySessionId]);

  useEffect(() => {
    return subscribeToChatDraftWorkspaceStateChanges((changedWorkspaceId) => {
      if (changedWorkspaceId !== activeWorkspaceId) {
        return;
      }

      const nextDraftsBySessionId = loadChatDraftWorkspaceState(activeWorkspaceId);
      draftsBySessionIdRef.current = nextDraftsBySessionId;
      setDraftsBySessionId(nextDraftsBySessionId);
    });
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId === null || activeSessionId === null || transientDraft === null) {
      return;
    }

    if (transientDraft.workspaceId !== activeWorkspaceId) {
      return;
    }

    const nextDraftsBySessionId = replaceChatDraftForSession(
      draftsBySessionIdRef.current,
      activeSessionId,
      transientDraft.draft,
    );
    draftsBySessionIdRef.current = nextDraftsBySessionId;
    storeChatDraftWorkspaceState(activeWorkspaceId, nextDraftsBySessionId);
    setDraftsBySessionId(nextDraftsBySessionId);
    setTransientDraft(null);
  }, [activeSessionId, activeWorkspaceId, transientDraft]);

  useEffect(() => {
    const previousDraftTarget = previousDraftTargetRef.current;

    if (previousDraftTarget.workspaceId !== activeWorkspaceId) {
      previousDraftTargetRef.current = {
        workspaceId: activeWorkspaceId,
        sessionId: activeSessionId,
      };
      suppressedDraftCarryoverRef.current = null;
      return;
    }

    if (previousDraftTarget.sessionId === activeSessionId) {
      return;
    }

    const shouldSuppressCarryover = consumeSuppressedDraftCarryover(
      suppressedDraftCarryoverRef,
      previousDraftTarget,
    );

    if (
      shouldSuppressCarryover === false
      && activeWorkspaceId !== null
      && activeSessionId !== null
    ) {
      carryDraftToSession(previousDraftTarget.sessionId, activeSessionId);
    }

    previousDraftTargetRef.current = {
      workspaceId: activeWorkspaceId,
      sessionId: activeSessionId,
    };
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

    const nextDraftsBySessionId = replaceChatDraftForSession(
      draftsBySessionIdRef.current,
      sessionId,
      nextDraft,
    );
    draftsBySessionIdRef.current = nextDraftsBySessionId;
    storeChatDraftWorkspaceState(activeWorkspaceId, nextDraftsBySessionId);
    setDraftsBySessionId(nextDraftsBySessionId);
  }

  function carryDraftToSession(
    sourceSessionId: string | null,
    targetSessionId: string,
  ): void {
    const currentDraftsBySessionId = draftsBySessionIdRef.current;
    const targetDraft = readStoredChatDraftForSession(currentDraftsBySessionId, targetSessionId);
    if (targetDraft !== null) {
      return;
    }

    const carriedDraft = readDraftContentForCarryover(
      currentDraftsBySessionId,
      sourceSessionId,
      activeWorkspaceId,
      transientDraft,
    );
    if (carriedDraft === null) {
      return;
    }

    const targetDraftsBySessionId = replaceChatDraftForSession(
      currentDraftsBySessionId,
      targetSessionId,
      carriedDraft,
    );
    const nextDraftsBySessionId = sourceSessionId === null
      ? targetDraftsBySessionId
      : replaceChatDraftForSession(
        targetDraftsBySessionId,
        sourceSessionId,
        createChatDraftContent("", []),
      );

    draftsBySessionIdRef.current = nextDraftsBySessionId;
    storeChatDraftWorkspaceState(activeWorkspaceId, nextDraftsBySessionId);
    setDraftsBySessionId(nextDraftsBySessionId);
    if (sourceSessionId === null) {
      setTransientDraft(null);
    }
  }

  function moveDraftToSession(
    sourceSessionId: string | null,
    sourceDraftUpdatedAt: number | null,
    targetSessionId: string,
    nextDraft: ChatDraftContent,
  ): number | null {
    const currentDraftsBySessionId = loadChatDraftWorkspaceState(activeWorkspaceId);
    const targetDraftsBySessionId = replaceChatDraftForSession(
      currentDraftsBySessionId,
      targetSessionId,
      nextDraft,
    );
    const targetDraft = readStoredChatDraftForSession(targetDraftsBySessionId, targetSessionId);
    const sourceDraft = readStoredChatDraftForSession(targetDraftsBySessionId, sourceSessionId);
    const shouldClearSourceDraft = sourceSessionId !== null
      && sourceSessionId !== targetSessionId
      && sourceDraft !== null
      && sourceDraftUpdatedAt !== null
      && sourceDraft.updatedAt === sourceDraftUpdatedAt
      && areChatDraftContentsEqual(sourceDraft, nextDraft);
    const nextDraftsBySessionId = shouldClearSourceDraft === false
      ? targetDraftsBySessionId
      : replaceChatDraftForSession(
        targetDraftsBySessionId,
        sourceSessionId,
        createChatDraftContent("", []),
      );
    storeChatDraftWorkspaceState(activeWorkspaceId, nextDraftsBySessionId);
    draftsBySessionIdRef.current = nextDraftsBySessionId;
    if (transientDraft !== null && transientDraft.workspaceId === activeWorkspaceId) {
      setTransientDraft(null);
    }
    setDraftsBySessionId(nextDraftsBySessionId);
    return targetDraft?.updatedAt ?? null;
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

  function suppressNextSessionDraftCarryover(sourceSessionId: string | null): void {
    suppressedDraftCarryoverRef.current = {
      workspaceId: activeWorkspaceId,
      sessionId: sourceSessionId,
    };
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
        moveDraftToSession,
        replaceDraftForSession,
        replaceComposerSendPhase,
        requestComposerFocus,
        suppressNextSessionDraftCarryover,
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
      updatedAt: null,
    };
  }

  const resolvedDraft = readStoredChatDraftForSession(draftsBySessionId, sessionId);
  if (resolvedDraft !== null) {
    return {
      workspaceId,
      sessionId,
      inputText: resolvedDraft.inputText,
      pendingAttachments: resolvedDraft.pendingAttachments,
      updatedAt: resolvedDraft.updatedAt,
    };
  }

  return createEmptyChatDraft(workspaceId);
}

function isChatDraftContentEmpty(draft: ChatDraftContent): boolean {
  return draft.inputText.trim() === "" && draft.pendingAttachments.length === 0;
}

function consumeSuppressedDraftCarryover(
  suppressedDraftCarryoverRef: MutableRefObject<DraftTarget | null>,
  previousDraftTarget: DraftTarget,
): boolean {
  const suppressedDraftCarryover = suppressedDraftCarryoverRef.current;
  if (suppressedDraftCarryover === null) {
    return false;
  }

  suppressedDraftCarryoverRef.current = null;
  return suppressedDraftCarryover.workspaceId === previousDraftTarget.workspaceId
    && suppressedDraftCarryover.sessionId === previousDraftTarget.sessionId;
}

function readDraftContentForCarryover(
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  sourceSessionId: string | null,
  workspaceId: string | null,
  transientDraft: TransientChatDraft | null,
): ChatDraftContent | null {
  const carriedDraft = sourceSessionId === null
    ? readTransientDraftContentForCarryover(workspaceId, transientDraft)
    : readStoredChatDraftForSession(draftsBySessionId, sourceSessionId);

  if (carriedDraft === null || isChatDraftContentEmpty(carriedDraft)) {
    return null;
  }

  return createChatDraftContent(carriedDraft.inputText, carriedDraft.pendingAttachments);
}

function readTransientDraftContentForCarryover(
  workspaceId: string | null,
  transientDraft: TransientChatDraft | null,
): ChatDraftContent | null {
  if (transientDraft === null || transientDraft.workspaceId !== workspaceId) {
    return null;
  }

  return transientDraft.draft;
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
