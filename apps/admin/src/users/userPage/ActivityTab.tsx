import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { getEventPath } from "../../routing";
import { DataTable } from "../../table/DataTable";
import {
  clampDataTablePage,
  emptyDataTableState,
  type DataTableColumn,
  type DataTableState,
} from "../../table/dataTableModel";
import { JsonPreviewCell } from "../../table/JsonPreviewCell";
import {
  emptyActivityEnumOptions,
  loadActivityEnumOptions,
  loadActivityPage,
  type ActivityEnumOptions,
  type ActivityPageResult,
  type ActivityRow,
} from "./activityQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: ActivityPageResult;
    isLoading: boolean;
    /** A reload that failed while the previous page stays on screen; cleared only by a later success. */
    reloadError: string | null;
  }>;

type EnumOptionsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; options: ActivityEnumOptions }>;

// Every state change is a query, so a burst of keystrokes in a filter would be a burst of queries. The
// newest state waits this long before it is sent, and the ones it superseded never reach the network.
const tableReloadDebounceMs = 300;

/**
 * An analytics row's name links to that event's page; purchases, grants and feedback have none. Each
 * column's SQL is `activityColumnSqlById`.
 */
function buildActivityColumns(onNavigate: (path: string) => void): ReadonlyArray<DataTableColumn<ActivityRow>> {
  return [
    { id: "occurred", label: "Occurred at (UTC)", kind: "date", value: (row) => row.occurredAt, renderCell: null },
    { id: "source", label: "Source", kind: "enum", value: (row) => row.source, renderCell: null },
    { id: "recorded-as", label: "Recorded as", kind: "enum", value: (row) => row.recordedAs, renderCell: null },
    {
      id: "name",
      label: "Event",
      kind: "enum",
      value: (row) => row.name,
      renderCell: (row) => row.eventId === null ? row.name : (
        <AdminLink className="data-table-link" path={getEventPath(row.eventId)} onNavigate={onNavigate}>{row.name}</AdminLink>
      ),
    },
    { id: "platform", label: "Platform", kind: "enum", value: (row) => row.platform, renderCell: null },
    { id: "app-version", label: "App version", kind: "enum", value: (row) => row.appVersion, renderCell: null },
    { id: "screen", label: "Screen", kind: "enum", value: (row) => row.screen, renderCell: null },
    { id: "country", label: "Country", kind: "enum", value: (row) => row.country, renderCell: null },
    { id: "ui-locale", label: "UI locale", kind: "enum", value: (row) => row.uiLocale, renderCell: null },
    { id: "session", label: "Session ID", kind: "text", value: (row) => row.sessionId, renderCell: null },
    { id: "origin", label: "Origin / trust level", kind: "enum", value: (row) => row.origin, renderCell: null },
    { id: "details", label: "Details", kind: "text", value: (row) => row.details, renderCell: (row) => <JsonPreviewCell json={row.details} /> },
  ];
}

function getActivityRowKey(row: ActivityRow): string {
  return row.key;
}

function getActivityRowClassName(): string {
  return "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected user activity query error.";
}

/**
 * The person's activity, sorted, filtered and paged in SQL over their whole history; an unsorted table
 * is newest first. The enum option lists are fetched once on entry, apart from the pages, so the rows
 * never wait for them and their failure only empties the enum filters.
 */
export function ActivityTab(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, onNavigate, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);
  const activityColumns = useMemo(() => buildActivityColumns(onNavigate), [onNavigate]);
  const [enumOptionsState, setEnumOptionsState] = useState<EnumOptionsState>({ status: "loading" });
  const [enumOptionsRevision, setEnumOptionsRevision] = useState<number>(0);
  // Only a table that already shows a page waits for the debounce; the first load has nothing to coalesce.
  const hasLoadedPageRef = useRef<boolean>(false);

  // Blind to the table state, so neither a table change nor the clamp re-request asks for them again.
  useEffect(() => {
    let isSuperseded = false;
    setEnumOptionsState({ status: "loading" });

    async function loadEnumOptions(): Promise<void> {
      try {
        const options = await loadActivityEnumOptions(config, userId);
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
        const result = await loadActivityPage(config, userId, requestedState, activityColumns);
        if (isSuperseded) return;
        // A page past the end, from a shrunken total, is asked for again as the last page the table shows instead.
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
  }, [activityColumns, config, onTerminalAdminError, revision, tableState, userId]);

  return (
    <div className="activity-tab" data-testid="user-activity">
      <p className="dashboard-section-description">
        Every analytics event credited to this person, every trust level included, plus their purchases, grants and feedback, newest first. Reviews, cards and AI chat appear as their analytics events.
        Recorded as is the credential behind each event - guest, account, or visitor with no user at all - and where a server-made event carries none, whether its user id was still a guest at that moment.
        Sorting, filters and pages apply to the whole history.
      </p>
      {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading activity…</p> : null}
      {loadState.status === "error" ? <div className="report-state report-state-error">
        <strong>User activity query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" && loadState.reloadError !== null ? <div className="report-state report-state-error" role="alert" data-testid="user-activity-reload-error">
        <strong>User activity query failed; the rows below are from the previous query.</strong><span>{loadState.reloadError}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {enumOptionsState.status === "error" ? <div className="report-state report-state-error" role="alert" data-testid="user-activity-enum-options-error">
        <strong>Filter options query failed; the enum column filters list no values until it succeeds.</strong><span>{enumOptionsState.message}</span>
        <button className="filter-button" type="button" onClick={() => setEnumOptionsRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" ? <DataTable
        testId="user-activity-table"
        columns={activityColumns}
        rows={loadState.result.rows}
        rowKey={getActivityRowKey}
        rowClassName={getActivityRowClassName}
        state={tableState}
        onStateChange={setTableState}
        server={{
          totalCount: loadState.result.totalCount,
          enumOptionsByColumnId: enumOptionsState.status === "ready" ? enumOptionsState.options : emptyActivityEnumOptions,
          isLoading: loadState.isLoading,
        }}
      /> : null}
    </div>
  );
}
