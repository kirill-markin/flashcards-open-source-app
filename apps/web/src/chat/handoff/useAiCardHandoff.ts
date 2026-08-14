import { useCallback } from "react";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import type { Card } from "../../types";
import { makeCardPendingAttachment } from "../attachments/chatCardParts";
import { useOptionalChatDraft } from "../composer/drafts/ChatDraftContext";
import { useOptionalChatLayout } from "../layout/ChatLayoutContext";
import { useOptionalChatSession } from "../sessionController";

export function useAiCardHandoff(): (card: Card) => Promise<boolean> {
  const { setErrorMessage } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const draftContext = useOptionalChatDraft();
  const chatLayout = useOptionalChatLayout();
  const session = useOptionalChatSession();

  return useCallback(async (card: Card): Promise<boolean> => {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || draftContext === null
      || chatLayout === null
      || session === null
    ) {
      return false;
    }

    const sourceSessionId = session.currentSessionId;
    if (draftContext.composerSendPhase !== "idle") {
      return false;
    }

    if (session.isStopping) {
      return false;
    }

    if (session.isAssistantRunActive) {
      if (sourceSessionId === null) {
        return false;
      }

      draftContext.replaceDraftForSession(
        sourceSessionId,
        {
          inputText: draftContext.draft.inputText,
          pendingAttachments: [
            ...draftContext.draft.pendingAttachments,
            makeCardPendingAttachment(card),
          ],
        },
      );
      if (chatLayout.isOpen === false) {
        chatLayout.setIsOpen(true);
      }
      draftContext.requestComposerFocus();
      return true;
    }

    const isDirtyConversation = session.messages.length > 0
      || draftContext.draft.inputText.trim() !== ""
      || draftContext.draft.pendingAttachments.length > 0;
    let targetSessionId = sourceSessionId;

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      if (sourceSessionId === null || isDirtyConversation) {
        indexedDbOpenRecoveryState.throwIfFailed();
        draftContext.suppressNextSessionDraftCarryover(sourceSessionId);
        const clearedSessionId = await session.clearConversation();
        indexedDbOpenRecoveryState.throwIfFailed();
        if (clearedSessionId !== null) {
          targetSessionId = clearedSessionId;
        }
      }
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI handoff failed. ${message}`);
      return false;
    }

    if (targetSessionId === null || indexedDbOpenRecoveryState.hasFailed()) {
      return false;
    }

    draftContext.replaceDraftForSession(
      targetSessionId,
      {
        inputText: "",
        pendingAttachments: [makeCardPendingAttachment(card)],
      },
    );
    if (chatLayout.isOpen === false) {
      chatLayout.setIsOpen(true);
    }
    draftContext.requestComposerFocus();
    return true;
  }, [
    chatLayout,
    draftContext,
    indexedDbOpenRecoveryState,
    setErrorMessage,
    session,
  ]);
}
