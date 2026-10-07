import { useEffect, useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../config";
import { AdminLink } from "../navigation/AdminLink";
import { AdminNavigation } from "../navigation/AdminNavigation";
import { getUserPath, usersPath } from "../routing";
import { DataTable } from "../table/DataTable";
import {
  parseDataTableState,
  toDataTableSearchParams,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableState,
} from "../table/dataTableModel";
import { loadUsersReport, type UserRow, type UsersReport } from "./usersQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: UsersReport }>;

export function renderUserLink(userId: string | null, text: string | null, onNavigate: (path: string) => void): JSX.Element | null {
  return userId === null || text === null ? null : (
    <AdminLink className="data-table-link" path={getUserPath(userId, "profile")} onNavigate={onNavigate}>{text}</AdminLink>
  );
}

const mergedGuestColumnId = "merged-guest";

// The column ids are the URL vocabulary of the table state, so renaming one breaks saved links.
function buildUserColumns(onNavigate: (path: string) => void): ReadonlyArray<DataTableColumn<UserRow>> {
  return [
    { id: "user-id", label: "User ID", kind: "text", value: (user) => user.userId, renderCell: (user) => renderUserLink(user.userId, user.userId, onNavigate) },
    { id: "email", label: "Email", kind: "text", value: (user) => user.email, renderCell: (user) => renderUserLink(user.userId, user.email, onNavigate) },
    { id: "kind", label: "Kind", kind: "enum", value: (user) => user.kind, renderCell: null },
    { id: mergedGuestColumnId, label: "Merged guest", kind: "boolean", value: (user) => user.mergedIntoUserId !== null, renderCell: null },
    { id: "merged-into", label: "Merged into", kind: "text", value: (user) => user.mergedIntoUserId, renderCell: (user) => renderUserLink(user.mergedIntoUserId, user.mergedIntoUserId, onNavigate) },
    { id: "excluded", label: "Excluded", kind: "boolean", value: (user) => user.exclusionReason.length > 0, renderCell: null },
    { id: "exclusion-reason", label: "Exclusion reason", kind: "enum-list", value: (user) => user.exclusionReason, renderCell: null },
    { id: "created", label: "Created", kind: "date", value: (user) => user.createdAt, renderCell: null },
    { id: "first-seen", label: "First seen", kind: "date", value: (user) => user.firstSeenAt, renderCell: null },
    { id: "last-active", label: "Last active", kind: "date", value: (user) => user.lastActiveAt, renderCell: null },
    { id: "active-days", label: "Active days", kind: "number", value: (user) => user.activeDays, renderCell: null },
    { id: "events", label: "Events", kind: "number", value: (user) => user.eventCount, renderCell: null },
    { id: "platforms", label: "Platforms", kind: "enum-list", value: (user) => user.platforms, renderCell: null },
    { id: "app-version", label: "Latest app version", kind: "enum", value: (user) => user.latestAppVersion, renderCell: null },
    { id: "countries", label: "Countries (90 days)", kind: "enum-list", value: (user) => user.connectionCountries, renderCell: null },
    { id: "ui-locale", label: "Latest UI locale", kind: "enum", value: (user) => user.latestUiLocale, renderCell: null },
    { id: "settings-locale", label: "Saved app language", kind: "enum", value: (user) => user.settingsLocale, renderCell: null },
    { id: "reviews", label: "Reviews", kind: "number", value: (user) => user.reviewCount, renderCell: null },
    { id: "cards", label: "Live cards", kind: "number", value: (user) => user.cardCount, renderCell: null },
    { id: "decks", label: "Live decks", kind: "number", value: (user) => user.deckCount, renderCell: null },
    { id: "ai-messages", label: "AI messages sent", kind: "number", value: (user) => user.aiUserMessageCount, renderCell: null },
    { id: "ai-chars", label: "AI chat characters", kind: "number", value: (user) => user.aiCharacterCount, renderCell: null },
    { id: "ever-purchased", label: "Ever purchased", kind: "date", value: (user) => user.everPurchasedAt, renderCell: null },
    { id: "trial-consumed", label: "Trial consumed", kind: "date", value: (user) => user.trialConsumedAt, renderCell: null },
    { id: "purchase-tier", label: "Latest purchase tier", kind: "enum", value: (user) => user.latestPurchaseTier, renderCell: null },
    { id: "purchase-status", label: "Latest purchase status", kind: "enum", value: (user) => user.latestPurchaseStatus, renderCell: null },
    { id: "grant-tiers", label: "Active grant tiers", kind: "enum-list", value: (user) => user.activeGrantTiers, renderCell: null },
    { id: "feedback", label: "Feedback", kind: "number", value: (user) => user.feedbackCount, renderCell: null },
    { id: "friends", label: "Friends", kind: "number", value: (user) => user.friendCount, renderCell: null },
    { id: "leaderboard", label: "Leaderboard", kind: "boolean", value: (user) => user.leaderboardParticipation, renderCell: null },
    { id: "product-analytics", label: "Product analytics", kind: "enum", value: (user) => user.productAnalytics, renderCell: null },
  ];
}

const tableParamPrefix = "";

// Merged guests are hidden by default through an ordinary `Merged guest = no` filter. A URL without
// its parameter carries that default, so the default state stays the bare path, and a cleared filter
// is written as `any`, a value the table's codec ignores, so it survives a reload or a shared link.
const mergedGuestFilterParam = `${tableParamPrefix}f.${mergedGuestColumnId}`;
const mergedGuestFilterClearedValue = "any";
const hiddenMergedGuestsFilter: DataTableFilter = { kind: "boolean", value: false };

function parseUsersListState(searchParams: URLSearchParams, columns: ReadonlyArray<DataTableColumn<UserRow>>): DataTableState {
  const state = parseDataTableState(searchParams, columns, tableParamPrefix);
  return searchParams.has(mergedGuestFilterParam)
    ? state
    : { ...state, filters: { ...state.filters, [mergedGuestColumnId]: hiddenMergedGuestsFilter } };
}

/** The table state as the list's query string, `?` included, or `""` for the default state. */
function buildUsersListSearch(state: DataTableState, columns: ReadonlyArray<DataTableColumn<UserRow>>): string {
  const searchParams = toDataTableSearchParams(state, columns, tableParamPrefix);
  const mergedGuestFilter = state.filters[mergedGuestColumnId];
  if (mergedGuestFilter === undefined) {
    searchParams.set(mergedGuestFilterParam, mergedGuestFilterClearedValue);
  } else if (mergedGuestFilter.kind === "boolean" && !mergedGuestFilter.value) {
    searchParams.delete(mergedGuestFilterParam);
  }
  const search = searchParams.toString();
  return search === "" ? "" : `?${search}`;
}

function getUserRowKey(user: UserRow): string {
  return user.userId;
}

function getUserRowClassName(user: UserRow): string {
  return user.exclusionReason.length > 0 ? "data-table-row-muted" : "";
}

export function UsersPage(props: Readonly<{
  config: AdminAppConfig;
  adminEmail: string;
  onNavigate: (path: string) => void;
  /** Receives the list path with its table state on entry and after every table change. */
  onListPathChange: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const userColumns = useMemo(() => buildUserColumns(props.onNavigate), [props.onNavigate]);
  // Read once on entry, so Back from a later page restores the list exactly as it was left.
  const [tableState, setTableState] = useState<DataTableState>(
    () => parseUsersListState(new URLSearchParams(window.location.search), userColumns),
  );

  const { onListPathChange } = props;
  const listPath = `${usersPath}${buildUsersListSearch(tableState, userColumns)}`;
  useEffect(() => {
    onListPathChange(listPath);
  }, [listPath, onListPathChange]);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadUsersReport(props.config).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Users query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.onTerminalAdminError, revision]);

  // Replaces rather than pushes, as the analytics filters do, so Back leaves the page instead of
  // stepping through every sort and filter click.
  function handleTableStateChange(nextState: DataTableState): void {
    setTableState(nextState);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${buildUsersListSearch(nextState, userColumns)}${window.location.hash}`,
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Users</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">All dates and times in UTC</span>
          {loadState.status === "ready" ? <span className="hero-badge">Generated {loadState.report.generatedAtUtc}</span> : null}
        </div>
      </section>

      <AdminNavigation activePage="users" onNavigate={props.onNavigate} />

      <section className="dashboard-section" data-testid="users-section">
        <header className="dashboard-section-header">
          <p className="dashboard-section-description">Every live account and guest, one row per settings row; a deleted account is not listed, and a guest merged into an account is hidden until the Merged guest filter is cleared. People the analytics exclusion rule drops from every report are listed too, dimmed, with the reason. Activity comes from analytics events credited to the row's own id, so a guest merged into an account shows its activity on that account's row instead. Countries come from connection samples, which are kept for 90 days.</p>
        </header>
        {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading users…</p> : null}
        {loadState.status === "error" ? <div className="report-state report-state-error">
          <strong>Users query failed.</strong><span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {loadState.status === "ready" ? <DataTable
          testId="users-table"
          columns={userColumns}
          rows={loadState.report.users}
          rowKey={getUserRowKey}
          rowClassName={getUserRowClassName}
          state={tableState}
          onStateChange={handleTableStateChange}
          server={null}
        /> : null}
      </section>
    </main>
  );
}
