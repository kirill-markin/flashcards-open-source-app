import { useEffect, useEffectEvent, useRef, useState } from "react";
import { getChatSnapshot } from "../../api";
import { useI18n } from "../../i18n";
import type { ChatSessionHistoryMessage, ChatSessionHistorySummary } from "../../types";
import { renderStoredMessageContent } from "./chatMessageContent";
import {
  ChatHistoryLoadError,
  ChatHistoryLoading,
  isChatUnavailableError,
  type ReportHistoryError,
} from "./chatHistoryShared";

type ReaderState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "failed"; isUnavailable: boolean }>
  | Readonly<{ status: "loaded"; messages: ReadonlyArray<ChatSessionHistoryMessage> }>;

export function ChatHistoryReader(props: {
  workspaceId: string;
  summary: ChatSessionHistorySummary;
  reportHistoryError: ReportHistoryError;
  onMessageTechnicalError: (error: unknown) => boolean;
  canStartMessageAction: () => boolean;
  onUnavailable: (sessionId: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const {
    workspaceId,
    summary,
    reportHistoryError,
    onMessageTechnicalError,
    canStartMessageAction,
    onUnavailable,
    onBack,
  } = props;
  const { t, formatDate } = useI18n();
  const [readerState, setReaderState] = useState<ReaderState>({ status: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const reportUnavailable = useEffectEvent((sessionId: string): void => onUnavailable(sessionId));

  // Opening a row hides the list and drops focus to the page.
  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    setReaderState({ status: "loading" });
    void (async (): Promise<void> => {
      try {
        const snapshot = await getChatSnapshot(summary.sessionId, workspaceId, abortController.signal);
        if (abortController.signal.aborted) {
          return;
        }
        setReaderState({ status: "loaded", messages: snapshot.conversation.messages });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        const isUnavailable = isChatUnavailableError(error);
        if (isUnavailable) {
          reportUnavailable(summary.sessionId);
        } else {
          reportHistoryError(error, "chat_history_read", summary.sessionId);
        }
        setReaderState({ status: "failed", isUnavailable });
      }
    })();
    return () => abortController.abort();
  }, [reloadVersion, reportHistoryError, summary.sessionId, workspaceId]);

  return (
    <div className="chat-history-panel" data-testid="chat-history-reader">
      <div className="chat-header">
        <div>
          <span className="chat-header-title">{summary.title ?? t("chatPanel.history.untitledChat")}</span>
          <p className="chat-subtitle">
            {formatDate(summary.lastActivityAt)}
            {" · "}
            {t("chatPanel.history.readOnlyNotice")}
          </p>
        </div>
        <div className="chat-header-actions">
          <button
            ref={backButtonRef}
            type="button"
            className="chat-close-btn"
            onClick={onBack}
            data-testid="chat-history-back"
          >
            {t("chatPanel.history.back")}
          </button>
        </div>
      </div>
      <div className="chat-messages" data-testid="chat-history-messages">
        <div className="chat-messages-content">
          {readerState.status === "loading" ? <ChatHistoryLoading title={t("chatPanel.history.readerLoading")} /> : null}
          {readerState.status === "failed" && readerState.isUnavailable ? (
            <p className="chat-history-empty" role="alert" data-testid="chat-history-reader-unavailable">
              {t("chatPanel.history.unavailable")}
            </p>
          ) : null}
          {readerState.status === "failed" && readerState.isUnavailable === false ? (
            <ChatHistoryLoadError
              message={t("chatPanel.history.readerLoadError")}
              onRetry={() => setReloadVersion((version) => version + 1)}
              testId="chat-history-reader-error"
            />
          ) : null}
          {readerState.status === "loaded"
            ? readerState.messages.map((message, index) => (
              <div
                key={`${message.timestamp}-${index}`}
                className={`chat-msg chat-msg-${message.role}`}
              >
                {renderStoredMessageContent(
                  message,
                  t,
                  onMessageTechnicalError,
                  canStartMessageAction,
                )}
              </div>
            ))
            : null}
        </div>
      </div>
    </div>
  );
}
