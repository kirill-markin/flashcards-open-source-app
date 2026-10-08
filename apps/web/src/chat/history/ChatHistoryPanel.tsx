import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  archiveChatSession,
  listChatSessions,
  renameChatSession,
} from "../../api";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type { ChatSessionHistorySummary } from "../../types";
import {
  ChatHistoryList,
  type ListState,
  type LoadMoreState,
  type RowAction,
} from "./ChatHistoryList";
import { ChatHistoryReader } from "./ChatHistoryReader";
import { isChatUnavailableError, type ReportHistoryError } from "./chatHistoryShared";

const SEARCH_DEBOUNCE_MS = 300;
const archiveActiveRunErrorCode = "CHAT_SESSION_ARCHIVE_ACTIVE_RUN";

type HistoryView =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "reading"; summary: ChatSessionHistorySummary }>;

export type ChatHistoryPanelProps = Readonly<{
  workspaceId: string;
  currentSessionId: string | null;
  isCurrentChatArchiveDisabled: boolean;
  onCurrentChatArchived: () => void;
  onMessageTechnicalError: (error: unknown) => boolean;
  canStartMessageAction: () => boolean;
  onClose: () => void;
}>;

function isArchiveActiveRunError(error: unknown): boolean {
  return error instanceof ApiError && error.code === archiveActiveRunErrorCode;
}

function appendNewSessions(
  sessions: ReadonlyArray<ChatSessionHistorySummary>,
  nextSessions: ReadonlyArray<ChatSessionHistorySummary>,
): ReadonlyArray<ChatSessionHistorySummary> {
  const knownSessionIds = new Set(sessions.map((session) => session.sessionId));
  return [...sessions, ...nextSessions.filter((session) => knownSessionIds.has(session.sessionId) === false)];
}

function withEntry<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
  value: Value,
): Readonly<Record<string, Value>> {
  return { ...record, [key]: value };
}

function withoutEntry<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

export function ChatHistoryPanel(props: ChatHistoryPanelProps): React.JSX.Element {
  const {
    workspaceId,
    currentSessionId,
    isCurrentChatArchiveDisabled,
    onCurrentChatArchived,
    onMessageTechnicalError,
    canStartMessageAction,
    onClose,
  } = props;
  const appData = useAppData();
  const { t } = useI18n();
  const userId = appData.session?.userId ?? null;
  const installationId = appData.cloudSettings?.installationId ?? null;
  const [view, setView] = useState<HistoryView>({ kind: "list" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchText, setSearchText] = useState<string | null>(null);
  const [listState, setListState] = useState<ListState>({ status: "loading" });
  const [loadMoreState, setLoadMoreState] = useState<LoadMoreState>("idle");
  const [listReloadVersion, setListReloadVersion] = useState(0);
  const [rowActions, setRowActions] = useState<Readonly<Record<string, RowAction>>>({});
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const [listNotice, setListNotice] = useState<string | null>(null);
  // The signal of the first-page request that produced the visible list; aborted when it is replaced.
  const listSignalRef = useRef<AbortSignal | null>(null);

  const reportHistoryError = useCallback<ReportHistoryError>((error, operation, sessionId) => {
    captureAppOperationError(error, {
      feature: "chat",
      operation,
      userId,
      workspaceId,
      installationId,
      entityId: sessionId,
    });
  }, [installationId, userId, workspaceId]);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    const timeoutId = window.setTimeout(() => {
      setSearchText(trimmedQuery === "" ? null : trimmedQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const abortController = new AbortController();
    listSignalRef.current = abortController.signal;
    setListState({ status: "loading" });
    setLoadMoreState("idle");
    setListNotice(null);
    void (async (): Promise<void> => {
      try {
        const page = await listChatSessions(workspaceId, null, searchText, abortController.signal);
        if (abortController.signal.aborted) {
          return;
        }
        setListState({ status: "loaded", sessions: page.sessions, nextCursor: page.nextCursor });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        reportHistoryError(error, "chat_history_list", null);
        setListState({ status: "failed" });
      }
    })();
    return () => abortController.abort();
  }, [listReloadVersion, reportHistoryError, searchText, workspaceId]);

  function updateLoadedSessions(
    update: (sessions: ReadonlyArray<ChatSessionHistorySummary>) => ReadonlyArray<ChatSessionHistorySummary>,
  ): void {
    setListState((current) => current.status === "loaded"
      ? { ...current, sessions: update(current.sessions) }
      : current);
  }

  function replaceSession(summary: ChatSessionHistorySummary): void {
    updateLoadedSessions((sessions) => sessions.map((session) =>
      session.sessionId === summary.sessionId ? summary : session));
  }

  function removeSession(sessionId: string): void {
    updateLoadedSessions((sessions) => sessions.filter((session) => session.sessionId !== sessionId));
  }

  function removeUnavailableSession(sessionId: string): void {
    removeSession(sessionId);
    setListNotice(t("chatPanel.history.unavailable"));
  }

  async function handleLoadMore(): Promise<void> {
    if (listState.status !== "loaded" || listState.nextCursor === null) {
      return;
    }
    const signal = listSignalRef.current;
    if (signal === null) {
      throw new Error("Chat history load more started before the first page request.");
    }

    setLoadMoreState("loading");
    try {
      const page = await listChatSessions(workspaceId, listState.nextCursor, searchText, signal);
      if (signal.aborted) {
        return;
      }
      setListState((current) => current.status === "loaded"
        ? {
          status: "loaded",
          sessions: appendNewSessions(current.sessions, page.sessions),
          nextCursor: page.nextCursor,
        }
        : current);
      setLoadMoreState("idle");
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      reportHistoryError(error, "chat_history_list", null);
      setLoadMoreState("failed");
    }
  }

  async function handleRename(summary: ChatSessionHistorySummary, title: string): Promise<void> {
    const trimmedTitle = title.trim();
    setRowErrors((current) => withoutEntry(current, summary.sessionId));
    setRowActions((current) => withEntry(current, summary.sessionId, "renaming"));
    replaceSession({ ...summary, title: trimmedTitle, hasCustomTitle: true });
    try {
      replaceSession(await renameChatSession(summary.sessionId, workspaceId, trimmedTitle));
    } catch (error) {
      if (isChatUnavailableError(error)) {
        removeUnavailableSession(summary.sessionId);
      } else {
        replaceSession(summary);
        reportHistoryError(error, "chat_history_rename", summary.sessionId);
        setRowErrors((current) => withEntry(current, summary.sessionId, t("chatPanel.history.renameError")));
      }
    } finally {
      setRowActions((current) => withoutEntry(current, summary.sessionId));
    }
  }

  async function handleArchive(summary: ChatSessionHistorySummary): Promise<void> {
    const isCurrent = summary.sessionId === currentSessionId;
    setRowErrors((current) => withoutEntry(current, summary.sessionId));
    setRowActions((current) => withEntry(current, summary.sessionId, "archiving"));
    try {
      await archiveChatSession(summary.sessionId, workspaceId);
    } catch (error) {
      // A 404 means the chat is already archived, which is the outcome this action wants.
      if (isChatUnavailableError(error) === false) {
        setRowActions((current) => withoutEntry(current, summary.sessionId));
        const isActiveRun = isArchiveActiveRunError(error);
        if (isActiveRun === false) {
          reportHistoryError(error, "chat_history_archive", summary.sessionId);
        }
        setRowErrors((current) => withEntry(
          current,
          summary.sessionId,
          isActiveRun ? t("chatPanel.history.archiveActiveRunError") : t("chatPanel.history.archiveError"),
        ));
        return;
      }
    }

    setRowActions((current) => withoutEntry(current, summary.sessionId));
    removeSession(summary.sessionId);
    if (isCurrent) {
      onCurrentChatArchived();
    }
  }

  // The list stays mounted while reading so Back returns to the same scroll position and row state.
  return (
    <>
      <ChatHistoryList
        hidden={view.kind === "reading"}
        listState={listState}
        loadMoreState={loadMoreState}
        currentSessionId={currentSessionId}
        isCurrentChatArchiveDisabled={isCurrentChatArchiveDisabled}
        searchQuery={searchQuery}
        isSearchActive={searchText !== null}
        onSearchQueryChange={setSearchQuery}
        rowActions={rowActions}
        rowErrors={rowErrors}
        listNotice={listNotice}
        onRename={(summary, title) => void handleRename(summary, title)}
        onArchive={(summary) => void handleArchive(summary)}
        onOpen={(summary) => {
          if (summary.sessionId === currentSessionId) {
            onClose();
            return;
          }
          setView({ kind: "reading", summary });
        }}
        onRetry={() => setListReloadVersion((version) => version + 1)}
        onLoadMore={() => void handleLoadMore()}
        onClose={onClose}
      />
      {view.kind === "reading" ? (
        <ChatHistoryReader
          workspaceId={workspaceId}
          summary={view.summary}
          reportHistoryError={reportHistoryError}
          onMessageTechnicalError={onMessageTechnicalError}
          canStartMessageAction={canStartMessageAction}
          onUnavailable={removeUnavailableSession}
          onBack={() => setView({ kind: "list" })}
        />
      ) : null}
    </>
  );
}
