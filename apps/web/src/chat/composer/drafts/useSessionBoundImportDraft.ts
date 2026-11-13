import { useRef, useState } from "react";
import { hasChatDraftContent } from "../chatComposerState";
import {
  areChatDraftContentsEqual,
  createChatDraftContent,
  createUpdatedChatDraft,
  type ChatDraftContent,
  type StoredChatDraft,
} from "./chatDraftStorage";

export type SessionBoundDraft = Readonly<{
  id: symbol;
  workspaceId: string;
  sessionId: string;
  originalContent: ChatDraftContent;
  autoSendDraftUpdatedAt: number | null;
  lastRequest: Readonly<{ id: string; content: ChatDraftContent }> | null;
  draft: StoredChatDraft;
}>;

export type AiImportSendReadiness = Readonly<{
  workspaceId: string | null;
  sessionId: string | null;
  isHistoryLoaded: boolean;
  canSendPendingMessage: boolean;
}>;

export function useSessionBoundImportDraft(activeWorkspaceId: string | null, activeSessionId: string | null) {
  const [sessionBoundDraft, setSessionBoundDraft] = useState<SessionBoundDraft | null>(null);
  const sessionBoundDraftRef = useRef<SessionBoundDraft | null>(null);
  const [restartWorkspaceId, setRestartWorkspaceId] = useState<string | null>(null);

  const activeDraft = sessionBoundDraft?.workspaceId === activeWorkspaceId
    && sessionBoundDraft.sessionId === activeSessionId ? sessionBoundDraft : null;

  function updateDraft(nextDraft: SessionBoundDraft | null): void {
    sessionBoundDraftRef.current = nextDraft;
    setSessionBoundDraft(nextDraft);
  }

  function readForSession(sessionId: string | null): SessionBoundDraft | null {
    const currentDraft = sessionBoundDraftRef.current;
    return currentDraft?.workspaceId === activeWorkspaceId && currentDraft.sessionId === sessionId ? currentDraft : null;
  }

  function stage(sessionId: string, content: ChatDraftContent): boolean {
    if (activeWorkspaceId === null) {
      return false;
    }

    const draft = createUpdatedChatDraft(content);
    updateDraft({
      id: Symbol(),
      workspaceId: activeWorkspaceId,
      sessionId,
      originalContent: createChatDraftContent(content.inputText.trim(), content.pendingAttachments),
      autoSendDraftUpdatedAt: draft.updatedAt,
      lastRequest: null,
      draft,
    });
    dismissRestart();
    return true;
  }

  function replaceForSession(sessionId: string, content: ChatDraftContent): boolean {
    const currentDraft = readForSession(sessionId);
    if (currentDraft === null) {
      return false;
    }

    if (!hasChatDraftContent(content.inputText, content.pendingAttachments)) {
      updateDraft(null);
      return true;
    }

    const hasImportAttachments = content.pendingAttachments.some((attachment) =>
      currentDraft.originalContent.pendingAttachments.includes(attachment));
    if (hasImportAttachments || content.inputText.trim() === currentDraft.originalContent.inputText) {
      updateDraft({ ...currentDraft, draft: createUpdatedChatDraft(content) });
      return true;
    }

    updateDraft(null);
    return false;
  }

  function claimAutoSend(readiness: AiImportSendReadiness): string | null {
    const currentDraft = sessionBoundDraftRef.current;
    if (!readiness.isHistoryLoaded || currentDraft === null || currentDraft.autoSendDraftUpdatedAt === null
      || currentDraft.id !== sessionBoundDraft?.id) {
      return null;
    }

    const isTargetCurrent = readiness.workspaceId === currentDraft.workspaceId
      && readiness.sessionId === currentDraft.sessionId;
    const isUnedited = currentDraft.draft.updatedAt === currentDraft.autoSendDraftUpdatedAt;
    if (!isTargetCurrent) {
      if (readiness.workspaceId === currentDraft.workspaceId && isUnedited) {
        requireRestart(currentDraft);
      } else {
        updateDraft({ ...currentDraft, autoSendDraftUpdatedAt: null });
      }
      return null;
    }

    if (!isUnedited || activeDraft?.draft.updatedAt !== currentDraft.autoSendDraftUpdatedAt) {
      updateDraft({ ...currentDraft, autoSendDraftUpdatedAt: null });
      return null;
    }

    if (!readiness.canSendPendingMessage) {
      return null;
    }

    updateDraft({ ...currentDraft, autoSendDraftUpdatedAt: null });
    return currentDraft.sessionId;
  }

  function getRequestIdForSend(content: ChatDraftContent): string | null {
    const currentDraft = readForSession(activeSessionId);
    if (currentDraft === null || currentDraft.id !== activeDraft?.id
      || currentDraft.draft.updatedAt !== activeDraft.draft.updatedAt) {
      return null;
    }

    const requestContent = createChatDraftContent(content.inputText.trim(), content.pendingAttachments);
    if (currentDraft.lastRequest !== null && areChatDraftContentsEqual(currentDraft.lastRequest.content, requestContent)) {
      return currentDraft.lastRequest.id;
    }

    const requestId = crypto.randomUUID().toLowerCase();
    updateDraft({ ...currentDraft, lastRequest: { id: requestId, content: requestContent } });
    return requestId;
  }

  function clearIfUnchanged(sessionId: string | null, expectedUpdatedAt: number | null): void {
    if (readForSession(sessionId)?.draft.updatedAt === expectedUpdatedAt) {
      updateDraft(null);
    }
  }

  function requireRestart(draft: SessionBoundDraft): void {
    updateDraft(null);
    setRestartWorkspaceId(draft.workspaceId);
  }

  function dismissRestart(): void {
    setRestartWorkspaceId(null);
  }

  function discardOutsideWorkspace(): void {
    if (sessionBoundDraftRef.current?.workspaceId !== activeWorkspaceId) {
      updateDraft(null);
    }
  }

  function discardAfterSuppressedCarryover(sourceSessionId: string | null): void {
    if (readForSession(sourceSessionId) !== null) {
      updateDraft(null);
    }
    dismissRestart();
  }

  function requireRestartIfSessionChanged(): void {
    const currentDraft = sessionBoundDraftRef.current;
    if (currentDraft?.workspaceId === activeWorkspaceId && currentDraft.sessionId !== activeSessionId) {
      requireRestart(currentDraft);
    }
  }

  return {
    activeDraft,
    isAutoSendPending: activeDraft !== null && activeDraft.autoSendDraftUpdatedAt !== null,
    isRestartRequired: activeWorkspaceId !== null && restartWorkspaceId === activeWorkspaceId,
    stage,
    readForSession,
    replaceForSession,
    claimAutoSend,
    getRequestIdForSend,
    clearIfUnchanged,
    dismissRestart,
    discardOutsideWorkspace,
    discardAfterSuppressedCarryover,
    requireRestartIfSessionChanged,
  };
}
