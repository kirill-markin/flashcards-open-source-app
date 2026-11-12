import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { buildWorkspaceRoute, chatRoute } from "../../routes";
import { useOptionalChatDraft } from "../composer/drafts/ChatDraftContext";
import type { ChatDraftContent } from "../composer/drafts/chatDraftStorage";
import { useOptionalChatSession } from "../sessionController";
import { useAiImportHandoff } from "./AiImportHandoffContext";

type AiImportRequest = Readonly<{
  workspaceId: string;
  draft: ChatDraftContent;
}>;

type OpenAiImportChat = Readonly<{
  isOpening: boolean;
  errorMessage: string;
  start: (draft: ChatDraftContent) => void;
}>;

export function useOpenAiImportChat(): OpenAiImportChat {
  const { activeWorkspace, isSessionVerified } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { t } = useI18n();
  const navigate = useNavigate();
  const draftContext = useOptionalChatDraft();
  const session = useOptionalChatSession();
  const handoff = useAiImportHandoff();
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const [request, setRequest] = useState<AiImportRequest | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const pendingRequestRef = useRef<AiImportRequest | null>(null);
  const draft = draftContext?.draft;
  const hasTransientDraft = draft !== undefined && draft.updatedAt === null
    && (draft.inputText !== "" || draft.pendingAttachments.length > 0);

  function start(draft: ChatDraftContent): void {
    if (request !== null || pendingRequestRef.current !== null || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (workspaceId === null || !isSessionVerified || draftContext === null || session === null || handoff === null) {
      setErrorMessage(t("chatPanel.transientErrors.remoteNotReady"));
      return;
    }

    const nextRequest = { workspaceId, draft };
    pendingRequestRef.current = nextRequest;
    setErrorMessage("");
    setRequest(nextRequest);
  }

  const openFreshChat = useEffectEvent(async (nextRequest: AiImportRequest): Promise<void> => {
    let navigated = false;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      if (nextRequest.workspaceId !== workspaceId || !isSessionVerified
        || draftContext === null || session === null || handoff === null) {
        setErrorMessage(t("chatPanel.transientErrors.remoteNotReady"));
        return;
      }

      if (!session.chatConfig.features.attachmentsEnabled) {
        setErrorMessage(t("common.unavailable"));
        return;
      }

      const sourceSessionId = session.currentSessionId;
      if (hasTransientDraft) {
        setErrorMessage(t("chatPanel.transientErrors.remoteNotReady"));
        return;
      }

      draftContext.suppressNextSessionDraftCarryover(sourceSessionId);
      const sessionId = await session.clearConversation();
      indexedDbOpenRecoveryState.throwIfFailed();
      if (sessionId === null || sessionId === sourceSessionId) {
        setErrorMessage(t("chatPanel.errors.newChatFailedPrefix"));
        return;
      }

      const draftUpdatedAt = draftContext.startSessionBoundDraft(sessionId, nextRequest.draft);
      if (draftUpdatedAt === null) {
        setErrorMessage(t("chatPanel.transientErrors.remoteNotReady"));
        return;
      }

      handoff.arm({ workspaceId: nextRequest.workspaceId, sessionId, draftUpdatedAt });
      await navigate(buildWorkspaceRoute(nextRequest.workspaceId, chatRoute));
      navigated = true;
    } catch (error) {
      if (!markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(`${t("chatPanel.errors.newChatFailedPrefix")} ${message}`);
      }
    } finally {
      if (!navigated) {
        setRequest(null);
      }
    }
  });

  const canOpenFreshChat = session?.isHistoryLoaded === true
    && !session.isStopping
    && draftContext?.composerSendPhase === "idle"
    && !(hasTransientDraft && session.currentSessionId !== null);
  useEffect(() => {
    if (request === null || pendingRequestRef.current !== request) {
      return;
    }
    if (request.workspaceId === workspaceId && isSessionVerified && !canOpenFreshChat) {
      return;
    }

    pendingRequestRef.current = null;
    void openFreshChat(request);
  }, [canOpenFreshChat, isSessionVerified, request, workspaceId]);

  return { isOpening: request !== null, errorMessage, start };
}
