import { useEffect, useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { getUserChatPath } from "../../routing";
import { DataTable } from "../../table/DataTable";
import { emptyDataTableState, type DataTableColumn, type DataTableState } from "../../table/dataTableModel";
import { ChatView } from "./ChatView";
import { loadChatSessions, type ChatSessionRow } from "./chatsQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; sessions: ReadonlyArray<ChatSessionRow> }>;

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

/** The person's chats, or the one open chat; the list and its table state outlive opening a chat. */
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
  const columns = useMemo(() => buildChatColumns(userId, onNavigate), [userId, onNavigate]);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadChatSessions(config, userId).then((sessions) => {
      if (!cancelled) setLoadState({ status: "ready", sessions });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected user chats query error." });
    });
    return () => { cancelled = true; };
  }, [config, userId, onTerminalAdminError, revision]);

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

  if (loadState.status === "loading") {
    return <p className="report-state" aria-live="polite">Loading chats…</p>;
  }

  if (loadState.status === "error") {
    return (
      <div className="report-state report-state-error">
        <strong>User chats query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="user-tab" data-testid="user-chats">
      <p className="dashboard-section-description">
        Every AI chat this person owns, most recently updated first. Characters count the text of every message, the person's and the model's. Open a chat to read it. A guest's chats are deleted with the guest when it merges into an account, so none carry over.
      </p>
      <DataTable
        testId="user-chats-table"
        columns={columns}
        rows={loadState.sessions}
        rowKey={getChatRowKey}
        rowClassName={getChatRowClassName}
        state={tableState}
        onStateChange={setTableState}
        server={null}
      />
    </div>
  );
}
