import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { renderStoredMessageContent } from "./chatMessageContent";
import {
  deleteArchivedChat,
  getArchivedChat,
  listArchivedChats,
  renameArchivedChat,
  type ArchivedChat,
  type ArchivedChatSummary,
} from "./chatArchive";

type HistoryView =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "reading"; chatId: string }>;

export type ChatHistoryPanelProps = Readonly<{
  workspaceId: string | null;
  onClose: () => void;
}>;

function formatChatDate(timestamp: number, formatDate: (value: number) => string): string {
  try {
    return formatDate(timestamp);
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
}

function ChatHistoryList(props: {
  workspaceId: string | null;
  summaries: ArchivedChatSummary[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  renamingId: string | null;
  onStartRename: (chatId: string) => void;
  onCancelRename: () => void;
  onConfirmRename: (chatId: string, title: string) => void;
  onDelete: (chatId: string) => void;
  onOpen: (chatId: string) => void;
  onClose: () => void;
  refresh: () => void;
}): React.JSX.Element {
  const {
    workspaceId,
    summaries,
    searchQuery,
    onSearchQueryChange,
    renamingId,
    onStartRename,
    onCancelRename,
    onConfirmRename,
    onDelete,
    onOpen,
    onClose,
    refresh,
  } = props;
  const { t, formatDate, formatCount, messages: translationMessages } = useI18n();
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === "") {
      return summaries;
    }
    return summaries.filter(
      (summary) =>
        summary.title.toLowerCase().includes(query) ||
        summary.preview.toLowerCase().includes(query),
    );
  }, [summaries, searchQuery]);

  function handleDeleteConfirmed(chatId: string): void {
    deleteArchivedChat(workspaceId, chatId);
    setDeleteConfirmId(null);
    refresh();
  }

  return (
    <div className="chat-history-panel" data-testid="chat-history-panel">
      <div className="chat-header">
        <div>
          <span className="chat-header-title">{t("chatPanel.history.title")}</span>
          <p className="chat-subtitle">{t("chatPanel.history.readOnlyNotice")}</p>
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
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={t("chatPanel.history.searchPlaceholder")}
          aria-label={t("chatPanel.history.searchPlaceholder")}
          data-testid="chat-history-search"
        />
      </div>
      <div className="chat-history-list" data-testid="chat-history-list">
        {filtered.length === 0 ? (
          <p className="chat-history-empty" data-testid="chat-history-empty">
            {searchQuery.trim() === ""
              ? t("chatPanel.history.empty")
              : t("chatPanel.history.noSearchResults")}
          </p>
        ) : (
          filtered.map((summary) => (
            <div key={summary.id} className="chat-history-item" data-testid="chat-history-item">
              {renamingId === summary.id ? (
                <form
                  className="chat-history-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onConfirmRename(summary.id, renameDraft);
                  }}
                >
                  <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    aria-label={t("chatPanel.history.rename")}
                    data-testid="chat-history-rename-input"
                  />
                  <button type="submit" data-testid="chat-history-rename-save">
                    {t("chatPanel.history.save")}
                  </button>
                  <button type="button" onClick={onCancelRename} data-testid="chat-history-rename-cancel">
                    {t("chatPanel.history.cancel")}
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="chat-history-item-main"
                    onClick={() => onOpen(summary.id)}
                    data-testid="chat-history-open"
                  >
                    <span className="chat-history-item-title">{summary.title}</span>
                    <span className="chat-history-item-meta">
                      {formatChatDate(summary.updatedAt, formatDate)}
                      {" · "}
                      {formatCount(
                        summary.messageCount,
                        translationMessages.chatPanel.history.messageCountLabels.message,
                      )}
                    </span>
                    {summary.preview !== "" ? (
                      <span className="chat-history-item-preview">{summary.preview}</span>
                    ) : null}
                  </button>
                  <div className="chat-history-item-actions">
                    <button
                      type="button"
                      className="chat-history-item-action"
                      onClick={() => {
                        setRenameDraft(summary.title);
                        onStartRename(summary.id);
                      }}
                      aria-label={t("chatPanel.history.rename")}
                      data-testid="chat-history-rename"
                    >
                      {t("chatPanel.history.rename")}
                    </button>
                    {deleteConfirmId === summary.id ? (
                      <>
                        <button
                          type="button"
                          className="chat-history-item-action chat-history-item-action-danger"
                          onClick={() => handleDeleteConfirmed(summary.id)}
                          data-testid="chat-history-delete-confirm"
                        >
                          {t("chatPanel.history.deleteConfirm")}
                        </button>
                        <button
                          type="button"
                          className="chat-history-item-action"
                          onClick={() => setDeleteConfirmId(null)}
                          data-testid="chat-history-delete-cancel"
                        >
                          {t("chatPanel.history.cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="chat-history-item-action chat-history-item-action-danger"
                        onClick={() => setDeleteConfirmId(summary.id)}
                        aria-label={t("chatPanel.history.delete")}
                        data-testid="chat-history-delete"
                      >
                        {t("chatPanel.history.delete")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChatHistoryReader(props: {
  chat: ArchivedChat;
  onBack: () => void;
}): React.JSX.Element {
  const { chat, onBack } = props;
  const { t, formatDate } = useI18n();

  return (
    <div className="chat-history-panel" data-testid="chat-history-reader">
      <div className="chat-header">
        <div>
          <span className="chat-header-title">{chat.summary.title}</span>
          <p className="chat-subtitle">
            {formatChatDate(chat.summary.updatedAt, formatDate)}
            {" · "}
            {t("chatPanel.history.readOnlyNotice")}
          </p>
        </div>
        <div className="chat-header-actions">
          <button
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
          {chat.messages.map((message, index) => (
            <div
              key={`${message.timestamp}-${index}`}
              className={`chat-msg chat-msg-${message.role}`}
            >
              {renderStoredMessageContent(
                message,
                t,
                () => false,
                () => false,
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatHistoryPanel(props: ChatHistoryPanelProps): React.JSX.Element {
  const { workspaceId, onClose } = props;
  const [view, setView] = useState<HistoryView>({ kind: "list" });
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const summaries = useMemo(
    () => listArchivedChats(workspaceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, refreshToken],
  );

  const readingChat =
    view.kind === "reading" ? getArchivedChat(workspaceId, view.chatId) : null;

  useEffect(() => {
    if (view.kind === "reading" && readingChat === null) {
      setView({ kind: "list" });
      setRefreshToken((token) => token + 1);
    }
  }, [view, readingChat]);

  function refresh(): void {
    setRefreshToken((token) => token + 1);
  }

  if (view.kind === "reading" && readingChat !== null) {
    return <ChatHistoryReader chat={readingChat} onBack={() => setView({ kind: "list" })} />;
  }

  return (
    <ChatHistoryList
      workspaceId={workspaceId}
      summaries={summaries}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      renamingId={renamingId}
      onStartRename={setRenamingId}
      onCancelRename={() => setRenamingId(null)}
      onConfirmRename={(chatId, title) => {
        if (renameArchivedChat(workspaceId, chatId, title)) {
          setRenamingId(null);
          refresh();
        }
      }}
      onDelete={() => refresh()}
      onOpen={(chatId) => setView({ kind: "reading", chatId })}
      onClose={onClose}
      refresh={refresh}
    />
  );
}
