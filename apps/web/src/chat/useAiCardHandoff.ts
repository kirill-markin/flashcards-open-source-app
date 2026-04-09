import { useCallback } from "react";
import { useAppData } from "../appData";
import type { Card } from "../types";
import { makeCardPendingAttachment } from "./chatCardParts";
import { useOptionalChatDraft } from "./ChatDraftContext";
import { useOptionalChatLayout } from "./ChatLayoutContext";
import { useOptionalChatSession } from "./sessionController";

export function useAiCardHandoff(): (card: Card) => Promise<boolean> {
  const { setErrorMessage } = useAppData();
  const draftContext = useOptionalChatDraft();
  const chatLayout = useOptionalChatLayout();
  const session = useOptionalChatSession();

  return useCallback(async (card: Card): Promise<boolean> => {
    if (draftContext === null || chatLayout === null || session === null) {
      return false;
    }

    const sourceSessionId = session.currentSessionId;
    const isDirtyConversation = session.messages.length > 0
      || draftContext.draft.inputText.trim() !== ""
      || draftContext.draft.pendingAttachments.length > 0
      || session.isAssistantRunActive
      || session.isStopping;
    let targetSessionId = sourceSessionId;

    try {
      if (sourceSessionId === null || isDirtyConversation) {
        const clearedSessionId = await session.clearConversation();
        if (clearedSessionId !== null) {
          targetSessionId = clearedSessionId;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI handoff failed. ${message}`);
      return false;
    }

    if (targetSessionId === null) {
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
    setErrorMessage,
    session,
  ]);
}
