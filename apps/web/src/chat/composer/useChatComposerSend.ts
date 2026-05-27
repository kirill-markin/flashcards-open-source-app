import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { listOutboxRecords } from "../../localDb/outbox";
import type { ChatComposerSendPhase } from "./ChatDraftContext";
import {
  clearStoredChatDraftForSessionIfUnchanged,
  createChatDraftContent,
  type ChatDraftContent,
} from "./chatDraftStorage";
import {
  binaryPendingAttachmentExceedsSizeLimit,
  type PendingAttachment,
} from "../attachments/FileAttachment";
import {
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  buildContentParts,
  toRequestBodySizeBytes,
} from "../shared/chatHelpers";
import type { ChatDictationState } from "./chatDictation";
import type {
  SendChatMessageParams,
  SendChatMessageResult,
} from "../sessionController";
import type { ChatComposerAction } from "../sessionController/runState";

type UseChatComposerSendParams = Readonly<{
  activeWorkspaceId: string | null;
  attachmentLimitMessage: string;
  clearDraftForSession: (sessionId: string | null) => void;
  clearTrackedDraftSelection: () => void;
  composerAction: ChatComposerAction;
  currentSessionId: string | null;
  dictationState: ChatDictationState;
  draftInputText: string;
  draftPendingAttachments: ReadonlyArray<PendingAttachment>;
  draftUpdatedAt: number | null;
  isSessionVerified: boolean;
  pendingSyncMessage: string;
  moveDraftToSession: (sourceSessionId: string | null, sourceDraftUpdatedAt: number | null, targetSessionId: string, nextDraft: ChatDraftContent) => number | null;
  replacePendingAttachments: (nextPendingAttachments: ReadonlyArray<PendingAttachment>) => void;
  requestComposerFocusRestore: () => void;
  runSync: () => Promise<void>;
  sendChatMessage: (params: SendChatMessageParams) => Promise<SendChatMessageResult>;
  sendPhase: ChatComposerSendPhase;
  sessionRestoringMessage: string;
  setErrorMessage: (message: string) => void;
  setSendPhase: (nextSendPhase: ChatComposerSendPhase) => void;
  workspaceRequiredMessage: string;
}>;

export type ChatComposerSend = Readonly<{
  finishNewConversationComposerReset: (nextSessionId: string | null) => void;
  inputText: string;
  pendingAttachments: ReadonlyArray<PendingAttachment>;
  pendingAttachmentsRef: MutableRefObject<ReadonlyArray<PendingAttachment>>;
  sendPendingMessage: () => Promise<void>;
  setPendingAttachmentsState: (nextAttachments: ReadonlyArray<PendingAttachment>) => void;
  startNewConversationComposerReset: (sourceSessionId: string | null) => void;
}>;

export function useChatComposerSend(params: UseChatComposerSendParams): ChatComposerSend {
  const {
    activeWorkspaceId,
    attachmentLimitMessage,
    clearDraftForSession,
    clearTrackedDraftSelection,
    composerAction,
    currentSessionId,
    dictationState,
    draftInputText,
    draftPendingAttachments,
    draftUpdatedAt,
    isSessionVerified,
    pendingSyncMessage,
    moveDraftToSession,
    replacePendingAttachments,
    requestComposerFocusRestore,
    runSync,
    sendChatMessage,
    sendPhase,
    sessionRestoringMessage,
    setErrorMessage,
    setSendPhase,
    workspaceRequiredMessage,
  } = params;
  const [isDraftOptimisticallyClearedForSend, setIsDraftOptimisticallyClearedForSend] = useState<boolean>(false);
  const sendLifecycleRequestSequenceRef = useRef<number>(0);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const isComposerMountedRef = useRef<boolean>(true);
  const pendingAttachmentsRef = useRef<ReadonlyArray<PendingAttachment>>([]);
  const inputText = isDraftOptimisticallyClearedForSend ? "" : draftInputText;
  const pendingAttachments = isDraftOptimisticallyClearedForSend ? [] : draftPendingAttachments;

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    isComposerMountedRef.current = true;
    return () => {
      isComposerMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (activeWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }

    activeWorkspaceIdRef.current = activeWorkspaceId;
    invalidateSendLifecycleRequests();
    setIsDraftOptimisticallyClearedForSend(false);
    pendingAttachmentsRef.current = draftPendingAttachments;
    setSendPhase("idle");
  }, [activeWorkspaceId, draftPendingAttachments, setSendPhase]);

  function setPendingAttachmentsState(nextAttachments: ReadonlyArray<PendingAttachment>): void {
    pendingAttachmentsRef.current = nextAttachments;
    replacePendingAttachments(nextAttachments);
  }

  function invalidateSendLifecycleRequests(): number {
    const nextSequence = sendLifecycleRequestSequenceRef.current + 1;
    sendLifecycleRequestSequenceRef.current = nextSequence;
    return nextSequence;
  }

  function isSendLifecycleRequestCurrent(requestSequence: number): boolean {
    return sendLifecycleRequestSequenceRef.current === requestSequence;
  }

  function clearComposerForPendingSend(): void {
    setIsDraftOptimisticallyClearedForSend(true);
    pendingAttachmentsRef.current = [];
    clearTrackedDraftSelection();
  }

  function restoreComposerAfterPendingSend(
    nextAttachments: ReadonlyArray<PendingAttachment>,
  ): void {
    setIsDraftOptimisticallyClearedForSend(false);
    pendingAttachmentsRef.current = nextAttachments;
  }

  function restoreRejectedSend(
    inputText: string,
    nextAttachments: ReadonlyArray<PendingAttachment>,
    currentDraftSessionId: string | null,
    currentDraftUpdatedAt: number | null,
    resultSessionId: string | null,
  ): void {
    if (resultSessionId !== null && resultSessionId !== currentDraftSessionId) {
      moveDraftToSession(
        currentDraftSessionId,
        currentDraftUpdatedAt,
        resultSessionId,
        createChatDraftContent(inputText, nextAttachments),
      );
    }
    restoreComposerAfterPendingSend(nextAttachments);
  }

  function movePendingSendDraftToSession(
    inputText: string,
    nextAttachments: ReadonlyArray<PendingAttachment>,
    sourceSessionId: string | null,
    sourceDraftUpdatedAt: number | null,
    resultSessionId: string,
  ): number | null {
    if (resultSessionId === sourceSessionId) {
      return sourceDraftUpdatedAt;
    }

    return moveDraftToSession(
      sourceSessionId,
      sourceDraftUpdatedAt,
      resultSessionId,
      createChatDraftContent(inputText, nextAttachments),
    );
  }

  function finalizeAcceptedSend(sourceDraftUpdatedAt: number | null): void {
    if (sourceDraftUpdatedAt === null) {
      clearDraftForSession(null);
    }
    pendingAttachmentsRef.current = [];
    clearTrackedDraftSelection();
    setIsDraftOptimisticallyClearedForSend(false);
    requestComposerFocusRestore();
  }

  function clearAcceptedSendStoredDrafts(
    sourceSessionId: string | null,
    resultSessionId: string | null,
    acceptedDraft: ChatDraftContent,
    sourceDraftUpdatedAt: number | null,
    resultDraftUpdatedAt: number | null,
  ): void {
    clearStoredChatDraftForSessionIfUnchanged(activeWorkspaceId, sourceSessionId, acceptedDraft, sourceDraftUpdatedAt);
    if (resultSessionId !== null && resultSessionId !== sourceSessionId) {
      clearStoredChatDraftForSessionIfUnchanged(activeWorkspaceId, resultSessionId, acceptedDraft, resultDraftUpdatedAt);
    }
  }

  function startNewConversationComposerReset(sourceSessionId: string | null): void {
    invalidateSendLifecycleRequests();
    setIsDraftOptimisticallyClearedForSend(false);
    setSendPhase("idle");
    if (sourceSessionId === null) {
      clearDraftForSession(null);
    }
  }

  function finishNewConversationComposerReset(nextSessionId: string | null): void {
    clearDraftForSession(nextSessionId);
    pendingAttachmentsRef.current = [];
    clearTrackedDraftSelection();
    requestComposerFocusRestore();
  }

  async function sendPendingMessage(): Promise<void> {
    if (dictationState !== "idle" || composerAction !== "send" || sendPhase !== "idle") {
      return;
    }

    if (isSessionVerified === false) {
      setErrorMessage(sessionRestoringMessage);
      return;
    }

    if (activeWorkspaceId === null) {
      setErrorMessage(workspaceRequiredMessage);
      return;
    }

    const nextText = draftInputText;
    const nextAttachments = pendingAttachmentsRef.current;
    const sourceSessionId = currentSessionId;
    const sourceDraftUpdatedAt = draftUpdatedAt;
    const contentParts = buildContentParts(nextText, nextAttachments);
    if (contentParts.length === 0) {
      return;
    }

    if (nextAttachments.some(binaryPendingAttachmentExceedsSizeLimit)) {
      window.alert(attachmentLimitMessage);
      return;
    }

    const requestBody = {
      sessionId: currentSessionId ?? undefined,
      content: contentParts,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      window.alert(attachmentLimitMessage);
      return;
    }

    const requestSequence = sendLifecycleRequestSequenceRef.current;
    clearComposerForPendingSend();
    setSendPhase("preparingSend");

    try {
      await runSync();
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      const outboxRecords = await listOutboxRecords(activeWorkspaceId);
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      if (outboxRecords.length > 0) {
        restoreComposerAfterPendingSend(nextAttachments);
        setErrorMessage(pendingSyncMessage);
        setSendPhase("idle");
        return;
      }
    } catch (error) {
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      restoreComposerAfterPendingSend(nextAttachments);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setSendPhase("idle");
      return;
    }

    if (isSendLifecycleRequestCurrent(requestSequence) === false) {
      return;
    }

    setSendPhase("startingRun");

    try {
      let pendingDraftSessionId: string | null = sourceSessionId;
      let resultDraftUpdatedAt: number | null = sourceDraftUpdatedAt;
      const handleSessionDraftTargetReady = (targetSessionId: string): number | null => {
        if (pendingDraftSessionId === targetSessionId) {
          return resultDraftUpdatedAt;
        }

        resultDraftUpdatedAt = movePendingSendDraftToSession(
          nextText,
          nextAttachments,
          pendingDraftSessionId,
          resultDraftUpdatedAt,
          targetSessionId,
        );
        pendingDraftSessionId = targetSessionId;
        return resultDraftUpdatedAt;
      };
      const result = await sendChatMessage({
        clientRequestId: crypto.randomUUID().toLowerCase(),
        text: nextText,
        attachments: nextAttachments,
        onSessionDraftTargetReady: handleSessionDraftTargetReady,
      });
      if (result.accepted) {
        clearAcceptedSendStoredDrafts(
          sourceSessionId,
          result.sessionId,
          createChatDraftContent(nextText, nextAttachments),
          sourceDraftUpdatedAt,
          result.sessionId !== null && result.sessionId !== sourceSessionId
            ? resultDraftUpdatedAt
            : sourceDraftUpdatedAt,
        );
      }
      if (isSendLifecycleRequestCurrent(requestSequence) === false) {
        return;
      }

      if (result.status === "stale") {
        return;
      }

      if (isComposerMountedRef.current === false) {
        return;
      }

      if (result.accepted) {
        finalizeAcceptedSend(sourceDraftUpdatedAt);
      } else {
        restoreRejectedSend(
          nextText,
          nextAttachments,
          pendingDraftSessionId,
          resultDraftUpdatedAt,
          result.sessionId,
        );
      }
    } finally {
      if (isSendLifecycleRequestCurrent(requestSequence)) {
        setSendPhase("idle");
      }
    }
  }

  return {
    finishNewConversationComposerReset,
    inputText,
    pendingAttachments,
    pendingAttachmentsRef,
    sendPendingMessage,
    setPendingAttachmentsState,
    startNewConversationComposerReset,
  };
}
