import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { ChatSessionHistorySummary } from "../../types";
import { ChatHistoryLoadError, ChatHistoryLoading } from "./chatHistoryShared";

// Server limits for `q` and for a title, both counted after trimming.
const MAX_SEARCH_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;

export type ListState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "failed" }>
  | Readonly<{
    status: "loaded";
    sessions: ReadonlyArray<ChatSessionHistorySummary>;
    nextCursor: string | null;
  }>;

export type LoadMoreState = "idle" | "loading" | "failed";

export type RowAction = "renaming" | "archiving";

function orderCurrentChatFirst(
  sessions: ReadonlyArray<ChatSessionHistorySummary>,
  currentSessionId: string | null,
): ReadonlyArray<ChatSessionHistorySummary> {
  return [
    ...sessions.filter((session) => session.sessionId === currentSessionId),
    ...sessions.filter((session) => session.sessionId !== currentSessionId),
  ];
}

export function ChatHistoryList(props: {
  hidden: boolean;
  listState: ListState;
  loadMoreState: LoadMoreState;
  currentSessionId: string | null;
  isCurrentChatArchiveDisabled: boolean;
  searchQuery: string;
  isSearchActive: boolean;
  onSearchQueryChange: (value: string) => void;
  rowActions: Readonly<Record<string, RowAction>>;
  rowErrors: Readonly<Record<string, string>>;
  listNotice: string | null;
  onRename: (summary: ChatSessionHistorySummary, title: string) => void;
  onArchive: (summary: ChatSessionHistorySummary) => void;
  onOpen: (summary: ChatSessionHistorySummary) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const {
    hidden,
    listState,
    loadMoreState,
    currentSessionId,
    isCurrentChatArchiveDisabled,
    searchQuery,
    isSearchActive,
    onSearchQueryChange,
    rowActions,
    rowErrors,
    listNotice,
    onRename,
    onArchive,
    onOpen,
    onRetry,
    onLoadMore,
    onClose,
  } = props;
  const { t, formatDate, formatCount, messages: translationMessages } = useI18n();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  // Hidden via display:none, Firefox drops the scroller's offset, so the list restores its own.
  const listRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef(0);

  // Only a new first-page request sets "loading"; its result set must not inherit the old offset.
  useLayoutEffect(() => {
    if (listState.status === "loading") {
      savedScrollTopRef.current = 0;
    }
  }, [listState.status]);

  useLayoutEffect(() => {
    if (hidden === false && listRef.current !== null) {
      listRef.current.scrollTop = savedScrollTopRef.current;
    }
  }, [hidden]);

  function renderSessions(sessions: ReadonlyArray<ChatSessionHistorySummary>): React.JSX.Element {
    if (sessions.length === 0) {
      return (
        <p className="chat-history-empty" data-testid="chat-history-empty">
          {isSearchActive
            ? t("chatPanel.history.noSearchResults")
            : t("chatPanel.history.empty")}
        </p>
      );
    }

    return (
      <>
        {orderCurrentChatFirst(sessions, currentSessionId).map((summary) => {
          const isCurrent = summary.sessionId === currentSessionId;
          const rowAction = rowActions[summary.sessionId];
          const isBusy = rowAction !== undefined;
          const rowError = rowErrors[summary.sessionId];
          const title = summary.title ?? t("chatPanel.history.untitledChat");
          return (
            <div
              key={summary.sessionId}
              className={`chat-history-item${isBusy ? " chat-history-item-busy" : ""}`}
              aria-busy={isBusy ? "true" : "false"}
              data-testid="chat-history-item"
              data-chat-session-id={summary.sessionId}
              data-current={isCurrent ? "true" : "false"}
            >
              {renamingId === summary.sessionId ? (
                <form
                  className="chat-history-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (renameDraft.trim() === "") {
                      return;
                    }
                    setRenamingId(null);
                    onRename(summary, renameDraft);
                  }}
                >
                  <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={renameDraft}
                    maxLength={MAX_TITLE_LENGTH}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    aria-label={t("chatPanel.history.rename")}
                    data-testid="chat-history-rename-input"
                  />
                  <button
                    type="submit"
                    disabled={renameDraft.trim() === ""}
                    data-testid="chat-history-rename-save"
                  >
                    {t("chatPanel.history.save")}
                  </button>
                  <button type="button" onClick={() => setRenamingId(null)} data-testid="chat-history-rename-cancel">
                    {t("chatPanel.history.cancel")}
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="chat-history-item-main"
                    onClick={() => onOpen(summary)}
                    disabled={rowAction === "archiving"}
                    data-testid="chat-history-open"
                  >
                    <span className="chat-history-item-title-row">
                      <span className="chat-history-item-title">{title}</span>
                      {isCurrent ? (
                        <span className="chat-history-item-current" data-testid="chat-history-current">
                          {t("chatPanel.history.current")}
                        </span>
                      ) : null}
                    </span>
                    <span className="chat-history-item-meta">
                      {formatDate(summary.lastActivityAt)}
                      {" · "}
                      {formatCount(
                        summary.messageCount,
                        translationMessages.chatPanel.history.messageCountLabels.message,
                      )}
                    </span>
                    {summary.preview !== null ? (
                      <span className="chat-history-item-preview">{summary.preview}</span>
                    ) : null}
                  </button>
                  <div className="chat-history-item-actions">
                    {isBusy ? (
                      <span className="chat-history-spinner" aria-hidden="true" data-testid="chat-history-item-busy" />
                    ) : null}
                    <button
                      type="button"
                      className="chat-history-item-action"
                      onClick={() => {
                        setArchiveConfirmId(null);
                        setRenameDraft(summary.title ?? "");
                        setRenamingId(summary.sessionId);
                      }}
                      disabled={isBusy}
                      aria-label={t("chatPanel.history.rename")}
                      data-testid="chat-history-rename"
                    >
                      {t("chatPanel.history.rename")}
                    </button>
                    {archiveConfirmId === summary.sessionId ? (
                      <>
                        <button
                          type="button"
                          className="chat-history-item-action chat-history-item-action-danger"
                          onClick={() => {
                            setArchiveConfirmId(null);
                            onArchive(summary);
                          }}
                          disabled={isBusy || (isCurrent && isCurrentChatArchiveDisabled)}
                          data-testid="chat-history-archive-confirm"
                        >
                          {t("chatPanel.history.archiveConfirm")}
                        </button>
                        <button
                          type="button"
                          className="chat-history-item-action"
                          onClick={() => setArchiveConfirmId(null)}
                          data-testid="chat-history-archive-cancel"
                        >
                          {t("chatPanel.history.cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="chat-history-item-action chat-history-item-action-danger"
                        onClick={() => setArchiveConfirmId(summary.sessionId)}
                        disabled={isBusy || (isCurrent && isCurrentChatArchiveDisabled)}
                        aria-label={t("chatPanel.history.archive")}
                        data-testid="chat-history-archive"
                      >
                        {t("chatPanel.history.archive")}
                      </button>
                    )}
                  </div>
                  {rowError !== undefined ? (
                    <p className="chat-history-item-error" role="alert" data-testid="chat-history-item-error">
                      {rowError}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {listState.status === "loaded" && listState.nextCursor !== null ? (
          <div className="chat-history-load-more">
            {loadMoreState === "failed" ? (
              <p className="chat-history-item-error" role="alert">{t("chatPanel.history.loadError")}</p>
            ) : null}
            <button
              type="button"
              className="chat-history-item-action"
              onClick={onLoadMore}
              disabled={loadMoreState === "loading"}
              aria-busy={loadMoreState === "loading" ? "true" : "false"}
              data-testid="chat-history-load-more"
            >
              {loadMoreState === "loading" ? (
                <span className="chat-history-spinner" aria-hidden="true" />
              ) : null}
              {loadMoreState === "failed" ? t("common.retry") : t("chatPanel.history.loadMore")}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="chat-history-panel" hidden={hidden} data-testid="chat-history-panel">
      <div className="chat-header">
        <div>
          <span className="chat-header-title">{t("chatPanel.history.title")}</span>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-close-btn"
            onClick={onClose}
            aria-label={t("chatPanel.history.close")}
            data-testid="chat-history-close"
          >
            {t("chatPanel.history.close")}
          </button>
        </div>
      </div>
      <div className="chat-history-search">
        <input
          type="search"
          value={searchQuery}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={t("chatPanel.history.searchPlaceholder")}
          aria-label={t("chatPanel.history.searchPlaceholder")}
          data-testid="chat-history-search"
        />
      </div>
      <div
        ref={listRef}
        className="chat-history-list"
        onScroll={(event) => {
          // A scroll still in flight when the list hides lands here reading 0.
          if (hidden) {
            return;
          }
          savedScrollTopRef.current = event.currentTarget.scrollTop;
        }}
        data-testid="chat-history-list"
      >
        {listNotice !== null ? (
          <p className="chat-history-item-error" role="alert" data-testid="chat-history-notice">{listNotice}</p>
        ) : null}
        {listState.status === "loading" ? <ChatHistoryLoading title={t("chatPanel.history.loading")} /> : null}
        {listState.status === "failed" ? (
          <ChatHistoryLoadError
            message={t("chatPanel.history.loadError")}
            onRetry={onRetry}
            testId="chat-history-load-error"
          />
        ) : null}
        {listState.status === "loaded" ? renderSessions(listState.sessions) : null}
      </div>
    </div>
  );
}
