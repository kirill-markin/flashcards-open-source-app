import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { AdminAppConfig } from "../config";
import { AdminLink } from "../navigation/AdminLink";
import { AdminNavigation } from "../navigation/AdminNavigation";
import { eventsPath, getEventPath } from "../routing";
import { DataTable } from "../table/DataTable";
import {
  clampDataTablePage,
  parseDataTableState,
  toDataTableSearchParams,
  type DataTableColumn,
  type DataTableState,
} from "../table/dataTableModel";
import { JsonPreviewCell } from "../table/JsonPreviewCell";
import { renderUserLink } from "../users/UsersPage";
import {
  emptyEventsEnumOptions,
  loadEventsEnumOptions,
  loadEventsPage,
  type EventRow,
  type EventsEnumOptions,
  type EventsPageResult,
} from "./eventsQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: EventsPageResult;
    isLoading: boolean;
    /** A reload that failed while the previous page stays on screen; cleared only by a later success. */
    reloadError: string | null;
  }>;

type EnumOptionsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; options: EventsEnumOptions }>;

// Every state change is a query, so a burst of keystrokes in a filter would be a burst of queries. The
// newest state waits this long before it is sent, and the ones it superseded never reach the network.
const tableReloadDebounceMs = 300;

// The column ids are the URL vocabulary of the table state, so renaming one breaks saved links; each
// one's SQL is `eventColumnSqlById`.
function buildEventColumns(onNavigate: (path: string) => void): ReadonlyArray<DataTableColumn<EventRow>> {
  return [
    {
      id: "event-id",
      label: "Event ID",
      kind: "text",
      value: (event) => event.eventId,
      renderCell: (event) => (
        <AdminLink className="data-table-link" path={getEventPath(event.eventId)} onNavigate={onNavigate}>{event.eventId}</AdminLink>
      ),
    },
    { id: "occurred", label: "Occurred at (UTC)", kind: "date", value: (event) => event.occurredAt, renderCell: null },
    { id: "received", label: "Received at (UTC)", kind: "date", value: (event) => event.serverReceivedAt, renderCell: null },
    { id: "event", label: "Event", kind: "enum", value: (event) => event.eventName, renderCell: null },
    { id: "actor-id", label: "Actor ID", kind: "text", value: (event) => event.actorId, renderCell: (event) => renderUserLink(event.actorId, event.actorId, onNavigate) },
    { id: "actor-email", label: "Actor email", kind: "text", value: (event) => event.actorEmail, renderCell: (event) => renderUserLink(event.actorId, event.actorEmail, onNavigate) },
    { id: "user-id", label: "Recorded user ID", kind: "text", value: (event) => event.userId, renderCell: (event) => renderUserLink(event.userId, event.userId, onNavigate) },
    { id: "platform", label: "Platform", kind: "enum", value: (event) => event.platform, renderCell: null },
    { id: "app-version", label: "App version", kind: "enum", value: (event) => event.appVersion, renderCell: null },
    { id: "screen", label: "Screen", kind: "enum", value: (event) => event.screen, renderCell: null },
    { id: "country", label: "Country", kind: "enum", value: (event) => event.country, renderCell: null },
    { id: "ui-locale", label: "UI locale", kind: "enum", value: (event) => event.uiLocale, renderCell: null },
    { id: "origin", label: "Origin", kind: "enum", value: (event) => event.origin, renderCell: null },
    { id: "trust-level", label: "Trust level", kind: "enum", value: (event) => event.trustLevel, renderCell: null },
    { id: "identity-state", label: "Identity state", kind: "enum", value: (event) => event.identityState, renderCell: null },
    { id: "session", label: "Session ID", kind: "text", value: (event) => event.sessionId, renderCell: null },
    { id: "excluded", label: "Excluded", kind: "boolean", value: (event) => event.exclusionReason !== null, renderCell: null },
    { id: "exclusion-reason", label: "Exclusion reason", kind: "enum", value: (event) => event.exclusionReason, renderCell: null },
    { id: "properties", label: "Properties", kind: "text", value: (event) => event.eventProperties, renderCell: (event) => <JsonPreviewCell json={event.eventProperties} /> },
  ];
}

const tableParamPrefix = "";

/** The table state as the list's query string, `?` included, or `""` for the default state. */
function buildEventsListSearch(state: DataTableState, columns: ReadonlyArray<DataTableColumn<EventRow>>): string {
  const search = toDataTableSearchParams(state, columns, tableParamPrefix).toString();
  return search === "" ? "" : `?${search}`;
}

function getEventRowKey(event: EventRow): string {
  return event.eventId;
}

function getEventRowClassName(event: EventRow): string {
  return event.exclusionReason === null ? "" : "data-table-row-muted";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Events query error.";
}

/**
 * Every analytics event, sorted, filtered and paged in SQL over the whole history; an unsorted table is
 * newest first. The enum option lists are fetched once on entry, apart from the pages: their query scans the
 * whole history, so the rows never wait for it, and its failure only empties the enum filters.
 */
export function EventsPage(props: Readonly<{
  config: AdminAppConfig;
  adminEmail: string;
  onNavigate: (path: string) => void;
  /** Receives the list path with its table state on entry and after every table change. */
  onListPathChange: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, onListPathChange, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const eventColumns = useMemo(() => buildEventColumns(props.onNavigate), [props.onNavigate]);
  // Read once on entry, so Back from a later page restores the list exactly as it was left.
  const [tableState, setTableState] = useState<DataTableState>(
    () => parseDataTableState(new URLSearchParams(window.location.search), eventColumns, tableParamPrefix),
  );
  const [enumOptionsState, setEnumOptionsState] = useState<EnumOptionsState>({ status: "loading" });
  const [enumOptionsRevision, setEnumOptionsRevision] = useState<number>(0);
  // Only a table that already shows a page waits for the debounce; the first load has nothing to coalesce.
  const hasLoadedPageRef = useRef<boolean>(false);

  const listPath = `${eventsPath}${buildEventsListSearch(tableState, eventColumns)}`;
  useEffect(() => {
    onListPathChange(listPath);
  }, [listPath, onListPathChange]);

  // Replaces rather than pushes, as the analytics filters do, so Back leaves the page instead of
  // stepping through every sort and filter click.
  const replaceTableState = useCallback((nextState: DataTableState): void => {
    setTableState(nextState);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${buildEventsListSearch(nextState, eventColumns)}${window.location.hash}`,
    );
  }, [eventColumns]);

  // Blind to the table state, so neither a table change nor the clamp re-request asks for them again.
  useEffect(() => {
    let isSuperseded = false;
    setEnumOptionsState({ status: "loading" });

    async function loadEnumOptions(): Promise<void> {
      try {
        const options = await loadEventsEnumOptions(config);
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
  }, [config, enumOptionsRevision, onTerminalAdminError]);

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
        const result = await loadEventsPage(config, requestedState, eventColumns);
        if (isSuperseded) return;
        // A page past the end, from a shrunken total or a hand-edited link, is asked for again as the
        // last page the table shows instead.
        const clampedPage = clampDataTablePage(requestedState.page, result.totalCount);
        if (clampedPage !== requestedState.page) {
          replaceTableState({ ...requestedState, page: clampedPage });
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
  }, [config, eventColumns, onTerminalAdminError, replaceTableState, revision, tableState]);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Events</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">All dates and times in UTC</span>
          {loadState.status === "ready" ? <span className="hero-badge">Generated {loadState.result.generatedAtUtc}</span> : null}
        </div>
      </section>

      <AdminNavigation activePage="events" onNavigate={props.onNavigate} />

      <section className="dashboard-section" data-testid="events-section">
        <header className="dashboard-section-header">
          <p className="dashboard-section-description">Every analytics event at every trust level, newest first, billing facts and cookieless visitor rows included. People the analytics exclusion rule drops from every report are listed too, dimmed, with the reason. Sorting, filters and pages apply to the whole history.</p>
        </header>
        {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading events…</p> : null}
        {loadState.status === "error" ? <div className="report-state report-state-error">
          <strong>Events query failed.</strong><span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {loadState.status === "ready" && loadState.reloadError !== null ? <div className="report-state report-state-error" role="alert" data-testid="events-reload-error">
          <strong>Events query failed; the rows below are from the previous query.</strong><span>{loadState.reloadError}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {enumOptionsState.status === "error" ? <div className="report-state report-state-error" role="alert" data-testid="events-enum-options-error">
          <strong>Filter options query failed; the enum column filters list no values until it succeeds.</strong><span>{enumOptionsState.message}</span>
          <button className="filter-button" type="button" onClick={() => setEnumOptionsRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {loadState.status === "ready" ? <DataTable
          testId="events-table"
          columns={eventColumns}
          rows={loadState.result.rows}
          rowKey={getEventRowKey}
          rowClassName={getEventRowClassName}
          state={tableState}
          onStateChange={replaceTableState}
          server={{
            totalCount: loadState.result.totalCount,
            enumOptionsByColumnId: enumOptionsState.status === "ready" ? enumOptionsState.options : emptyEventsEnumOptions,
            isLoading: loadState.isLoading,
          }}
        /> : null}
      </section>
    </main>
  );
}
