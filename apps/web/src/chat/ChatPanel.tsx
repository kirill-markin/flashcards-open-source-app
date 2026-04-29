import { useRef, type ReactElement } from "react";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { useChatDraft } from "./ChatDraftContext";
import { useChatLayout } from "./ChatLayoutContext";
import {
  FileAttachment,
  isBinaryPendingAttachment,
} from "./FileAttachment";
import { formatCardAttachmentLabel } from "./chatCardParts";
import {
  USER_VISIBLE_ATTACHMENT_LIMIT_MB,
} from "./chatHelpers";
import {
  getCanSendPendingMessage,
  getCanShowComposerSuggestions,
  getChatComposerCapabilities,
  getChatComposerState,
  hasChatDraftContent,
} from "./chatComposerState";
import { renderStoredMessageContent } from "./chatMessageContent";
import { useChatAutoScroll } from "./useChatAutoScroll";
import { useChatSession } from "./sessionController";
import { useChatAttachments } from "./useChatAttachments";
import { useChatComposerKeyboard } from "./useChatComposerKeyboard";
import { useChatComposerSend } from "./useChatComposerSend";
import { useChatDictationCapture } from "./useChatDictationCapture";
import { useChatSidebarResize } from "./useChatSidebarResize";

type Props = Readonly<{
  mode: "sidebar" | "fullscreen";
}>;

export function ChatPanel(props: Props): ReactElement {
  const { mode } = props;
  const appData = useAppData();
  const { t, formatNumber } = useI18n();
  const {
    draft,
    focusComposerRequestVersion,
    replaceInputText,
    updateInputText,
    replacePendingAttachments,
    clearDraftForSession,
    composerSendPhase: sendPhase,
    replaceComposerSendPhase: setSendPhase,
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
    errorDialogMessage,
    dismissErrorDialog,
    ensureRemoteSession,
    sendMessage: sendChatMessage,
    stopMessage,
    clearConversation,
  } = useChatSession();

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { handleMessagesScroll } = useChatAutoScroll({
    isHydrated: isHistoryLoaded,
    isStreaming: isAssistantRunActive,
    messages,
    messagesRef,
    messagesContentRef,
  });
  const isInitialHistoryLoading = !isHistoryLoaded && messages.length === 0;
  const attachmentLimitMessage = t("chatPanel.alerts.attachmentLimit", {
    count: formatNumber(USER_VISIBLE_ATTACHMENT_LIMIT_MB),
  });
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
    t,
    textareaRef,
    updateInputText,
  });
  const {
    finishNewConversationComposerReset,
    inputText,
    pendingAttachments,
    pendingAttachmentsRef,
    sendPendingMessage,
    setPendingAttachmentsState,
    startNewConversationComposerReset,
  } = useChatComposerSend({
    activeWorkspaceId,
    attachmentLimitMessage,
    clearDraftForSession,
    clearTrackedDraftSelection,
    composerAction,
    currentSessionId,
    dictationState,
    draftInputText,
    draftPendingAttachments,
    isSessionVerified: appData.isSessionVerified,
    pendingSyncMessage: t("chatPanel.transientErrors.pendingSync"),
    replacePendingAttachments,
    requestComposerFocusRestore,
    runSync: appData.runSync,
    sendChatMessage,
    sendPhase,
    sessionRestoringMessage: t("chatPanel.transientErrors.sessionRestoring"),
    setErrorMessage: appData.setErrorMessage,
    setSendPhase,
    workspaceRequiredMessage: t("chatPanel.transientErrors.workspaceRequired"),
  });
  const rootClassName = mode === "sidebar" ? "chat-sidebar" : "chat-sidebar-fullscreen";
  const isDictationVisible = dictationState !== "idle";
  const isChatActionLocked = appData.isSessionVerified === false;
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
    isChatActionLocked,
    isChatConversationReadyForAttachments,
    isDictationEnabled,
    isStopping,
    sendPhase,
  });
  const {
    handleAttach,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isDragOver,
    removeAttachment,
  } = useChatAttachments({
    attachmentLimitMessage,
    canAttachDraftFiles,
    currentSessionId,
    draftInputText,
    pendingAttachmentsRef,
    setPendingAttachmentsState,
  });
  const { handleKeyDown } = useChatComposerKeyboard({
    composerAction,
    sendPendingMessage,
    stopMessage,
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
    isChatActionLocked,
    isHistoryLoaded,
    isStopping,
    sendPhase,
  });
  const canShowComposerSuggestions = getCanShowComposerSuggestions({
    composerAction,
    composerSuggestionsCount: composerSuggestions.length,
    dictationState,
    inputText,
    isAssistantRunActive,
    isChatActionLocked,
    isHistoryLoaded,
    isStopping,
    pendingAttachmentCount: pendingAttachments.length,
    sendPhase,
  });
  const microphoneAriaLabel = dictationState === "recording" ? t("chatPanel.dictation.stop") : t("chatPanel.dictation.start");
  const dictationStatusLabel = dictationState === "requesting_permission"
    ? t("chatPanel.dictation.waitingForPermission")
    : dictationState === "recording"
      ? t("chatPanel.dictation.listening")
      : t("chatPanel.dictation.transcribing");

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
      {isDragOver && canAttachDraftFiles ? <div className="chat-drop-overlay">{t("chatPanel.dropFiles")}</div> : null}
      {mode === "sidebar" ? (
        <div
          className={`chat-resize-handle${isDragging ? " dragging" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            beginResizeDrag();
          }}
        />
      ) : null}

      <div className="chat-header">
        <div>
          <span className="chat-header-title">{t("chatPanel.providerTitle")}</span>
          <div className="chat-subtitle">{chatConfig.provider.label} · {chatConfig.model.badgeLabel}</div>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-close-btn"
            onClick={() => {
              startNewConversationComposerReset(currentSessionId);
              discardDictation();
              void clearConversation()
                .then((nextSessionId) => finishNewConversationComposerReset(nextSessionId));
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
                discardDictation();
                setIsOpen(false);
              }}
            >
              &laquo;
            </button>
          ) : null}
        </div>
      </div>

      <div className="chat-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
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
                {renderStoredMessageContent(message, t)}
                {isLastAssistant ? (
                  <span className="chat-streaming-indicator">
                    <span className="chat-dots" />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="chat-input-area"
        data-testid="chat-composer-state"
        data-composer-state={composerState}
        data-composer-action={composerAction}
        data-chat-run-state={runState}
        data-send-phase={sendPhase}
        data-assistant-run-active={isAssistantRunActive ? "true" : "false"}
        data-stopping={isStopping ? "true" : "false"}
        data-draft-state={hasDraftContent ? "filled" : "empty"}
        data-can-send={canSendPendingMessage ? "true" : "false"}
      >
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

        {canShowComposerSuggestions ? (
          <div
            className="chat-composer-suggestions"
            aria-label={t("chatPanel.suggestedReplies")}
            data-testid="chat-composer-suggestions"
            data-suggestion-count={composerSuggestions.length}
          >
            {composerSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className="chat-composer-suggestion"
                data-testid="chat-composer-suggestion"
                data-suggestion-id={suggestion.id}
                data-suggestion-index={index}
                onClick={() => {
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
              replaceInputText(event.target.value);
              updateTrackedDraftSelection(event.target);
            }}
            onKeyDown={handleKeyDown}
            onSelect={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onClick={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onKeyUp={(event) => updateTrackedDraftSelection(event.currentTarget)}
            onFocus={(event) => updateTrackedDraftSelection(event.currentTarget)}
          />
        )}

        <div className="chat-controls">
          <div className="chat-controls-right">
            <FileAttachment onAttach={handleAttach} disabled={!canAttachDraftFiles} />
            <button
              type="button"
              className={`chat-mic-btn${dictationState === "recording" ? " chat-mic-btn-recording" : ""}`}
              aria-label={microphoneAriaLabel}
              onClick={() => void handleMicrophoneClick(canStartDictation)}
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
                onClick={() => void stopMessage()}
                disabled={isStopping}
                data-testid="chat-stop-button"
              >
                <span className="chat-stop-btn-icon" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-btn"
                aria-label={t("chatPanel.actions.sendAriaLabel")}
                onClick={() => void sendPendingMessage()}
                disabled={!canSendPendingMessage}
                data-testid="chat-send-button"
              >
                {t("chatPanel.actions.send")}
              </button>
            )}
          </div>
        </div>
      </div>

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
              onClick={dismissErrorDialog}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
