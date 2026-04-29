import type { ChatComposerSendPhase } from "./ChatDraftContext";
import type { PendingAttachment } from "./FileAttachment";
import type { ChatDictationState } from "./chatDictation";
import type { ChatComposerAction } from "./sessionController/runState";

export type ChatComposerState = "idle" | "preparingSend" | "startingRun" | "running" | "stopping";

export type ChatComposerCapabilities = Readonly<{
  canAttachDraftFiles: boolean;
  canStartDictation: boolean;
  isDictationButtonDisabled: boolean;
  isDraftInputBlocked: boolean;
}>;

export function getChatComposerState(params: Readonly<{
  composerAction: ChatComposerAction;
  isAssistantRunActive: boolean;
  isStopping: boolean;
  sendPhase: ChatComposerSendPhase;
}>): ChatComposerState {
  const {
    composerAction,
    isAssistantRunActive,
    isStopping,
    sendPhase,
  } = params;

  if (sendPhase === "preparingSend") {
    return "preparingSend";
  }

  if (sendPhase === "startingRun") {
    return "startingRun";
  }

  if (isStopping) {
    return "stopping";
  }

  if (composerAction === "stop" || isAssistantRunActive) {
    return "running";
  }

  return "idle";
}

export function getChatComposerCapabilities(params: Readonly<{
  areAttachmentsEnabled: boolean;
  dictationState: ChatDictationState;
  isChatActionLocked: boolean;
  isChatConversationReadyForAttachments: boolean;
  isDictationEnabled: boolean;
  isStopping: boolean;
  sendPhase: ChatComposerSendPhase;
}>): ChatComposerCapabilities {
  const {
    areAttachmentsEnabled,
    dictationState,
    isChatActionLocked,
    isChatConversationReadyForAttachments,
    isDictationEnabled,
    isStopping,
    sendPhase,
  } = params;
  const canPrepareDraft = sendPhase === "idle" && !isStopping;
  const canStartDictation = isDictationEnabled
    && dictationState === "idle"
    && canPrepareDraft
    && !isChatActionLocked;

  return {
    canAttachDraftFiles: areAttachmentsEnabled
      && dictationState === "idle"
      && canPrepareDraft
      && !isChatActionLocked
      && isChatConversationReadyForAttachments,
    canStartDictation,
    isDictationButtonDisabled: dictationState === "recording" ? false : !canStartDictation,
    isDraftInputBlocked: dictationState !== "idle" || !canPrepareDraft,
  };
}

export function hasChatDraftContent(
  inputText: string,
  pendingAttachments: ReadonlyArray<PendingAttachment>,
): boolean {
  return inputText.trim().length > 0 || pendingAttachments.length > 0;
}

export function getCanSendPendingMessage(params: Readonly<{
  composerAction: ChatComposerAction;
  dictationState: ChatDictationState;
  hasDraftContent: boolean;
  isChatActionLocked: boolean;
  isHistoryLoaded: boolean;
  isStopping: boolean;
  sendPhase: ChatComposerSendPhase;
}>): boolean {
  const {
    composerAction,
    dictationState,
    hasDraftContent,
    isChatActionLocked,
    isHistoryLoaded,
    isStopping,
    sendPhase,
  } = params;

  return isHistoryLoaded
    && composerAction === "send"
    && sendPhase === "idle"
    && !isStopping
    && !isChatActionLocked
    && dictationState === "idle"
    && hasDraftContent;
}

export function getCanShowComposerSuggestions(params: Readonly<{
  composerAction: ChatComposerAction;
  composerSuggestionsCount: number;
  dictationState: ChatDictationState;
  inputText: string;
  isAssistantRunActive: boolean;
  isChatActionLocked: boolean;
  isHistoryLoaded: boolean;
  isStopping: boolean;
  pendingAttachmentCount: number;
  sendPhase: ChatComposerSendPhase;
}>): boolean {
  const {
    composerAction,
    composerSuggestionsCount,
    dictationState,
    inputText,
    isAssistantRunActive,
    isChatActionLocked,
    isHistoryLoaded,
    isStopping,
    pendingAttachmentCount,
    sendPhase,
  } = params;

  return isHistoryLoaded
    && composerAction === "send"
    && sendPhase === "idle"
    && !isAssistantRunActive
    && !isStopping
    && !isChatActionLocked
    && dictationState === "idle"
    && pendingAttachmentCount === 0
    && inputText.trim().length === 0
    && composerSuggestionsCount > 0;
}
