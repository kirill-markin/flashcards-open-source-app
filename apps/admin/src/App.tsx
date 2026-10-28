import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { AdminApiError, fetchAdminSession, type AdminSession } from "./adminApi";
import { getAdminAppConfig, type AdminAppConfig } from "./config";
import {
  AdminDashboard,
  type AdminReportState,
  type AnalyticsRangeLookup,
} from "./dashboard/AdminDashboard";
import { EventPage } from "./events/eventPage/EventPage";
import { EventsPage } from "./events/EventsPage";
import {
  type AnalyticsDateRange,
  type AnalyticsFilterState,
} from "./filters/analyticsFilters";
import {
  buildAnalyticsAreaDefaultDateRange,
  normalizeAnalyticsFilterState,
  parseAnalyticsFilterState,
  parseProvisionalAnalyticsFilterState,
  toAnalyticsFilterSearchParams,
} from "./filters/analyticsFiltersUrl";
import { loadAnalyticsFilterOptions, type AnalyticsFilterOptions } from "./filters/optionsQuery";
import { NotFoundPage } from "./navigation/NotFoundPage";
import {
  parseAiUsageControls,
  withAiUsageControlSearchParams,
} from "./reports/aiUsageCohorts/aiUsageCohortsUrl";
import { loadCatalogInstallFunnelAvailableRange } from "./reports/catalogInstallFunnel/query";
import { loadCatalogInstallsReport } from "./reports/catalogInstalls/query";
import {
  parseFunnelAnchorStepId,
  withFunnelAnchorSearchParams,
} from "./reports/funnels/funnelAnchorUrl";
import { funnelSections } from "./reports/funnels/funnelSections";
import { reviewPromptFunnels } from "./reports/reviewPrompts/detailsQuery";
import {
  parseStudyDepthControls,
  withStudyDepthControlSearchParams,
} from "./reports/studyDepth/studyDepthUrl";
import {
  buildLookbackReportRangeEndingOn,
  defaultReportRangeLookbackDays,
  todayUtcCalendarDate,
} from "./reports/reportValues";
import {
  loadReviewEventsByDateAvailableRange,
  loadReviewEventsByDateReport,
  type ReviewEventsByDateRange,
} from "./reports/reviewEventsByDate/query";
import {
  eventsPath,
  getAdminRoutePath,
  parseAdminRoute,
  usersPath,
  type AdminRoute,
  type AnalyticsArea,
} from "./routing";
import { UserPage } from "./users/userPage/UserPage";
import { UsersPage } from "./users/UsersPage";

type AppState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "redirecting" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; config: AdminAppConfig; session: AdminSession }>;

/** What the first analytics area opened on, before the available range is known. */
type ProvisionalAnalyticsSelection = Readonly<{
  defaultRange: ReviewEventsByDateRange;
  /** The query string the area opened with, which the range lookup reconciles against. */
  openedSearch: string;
}>;

const analyticsDefaultRangeLabel = "Analytics default";

// Every filter is applied server-side, so a burst of clicks would be a burst of report queries. The
// newest selection waits this long before it is sent, and the ones it superseded never reach the
// network at all.
const filterReloadDebounceMs = 400;

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseCalendarDate(date: string, fieldName: string): Date {
  const match = calendarDatePattern.exec(date);
  if (match === null) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} must be a valid calendar date.`);
  }

  return parsedDate;
}

function isSameDateRange(left: ReviewEventsByDateRange, right: ReviewEventsByDateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

function isSameOptionalDateRange(
  left: ReviewEventsByDateRange | null,
  right: ReviewEventsByDateRange | null,
): boolean {
  return left === null || right === null ? left === right : isSameDateRange(left, right);
}

// General's reports do not read the Journeys-only comparison range, so its batch is keyed on the
// selection with it blanked: picking a comparison neither reloads General nor takes query slots ahead
// of the funnel cards. Keyed on content, because every apply makes a new selection object.
function toGeneralReportFilters(filters: AnalyticsFilterState): AnalyticsFilterState {
  return normalizeAnalyticsFilterState({
    ...filters,
    comparisonDateRange: null,
  });
}

function toGeneralReportFiltersKey(filters: AnalyticsFilterState): string {
  return JSON.stringify(toGeneralReportFilters(filters));
}

function compareCalendarDates(left: string, right: string): number {
  return parseCalendarDate(left, "Date").getTime() - parseCalendarDate(right, "Date").getTime();
}

function validateRequestedRange(
  range: ReviewEventsByDateRange,
  availableRange: ReviewEventsByDateRange,
): string | null {
  try {
    parseCalendarDate(range.from, "From date");
    parseCalendarDate(range.to, "To date");
  } catch (error) {
    return error instanceof Error ? error.message : "Date range is invalid.";
  }

  if (compareCalendarDates(range.from, range.to) > 0) {
    return "From date must be on or before To date.";
  }

  if (compareCalendarDates(range.from, availableRange.from) < 0) {
    return `From date must be on or after ${availableRange.from}.`;
  }

  if (compareCalendarDates(range.to, availableRange.to) > 0) {
    return `To date must be on or before ${availableRange.to}.`;
  }

  return null;
}

/**
 * The bounds the shared date picker allows: every day either area can carry data on.
 *
 * The review events and the catalog funnel start on different days, and one bar now drives both, so
 * a range with data in one area and none in the other stays selectable and simply shows an empty
 * tail rather than being refused.
 */
function buildUnionRange(
  left: ReviewEventsByDateRange,
  right: ReviewEventsByDateRange,
): ReviewEventsByDateRange {
  return {
    from: compareCalendarDates(left.from, right.from) <= 0 ? left.from : right.from,
    to: compareCalendarDates(left.to, right.to) >= 0 ? left.to : right.to,
  };
}

/**
 * The area whose shared filter bar the route renders, or `null` for a route without one. Every
 * analytics area but Level 1 metrics, and every funnel and review prompt Details page, renders the
 * shared filter bar and carries its selection in the URL. Level 1 metrics and its Details pages own
 * their range and its available range, so entering them loads nothing here.
 */
function getAnalyticsFilterArea(route: AdminRoute): AnalyticsArea | null {
  switch (route.kind) {
    case "analyticsArea":
      return route.area === "level-1-metrics" ? null : route.area;
    case "funnelDetails":
      return "journeys";
    case "reviewPromptDetails":
      return "review-prompts";
    default:
      return null;
  }
}

/**
 * The query string of one area: the shared filter selection, plus whatever parameters that area owns.
 *
 * An area-specific parameter is carried over from the URL the browser is on rather than held in this
 * component, because the control that owns it lives inside the area and writes it there directly.
 * Every one of them is added on its own route only, so none can leak into another area's links: the
 * filter writer starts from a fresh `URLSearchParams` each time, which is what drops them again on
 * the way out.
 *
 * The Journeys anchors are validated on the way through, each against that funnel's own steps. The
 * Study-vs-AI controls and the Study depth maturity are validated by their own parsers, which fall
 * back to the default for anything outside their closed option lists.
 */
function buildAreaSearchParams(
  route: AdminRoute,
  filterSearchParams: URLSearchParams,
  currentSearchParams: URLSearchParams,
): URLSearchParams {
  // A funnel Details page carries every funnel's anchor, not only its own, so its back link returns
  // to the Journeys area with the query string it left.
  if (route.kind === "funnelDetails" || (route.kind === "analyticsArea" && route.area === "journeys")) {
    return funnelSections.reduce(
      (nextSearchParams, funnel) => withFunnelAnchorSearchParams(
        nextSearchParams,
        funnel.anchor,
        parseFunnelAnchorStepId(currentSearchParams, funnel.anchor),
      ),
      filterSearchParams,
    );
  }

  // A review prompt Details page carries its own funnel's anchor; the table has none.
  if (route.kind === "reviewPromptDetails") {
    const anchor = reviewPromptFunnels[route.promptId].anchor;
    return withFunnelAnchorSearchParams(filterSearchParams, anchor, parseFunnelAnchorStepId(currentSearchParams, anchor));
  }

  if (route.kind === "analyticsArea" && route.area === "ai-usage") {
    return withAiUsageControlSearchParams(
      filterSearchParams,
      parseAiUsageControls(currentSearchParams),
    );
  }

  if (route.kind === "analyticsArea" && route.area === "study-depth") {
    return withStudyDepthControlSearchParams(
      filterSearchParams,
      parseStudyDepthControls(currentSearchParams),
    );
  }

  return filterSearchParams;
}

function replaceWithCanonicalPath(): void {
  const canonicalPath = getAdminRoutePath(parseAdminRoute(window.location.pathname));
  if (canonicalPath !== window.location.pathname) {
    window.history.replaceState(
      null,
      "",
      `${canonicalPath}${window.location.search}${window.location.hash}`,
    );
  }
}

function redirectToLogin(config: AdminAppConfig): void {
  const loginUrl = new URL(`${config.authBaseUrl}/login`);
  loginUrl.searchParams.set("redirect_uri", window.location.href);
  loginUrl.searchParams.set("locale", navigator.language || "en");
  window.location.replace(loginUrl.toString());
}

function LoadingState(): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin</p>
        <h1>Loading dashboard</h1>
        <p className="state-copy">Checking the current admin session.</p>
      </section>
    </main>
  );
}

function DeniedState(): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin Access Required</p>
        <h1>У вас нет доступа администратора.</h1>
        <p className="state-copy">Запросите доступ администратора, пожалуйста.</p>
      </section>
    </main>
  );
}

function ErrorState(props: Readonly<{ message: string }>): JSX.Element {
  const isUnsupportedHostError = props.message.startsWith("Unsupported admin hostname:");
  const title = isUnsupportedHostError ? "Unsupported admin hostname" : "Dashboard failed to load";

  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin Error</p>
        <h1>{title}</h1>
        <p className="state-copy">{props.message}</p>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected admin app error.";
}

export default function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>({ status: "loading" });
  const [reportState, setReportState] = useState<AdminReportState>({ status: "loading" });
  const [route, setRoute] = useState<AdminRoute>(() => parseAdminRoute(window.location.pathname));
  // The Users and Events lists report their paths, query string included, on entry and on every table
  // change, so the user and event pages' back links return to the list exactly as it was last left.
  const [usersListPath, setUsersListPath] = useState<string>(usersPath);
  const [eventsListPath, setEventsListPath] = useState<string>(eventsPath);
  const [reportLoadRevision, setReportLoadRevision] = useState<number>(0);
  // The whole filter selection lives here, above every area, so leaving General for Journeys and
  // coming back keeps it. It is null until the first analytics area opens, which starts it
  // provisionally from the URL; the range lookup then reconciles its range.
  const [filterState, setFilterState] = useState<AnalyticsFilterState | null>(null);
  // Mirrors `filterState` for `applyFilters`, which has to stay stable across renders and therefore
  // cannot read the state itself.
  const filterStateRef = useRef<AnalyticsFilterState | null>(null);
  const [provisionalSelection, setProvisionalSelection] = useState<ProvisionalAnalyticsSelection | null>(null);
  const [rangeLookup, setRangeLookup] = useState<AnalyticsRangeLookup>({ status: "loading" });
  // Mirrors the looked-up available range for `applyFilters`, for the same reason as `filterStateRef`.
  const availableRangeRef = useRef<ReviewEventsByDateRange | null>(null);
  // The last area that rendered the shared filter bar, whose default the date range is measured against
  // when the next one opens; a page without the bar between two areas leaves it unchanged.
  const lastFilterAreaRef = useRef<AnalyticsArea | null>(getAnalyticsFilterArea(route));
  const [rangeLookupRevision, setRangeLookupRevision] = useState<number>(0);
  // The available range is fetched at most once per page load. The latch is also the re-entry guard:
  // while that request is in flight no revision bump or area switch can start a second one.
  const hasRequestedAvailableRangeRef = useRef<boolean>(false);
  // Raised by a filter change and lowered once it has stood for the reload debounce; the areas that
  // query on their own wait it out, as the General batch does.
  const [isSelectionSettling, setIsSelectionSettling] = useState<boolean>(false);
  // The synchronous rejection of a requested range, shown inside the filter panel.
  const [dateRangeError, setDateRangeError] = useState<string>("");
  // Only a view that already has numbers on screen waits for the debounce; the first load has
  // nothing to coalesce.
  const hasLoadedReportsRef = useRef<boolean>(false);
  const loadedFilterOptionsRef = useRef<Readonly<{
    dateRange: AnalyticsDateRange;
    options: AnalyticsFilterOptions;
  }> | null>(null);

  // A trailing-slash variant of a known route, and `/` or `/analytics`, is rewritten in place, so the
  // address bar and any later history entry carry the canonical path without a network redirect.
  useEffect(() => {
    replaceWithCanonicalPath();
  }, []);

  // Areas open on different default ranges, so a range still at the area's default moves to the next
  // area's default on the way in, in the same render as the route change, so the area never queries
  // the old one. Any other range is a choice and is kept. Before the range lookup returns, the lookup
  // applies the current area's default itself.
  const setRouteFollowingDefaultRange = useCallback((nextRoute: AdminRoute): void => {
    setRoute(nextRoute);
    const nextArea = getAnalyticsFilterArea(nextRoute);
    const previousArea = lastFilterAreaRef.current;
    if (nextArea === null) {
      return;
    }

    lastFilterAreaRef.current = nextArea;
    const currentFilters = filterStateRef.current;
    const availableRange = availableRangeRef.current;
    if (previousArea === null || currentFilters === null || availableRange === null) {
      return;
    }

    const previousDefaultRange = buildAnalyticsAreaDefaultDateRange(previousArea, availableRange);
    const nextDefaultRange = buildAnalyticsAreaDefaultDateRange(nextArea, availableRange);
    if (
      isSameDateRange(currentFilters.dateRange, previousDefaultRange) === false
      || isSameDateRange(previousDefaultRange, nextDefaultRange)
    ) {
      return;
    }

    const nextFilters = { ...currentFilters, dateRange: nextDefaultRange };
    filterStateRef.current = nextFilters;
    setFilterState(nextFilters);
    setReportState((currentState) => (currentState.status === "ready"
      ? { ...currentState, isReportLoading: true }
      : currentState));
  }, []);

  useEffect(() => {
    function handlePopState(): void {
      replaceWithCanonicalPath();
      setRouteFollowingDefaultRange(parseAdminRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [setRouteFollowingDefaultRange]);

  // `path` may carry a query string, which is pushed with it but never read as part of the route.
  const navigateToPath = useCallback((path: string): void => {
    if (path !== window.location.pathname) {
      window.history.pushState(null, "", path);
    }

    setRouteFollowingDefaultRange(parseAdminRoute(new URL(path, window.location.origin).pathname));
  }, [setRouteFollowingDefaultRange]);

  const handleTerminalAdminError = useCallback((error: unknown, config: AdminAppConfig): boolean => {
    if (error instanceof AdminApiError) {
      if (error.status === 401) {
        setAppState({ status: "redirecting" });
        redirectToLogin(config);
        return true;
      }

      if (error.status === 403 && error.code === "ADMIN_ACCESS_REQUIRED") {
        setAppState({ status: "denied" });
        return true;
      }
    }

    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSession(): Promise<void> {
      let config: AdminAppConfig | null = null;

      try {
        config = getAdminAppConfig();
        const session = await fetchAdminSession(config);

        if (cancelled) {
          return;
        }

        setAppState({ status: "ready", config, session });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (config !== null && handleTerminalAdminError(error, config)) {
          return;
        }

        setAppState({
          status: "error",
          message: getErrorMessage(error),
        });
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [handleTerminalAdminError]);

  const sessionConfig = appState.status === "ready" ? appState.config : null;
  const filterArea = getAnalyticsFilterArea(route);
  const usesAnalyticsFilters = filterArea !== null;

  // The first analytics area starts on the URL's selection at once, its range clamped to today and
  // the browser's default where the URL has none. A layout effect, so the area never paints without it.
  useLayoutEffect(() => {
    if (!usesAnalyticsFilters || sessionConfig === null || filterStateRef.current !== null) {
      return;
    }

    const openedSearch = window.location.search;
    const todayUtc = todayUtcCalendarDate(new Date());
    // Both range loaders end on today's UTC date, so this matches the lookup's default unless the
    // data starts later than the lookback.
    const defaultRange = buildLookbackReportRangeEndingOn(
      todayUtc,
      defaultReportRangeLookbackDays,
      analyticsDefaultRangeLabel,
    );
    const provisionalFilters = parseProvisionalAnalyticsFilterState(
      new URLSearchParams(openedSearch),
      todayUtc,
      defaultRange,
    );

    setProvisionalSelection({ defaultRange, openedSearch });
    filterStateRef.current = provisionalFilters;
    setFilterState(provisionalFilters);
  }, [sessionConfig, usesAnalyticsFilters]);

  useEffect(() => {
    if (
      !usesAnalyticsFilters
      || sessionConfig === null
      || provisionalSelection === null
      || hasRequestedAvailableRangeRef.current
    ) {
      return;
    }

    hasRequestedAvailableRangeRef.current = true;
    const abortController = new AbortController();
    setRangeLookup({ status: "loading" });
    // Read from what the area opened with, because switching area before the lookup returns drops the
    // selection from the address bar until it can be written back.
    const openedSearchParams = new URLSearchParams(provisionalSelection.openedSearch);

    async function loadAvailableRange(config: AdminAppConfig): Promise<void> {
      try {
        const [reviewAvailableRange, funnelAvailableRange] = await Promise.all([
          loadReviewEventsByDateAvailableRange(config, abortController.signal),
          loadCatalogInstallFunnelAvailableRange(config, abortController.signal),
        ]);
        const availableRange = buildUnionRange(reviewAvailableRange, funnelAvailableRange);
        // Only the two ranges are reconciled: every other field reads the same without the
        // available range, and one changed meanwhile is not in the URL yet. Unchanged ranges keep
        // the selection object, so nothing reloads.
        const currentArea = lastFilterAreaRef.current;
        if (currentArea === null) {
          throw new Error("The analytics range lookup returned before any area with the shared filter bar opened.");
        }

        const reconciledSelection = parseAnalyticsFilterState(openedSearchParams, availableRange, currentArea);
        const currentFilters = filterStateRef.current;

        availableRangeRef.current = availableRange;
        setRangeLookup({ status: "ready", availableRange });
        if (
          currentFilters !== null
          && (
            isSameDateRange(currentFilters.dateRange, reconciledSelection.dateRange) === false
            || isSameOptionalDateRange(
              currentFilters.comparisonDateRange,
              reconciledSelection.comparisonDateRange,
            ) === false
          )
        ) {
          const reconciledFilters = {
            ...currentFilters,
            dateRange: reconciledSelection.dateRange,
            comparisonDateRange: reconciledSelection.comparisonDateRange,
          };
          filterStateRef.current = reconciledFilters;
          setFilterState(reconciledFilters);
        }
      } catch (error) {
        // Nothing is loaded and nothing is in flight, so a Retry may ask for the range again.
        hasRequestedAvailableRangeRef.current = false;

        // Dropped while it waited for a query slot, so it is asked for again once this effect can.
        if (abortController.signal.aborted) {
          setRangeLookupRevision((revision) => revision + 1);
          return;
        }

        if (handleTerminalAdminError(error, config)) {
          return;
        }

        // The areas already run on the provisional selection, so a failure only stays beside the
        // filter bar, whose date field it leaves disabled.
        setRangeLookup({ status: "error", message: getErrorMessage(error) });
      }
    }

    void loadAvailableRange(sessionConfig);
    return () => { abortController.abort(); };
  }, [
    handleTerminalAdminError,
    provisionalSelection,
    rangeLookupRevision,
    sessionConfig,
    usesAnalyticsFilters,
  ]);

  // The option lists and the colour domains are deliberately blind to the rest of the selection - a
  // user a filter just removed from every chart is exactly the user the popup has to keep offering -
  // so only a range change asks for them again. The five catalog attribution lists do not depend on
  // the range at all and are simply reloaded with the rest.
  const loadFilterOptions = useCallback(async (
    config: AdminAppConfig,
    dateRange: AnalyticsDateRange,
    signal: AbortSignal,
  ): Promise<AnalyticsFilterOptions> => {
    const loadedOptions = loadedFilterOptionsRef.current;
    if (
      loadedOptions !== null
      && loadedOptions.dateRange.from === dateRange.from
      && loadedOptions.dateRange.to === dateRange.to
    ) {
      return loadedOptions.options;
    }

    const options = await loadAnalyticsFilterOptions(config, dateRange, signal);
    loadedFilterOptionsRef.current = { dateRange, options };
    return options;
  }, []);

  const generalReportFilters = filterState === null ? null : toGeneralReportFilters(filterState);
  const generalReportFiltersKey = generalReportFilters === null ? null : JSON.stringify(generalReportFilters);

  // Reruns on `generalReportFiltersKey` rather than on `generalReportFilters`, whose content it fixes.
  useEffect(() => {
    if (sessionConfig === null || generalReportFilters === null) {
      return;
    }

    const config = sessionConfig;
    const filters = generalReportFilters;
    let isSuperseded = false;
    const abortController = new AbortController();

    async function loadReports(): Promise<void> {
      // `reloadError` is deliberately left standing while this attempt runs: clearing it here would
      // let a failure blink away the moment the next request leaves and put the operator back in
      // front of confidently rendered stale numbers. Only an outcome clears it.
      setReportState((currentState) => (currentState.status === "ready"
        ? { ...currentState, isReportLoading: true }
        : currentState));

      try {
        const [filterOptions, report, catalogInstallsReport] = await Promise.all([
          loadFilterOptions(config, filters.dateRange, abortController.signal),
          loadReviewEventsByDateReport(config, filters, abortController.signal),
          loadCatalogInstallsReport(config, filters, abortController.signal),
        ]);

        if (isSuperseded) {
          return;
        }

        hasLoadedReportsRef.current = true;
        setReportState({
          status: "ready",
          data: {
            filterOptions,
            report,
            catalogInstallsReport,
          },
          isReportLoading: false,
          reloadError: "",
        });
      } catch (error) {
        if (isSuperseded) {
          return;
        }

        if (handleTerminalAdminError(error, config)) {
          return;
        }

        // A selection that fails keeps the numbers it replaced, and the failure goes into
        // `reloadError`, which the dashboard shows as a sticky banner over the reports and uses to
        // mark those numbers stale; only a view that has nothing on screen yet falls back to the
        // retryable error state.
        setReportState((currentState) => (currentState.status === "ready"
          ? { ...currentState, isReportLoading: false, reloadError: getErrorMessage(error) }
          : { status: "error", message: getErrorMessage(error), isRetrying: false }));
      }
    }

    const reloadTimeoutId = window.setTimeout(
      () => { void loadReports(); },
      hasLoadedReportsRef.current ? filterReloadDebounceMs : 0,
    );

    return () => {
      isSuperseded = true;
      abortController.abort();
      window.clearTimeout(reloadTimeoutId);
    };
  }, [
    generalReportFiltersKey,
    handleTerminalAdminError,
    loadFilterOptions,
    reportLoadRevision,
    sessionConfig,
  ]);

  useEffect(() => {
    if (isSelectionSettling === false) {
      return;
    }

    const settleTimeoutId = window.setTimeout(
      () => { setIsSelectionSettling(false); },
      filterReloadDebounceMs,
    );

    return () => {
      window.clearTimeout(settleTimeoutId);
    };
  }, [filterState, isSelectionSettling]);

  // The selection is written back into the URL so a reload or a shared link reopens the same view.
  // It replaces the current history entry rather than pushing one, so Back leaves the area instead of
  // stepping through every click, and the single write this does on load is the canonicalization of a
  // hand-typed query string rather than a filter change of its own. The selection lives above the
  // areas, so switching area re-writes it onto the new path instead of being read back from it.
  // Area-specific parameters - the Journeys charts' anchors and group-by fields, the Study-vs-AI
  // period length and audience, and the Study depth maturity - are carried over by
  // `buildAreaSearchParams` above, on their own route only. It waits for the range lookup, whose
  // available range the defaults are derived from.
  useEffect(() => {
    if (filterState === null || rangeLookup.status !== "ready" || filterArea === null) {
      return;
    }

    const filterSearchParams = toAnalyticsFilterSearchParams(filterState, rangeLookup.availableRange, filterArea);
    const currentSearchParams = new URLSearchParams(window.location.search);
    const searchParams = buildAreaSearchParams(route, filterSearchParams, currentSearchParams);
    const serializedParams = searchParams.toString();
    const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
    if (nextSearch === window.location.search) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );
  }, [filterArea, filterState, rangeLookup, route]);

  // Both Retry controls - the one in the failure banner over stale numbers and the one in the error
  // panel - reach the reports effect only through this revision bump, and the in-flight mark is
  // raised here rather than when the request finally leaves, for a different reason on each path.
  // From the banner, because the reload waits out the same debounce a filter click does and nothing
  // would change on screen for those 400 ms. From the error panel, because `loadReports` raises its
  // own mark only on the `ready` branch, so without this the panel's button would stay unmarked for
  // the entire request. Either way a Retry that ends in the same message it started from would be
  // pixel-identical from click to outcome and read as a dead control. Nothing here re-requests on
  // its own; the effect owns the attempt, and only its outcome lowers the mark again.
  const retryReportLoad = useCallback((): void => {
    setReportState((currentState) => {
      if (currentState.status === "ready") {
        return { ...currentState, isReportLoading: true };
      }

      if (currentState.status === "error") {
        return { ...currentState, isRetrying: true };
      }

      return currentState;
    });
    setReportLoadRevision((revision) => revision + 1);
  }, []);

  const retryRangeLookup = useCallback((): void => {
    setRangeLookupRevision((revision) => revision + 1);
  }, []);

  // Stable across renders on purpose, so the filter controls receive the same callback on every render.
  // Returns whether the selection was accepted, so a caller that dismisses its own control on
  // success - the date popover - keeps it open to show the rejection instead.
  const applyFilters = useCallback((nextFilters: AnalyticsFilterState): boolean => {
    // Canonical here rather than only where it is serialized, so a value the URL codec would drop or
    // reorder cannot stay on screen as a checked option and a popover header and then change on the
    // next reload.
    const filters = normalizeAnalyticsFilterState(nextFilters);

    // Every selection is judged against the available data, including one that only changes another
    // field: a range the URL carried is already clamped into that window by the reconciliation, so
    // this cannot refuse a filter click on a link older than the retained data. Until the lookup
    // returns the date fields are disabled, so the ranges here are still the provisional ones.
    const availableRange = availableRangeRef.current;
    if (availableRange !== null) {
      const validationError = validateRequestedRange(filters.dateRange, availableRange);
      if (validationError !== null) {
        setDateRangeError(validationError);
        return false;
      }

      const comparisonValidationError = filters.comparisonDateRange === null
        ? null
        : validateRequestedRange(filters.comparisonDateRange, availableRange);
      if (comparisonValidationError !== null) {
        setDateRangeError(`Compare with: ${comparisonValidationError}`);
        return false;
      }
    }

    // The reload waits out the debounce, so the indicator is raised here rather than when the request
    // finally leaves: a selection that shows nothing for 400 ms reads as a dead control. Only the
    // range-validation message is cleared; an unresolved reload failure and its stale numbers stay on
    // screen until this new attempt has an outcome of its own. A change General's batch ignores
    // leaves its indicator alone.
    setDateRangeError("");
    const previousFilters = filterStateRef.current;
    if (
      previousFilters === null
      || toGeneralReportFiltersKey(previousFilters) !== toGeneralReportFiltersKey(filters)
    ) {
      setReportState((currentState) => (currentState.status === "ready"
        ? { ...currentState, isReportLoading: true }
        : currentState));
    }
    setIsSelectionSettling(true);
    filterStateRef.current = filters;
    setFilterState(filters);
    return true;
  }, []);

  if (appState.status === "loading" || appState.status === "redirecting") {
    return <LoadingState />;
  }

  if (appState.status === "denied") {
    return <DeniedState />;
  }

  if (appState.status === "error") {
    return <ErrorState message={appState.message} />;
  }

  if (route.kind === "notFound") {
    return <NotFoundPage pathname={route.pathname} onNavigate={navigateToPath} />;
  }

  if (route.kind === "users") {
    return (
      <UsersPage
        config={appState.config}
        adminEmail={appState.session.email}
        onNavigate={navigateToPath}
        onListPathChange={setUsersListPath}
        onTerminalAdminError={handleTerminalAdminError}
      />
    );
  }

  if (route.kind === "user" || route.kind === "userChat") {
    return (
      <UserPage
        key={route.userId}
        config={appState.config}
        adminEmail={appState.session.email}
        userId={route.userId}
        tab={route.kind === "user" ? route.tab : "chats"}
        openChatSessionId={route.kind === "userChat" ? route.sessionId : null}
        usersListPath={usersListPath}
        onNavigate={navigateToPath}
        onTerminalAdminError={handleTerminalAdminError}
      />
    );
  }

  if (route.kind === "events") {
    return (
      <EventsPage
        config={appState.config}
        adminEmail={appState.session.email}
        onNavigate={navigateToPath}
        onListPathChange={setEventsListPath}
        onTerminalAdminError={handleTerminalAdminError}
      />
    );
  }

  if (route.kind === "event") {
    return (
      <EventPage
        key={route.eventId}
        config={appState.config}
        adminEmail={appState.session.email}
        eventId={route.eventId}
        eventsListPath={eventsListPath}
        onNavigate={navigateToPath}
        onTerminalAdminError={handleTerminalAdminError}
      />
    );
  }

  return (
    <AdminDashboard
      route={route}
      onNavigate={navigateToPath}
      config={appState.config}
      adminEmail={appState.session.email}
      reportState={reportState}
      rangeLookup={rangeLookup}
      defaultRange={rangeLookup.status === "ready" && filterArea !== null
        ? buildAnalyticsAreaDefaultDateRange(filterArea, rangeLookup.availableRange)
        : provisionalSelection?.defaultRange ?? null}
      filters={filterState}
      isSelectionSettling={isSelectionSettling}
      dateRangeError={dateRangeError}
      onReportRetry={retryReportLoad}
      onRangeLookupRetry={retryRangeLookup}
      onFiltersChange={applyFilters}
      onTerminalAdminError={handleTerminalAdminError}
    />
  );
}
