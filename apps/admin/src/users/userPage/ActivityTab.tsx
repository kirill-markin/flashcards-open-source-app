import { useEffect, useState, type JSX, type ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { DataTable } from "../../table/DataTable";
import { emptyDataTableState, type DataTableColumn, type DataTableState } from "../../table/dataTableModel";
import {
  activityPageSize,
  loadActivityFirstPage,
  loadActivityOlderPage,
  type ActivityRow,
} from "./activityQuery";

type OlderPageState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>;

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    totalCount: number;
    rows: ReadonlyArray<ActivityRow>;
    /** False once a page came back short, so nothing older is left to ask for. */
    hasOlderRows: boolean;
    olderPage: OlderPageState;
  }>;

const detailsPreviewLength = 80;

function renderDetails(row: ActivityRow): ReactNode {
  if (row.details.length <= detailsPreviewLength) {
    return <code className="activity-details-text">{row.details}</code>;
  }
  return (
    <details className="activity-details">
      <summary><code className="activity-details-text">{`${row.details.slice(0, detailsPreviewLength)}…`}</code></summary>
      <pre className="activity-details-full">{row.details}</pre>
    </details>
  );
}

const activityColumns: ReadonlyArray<DataTableColumn<ActivityRow>> = [
  { id: "occurred", label: "Occurred at (UTC)", kind: "date", value: (row) => row.occurredAt, renderCell: null },
  { id: "source", label: "Source", kind: "enum", value: (row) => row.source, renderCell: null },
  { id: "name", label: "Event", kind: "enum", value: (row) => row.name, renderCell: null },
  { id: "platform", label: "Platform", kind: "enum", value: (row) => row.platform, renderCell: null },
  { id: "app-version", label: "App version", kind: "enum", value: (row) => row.appVersion, renderCell: null },
  { id: "screen", label: "Screen", kind: "enum", value: (row) => row.screen, renderCell: null },
  { id: "country", label: "Country", kind: "enum", value: (row) => row.country, renderCell: null },
  { id: "ui-locale", label: "UI locale", kind: "enum", value: (row) => row.uiLocale, renderCell: null },
  { id: "session", label: "Session ID", kind: "text", value: (row) => row.sessionId, renderCell: null },
  { id: "origin", label: "Origin / trust level", kind: "enum", value: (row) => row.origin, renderCell: null },
  { id: "details", label: "Details", kind: "text", value: (row) => row.details, renderCell: renderDetails },
];

function getActivityRowKey(row: ActivityRow): string {
  return row.key;
}

function getActivityRowClassName(): string {
  return "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected user activity query error.";
}

export function ActivityTab(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadActivityFirstPage(config, userId).then((page) => {
      if (cancelled) return;
      setLoadState({
        status: "ready",
        totalCount: page.totalCount,
        rows: page.rows,
        hasOlderRows: page.rows.length === activityPageSize,
        olderPage: { status: "idle" },
      });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLoadState({ status: "error", message: getErrorMessage(error) });
    });
    return () => { cancelled = true; };
  }, [config, userId, onTerminalAdminError, revision]);

  // The button is disabled while a page is in flight, so the cursor is always the last row on screen.
  function loadOlderRows(): void {
    if (loadState.status !== "ready") return;
    const lastRow = loadState.rows[loadState.rows.length - 1];
    if (lastRow === undefined) return;
    setLoadState({ ...loadState, olderPage: { status: "loading" } });
    void loadActivityOlderPage(config, userId, { occurredAt: lastRow.occurredAt, key: lastRow.key }).then((olderRows) => {
      setLoadState((current) => current.status !== "ready" ? current : {
        ...current,
        rows: [...current.rows, ...olderRows],
        hasOlderRows: olderRows.length === activityPageSize,
        olderPage: { status: "idle" },
      });
    }).catch((error: unknown) => {
      if (onTerminalAdminError(error, config)) return;
      setLoadState((current) => current.status !== "ready" ? current : {
        ...current,
        olderPage: { status: "error", message: getErrorMessage(error) },
      });
    });
  }

  if (loadState.status === "loading") {
    return <p className="report-state" aria-live="polite">Loading activity…</p>;
  }

  if (loadState.status === "error") {
    return (
      <div className="report-state report-state-error">
        <strong>User activity query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="activity-tab" data-testid="user-activity">
      <p className="dashboard-section-description">
        Every analytics event credited to this person, every trust level included, plus their purchases, grants and feedback, newest first. Reviews, cards and AI chat appear as their analytics events.
      </p>
      <div className="activity-paging">
        <span className="hero-badge" data-testid="user-activity-loaded-count">
          Loaded {loadState.rows.length.toLocaleString("en-US")} of {loadState.totalCount.toLocaleString("en-US")} total
        </span>
        <span className="activity-paging-note">Sorting and filtering apply to the loaded rows only.</span>
        <button
          className="filter-button filter-button-compact"
          type="button"
          data-testid="user-activity-load-older"
          disabled={!loadState.hasOlderRows || loadState.olderPage.status === "loading"}
          onClick={loadOlderRows}
        >{loadState.olderPage.status === "loading" ? "Loading older…" : `Load older ${activityPageSize.toLocaleString("en-US")}`}</button>
        {loadState.olderPage.status === "error"
          ? <span className="activity-paging-error" role="alert">Loading older rows failed: {loadState.olderPage.message}</span>
          : null}
      </div>
      <DataTable
        testId="user-activity-table"
        columns={activityColumns}
        rows={loadState.rows}
        rowKey={getActivityRowKey}
        rowClassName={getActivityRowClassName}
        state={tableState}
        onStateChange={setTableState}
      />
    </div>
  );
}
