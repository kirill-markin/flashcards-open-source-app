import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { getUserChatPath } from "../../routing";
import { DataTable } from "../../table/DataTable";
import {
  clampDataTablePage,
  emptyDataTableState,
  type DataTableColumn,
  type DataTableState,
} from "../../table/dataTableModel";
import { ChatView } from "./ChatView";
import {
  emptyChatSessionsEnumOptions,
  loadChatSessionsEnumOptions,
  loadChatSessionsPage,
  type ChatSessionRow,
  type ChatSessionsEnumOptions,
  type ChatSessionsPageResult,
} from "./chatsQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: ChatSessionsPageResult;
    isLoading: boolean;
    /** A reload that failed while the previous page stays on screen; cleared only by a later success. */
    reloadError: string | null;
  }>;

type EnumOptionsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; options: ChatSessionsEnumOptions }>;

// Every state change is a query, so a burst of keystrokes in a filter would be a burst of queries. The
// newest state waits this long before it is sent, and the ones it superseded never reach the network.
const tableReloadDebounceMs = 300;

// Each column's SQL is `chatColumnSqlById` in `chatsQuery.ts`.
function buildChatColumns(userId: string, onNavigate: (path: string) => void): ReadonlyArray<DataTableColumn<ChatSessionRow>> {
  return [
    {
      id: "session",
      label: "Chat",
      kind: "text",
      value: (session) => session.sessionId,
      renderCell: (session) => (
        <AdminLink className="data-table-link" path={getUserChatPath(userId, session.sessionId)} onNavigate={onNavigate}>{session.sessionId}</AdminLink>
      ),
    },
    { id: "created", label: "Created (UTC)", kind: "date", value: (session) => session.createdAt, renderCell: null },
    { id: "updated", label: "Updated (UTC)", kind: "date", value: (session) => session.updatedAt, renderCell: null },
    { id: "status", label: "Status", kind: "enum", value: (session) => session.status, renderCell: null },
    { id: "workspace", label: "Workspace", kind: "enum", value: (session) => session.workspaceName, renderCell: null },
    { id: "messages", label: "Messages", kind: "number", value: (session) => session.messageCount, renderCell: null },
    { id: "user-messages", label: "User messages", kind: "number", value: (session) => session.userMessageCount, renderCell: null },
    { id: "characters", label: "Characters", kind: "number", value: (session) => session.characterCount, renderCell: null },
    { id: "last-message", label: "Last message (UTC)", kind: "date", value: (session) => session.lastMessageAt, renderCell: null },
    { id: "runs", label: "Runs", kind: "number", value: (session) => session.runCount, renderCell: null },
    { id: "failed-runs", label: "Failed runs", kind: "number", value: (session) => session.failedRunCount, renderCell: null },
    { id: "models", label: "Models", kind: "text", value: (session) => session.models, renderCell: null },
    { id: "platforms", label: "Client platforms", kind: "text", value: (session) => session.clientPlatforms, renderCell: null },
  ];
}

function getChatRowKey(session: ChatSessionRow): string {
  return session.sessionId;
}

function getChatRowClassName(): string {
  return "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected user chats query error.";
}

/**
 * The person's chats, sorted, filtered and paged in SQL, or the one open chat; the list and its table
 * state outlive opening a chat. The enum option lists are fetched once, apart from the pages, so the
 * rows never wait for them and their failure only empties the enum filters.
 */
export function ChatsTab(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  openSessionId: string | null;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, onNavigate, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);
  const [enumOptionsState, setEnumOptionsState] = useState<EnumOptionsState>({ status: "loading" });
  const [enumOptionsRevision, setEnumOptionsRevision] = useState<number>(0);
  // Only a table that already shows a page waits for the debounce; the first load has nothing to coalesce.
  const hasLoadedPageRef = useRef<boolean>(false);
  const columns = useMemo(() => buildChatColumns(userId, onNavigate), [userId, onNavigate]);

  // Blind to the table state, so neither a table change nor the clamp re-request asks for them again.
  useEffect(() => {
    let isSuperseded = false;
    setEnumOptionsState({ status: "loading" });

    async function loadEnumOptions(): Promise<void> {
      try {
        const options = await loadChatSessionsEnumOptions(config, userId);
        if (isSuperseded) return;
        setEnumOptionsState({ status: "ready", options });
      } catch (error: unknown) {
        if (isSuperseded || onTerminalAdminError(error, config)) return;
        setEnumOptionsState({ status: "error", message: getErrorMessage(error) });
      }
    }

    void loadEnumOptions();
    return () => {
      isSuperseded = true;
    };
  }, [config, enumOptionsRevision, onTerminalAdminError, userId]);

  useEffect(() => {
    const requestedState = tableState;
    let isSuperseded = false;
    // The previous page stays on screen, dimmed, until the new one arrives.
    setLoadState((current) => {
      if (current.status === "ready") return { ...current, isLoading: true };
      return current.status === "error" ? { status: "loading" } : current;
    });

    async function loadPage(): Promise<void> {
      try {
        const result = await loadChatSessionsPage(config, userId, requestedState, columns);
        if (isSuperseded) return;
        // A page past the end, from a shrunken total, is asked for again as the last page the table
        // shows instead.
        const clampedPage = clampDataTablePage(requestedState.page, result.totalCount);
        if (clampedPage !== requestedState.page) {
          setTableState({ ...requestedState, page: clampedPage });
          return;
        }
        hasLoadedPageRef.current = true;
        setLoadState({ status: "ready", result, isLoading: false, reloadError: null });
      } catch (error: unknown) {
        if (isSuperseded || onTerminalAdminError(error, config)) return;
        const message = getErrorMessage(error);
        setLoadState((current) => current.status === "ready"
          ? { ...current, isLoading: false, reloadError: message }
          : { status: "error", message });
      }
    }

    const reloadTimeoutId = window.setTimeout(
      () => { void loadPage(); },
      hasLoadedPageRef.current ? tableReloadDebounceMs : 0,
    );
    return () => {
      isSuperseded = true;
      window.clearTimeout(reloadTimeoutId);
    };
  }, [columns, config, onTerminalAdminError, revision, tableState, userId]);

  if (props.openSessionId !== null) {
    return (
      <ChatView
        key={props.openSessionId}
        config={config}
        userId={userId}
        sessionId={props.openSessionId}
        onNavigate={onNavigate}
        onTerminalAdminError={onTerminalAdminError}
      />
    );
  }

  return (
    <div className="user-tab" data-testid="user-chats">
      <p className="dashboard-section-description">
        Every AI chat this person owns, most recently updated first. Characters count the text of every message, the person's and the model's. Open a chat to read it. A guest's chats are deleted with the guest when it merges into an account, so none carry over. Sorting, filters and pages apply to every chat of this person.
      </p>
      {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading chats…</p> : null}
      {loadState.status === "error" ? <div className="report-state report-state-error">
        <strong>User chats query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" && loadState.reloadError !== null ? <div className="report-state report-state-error" role="alert" data-testid="user-chats-reload-error">
        <strong>User chats query failed; the rows below are from the previous query.</strong><span>{loadState.reloadError}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {enumOptionsState.status === "error" ? <div className="report-state report-state-error" role="alert" data-testid="user-chats-enum-options-error">
        <strong>Filter options query failed; the enum column filters list no values until it succeeds.</strong><span>{enumOptionsState.message}</span>
        <button className="filter-button" type="button" onClick={() => setEnumOptionsRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" ? <DataTable
        testId="user-chats-table"
        columns={columns}
        rows={loadState.result.rows}
        rowKey={getChatRowKey}
        rowClassName={getChatRowClassName}
        state={tableState}
        onStateChange={setTableState}
        server={{
          totalCount: loadState.result.totalCount,
          enumOptionsByColumnId: enumOptionsState.status === "ready" ? enumOptionsState.options : emptyChatSessionsEnumOptions,
          isLoading: loadState.isLoading,
        }}
      /> : null}
    </div>
  );
}
