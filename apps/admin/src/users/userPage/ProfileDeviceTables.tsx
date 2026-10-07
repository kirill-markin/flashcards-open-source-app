import { useEffect, useRef, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { DataTable } from "../../table/DataTable";
import {
  clampDataTablePage,
  parseDataTableState,
  toDataTableSearchParams,
  type DataTableColumn,
  type DataTableState,
} from "../../table/dataTableModel";
import { emptyEnumOptions } from "../../table/dataTableServerQuery";
import {
  installationProfilesQuery,
  installationsQuery,
  loadDeviceListEnumOptions,
  loadDeviceListPage,
  replicasQuery,
  type DeviceListPageResult,
  type DeviceListQuery,
  type InstallationProfileRow,
  type InstallationRow,
  type ReplicaRow,
} from "./profileDevicesQuery";

type LoadState<Row> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: DeviceListPageResult<Row>;
    /** The page was asked for without filters and matched nothing, so the person has no rows at all. */
    hasNoRows: boolean;
    isLoading: boolean;
    /** A reload that failed while the previous page stays on screen; cleared only by a later success. */
    reloadError: string | null;
  }>;

type EnumOptionsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; options: ReadonlyMap<string, ReadonlyArray<string>> }>;

// Every state change is a query, so a burst of keystrokes in a filter would be a burst of queries. The
// newest state waits this long before it is sent, and the ones it superseded never reach the network.
const tableReloadDebounceMs = 300;

/**
 * `paramPrefix` keeps each table's state apart in the shared URL; it and the column ids are URL
 * vocabulary, so renaming one breaks saved links. Each column's SQL is the query's `columnSqlById`.
 */
type ProfileDeviceList<Row> = Readonly<{
  id: string;
  title: string;
  paramPrefix: string;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rowKey: (row: Row) => string;
  query: DeviceListQuery<Row>;
}>;

const installationsList: ProfileDeviceList<InstallationRow> = {
  id: "installations",
  title: "Devices: sync installations",
  paramPrefix: "installations.",
  columns: [
    { id: "installation-id", label: "Installation ID", kind: "text", value: (row) => row.installationId, renderCell: null },
    { id: "platform", label: "Platform", kind: "enum", value: (row) => row.platform, renderCell: null },
    { id: "app-version", label: "App version", kind: "enum", value: (row) => row.appVersion, renderCell: null },
    { id: "automation", label: "Automation", kind: "boolean", value: (row) => row.isAutomation, renderCell: null },
    { id: "created", label: "Created", kind: "date", value: (row) => row.createdAt, renderCell: null },
    { id: "last-seen", label: "Last seen", kind: "date", value: (row) => row.lastSeenAt, renderCell: null },
  ],
  rowKey: (row) => row.installationId,
  query: installationsQuery,
};

const installationProfilesList: ProfileDeviceList<InstallationProfileRow> = {
  id: "installation-profiles",
  title: "Devices: analytics installation profiles",
  paramPrefix: "installation-profiles.",
  columns: [
    { id: "anonymous-id", label: "Anonymous ID", kind: "text", value: (row) => row.anonymousId, renderCell: null },
    { id: "platform", label: "Platform", kind: "enum", value: (row) => row.platform, renderCell: null },
    { id: "app-version", label: "App version", kind: "enum", value: (row) => row.appVersion, renderCell: null },
    { id: "os-version", label: "OS version", kind: "enum", value: (row) => row.osVersion, renderCell: null },
    { id: "device-locale", label: "Device locale", kind: "enum", value: (row) => row.deviceLocale, renderCell: null },
    { id: "timezone", label: "Time zone", kind: "enum", value: (row) => row.timeZone, renderCell: null },
    { id: "first-country", label: "First country", kind: "enum", value: (row) => row.firstCountry, renderCell: null },
    { id: "first-seen", label: "First seen", kind: "date", value: (row) => row.firstSeenAt, renderCell: null },
    { id: "last-seen", label: "Last seen", kind: "date", value: (row) => row.lastSeenAt, renderCell: null },
  ],
  rowKey: (row) => `${row.anonymousId}:${row.platform}`,
  query: installationProfilesQuery,
};

const replicasList: ProfileDeviceList<ReplicaRow> = {
  id: "replicas",
  title: "Devices: workspace replicas",
  paramPrefix: "replicas.",
  columns: [
    { id: "replica-id", label: "Replica ID", kind: "text", value: (row) => row.replicaId, renderCell: null },
    { id: "workspace-id", label: "Workspace ID", kind: "text", value: (row) => row.workspaceId, renderCell: null },
    { id: "actor-kind", label: "Actor kind", kind: "enum", value: (row) => row.actorKind, renderCell: null },
    { id: "installation-id", label: "Installation ID", kind: "text", value: (row) => row.installationId, renderCell: null },
    { id: "platform", label: "Platform", kind: "enum", value: (row) => row.platform, renderCell: null },
    { id: "app-version", label: "App version", kind: "enum", value: (row) => row.appVersion, renderCell: null },
    { id: "created", label: "Created", kind: "date", value: (row) => row.createdAt, renderCell: null },
    { id: "last-seen", label: "Last seen", kind: "date", value: (row) => row.lastSeenAt, renderCell: null },
  ],
  rowKey: (row) => row.replicaId,
  query: replicasQuery,
};

/**
 * Replaces rather than pushes, as the Users list does, so Back leaves the page instead of stepping
 * through every click; only this table's parameters change, so the other tables keep theirs.
 */
function writeTableStateToUrl<Row>(state: DataTableState, list: ProfileDeviceList<Row>): void {
  const searchParams = new URLSearchParams(
    [...new URLSearchParams(window.location.search)].filter(([key]) => !key.startsWith(list.paramPrefix)),
  );
  toDataTableSearchParams(state, list.columns, list.paramPrefix).forEach((value, key) => {
    searchParams.append(key, value);
  });
  const search = searchParams.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`);
}

function getRowClassName(): string {
  return "";
}

function getErrorMessage(error: unknown, label: string): string {
  return error instanceof Error ? error.message : `Unexpected ${label} query error.`;
}

/**
 * The person's rows of one device list, sorted, filtered and paged in SQL; an unsorted table is most
 * recently seen first. The enum option lists are fetched once on entry, apart from the pages, so the
 * rows never wait for them and their failure only empties the enum filters.
 */
function ProfileDeviceTable<Row>(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  list: ProfileDeviceList<Row>;
  isActive: boolean;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, list, isActive, onTerminalAdminError } = props;
  const label = list.query.label;
  const [loadState, setLoadState] = useState<LoadState<Row>>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  // Read once on entry, so Back from a later page restores the table exactly as it was left.
  const [tableState, setTableState] = useState<DataTableState>(
    () => parseDataTableState(new URLSearchParams(window.location.search), list.columns, list.paramPrefix),
  );
  const [enumOptionsState, setEnumOptionsState] = useState<EnumOptionsState>({ status: "loading" });
  const [enumOptionsRevision, setEnumOptionsRevision] = useState<number>(0);
  // Only a table that already shows a page waits for the debounce; the first load has nothing to coalesce.
  const hasLoadedPageRef = useRef<boolean>(false);

  // The URL belongs to the tab on screen: a hidden table only keeps its state, and writes it back each
  // time the Profile tab is shown again.
  useEffect(() => {
    if (isActive) writeTableStateToUrl(tableState, list);
  }, [isActive, list, tableState]);

  // Blind to the table state, so neither a table change nor the clamp re-request asks for them again.
  useEffect(() => {
    let isSuperseded = false;
    setEnumOptionsState({ status: "loading" });

    async function loadEnumOptions(): Promise<void> {
      try {
        const options = await loadDeviceListEnumOptions(config, userId, list.query);
        if (isSuperseded) return;
        setEnumOptionsState({ status: "ready", options });
      } catch (error: unknown) {
        if (isSuperseded || onTerminalAdminError(error, config)) return;
        setEnumOptionsState({ status: "error", message: getErrorMessage(error, label) });
      }
    }

    void loadEnumOptions();
    return () => {
      isSuperseded = true;
    };
  }, [config, enumOptionsRevision, label, list, onTerminalAdminError, userId]);

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
        const result = await loadDeviceListPage(config, userId, list.query, requestedState, list.columns);
        if (isSuperseded) return;
        // A page past the end, from a shrunken total or a hand-edited link, is asked for again as the
        // last page the table shows instead.
        const clampedPage = clampDataTablePage(requestedState.page, result.totalCount);
        if (clampedPage !== requestedState.page) {
          setTableState({ ...requestedState, page: clampedPage });
          return;
        }
        hasLoadedPageRef.current = true;
        setLoadState({
          status: "ready",
          result,
          hasNoRows: result.totalCount === 0 && Object.keys(requestedState.filters).length === 0,
          isLoading: false,
          reloadError: null,
        });
      } catch (error: unknown) {
        if (isSuperseded || onTerminalAdminError(error, config)) return;
        const message = getErrorMessage(error, label);
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
  }, [config, label, list, onTerminalAdminError, revision, tableState, userId]);

  const testId = `user-profile-${list.id}`;
  return (
    <section className="profile-section profile-section-list" data-testid={testId}>
      <h2>{list.title}</h2>
      {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading rows…</p> : null}
      {loadState.status === "error" ? <div className="report-state report-state-error">
        <strong>{label} query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" && loadState.reloadError !== null ? <div className="report-state report-state-error" role="alert" data-testid={`${testId}-reload-error`}>
        <strong>{label} query failed; the rows below are from the previous query.</strong><span>{loadState.reloadError}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {enumOptionsState.status === "error" ? <div className="report-state report-state-error" role="alert" data-testid={`${testId}-enum-options-error`}>
        <strong>Filter options query failed; the enum column filters list no values until it succeeds.</strong><span>{enumOptionsState.message}</span>
        <button className="filter-button" type="button" onClick={() => setEnumOptionsRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" ? (loadState.hasNoRows ? <p className="profile-section-empty">None.</p> : <DataTable
        testId={`${testId}-table`}
        columns={list.columns}
        rows={loadState.result.rows}
        rowKey={list.rowKey}
        rowClassName={getRowClassName}
        state={tableState}
        onStateChange={setTableState}
        server={{
          totalCount: loadState.result.totalCount,
          enumOptionsByColumnId: enumOptionsState.status === "ready" ? enumOptionsState.options : emptyEnumOptions(list.query.enumColumnIds),
          isLoading: loadState.isLoading,
        }}
      />) : null}
    </section>
  );
}

/** The device lists, each its own query, after the profile sections so their loading moves nothing above them. */
export function ProfileDeviceTables(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  /** Whether the Profile tab is the one shown; it stays mounted while hidden. */
  isActive: boolean;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      <ProfileDeviceTable config={props.config} userId={props.userId} list={installationsList} isActive={props.isActive} onTerminalAdminError={props.onTerminalAdminError} />
      <ProfileDeviceTable config={props.config} userId={props.userId} list={installationProfilesList} isActive={props.isActive} onTerminalAdminError={props.onTerminalAdminError} />
      <ProfileDeviceTable config={props.config} userId={props.userId} list={replicasList} isActive={props.isActive} onTerminalAdminError={props.onTerminalAdminError} />
    </>
  );
}
