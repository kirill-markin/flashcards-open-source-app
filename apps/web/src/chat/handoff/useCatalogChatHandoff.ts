import { useEffect, useEffectEvent, useState, useSyncExternalStore, type RefObject } from "react";
import { useAppData } from "../../appData";
import { markIndexedDbOpenRecoveryFailureAndCheckActive, useAppErrorDialog } from "../../appError/AppErrorContext";
import { createBrowserUuidV4 } from "../../browserUuid";
import { useI18n } from "../../i18n";
import { hasChatDraftContent } from "../composer/chatComposerState";
import { useChatDraft } from "../composer/drafts/ChatDraftContext";
import {
  clearStoredChatDraftForSessionIfUnchanged,
  loadChatDraftWorkspaceState,
  type StoredChatDraft,
} from "../composer/drafts/chatDraftStorage";
import { useChatSession } from "../sessionController";
import {
  consumeCatalogChatDraftTransfer,
  consumeCatalogChatTopic,
  readCatalogChatGuestSignInUserId,
  readCatalogChatHandoff,
  subscribeToCatalogChatHandoff,
} from "./catalogChatHandoff";

type StoredCatalogDraft = Readonly<{ sessionId: string; draft: StoredChatDraft }>;

function findCatalogDraft(workspaceId: string, draftId: string): StoredCatalogDraft | null {
  for (const [sessionId, draft] of Object.entries(loadChatDraftWorkspaceState(workspaceId))) {
    if (draft.catalogHandoffId === draftId) return { sessionId, draft };
  }
  return null;
}

export function useCatalogChatHandoff(
  canOpen: boolean,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): boolean {
  const { activeWorkspace, isSessionVerified, session, setErrorMessage } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { t } = useI18n();
  const { draft, readActiveDraft, stageCatalogDraftForSession, suppressNextSessionDraftCarryover } = useChatDraft();
  const { currentSessionId, canStartCatalogConversation, startCatalogConversation } = useChatSession();
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const pending = useSyncExternalStore(subscribeToCatalogChatHandoff, readCatalogChatHandoff);
  const guestSignInUserId = useSyncExternalStore(subscribeToCatalogChatHandoff, readCatalogChatGuestSignInUserId);
  const hasDraft = hasChatDraftContent(draft.inputText, draft.pendingAttachments);
  const isReady = canOpen && isSessionVerified && workspaceId !== null && guestSignInUserId !== session?.userId
    && !indexedDbOpenRecoveryState.hasFailed();

  const openCatalogChat = useEffectEvent((): void => {
    const handoff = readCatalogChatHandoff();
    if (!isReady || handoff === null || handoff.userId !== session?.userId || workspaceId === null
      || readCatalogChatGuestSignInUserId() === session.userId) return;

    try {
      const activeDraft = readActiveDraft();
      const hasActiveDraft = hasChatDraftContent(activeDraft.inputText, activeDraft.pendingAttachments);
      const transfer = handoff.transfer;
      if (transfer?.destinationWorkspaceId != null) {
        if (transfer.destinationWorkspaceId !== workspaceId) return;

        const sourceDraft = findCatalogDraft(transfer.sourceWorkspaceId, transfer.draftId);
        const destinationDraft = transfer.sourceWorkspaceId === workspaceId
          ? sourceDraft
          : findCatalogDraft(workspaceId, transfer.draftId);
        const draftToRestore = destinationDraft ?? sourceDraft;
        if (draftToRestore === null) {
          consumeCatalogChatDraftTransfer(handoff);
          return;
        }

        if (activeDraft.catalogHandoffId !== transfer.draftId) {
          if (hasActiveDraft) return;
          const sessionId = startCatalogConversation((nextSessionId) => {
            stageCatalogDraftForSession(nextSessionId, draftToRestore.draft, destinationDraft);
            suppressNextSessionDraftCarryover(currentSessionId);
          });
          if (sessionId === null) return;
          setFocusSessionId(sessionId);
        }

        if (sourceDraft !== null && transfer.sourceWorkspaceId !== workspaceId) {
          clearStoredChatDraftForSessionIfUnchanged(transfer.sourceWorkspaceId, sourceDraft.sessionId,
            sourceDraft.draft, sourceDraft.draft.updatedAt);
        }
        consumeCatalogChatDraftTransfer(handoff);
        return;
      }

      // Switching away would leave the current unsent draft in read-only history.
      const { topic } = handoff;
      if (topic === null || hasActiveDraft) return;
      const sessionId = startCatalogConversation((nextSessionId) => {
        stageCatalogDraftForSession(nextSessionId, {
          inputText: t("chatPanel.catalogTopicPrompt", { topic }),
          pendingAttachments: [],
          catalogHandoffId: session.browserGuestCapabilities?.isGuest === true ? createBrowserUuidV4() : undefined,
        }, null);
        suppressNextSessionDraftCarryover(currentSessionId);
      });
      if (sessionId === null) return;

      consumeCatalogChatTopic(handoff);
      setFocusSessionId(sessionId);
    } catch (error) {
      if (!markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        const detail = error instanceof Error ? error.message : String(error);
        setErrorMessage(t("chatPanel.errors.newChatFailedPrefix") + " " + detail);
      }
    }
  });

  useEffect(() => {
    if (isReady && pending !== null) openCatalogChat();
  }, [canStartCatalogConversation, currentSessionId, draft.catalogHandoffId, hasDraft, isReady, pending, session?.userId, workspaceId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!isReady || focusSessionId === null || draft.sessionId !== focusSessionId || textarea === null) return;

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    setFocusSessionId(null);
  }, [draft.sessionId, focusSessionId, isReady, textareaRef]);

  const destinationWorkspaceId = pending?.transfer?.destinationWorkspaceId;
  return canOpen && isSessionVerified && hasDraft && pending?.userId === session?.userId
    && (destinationWorkspaceId == null || destinationWorkspaceId === workspaceId)
    && (pending?.topic != null || (destinationWorkspaceId != null
      && pending?.transfer?.draftId !== draft.catalogHandoffId));
}
