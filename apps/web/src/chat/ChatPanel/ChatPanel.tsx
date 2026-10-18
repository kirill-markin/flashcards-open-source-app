import { useEffect, useRef, useState, type ReactElement } from "react";
import { GuestSignIn } from "../../screens/settings/account/guest/GuestSignIn";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useEntitlementSnapshot } from "../../premium/entitlementStore";
import { hasPremiumAccess, usePremiumPresenter } from "../../premium/PremiumProvider";
import { useI18n } from "../../i18n";
import type { BrowserGuestAiRefusal } from "../../types";
import type { WebAppOperation } from "../../observability/webObservability";
import { useChatDraft } from "../composer/drafts/ChatDraftContext";
import { useChatLayout } from "../layout/ChatLayoutContext";
import {
  FileAttachment,
  isBinaryPendingAttachment,
} from "../attachments/FileAttachment";
import { formatCardAttachmentLabel } from "../attachments/chatCardParts";
import { formatChatAttachmentLimitMessages } from "../shared/chatSizePolicy";
import {
  formatAiLimitReachedMessageForHeldUsage,
  formatBrowserGuestAiRefusal,
  getBrowserGuestAiAdmissionRefusal,
  readGuestImageRefusal,
  reconcileBrowserGuestAiRefusal,
  isHeldAiUsageCurrent,
} from "../shared/chatAiLimitPolicy";
import { isOwnOpenAIKeyActive, useIsOwnOpenAIKeyActive } from "../preferences/ownOpenAIKeyStorage";
import {
  getCanSendPendingMessage,
  getCanShowComposerSuggestions,
  getChatComposerCapabilities,
  getChatComposerState,
  hasChatDraftContent,
} from "../composer/chatComposerState";
import { renderStoredMessageContent } from "../history/chatMessageContent";
import { ChatHistoryPanel } from "../history/ChatHistoryPanel";
import { useChatAutoScroll } from "../history/useChatAutoScroll";
import { useAIChatPreferences } from "../preferences/AIChatPreferencesContext";
import { useChatSession } from "../sessionController";
import { useChatAttachments } from "../attachments/useChatAttachments";
import { useChatComposerKeyboard } from "../composer/useChatComposerKeyboard";
import { useChatComposerSend } from "../composer/useChatComposerSend";
import { useChatDictationCapture } from "../composer/dictation/useChatDictationCapture";
import { useChatSidebarResize } from "../layout/useChatSidebarResize";

type Props = Readonly<{
  mode: "sidebar" | "fullscreen";
}>;

export function ChatPanel(props: Props): ReactElement {
  const { mode } = props;
  const appData = useAppData();
  const entitlement = useEntitlementSnapshot(appData.session?.userId ?? null);
  const presentPremium = usePremiumPresenter();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError, showTechnicalError } = useAppErrorDialog();
  const { t, formatCount, formatDate, formatNumber, messages: translationMessages } = useI18n();
  const { aiChatComposerSuggestionsEnabled } = useAIChatPreferences();
  const hasOwnOpenAIKey = useIsOwnOpenAIKeyActive();
  const {
    draft,
    focusComposerRequestVersion,
    replaceInputText,
    updateInputText,
    moveDraftToSession,
    replacePendingAttachments,
    clearDraftForSession,
    composerSendPhase: sendPhase,
    replaceComposerSendPhase: setSendPhase,
    suppressNextSessionDraftCarryover,
  } = useChatDraft();
  const { setIsOpen, chatWidth, setChatWidth } = useChatLayout();
  const draftInputText = draft.inputText;
  const draftPendingAttachments = draft.pendingAttachments;

  const activeWorkspaceId = appData.activeWorkspace?.workspaceId ?? null;
  const {
    runState,
    messages,
    isHistoryLoaded,
    isAssistantRunActive,
    isStopping,
    currentSessionId,
    chatConfig,
    composerSuggestions,
    composerAction,
    composerNotice,
    errorDialogMessage,
    aiUsage,
    aiUsageLoadStatus,
    refreshAiUsage,
    dismissErrorDialog,
    ensureRemoteSession,
    sendMessage: sendChatMessage,
    stopMessage,
    clearConversation,
  } = useChatSession();

  useEffect(() => {
    refreshAiUsage();
  }, [refreshAiUsage]);

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [guestAiRefusal, setGuestAiRefusal] = useState<BrowserGuestAiRefusal | null>(null);
  const lastImageRefusalRef = useRef<string | null>(null);
  const hasReviewedInitialImageHistoryRef = useRef(false);
  const wasAssistantRunActiveRef = useRef(false);
  const guestCapabilities = aiUsage?.browserGuestCapabilities ?? appData.session?.browserGuestCapabilities ?? null;
  const isBrowserGuest = appData.session?.browserGuestCapabilities?.isGuest === true;
  const isGuestUsageUnavailable = isBrowserGuest && !hasOwnOpenAIKey
    && guestCapabilities?.platformFundedAi === true && aiUsage === null;
  const visibleGuestAiRefusal = guestAiRefusal === null ? null
    : reconcileBrowserGuestAiRefusal(guestAiRefusal, null, guestCapabilities);
  const guestRecordingLimitSeconds = isBrowserGuest && !hasOwnOpenAIKey && aiUsage?.browserGuestAiTrial?.enabled
    ? Math.min(120, aiUsage.browserGuestAiTrial.maxRecordingSeconds, aiUsage.browserGuestAiTrial.dictation.lifetimeRemaining)
    : null;

  function showGuestAiRefusal(refusal: BrowserGuestAiRefusal): void {
    setGuestAiRefusal(reconcileBrowserGuestAiRefusal(refusal, null, guestCapabilities));
    refreshAiUsage();
  }

  useEffect(() => {
    setGuestAiRefusal(null);
    lastImageRefusalRef.current = null;
    hasReviewedInitialImageHistoryRef.current = false;
    wasAssistantRunActiveRef.current = false;
  }, [activeWorkspaceId, currentSessionId, isBrowserGuest]);

  useEffect(() => {
    if (aiUsage === null) return;
    setGuestAiRefusal((refusal) => refusal === null ? null
      : reconcileBrowserGuestAiRefusal(refusal, aiUsage, guestCapabilities));
  }, [aiUsage, guestCapabilities]);

  useEffect(() => {
    const isHistoryReplay = !hasReviewedInitialImageHistoryRef.current
      || (!isAssistantRunActive && !wasAssistantRunActiveRef.current);
    hasReviewedInitialImageHistoryRef.current = isHistoryLoaded;
    wasAssistantRunActiveRef.current = isAssistantRunActive;
    if (!isBrowserGuest) return;
    try {
      for (const { message, part } of [...messages].reverse().flatMap(
        (message) => message.content.map((part) => ({ message, part })),
      )) {
        if (part.type !== "tool_call") continue;
        const refusal = readGuestImageRefusal([part]);
        if (refusal === null) continue;
        const identity = JSON.stringify([message.itemId, part.id, part.streamPosition?.outputIndex, refusal]);
        if (lastImageRefusalRef.current !== identity) {
          lastImageRefusalRef.current = identity;
          if (isHistoryReplay) {
            setGuestAiRefusal(reconcileBrowserGuestAiRefusal(refusal, aiUsage, guestCapabilities));
          } else {
            showGuestAiRefusal(refusal);
          }
        }
        break;
      }
    } catch (error) {
      showChatTechnicalError(error, "chat_send_prepare");
    }
  }, [messages, isBrowserGuest, isHistoryLoaded, isAssistantRunActive, aiUsage, guestCapabilities, refreshAiUsage]);
  const isHistoryPanelVisible = isHistoryOpen && activeWorkspaceId !== null;

  const { handleMessagesScroll } = useChatAutoScroll({
    // The History panel unmounts the messages scroller; closing it must rebind and re-restore the new one.
    isHydrated: isHistoryLoaded && isHistoryPanelVisible === false,
    isStreaming: isAssistantRunActive,
    messages,
    messagesRef,
    messagesContentRef,
    scrollKey: currentSessionId,
  });
  const isInitialHistoryLoading = !isHistoryLoaded && messages.length === 0;
  const attachmentLimitMessages = formatChatAttachmentLimitMessages({ t, formatNumber });
  const attachmentUnsupportedMessage = t("chatPanel.alerts.attachmentUnsupported");
  const technicalErrorMessage = t("appError.technicalError.message");
  function showChatTechnicalError(error: unknown, operation: WebAppOperation): boolean {
    return showTechnicalError(error, {
      feature: "chat",
      operation,
      userId: appData.session?.userId ?? null,
      workspaceId: activeWorkspaceId,
      installationId: appData.cloudSettings?.installationId ?? null,
      entityId: currentSessionId,
    });
  }
  const {
    beginResizeDrag,
    isDragging,
    localWidth,
  } = useChatSidebarResize({
    chatWidth,
    rootRef,
    setChatWidth,
  });
  const {
    clearTrackedDraftSelection,
    dictationState,
    discardDictation,
    handleMicrophoneClick,
    requestComposerFocusRestore,
    updateTrackedDraftSelection,
  } = useChatDictationCapture({
    activeWorkspaceId,
    currentSessionId,
    ensureRemoteSession,
    focusComposerRequestVersion,
    inputText: draftInputText,
    indexedDbOpenRecoveryState,
    onTechnicalError: showChatTechnicalError,
    formatAiLimitReachedMessage: () => formatAiLimitReachedMessageForHeldUsage({ aiUsage, t, formatDate }),
    refreshAiUsage,
    guestRecordingLimitSeconds,
    onGuestAiRefusal: showGuestAiRefusal,
    t,
    textareaRef,
    updateInputText,
  });
  const {
    finishNewConversationComposerReset,
    inputText,
    pendingAttachments,
    pendingAttachmentsRef,
    sendPendingMessage: sendPreparedMessage,
    setPendingAttachmentsState,
    startNewConversationComposerReset,
  } = useChatComposerSend({
    activeWorkspaceId,
    attachmentLimitMessages,
    clearDraftForSession,
    clearTrackedDraftSelection,
    composerAction,
    currentSessionId,
    dictationState,
    draftInputText,
    draftPendingAttachments,
    draftUpdatedAt: draft.updatedAt,
    indexedDbOpenRecoveryState,
    isSessionVerified: appData.isSessionVerified,
    pendingSyncMessage: t("chatPanel.transientErrors.pendingSync"),
    moveDraftToSession,
    onCapturedTechnicalError: showCapturedTechnicalError,
    onTechnicalError: (error) => showChatTechnicalError(error, "chat_send_prepare"),
    replacePendingAttachments,
    requestComposerFocusRestore,
    runSync: appData.runSync,
    sendChatMessage: async (params) => {
      const result = await sendChatMessage(params);
      if (!result.accepted && result.guestAiRefusal !== undefined) showGuestAiRefusal(result.guestAiRefusal);
      return result;
    },
    sendPhase,
    sessionRestoringMessage: t("chatPanel.transientErrors.sessionRestoring"),
    setAppErrorMessage: appData.setErrorMessage,
    setSendPhase,
    technicalErrorMessage,
    workspaceRequiredMessage: t("chatPanel.transientErrors.workspaceRequired"),
  });
  const rootClassName = mode === "sidebar" ? "chat-sidebar" : "chat-sidebar-fullscreen";
  const isDictationVisible = dictationState !== "idle";
  const isChatActionLocked = appData.isSessionVerified === false || indexedDbOpenRecoveryState.hasFailed();
  const isAiActionLocked = isChatActionLocked || isGuestUsageUnavailable;
  async function sendPendingMessage(): Promise<void> {
    if (isAiActionLocked || !isHistoryLoaded || isStopping) return;
    const refusal = isOwnOpenAIKeyActive() ? null : getBrowserGuestAiAdmissionRefusal(aiUsage, guestCapabilities, "chat");
    if (refusal !== null) {
      showGuestAiRefusal(refusal);
      return;
    }
    setGuestAiRefusal(null);
    await sendPreparedMessage();
  }
  useEffect(() => {
    if (isChatActionLocked && dictationState !== "idle") discardDictation();
  }, [isChatActionLocked, dictationState, discardDictation]);
  const areAttachmentsEnabled = chatConfig.features.attachmentsEnabled;
  const isDictationEnabled = chatConfig.features.dictationEnabled;
  const isChatConversationReadyForAttachments = isHistoryLoaded && currentSessionId !== null;
  const {
    canAttachDraftFiles,
    canStartDictation,
    isDictationButtonDisabled,
    isDraftInputBlocked,
  } = getChatComposerCapabilities({
    areAttachmentsEnabled,
    dictationState,
    isChatActionLocked: isAiActionLocked,
    isChatConversationReadyForAttachments,
    isDictationEnabled,
    isStopping,
    sendPhase,
  });
  // The History panel hides the draft, so a drop there must not attach to it unseen.
  const canDropDraftFiles = canAttachDraftFiles && isHistoryPanelVisible === false;
  const {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    ingestFiles,
    isDragOver,
    removeAttachment,
  } = useChatAttachments({
    attachmentLimitMessages,
    attachmentUnsupportedMessage,
    canAttachDraftFiles: canDropDraftFiles,
    indexedDbOpenRecoveryState,
    onTechnicalError: (error) => {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      showChatTechnicalError(error, "chat_attachment_prepare");
    },
    pendingAttachmentsRef,
    setPendingAttachmentsState,
  });
  const { handleKeyDown } = useChatComposerKeyboard({
    composerAction,
    sendPendingMessage,
    stopMessage: handleStopMessage,
  });
  const hasDraftContent = hasChatDraftContent(inputText, pendingAttachments);
  const composerState = getChatComposerState({
    composerAction,
    isAssistantRunActive,
    isStopping,
    sendPhase,
  });
  const canSendPendingMessage = getCanSendPendingMessage({
    composerAction,
    dictationState,
    hasDraftContent,
    isChatActionLocked: isAiActionLocked,
    isHistoryLoaded,
    isStopping,
    sendPhase,
  });
  const isSendButtonBusy = sendPhase === "preparingSend" || sendPhase === "startingRun";
  const canShowComposerSuggestions = getCanShowComposerSuggestions({
    areComposerSuggestionsEnabled: aiChatComposerSuggestionsEnabled,
    composerAction,
    composerSuggestionsCount: composerSuggestions.length,
    dictationState,
    inputText,
    isAssistantRunActive,
    isChatActionLocked: isAiActionLocked,
    isHistoryLoaded,
    isStopping,
    pendingAttachmentCount: pendingAttachments.length,
    sendPhase,
  });
  const visibleComposerSuggestions = canShowComposerSuggestions ? composerSuggestions : [];
  const remainingAiMessages = isBrowserGuest
    ? aiUsage?.browserGuestAiTrial?.enabled === true && guestCapabilities?.platformFundedAi === true
      ? aiUsage.browserGuestAiTrial.chat.lifetimeRemaining : null
    : aiUsage !== null && isHeldAiUsageCurrent(aiUsage) ? aiUsage.usage.remainingMessages : null;
  const remainingAiMessagesNotice = remainingAiMessages !== null
    && remainingAiMessages <= 3
    && hasOwnOpenAIKey === false
    ? remainingAiMessages
    : null;
  const microphoneAriaLabel = dictationState === "recording" ? t("chatPanel.dictation.stop") : t("chatPanel.dictation.start");
  const dictationStatusLabel = dictationState === "requesting_permission"
    ? t("chatPanel.dictation.waitingForPermission")
    : dictationState === "recording"
      ? t("chatPanel.dictation.listening")
      : t("chatPanel.dictation.transcribing");

  async function handleStartNewConversation(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      suppressNextSessionDraftCarryover(currentSessionId);
      startNewConversationComposerReset(currentSessionId);
      discardDictation();
      const nextSessionId = await clearConversation();
      indexedDbOpenRecoveryState.throwIfFailed();
      finishNewConversationComposerReset(nextSessionId);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      throw error;
    }
  }

  function handleMessageTechnicalError(error: unknown): boolean {
    if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
      return true;
    }
    return showChatTechnicalError(error, "chat_tool_call_copy");
  }

  function canStartMessageAction(): boolean {
    return indexedDbOpenRecoveryState.hasFailed() === false;
  }

  async function handleStopMessage(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await stopMessage();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      throw error;
    }
  }

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-testid="chat-panel"
      style={mode === "sidebar" ? { width: localWidth } : undefined}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(event) => void handleDrop(event)}
    >
      {isDragOver && canDropDraftFiles ? <div className="chat-drop-overlay">{t("chatPanel.dropFiles")}</div> : null}
      {mode === "sidebar" ? (
        <div
          className={`chat-resize-handle${isDragging ? " dragging" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            if (indexedDbOpenRecoveryState.hasFailed() === false) {
              beginResizeDrag();
            }
          }}
        />
      ) : null}

      <div className="chat-header">
        <div>
          <span className="chat-header-title">{t("chatPanel.providerTitle")}</span>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-close-btn chat-icon-btn"
            aria-label={t("chatPanel.actions.history")}
            title={t("chatPanel.actions.history")}
            onClick={() => setIsHistoryOpen(true)}
            disabled={isChatActionLocked || activeWorkspaceId === null || isDictationVisible}
            data-testid="chat-history-button"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M9 6h11" />
              <path d="M9 12h11" />
              <path d="M9 18h11" />
              <path d="M4 6h.01" />
              <path d="M4 12h.01" />
              <path d="M4 18h.01" />
            </svg>
          </button>
          <button
            type="button"
            className="chat-close-btn"
            onClick={() => {
              setIsHistoryOpen(false);
              void handleStartNewConversation();
            }}
            disabled={isStopping || isChatActionLocked}
            data-testid="chat-new-button"
          >
            {t("chatPanel.actions.newChat")}
          </button>
          {mode === "sidebar" ? (
            <button
              type="button"
              className="chat-close-btn"
              onClick={() => {
                if (indexedDbOpenRecoveryState.hasFailed() === false) {
                  discardDictation();
                  setIsOpen(false);
                }
              }}
              disabled={isChatActionLocked}
            >
              &laquo;
            </button>
          ) : null}
        </div>
      </div>

      {isHistoryPanelVisible ? (
        <ChatHistoryPanel
          key={activeWorkspaceId}
          workspaceId={activeWorkspaceId}
          currentSessionId={currentSessionId}
          isCurrentChatArchiveDisabled={isAssistantRunActive || isStopping || isSendButtonBusy || isChatActionLocked}
          onCurrentChatArchived={() => {
            setIsHistoryOpen(false);
            void handleStartNewConversation();
          }}
          onMessageTechnicalError={handleMessageTechnicalError}
          canStartMessageAction={canStartMessageAction}
          onClose={() => setIsHistoryOpen(false)}
        />
      ) : (
        <>
      <div className="chat-messages" ref={messagesRef} onScroll={handleMessagesScroll} data-testid="chat-messages">
        <div className="chat-messages-content" ref={messagesContentRef}>
          {isInitialHistoryLoading ? (
            <div className="chat-empty chat-empty-loading" aria-live="polite">
              <p className="chat-empty-title" data-testid="chat-loading-title">{t("chatPanel.loadingTitle")}</p>
              <div className="chat-loading-lines" aria-hidden="true">
                <span className="chat-loading-line chat-loading-line-title" />
                <span className="chat-loading-line" />
                <span className="chat-loading-line" />
                <span className="chat-loading-line chat-loading-line-short" />
              </div>
            </div>
          ) : null}

          {!isInitialHistoryLoading && messages.length === 0 ? (
            <div className="chat-empty">
              <p className="chat-empty-title" data-testid="chat-empty-title">{t("chatPanel.empty.title")}</p>
              <p className="chat-empty-copy">{t("chatPanel.empty.copy")}</p>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const isLastAssistant = isAssistantRunActive && message.role === "assistant" && index === messages.length - 1;
            return (
              <div
                key={`${message.timestamp}-${index}`}
                className={`chat-msg chat-msg-${message.role}`}
              >
                {renderStoredMessageContent(
                  message,
                  t,
                  handleMessageTechnicalError,
                  canStartMessageAction,
                )}
                {isLastAssistant ? (
                  <span className="chat-streaming-indicator">
                    <span className="chat-dots" />
                  </span>
                ) : null}
              </div>
            );
          })}
          {isBrowserGuest && visibleGuestAiRefusal !== null ? (
            <section className="chat-guest-sign-in" role="status" data-testid="guest-ai-sign-in" data-feature={visibleGuestAiRefusal.feature} data-scope={visibleGuestAiRefusal.scope}>
              <p>{formatBrowserGuestAiRefusal(visibleGuestAiRefusal, t)}</p>
              <GuestSignIn label={t("guest.signIn")} testId="guest-ai-sign-in-button" />
            </section>
          ) : null}
        </div>
      </div>

      <div
        className="chat-input-area"
        data-testid="chat-composer-state"
        data-composer-state={composerState}
        data-composer-action={composerAction}
        data-chat-run-state={runState}
        data-send-phase={sendPhase}
        data-chat-session-id={currentSessionId ?? ""}
        data-history-loaded={isHistoryLoaded ? "true" : "false"}
        data-assistant-run-active={isAssistantRunActive ? "true" : "false"}
        data-stopping={isStopping ? "true" : "false"}
        data-draft-state={hasDraftContent ? "filled" : "empty"}
        data-can-send={canSendPendingMessage ? "true" : "false"}
      >
        {isGuestUsageUnavailable ? (
          <p className="chat-ai-usage-notice" role="status" data-testid="guest-ai-usage-status" data-load-status={aiUsageLoadStatus}>
            {aiUsageLoadStatus === "error" ? <>
              {t("chatPanel.errors.refreshFailedPrefix")}{" "}
              <button type="button" className="ghost-btn" data-testid="guest-ai-usage-retry"
                disabled={isChatActionLocked} onClick={refreshAiUsage}>{t("common.retry")}</button>
            </> : t("common.loading")}
          </p>
        ) : null}

        {composerNotice !== null ? (
          <p className="chat-ai-usage-notice" role="status" data-testid="chat-composer-notice">
            {composerNotice}
          </p>
        ) : null}

        {remainingAiMessagesNotice !== null ? (
          <p className="chat-ai-usage-notice" data-testid="chat-ai-usage-remaining">
            {t("chatPanel.aiUsage.remaining", {
              count: formatCount(remainingAiMessagesNotice, translationMessages.chatPanel.aiUsage.countLabels.aiMessage),
            })}
            {!isBrowserGuest && entitlement !== null && !hasPremiumAccess(entitlement, 20) && presentPremium !== null ? <>{" "}
              <button type="button" className="ghost-btn" data-testid="chat-ai-low-balance-premium"
                onClick={() => presentPremium({ reason: "offer", entryPoint: "ai_low_balance" })}>{t("premium.offer")}</button>
            </> : null}
          </p>
        ) : null}

        {pendingAttachments.length > 0 ? (
          <div className="chat-attachment-preview">
            {pendingAttachments.map((attachment, index) => (
              <span
                key={isBinaryPendingAttachment(attachment)
                  ? `${attachment.fileName}-${index}`
                  : `${attachment.attachmentId}-${index}`}
                className={`chat-attachment-chip${isBinaryPendingAttachment(attachment) ? "" : " chat-attachment-chip-card"}`}
              >
                {isBinaryPendingAttachment(attachment)
                  ? attachment.fileName
                  : `${t("chatPanel.pendingAttachmentCardPrefix")} · ${formatCardAttachmentLabel(attachment)}`}
                <button
                  type="button"
                  className="chat-attachment-remove"
                  onClick={() => removeAttachment(index)}
                  disabled={isDraftInputBlocked}
                  aria-label={t("chatPanel.actions.removeAttachment")}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {visibleComposerSuggestions.length > 0 ? (
          <div
            className="chat-composer-suggestions"
            aria-label={t("chatPanel.suggestedReplies")}
            data-testid="chat-composer-suggestions"
            data-suggestion-count={visibleComposerSuggestions.length}
          >
            {visibleComposerSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className="chat-composer-suggestion"
                data-testid="chat-composer-suggestion"
                data-suggestion-id={suggestion.id}
                data-suggestion-index={index}
                onClick={() => {
                  if (indexedDbOpenRecoveryState.hasFailed()) {
                    return;
                  }
                  updateInputText((currentText) =>
                    currentText.length === 0
                      ? suggestion.text
                      : `${currentText}${currentText.endsWith(" ") ? "" : " "}${suggestion.text}`);
                  requestComposerFocusRestore();
                }}
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        ) : null}

        {isDictationVisible ? (
          <div className={`chat-dictation-surface chat-dictation-surface-${dictationState}`} aria-live="polite">
            <div className="chat-dictation-wave" aria-hidden="true">
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
              <span className="chat-dictation-bar" />
            </div>
            <span className="chat-dictation-label">{dictationStatusLabel}</span>
            {dictationState === "recording" && guestRecordingLimitSeconds !== null
              ? <span className="chat-dictation-label">{t("guest.aiRecordingLimit", { seconds: guestRecordingLimitSeconds })}</span> : null}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            name="chatMessage"
            className="chat-textarea"
            placeholder={t("chatPanel.composerPlaceholder")}
            value={inputText}
            rows={1}
            disabled={isDraftInputBlocked}
            data-testid="chat-composer-input"
            onChange={(event) => {
              if (indexedDbOpenRecoveryState.hasFailed()) {
                return;
              }
              replaceInputText(event.target.value);
              updateTrackedDraftSelection(event.target);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onClick={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onKeyUp={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onFocus={(event) => updateTrackedDraftSelection(event.currentTarget)}
          />
        )}

        <div className="chat-controls">
          <div className="chat-controls-right">
            <FileAttachment
              // The file chooser is this client's stand-in for a photo library: it opens over the
              // person's stored files, which is what that value names here.
              onFiles={(files) => ingestFiles(files, "photo_library")}
              disabled={!canAttachDraftFiles}
            />
            <button
              type="button"
              className={`chat-mic-btn${dictationState === "recording" ? " chat-mic-btn-recording" : ""}`}
              aria-label={microphoneAriaLabel}
              onClick={() => {
                if (indexedDbOpenRecoveryState.hasFailed() === false) {
                  const refusal = dictationState === "recording" || isOwnOpenAIKeyActive()
                    ? null : getBrowserGuestAiAdmissionRefusal(aiUsage, guestCapabilities, "dictation");
                  if (refusal !== null) showGuestAiRefusal(refusal);
                  else {
                    if (dictationState === "idle") setGuestAiRefusal(null);
                    void handleMicrophoneClick(canStartDictation);
                  }
                }
              }}
              disabled={isDictationButtonDisabled}
            >
              {dictationState === "recording" ? (
                <span className="chat-stop-btn-icon" aria-hidden="true" />
              ) : (
                <svg
                  className="chat-mic-btn-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3.75a3 3 0 0 1 3 3v5.5a3 3 0 1 1-6 0v-5.5a3 3 0 0 1 3-3Z" />
                  <path d="M6.75 11.5a5.25 5.25 0 0 0 10.5 0" />
                  <path d="M12 16.75v3.5" />
                  <path d="M9.25 20.25h5.5" />
                </svg>
              )}
            </button>
            {composerAction === "stop" ? (
              <button
                type="button"
                className="chat-stop-btn"
                aria-label={t("chatPanel.actions.stopAriaLabel")}
                onClick={() => {
                  if (indexedDbOpenRecoveryState.hasFailed() === false) {
                    void handleStopMessage();
                  }
                }}
                disabled={isStopping || isChatActionLocked}
                data-testid="chat-stop-button"
              >
                <span className="chat-stop-btn-icon" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-btn"
                aria-label={t("chatPanel.actions.sendAriaLabel")}
                aria-busy={isSendButtonBusy ? "true" : "false"}
                onClick={() => void sendPendingMessage()}
                disabled={!canSendPendingMessage}
                data-testid="chat-send-button"
              >
                <span
                  className="chat-send-btn-spinner"
                  aria-hidden="true"
                  data-testid="chat-send-button-busy-indicator"
                  hidden={!isSendButtonBusy}
                />
                <span>{t("chatPanel.actions.send")}</span>
              </button>
            )}
          </div>
        </div>
      </div>
        </>
      )}

      {errorDialogMessage !== null ? (
        <div
          className="chat-error-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-error-dialog-title"
        >
          <div className="panel chat-error-dialog">
            <h2 id="chat-error-dialog-title">{t("chatPanel.errorTitle")}</h2>
            <p>{errorDialogMessage}</p>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                if (indexedDbOpenRecoveryState.hasFailed() === false) {
                  dismissErrorDialog();
                }
              }}
              disabled={isChatActionLocked}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
