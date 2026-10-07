import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { AdminAppConfig } from "../config";
import { AdminLink } from "../navigation/AdminLink";
import { AdminNavigation } from "../navigation/AdminNavigation";
import { getUserPath, usersPath } from "../routing";
import { DataTable } from "../table/DataTable";
import {
  clampDataTablePage,
  parseDataTableState,
  toDataTableSearchParams,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableState,
} from "../table/dataTableModel";
import {
  emptyUsersEnumOptions,
  loadUsersEnumOptions,
  loadUsersPage,
  type UserRow,
  type UsersEnumOptions,
  type UsersPageResult,
} from "./usersQuery";
import { userSettingsFields, type UserSettingsField } from "./userSettingsFields";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: UsersPageResult;
    isLoading: boolean;
    /** A reload that failed while the previous page stays on screen; cleared only by a later success. */
    reloadError: string | null;
  }>;

type EnumOptionsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; options: UsersEnumOptions }>;

// Every state change is a query, so a burst of keystrokes in a filter would be a burst of queries. The
// newest state waits this long before it is sent, and the ones it superseded never reach the network.
const tableReloadDebounceMs = 300;

export function renderUserLink(userId: string | null, text: string | null, onNavigate: (path: string) => void): JSX.Element | null {
  return userId === null || text === null ? null : (
    <AdminLink className="data-table-link" path={getUserPath(userId, "profile")} onNavigate={onNavigate}>{text}</AdminLink>
  );
}

const mergedGuestColumnId = "merged-guest";

function buildUserSettingsColumn(field: UserSettingsField): DataTableColumn<UserRow> {
  const base = { id: field.id, label: field.label, value: (user: UserRow) => user.settings[field.id], renderCell: null };
  switch (field.kind) {
    case "text":
      return { ...base, kind: "text" };
    case "date":
      return { ...base, kind: "date" };
    case "enum":
    case "boolean":
      return { ...base, kind: "enum" };
  }
}

// The column ids are the URL vocabulary of the table state, so renaming one breaks saved links; each
// one's SQL is `columnSqlById` in `usersQuery.ts`.
function buildUserColumns(onNavigate: (path: string) => void): ReadonlyArray<DataTableColumn<UserRow>> {
  return [
    { id: "user-id", label: "User ID", kind: "text", value: (user) => user.userId, renderCell: (user) => renderUserLink(user.userId, user.userId, onNavigate) },
    { id: "email", label: "Email", kind: "text", value: (user) => user.email, renderCell: (user) => renderUserLink(user.userId, user.email, onNavigate) },
    { id: "kind", label: "Kind", kind: "enum", value: (user) => user.kind, renderCell: null },
    { id: mergedGuestColumnId, label: "Merged guest", kind: "boolean", value: (user) => user.mergedIntoUserId !== null, renderCell: null },
    { id: "merged-into", label: "Merged into", kind: "text", value: (user) => user.mergedIntoUserId, renderCell: (user) => renderUserLink(user.mergedIntoUserId, user.mergedIntoUserId, onNavigate) },
    { id: "guests-merged-in", label: "Guests merged in", kind: "number", value: (user) => user.guestsMergedInCount, renderCell: null },
    { id: "guest-sessions", label: "Guest sessions", kind: "number", value: (user) => user.guestSessionCount, renderCell: null },
    { id: "excluded", label: "Excluded", kind: "boolean", value: (user) => user.exclusionReason.length > 0, renderCell: null },
    { id: "exclusion-reason", label: "Exclusion reason", kind: "enum-list", value: (user) => user.exclusionReason, renderCell: null },
    { id: "exclusion-list-entries", label: "Exclusion list entries", kind: "number", value: (user) => user.exclusionListEntryCount, renderCell: null },
    { id: "created", label: "Created", kind: "date", value: (user) => user.createdAt, renderCell: null },
    { id: "identity-created", label: "Sign-in identity created", kind: "date", value: (user) => user.identityCreatedAt, renderCell: null },
    { id: "first-seen", label: "First seen (trusted)", kind: "date", value: (user) => user.firstSeenAt, renderCell: null },
    { id: "last-active", label: "Last active (trusted)", kind: "date", value: (user) => user.lastActiveAt, renderCell: null },
    { id: "active-days", label: "Active days (trusted)", kind: "number", value: (user) => user.activeDays, renderCell: null },
    { id: "events", label: "Events (trusted)", kind: "number", value: (user) => user.eventCount, renderCell: null },
    { id: "first-seen-every-trust", label: "First seen (every trust level)", kind: "date", value: (user) => user.everyTrustFirstSeenAt, renderCell: null },
    { id: "last-seen-every-trust", label: "Last seen (every trust level)", kind: "date", value: (user) => user.everyTrustLastSeenAt, renderCell: null },
    { id: "active-days-every-trust", label: "Active days (every trust level)", kind: "number", value: (user) => user.everyTrustActiveDays, renderCell: null },
    { id: "events-every-trust", label: "Events (every trust level)", kind: "number", value: (user) => user.everyTrustEventCount, renderCell: null },
    { id: "platforms", label: "Platforms", kind: "enum-list", value: (user) => user.platforms, renderCell: null },
    { id: "app-version", label: "Latest app version", kind: "enum", value: (user) => user.latestAppVersion, renderCell: null },
    { id: "countries", label: "Countries (90 days)", kind: "enum-list", value: (user) => user.connectionCountries, renderCell: null },
    { id: "ui-locale", label: "Latest UI locale", kind: "enum", value: (user) => user.latestUiLocale, renderCell: null },
    { id: "reviews", label: "Reviews", kind: "number", value: (user) => user.reviewCount, renderCell: null },
    { id: "cards", label: "Live cards", kind: "number", value: (user) => user.cardCount, renderCell: null },
    { id: "decks", label: "Live decks", kind: "number", value: (user) => user.deckCount, renderCell: null },
    { id: "workspaces", label: "Workspaces", kind: "number", value: (user) => user.workspaceCount, renderCell: null },
    { id: "workspace-name", label: "Current workspace name", kind: "text", value: (user) => user.currentWorkspaceName, renderCell: null },
    { id: "workspace-role", label: "Current workspace role", kind: "enum", value: (user) => user.currentWorkspaceRole, renderCell: null },
    { id: "workspace-members", label: "Current workspace members", kind: "number", value: (user) => user.currentWorkspaceMemberCount, renderCell: null },
    { id: "workspace-fsrs-algorithm", label: "Current workspace FSRS algorithm", kind: "enum", value: (user) => user.currentWorkspaceFsrsAlgorithm, renderCell: null },
    { id: "workspace-desired-retention", label: "Current workspace desired retention", kind: "number", value: (user) => user.currentWorkspaceDesiredRetention, renderCell: null },
    { id: "workspace-learning-steps", label: "Current workspace learning steps (min)", kind: "text", value: (user) => user.currentWorkspaceLearningSteps, renderCell: null },
    { id: "workspace-relearning-steps", label: "Current workspace relearning steps (min)", kind: "text", value: (user) => user.currentWorkspaceRelearningSteps, renderCell: null },
    { id: "workspace-maximum-interval", label: "Current workspace maximum interval (days)", kind: "number", value: (user) => user.currentWorkspaceMaximumIntervalDays, renderCell: null },
    { id: "workspace-fuzz", label: "Current workspace fuzz", kind: "boolean", value: (user) => user.currentWorkspaceFuzz, renderCell: null },
    { id: "workspace-fsrs-updated", label: "Current workspace FSRS updated", kind: "date", value: (user) => user.currentWorkspaceFsrsUpdatedAt, renderCell: null },
    { id: "ai-messages", label: "AI messages sent", kind: "number", value: (user) => user.aiUserMessageCount, renderCell: null },
    { id: "ai-chars", label: "AI chat characters", kind: "number", value: (user) => user.aiCharacterCount, renderCell: null },
    { id: "ai-calls", label: "AI provider calls", kind: "number", value: (user) => user.aiCallCount, renderCell: null },
    { id: "ai-input-tokens", label: "AI input tokens", kind: "number", value: (user) => user.aiInputTokens, renderCell: null },
    { id: "ai-output-tokens", label: "AI output tokens", kind: "number", value: (user) => user.aiOutputTokens, renderCell: null },
    { id: "ai-cache-read-tokens", label: "AI cache read tokens", kind: "number", value: (user) => user.aiCacheReadTokens, renderCell: null },
    { id: "ai-cache-write-tokens", label: "AI cache write tokens", kind: "number", value: (user) => user.aiCacheWriteTokens, renderCell: null },
    { id: "ai-reasoning-tokens", label: "AI reasoning tokens", kind: "number", value: (user) => user.aiReasoningTokens, renderCell: null },
    { id: "ever-purchased", label: "Ever purchased", kind: "date", value: (user) => user.everPurchasedAt, renderCell: null },
    { id: "trial-consumed", label: "Trial consumed", kind: "date", value: (user) => user.trialConsumedAt, renderCell: null },
    { id: "trial-provider", label: "Trial provider", kind: "enum", value: (user) => user.trialProvider, renderCell: null },
    { id: "purchases", label: "Purchases", kind: "number", value: (user) => user.purchaseCount, renderCell: null },
    { id: "purchase-tier", label: "Latest purchase tier", kind: "enum", value: (user) => user.latestPurchaseTier, renderCell: null },
    { id: "purchase-status", label: "Latest purchase status", kind: "enum", value: (user) => user.latestPurchaseStatus, renderCell: null },
    { id: "purchase-provider", label: "Latest purchase provider", kind: "enum", value: (user) => user.latestPurchaseProvider, renderCell: null },
    { id: "purchase-kind", label: "Latest purchase kind", kind: "enum", value: (user) => user.latestPurchaseKind, renderCell: null },
    { id: "purchase-environment", label: "Latest purchase environment", kind: "enum", value: (user) => user.latestPurchaseEnvironment, renderCell: null },
    { id: "purchase-trial", label: "Latest purchase trial", kind: "boolean", value: (user) => user.latestPurchaseTrial, renderCell: null },
    { id: "purchase-will-renew", label: "Latest purchase will renew", kind: "boolean", value: (user) => user.latestPurchaseWillRenew, renderCell: null },
    { id: "purchase-until", label: "Latest purchase until", kind: "date", value: (user) => user.latestPurchaseUntil, renderCell: null },
    { id: "purchase-grace-until", label: "Latest purchase grace until", kind: "date", value: (user) => user.latestPurchaseGraceUntil, renderCell: null },
    { id: "grants", label: "Grants", kind: "number", value: (user) => user.grantCount, renderCell: null },
    { id: "grant-tiers", label: "Active grant tiers", kind: "enum-list", value: (user) => user.activeGrantTiers, renderCell: null },
    { id: "feedback", label: "Feedback", kind: "number", value: (user) => user.feedbackCount, renderCell: null },
    { id: "friends", label: "Friends", kind: "number", value: (user) => user.friendCount, renderCell: null },
    { id: "public-profile", label: "Public profile", kind: "boolean", value: (user) => user.hasPublicProfile, renderCell: null },
    { id: "invitations-created", label: "Friend invitations created", kind: "number", value: (user) => user.friendInvitationsCreated, renderCell: null },
    { id: "invitations-accepted-by-others", label: "Their invitations accepted", kind: "number", value: (user) => user.friendInvitationsAcceptedByOthers, renderCell: null },
    { id: "invitations-accepted", label: "Invitations they accepted", kind: "number", value: (user) => user.friendInvitationsAccepted, renderCell: null },
    { id: "leaderboard", label: "Leaderboard", kind: "boolean", value: (user) => user.leaderboardParticipation, renderCell: null },
    ...userSettingsFields.map(buildUserSettingsColumn),
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Users query error.";
}

/**
 * Every user, sorted, filtered and paged in SQL; an unsorted table is newest first. The enum option
 * lists are fetched once on entry, apart from the pages, so the rows never wait for them and their
 * failure only empties the enum filters.
 */
export function UsersPage(props: Readonly<{
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
  const userColumns = useMemo(() => buildUserColumns(props.onNavigate), [props.onNavigate]);
  // Read once on entry, so Back from a later page restores the list exactly as it was left.
  const [tableState, setTableState] = useState<DataTableState>(
    () => parseUsersListState(new URLSearchParams(window.location.search), userColumns),
  );
  const [enumOptionsState, setEnumOptionsState] = useState<EnumOptionsState>({ status: "loading" });
  const [enumOptionsRevision, setEnumOptionsRevision] = useState<number>(0);
  // Only a table that already shows a page waits for the debounce; the first load has nothing to coalesce.
  const hasLoadedPageRef = useRef<boolean>(false);

  const listPath = `${usersPath}${buildUsersListSearch(tableState, userColumns)}`;
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
      `${window.location.pathname}${buildUsersListSearch(nextState, userColumns)}${window.location.hash}`,
    );
  }, [userColumns]);

  // Blind to the table state, so neither a table change nor the clamp re-request asks for them again.
  useEffect(() => {
    let isSuperseded = false;
    setEnumOptionsState({ status: "loading" });

    async function loadEnumOptions(): Promise<void> {
      try {
        const options = await loadUsersEnumOptions(config);
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
        const result = await loadUsersPage(config, requestedState, userColumns);
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
  }, [config, onTerminalAdminError, replaceTableState, revision, tableState, userColumns]);

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
          {loadState.status === "ready" ? <span className="hero-badge">Generated {loadState.result.generatedAtUtc}</span> : null}
        </div>
      </section>

      <AdminNavigation activePage="users" onNavigate={props.onNavigate} />

      <section className="dashboard-section" data-testid="users-section">
        <header className="dashboard-section-header">
          <p className="dashboard-section-description">Every live account and guest, one row per settings row, newest first; a deleted account is not listed, and a guest merged into an account is hidden until the Merged guest filter is cleared. People the analytics exclusion rule drops from every report are listed too, dimmed, with the reason. Activity comes from analytics events credited to the row's own id, so a guest merged into an account shows its activity on that account's row instead. Countries come from connection samples, which are kept for 90 days. Sorting, filters and pages apply to every user.</p>
        </header>
        {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading users…</p> : null}
        {loadState.status === "error" ? <div className="report-state report-state-error">
          <strong>Users query failed.</strong><span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {loadState.status === "ready" && loadState.reloadError !== null ? <div className="report-state report-state-error" role="alert" data-testid="users-reload-error">
          <strong>Users query failed; the rows below are from the previous query.</strong><span>{loadState.reloadError}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {enumOptionsState.status === "error" ? <div className="report-state report-state-error" role="alert" data-testid="users-enum-options-error">
          <strong>Filter options query failed; the enum column filters list no values until it succeeds.</strong><span>{enumOptionsState.message}</span>
          <button className="filter-button" type="button" onClick={() => setEnumOptionsRevision((value) => value + 1)}>Retry</button>
        </div> : null}
        {loadState.status === "ready" ? <DataTable
          testId="users-table"
          columns={userColumns}
          rows={loadState.result.rows}
          rowKey={getUserRowKey}
          rowClassName={getUserRowClassName}
          state={tableState}
          onStateChange={replaceTableState}
          server={{
            totalCount: loadState.result.totalCount,
            enumOptionsByColumnId: enumOptionsState.status === "ready" ? enumOptionsState.options : emptyUsersEnumOptions,
            isLoading: loadState.isLoading,
          }}
        /> : null}
      </section>
    </main>
  );
}
