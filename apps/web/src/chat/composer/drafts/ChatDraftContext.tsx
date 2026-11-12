import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../../../appData";
import type { PendingAttachment } from "../../attachments/FileAttachment";
import {
  areChatDraftContentsEqual,
  createChatDraftContent,
  createUpdatedChatDraft,
  loadChatDraftWorkspaceState,
  readStoredChatDraftForSession,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
  subscribeToChatDraftWorkspaceStateChanges,
  toPersistableChatDraftContent,
  type ChatDraftContent,
  type StoredChatDraft,
} from "./chatDraftStorage";
import { useOptionalChatSession } from "../../sessionController";

export type ChatDraft = Readonly<{
  workspaceId: string | null;
  sessionId: string | null;
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
  updatedAt: number | null;
  sessionBoundDraftId: symbol | null;
}>;

export type ChatComposerSendPhase = "idle" | "preparingSend" | "startingRun";

type ChatDraftContextValue = Readonly<{
  draft: ChatDraft;
  composerSendPhase: ChatComposerSendPhase;
  focusComposerRequestVersion: number;
  isAiImportRestartRequired: boolean;
  replaceInputText: (nextInputText: string) => void;
  updateInputText: (updateDraftText: (currentInputText: string) => string) => void;
  replacePendingAttachments: (nextPendingAttachments: ReadonlyArray<PendingAttachment>) => boolean;
  moveDraftToSession: (sourceSessionId: string | null, sourceDraftUpdatedAt: number | null, targetSessionId: string, nextDraft: ChatDraftContent) => number | null;
  replaceDraftForSession: (sessionId: string | null, nextDraft: ChatDraftContent) => void;
  startSessionBoundDraft: (sessionId: string, draft: ChatDraftContent) => number | null;
  getSessionBoundRequestIdForSend: (content: ChatDraftContent) => string | null;
  clearSessionBoundDraftIfUnchanged: (sessionId: string | null, expectedUpdatedAt: number | null) => void;
  requireAiImportRestart: (sessionId: string, expectedUpdatedAt: number) => void;
  dismissAiImportRestart: () => void;
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

type SessionBoundDraft = Readonly<{
  id: symbol;
  workspaceId: string;
  sessionId: string;
  originalImportPrompt: string;
  originalImportAttachments: ReadonlyArray<PendingAttachment>;
  lastRequest: Readonly<{ id: string; content: ChatDraftContent }> | null;
  draft: StoredChatDraft;
}>;

const ChatDraftContext = createContext<ChatDraftContextValue | null>(null);

function createEmptyChatDraft(workspaceId: string | null): ChatDraft {
  return {
    workspaceId,
    sessionId: null,
    inputText: "",
    pendingAttachments: [],
    updatedAt: null,
    sessionBoundDraftId: null,
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
  const [sessionBoundDraft, setSessionBoundDraft] = useState<SessionBoundDraft | null>(null);
  const sessionBoundDraftRef = useRef<SessionBoundDraft | null>(null);
  const [aiImportRestartWorkspaceId, setAiImportRestartWorkspaceId] = useState<string | null>(null);
  const isHistoryLoaded = session?.isHistoryLoaded === true;
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

      const nextDraftsBySessionId = mergeStoredAndInMemoryDrafts(
        loadChatDraftWorkspaceState(activeWorkspaceId),
        draftsBySessionIdRef.current,
      );
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
      if (sessionBoundDraftRef.current?.workspaceId !== activeWorkspaceId) {
        updateSessionBoundDraft(null);
      }
      previousDraftTargetRef.current = {
        workspaceId: activeWorkspaceId,
        sessionId: activeSessionId,
      };
      suppressedDraftCarryoverRef.current = null;
      return;
    }

    if (previousDraftTarget.sessionId !== activeSessionId) {
      if (consumeSuppressedDraftCarryover(suppressedDraftCarryoverRef, previousDraftTarget)) {
        if (readSessionBoundDraft(previousDraftTarget.sessionId) !== null) {
          updateSessionBoundDraft(null);
        }
        dismissAiImportRestart();
      } else if (activeWorkspaceId !== null && activeSessionId !== null) {
        carryDraftToSession(previousDraftTarget.sessionId, activeSessionId);
      }

      previousDraftTargetRef.current = {
        workspaceId: activeWorkspaceId,
        sessionId: activeSessionId,
      };
    }

    const currentDraft = sessionBoundDraftRef.current;
    if (currentDraft !== null && isHistoryLoaded && currentDraft.sessionId !== activeSessionId) {
      requireAiImportRestart(currentDraft.sessionId, currentDraft.draft.updatedAt);
    }
  }, [activeSessionId, activeWorkspaceId, isHistoryLoaded, transientDraft]);

  const activeSessionBoundDraft = sessionBoundDraft?.workspaceId === activeWorkspaceId
    && sessionBoundDraft.sessionId === activeSessionId ? sessionBoundDraft : null;
  const draft = getActiveDraft(activeWorkspaceId, activeSessionId, draftsBySessionId, transientDraft, activeSessionBoundDraft);

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

    const currentSessionBoundDraft = readSessionBoundDraft(sessionId);
    if (currentSessionBoundDraft !== null) {
      if (isChatDraftContentEmpty(nextDraft)) {
        updateSessionBoundDraft(null);
        return;
      }

      const hasImportAttachments = nextDraft.pendingAttachments.some((attachment) =>
        currentSessionBoundDraft.originalImportAttachments.includes(attachment));
      if (hasImportAttachments || nextDraft.inputText.trim() === currentSessionBoundDraft.originalImportPrompt) {
        updateSessionBoundDraft({ ...currentSessionBoundDraft, draft: createUpdatedChatDraft(nextDraft) });
        return;
      }

      updateSessionBoundDraft(null);
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

  function readSessionBoundDraft(sessionId: string | null): SessionBoundDraft | null {
    const currentDraft = sessionBoundDraftRef.current;
    return currentDraft?.workspaceId === activeWorkspaceId && currentDraft.sessionId === sessionId ? currentDraft : null;
  }

  function updateSessionBoundDraft(nextDraft: SessionBoundDraft | null): void {
    sessionBoundDraftRef.current = nextDraft;
    setSessionBoundDraft(nextDraft);
  }

  function startSessionBoundDraft(sessionId: string, content: ChatDraftContent): number | null {
    if (activeWorkspaceId === null) {
      return null;
    }

    const draft = createUpdatedChatDraft(content);
    updateSessionBoundDraft({
      id: Symbol(),
      workspaceId: activeWorkspaceId,
      sessionId,
      originalImportPrompt: content.inputText.trim(),
      originalImportAttachments: content.pendingAttachments,
      lastRequest: null,
      draft,
    });
    setAiImportRestartWorkspaceId(null);
    return draft.updatedAt;
  }

  function getSessionBoundRequestIdForSend(content: ChatDraftContent): string | null {
    const currentDraft = readSessionBoundDraft(activeSessionId);
    if (currentDraft === null || currentDraft.id !== draft.sessionBoundDraftId
      || currentDraft.draft.updatedAt !== draft.updatedAt) {
      return null;
    }

    const requestContent = createChatDraftContent(content.inputText.trim(), content.pendingAttachments);
    if (currentDraft.lastRequest !== null && areChatDraftContentsEqual(currentDraft.lastRequest.content, requestContent)) {
      return currentDraft.lastRequest.id;
    }

    const requestId = crypto.randomUUID().toLowerCase();
    updateSessionBoundDraft({ ...currentDraft, lastRequest: { id: requestId, content: requestContent } });
    return requestId;
  }

  function clearSessionBoundDraftIfUnchanged(sessionId: string | null, expectedUpdatedAt: number | null): void {
    if (readSessionBoundDraft(sessionId)?.draft.updatedAt === expectedUpdatedAt) {
      updateSessionBoundDraft(null);
    }
  }

  function requireAiImportRestart(sessionId: string, expectedUpdatedAt: number): void {
    const currentDraft = readSessionBoundDraft(sessionId);
    if (currentDraft?.draft.updatedAt === expectedUpdatedAt) {
      updateSessionBoundDraft(null);
      setAiImportRestartWorkspaceId(currentDraft.workspaceId);
    }
  }

  function dismissAiImportRestart(): void {
    setAiImportRestartWorkspaceId(null);
  }

  function carryDraftToSession(
    sourceSessionId: string | null,
    targetSessionId: string,
  ): void {
    if (readSessionBoundDraft(sourceSessionId) !== null || readSessionBoundDraft(targetSessionId) !== null) {
      return;
    }

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
    const currentDraftsBySessionId = mergeStoredAndInMemoryDrafts(
      loadChatDraftWorkspaceState(activeWorkspaceId),
      draftsBySessionIdRef.current,
    );
    const existingTargetDraft = readStoredChatDraftForSession(currentDraftsBySessionId, targetSessionId);
    if (sourceSessionId === targetSessionId) {
      if (
        existingTargetDraft === null
        || existingTargetDraft.updatedAt !== sourceDraftUpdatedAt
        || areChatDraftContentsEqual(toPersistableChatDraftContent(existingTargetDraft), toPersistableChatDraftContent(nextDraft)) === false
      ) {
        return null;
      }
      if (areChatDraftContentsEqual(existingTargetDraft, nextDraft)) {
        return existingTargetDraft.updatedAt;
      }
    } else if (existingTargetDraft !== null && areChatDraftContentsEqual(existingTargetDraft, nextDraft) === false) {
      return null;
    }
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
      && areChatDraftContentsEqual(toPersistableChatDraftContent(sourceDraft), toPersistableChatDraftContent(nextDraft));
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

  function replacePendingAttachments(nextPendingAttachments: ReadonlyArray<PendingAttachment>): boolean {
    const currentSessionBoundDraft = readSessionBoundDraft(activeSessionId);
    if (draft.sessionBoundDraftId !== null && currentSessionBoundDraft?.id !== draft.sessionBoundDraftId) {
      return false;
    }

    const currentInputText = currentSessionBoundDraft?.draft.inputText ?? draft.inputText;
    replaceDraftForSession(activeSessionId, createChatDraftContent(currentInputText, nextPendingAttachments));
    return true;
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
        isAiImportRestartRequired: activeWorkspaceId !== null && aiImportRestartWorkspaceId === activeWorkspaceId,
        replaceInputText,
        updateInputText,
        replacePendingAttachments,
        moveDraftToSession,
        replaceDraftForSession,
        startSessionBoundDraft,
        getSessionBoundRequestIdForSend,
        clearSessionBoundDraftIfUnchanged,
        requireAiImportRestart,
        dismissAiImportRestart,
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

function mergeStoredAndInMemoryDrafts(
  storedDraftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  memoryDraftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
): Record<string, StoredChatDraft> {
  const nextDraftsBySessionId = { ...storedDraftsBySessionId };
  for (const [sessionId, memoryDraft] of Object.entries(memoryDraftsBySessionId)) {
    const storedDraft = storedDraftsBySessionId[sessionId];
    const persistableMemoryDraft = toPersistableChatDraftContent(memoryDraft);
    if (
      (storedDraft !== undefined
        && storedDraft.updatedAt === memoryDraft.updatedAt
        && areChatDraftContentsEqual(storedDraft, persistableMemoryDraft))
      || (storedDraft === undefined && isChatDraftContentEmpty(persistableMemoryDraft))
    ) {
      nextDraftsBySessionId[sessionId] = memoryDraft;
    }
  }
  return nextDraftsBySessionId;
}

function getActiveDraft(
  workspaceId: string | null,
  sessionId: string | null,
  draftsBySessionId: Readonly<Record<string, StoredChatDraft>>,
  transientDraft: TransientChatDraft | null,
  sessionBoundDraft: SessionBoundDraft | null,
): ChatDraft {
  if (workspaceId === null) {
    return createEmptyChatDraft(null);
  }

  if (sessionBoundDraft === null && transientDraft !== null && transientDraft.workspaceId === workspaceId) {
    return {
      workspaceId,
      sessionId,
      inputText: transientDraft.draft.inputText,
      pendingAttachments: transientDraft.draft.pendingAttachments,
      updatedAt: null,
      sessionBoundDraftId: null,
    };
  }

  const resolvedDraft = sessionBoundDraft?.draft ?? readStoredChatDraftForSession(draftsBySessionId, sessionId);
  if (resolvedDraft !== null) {
    return {
      workspaceId,
      sessionId,
      inputText: resolvedDraft.inputText,
      pendingAttachments: resolvedDraft.pendingAttachments,
      updatedAt: resolvedDraft.updatedAt,
      sessionBoundDraftId: sessionBoundDraft?.id ?? null,
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
