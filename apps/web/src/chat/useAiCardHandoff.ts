import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../appData";
import type { Card } from "../types";
import { chatRoute } from "../routes";
import { makeCardPendingAttachment } from "./chatCardParts";
import { useOptionalChatDraft } from "./ChatDraftContext";
import { useOptionalChatSession } from "./ChatSessionControllerContext";

export function useAiCardHandoff(): (card: Card) => Promise<boolean> {
  const navigate = useNavigate();
  const { setErrorMessage } = useAppData();
  const draftContext = useOptionalChatDraft();
  const session = useOptionalChatSession();

  return useCallback(async (card: Card): Promise<boolean> => {
    if (draftContext === null || session === null) {
      return false;
    }

    const sourceSessionId = session.currentSessionId;
    const sourceDraft = draftContext.draft;
    const isDirtyConversation = session.messages.length > 0
      || sourceDraft.inputText.trim() !== ""
      || sourceDraft.pendingAttachments.length > 0
      || session.isAssistantRunActive
      || session.isStopping;
    const shouldRestorePendingDraft = sourceSessionId === null && isDirtyConversation;
    let targetSessionId = sourceSessionId;

    try {
      if (isDirtyConversation) {
        const clearedSessionId = await session.clearConversation({ forceFresh: true });
        if (clearedSessionId !== null) {
          targetSessionId = clearedSessionId;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI handoff failed. ${message}`);
      return false;
    }

    if (shouldRestorePendingDraft) {
      draftContext.replaceDraftForSession(null, sourceDraft);
    }

    draftContext.replaceDraftForSession(
      targetSessionId,
      {
        inputText: "",
        pendingAttachments: [makeCardPendingAttachment(card)],
      },
    );
    draftContext.requestComposerFocus();
    navigate(chatRoute);
    return true;
  }, [
    draftContext,
    navigate,
    setErrorMessage,
    session,
  ]);
}
