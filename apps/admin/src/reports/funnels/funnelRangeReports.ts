import { useCallback, useEffect, useState } from "react";
import { dailyTotalBarColor } from "../../charts/chartPrimitives";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import { normalizeAnalyticsFilterState } from "../../filters/analyticsFiltersUrl";
import type { FunnelReportProps } from "./funnelSections";
import type { FunnelChartGroups, FunnelStage } from "./FunnelStepsChart";

// A funnel card counts its report on the main range A and, when the Funnels bar sets a comparison
// range, once more on range B with every other filter and the audience mode unchanged; the chart then
// draws the two as series side by side, each measured from its own first step.

export type FunnelRangeKey = "a" | "b";

/** One range a funnel card counted. */
export type FunnelRangeReport<Report> = Readonly<{
  key: FunnelRangeKey;
  /** `null` without a comparison, so a single-range card reads as it always has. */
  seriesLabel: string | null;
  dateRange: AnalyticsDateRange;
  report: Report;
}>;

/** Ready holds A first, then B when a comparison range is set. */
export type FunnelRangeReportsState<Report> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; ranges: ReadonlyArray<FunnelRangeReport<Report>> }>;

/** Must be stable across renders, as a module-level function is, because the load reruns when it changes. */
export type FunnelReportLoader<Report> = (
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
) => Promise<Report>;

// A takes the accent the single-range chart draws in, so the main range keeps its colour when a
// comparison is added.
const funnelRangeColors: Readonly<Record<FunnelRangeKey, string>> = {
  a: dailyTotalBarColor,
  b: "#4e79a7",
};

const loadingState = { status: "loading" } as const;

export function formatFunnelRangeSeriesLabel(key: FunnelRangeKey, dateRange: AnalyticsDateRange): string {
  return `${key.toUpperCase()} · ${dateRange.from} – ${dateRange.to}`;
}

/** What one range queries: the shared selection on that range's dates, without the comparison. */
function buildFunnelRangeRequest(
  filters: AnalyticsFilterState,
  dateRange: AnalyticsDateRange,
): AnalyticsFilterState {
  return normalizeAnalyticsFilterState({ ...filters, dateRange, comparisonDateRange: null });
}

type FunnelRangeLoad<Report> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: Report }>;

type FunnelRangeQuery = Readonly<{ key: string; request: AnalyticsFilterState }>;

/**
 * Loads one range, keyed on its request's content because every apply makes a new selection object,
 * so a change to the other range neither re-queries nor drops this one. A changed request drops its
 * query at once and asks again only once the selection settles. `null` when there is no range.
 */
function useFunnelRangeLoad<Report>(
  props: FunnelReportProps,
  request: AnalyticsFilterState | null,
  loadRevision: number,
  loadReport: FunnelReportLoader<Report>,
  getErrorMessage: (error: unknown) => string,
): FunnelRangeLoad<Report> | null {
  const { config, isRangeLoading, onTerminalAdminError } = props;
  const requestedQuery: FunnelRangeQuery | null = request === null ? null : { key: JSON.stringify(request), request };
  const requestKey = requestedQuery?.key ?? null;
  const [query, setQuery] = useState<FunnelRangeQuery | null>(() => (isRangeLoading ? null : requestedQuery));
  const [loaded, setLoaded] = useState<Readonly<{ key: string; load: FunnelRangeLoad<Report> }> | null>(null);

  // Adjusted during render, so the commit that settles a new request already reads it as loading.
  if ((query?.key ?? null) !== requestKey) {
    if (isRangeLoading === false) {
      setQuery(requestedQuery);
    } else if (query !== null) {
      setQuery(null);
    }
  }

  useEffect(() => {
    if (query === null) {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setLoaded({ key: query.key, load: loadingState });
    void loadReport(config, query.request, abortController.signal)
      .then((report) => {
        if (cancelled === false) {
          setLoaded({ key: query.key, load: { status: "ready", report } });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || onTerminalAdminError(error, config)) {
          return;
        }

        setLoaded({ key: query.key, load: { status: "error", message: getErrorMessage(error) } });
      });

    return () => { cancelled = true; abortController.abort(); };
  }, [config, getErrorMessage, loadReport, loadRevision, onTerminalAdminError, query]);

  if (requestKey === null) {
    return null;
  }

  return loaded !== null && loaded.key === requestKey ? loaded.load : loadingState;
}

/**
 * Loads a funnel's report on range A and, when set, range B, each on its own so that picking or
 * clearing B keeps A's result. Nothing is queried while the selection settles, which reads as
 * loading, and the card is ready only once every range it draws is.
 */
export function useFunnelRangeReports<Report>(
  props: FunnelReportProps,
  loadReport: FunnelReportLoader<Report>,
  getErrorMessage: (error: unknown) => string,
): Readonly<{ state: FunnelRangeReportsState<Report>; retry: () => void }> {
  const { filters, isRangeLoading } = props;
  const comparisonDateRange = filters.comparisonDateRange;
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const rangeA = useFunnelRangeLoad(
    props,
    buildFunnelRangeRequest(filters, filters.dateRange),
    loadRevision,
    loadReport,
    getErrorMessage,
  );
  const rangeB = useFunnelRangeLoad(
    props,
    comparisonDateRange === null ? null : buildFunnelRangeRequest(filters, comparisonDateRange),
    loadRevision,
    loadReport,
    getErrorMessage,
  );

  const retry = useCallback((): void => {
    setLoadRevision((revision) => revision + 1);
  }, []);

  if (isRangeLoading || rangeA === null) {
    return { state: loadingState, retry };
  }

  const loads: ReadonlyArray<Readonly<{
    key: FunnelRangeKey;
    dateRange: AnalyticsDateRange;
    load: FunnelRangeLoad<Report>;
  }>> = rangeB === null || comparisonDateRange === null
    ? [{ key: "a", dateRange: filters.dateRange, load: rangeA }]
    : [
      { key: "a", dateRange: filters.dateRange, load: rangeA },
      { key: "b", dateRange: comparisonDateRange, load: rangeB },
    ];

  // A failed range fails the card at once, even while the other is still loading.
  for (const range of loads) {
    if (range.load.status === "error") {
      return { state: range.load, retry };
    }
  }

  const ranges: Array<FunnelRangeReport<Report>> = [];
  for (const range of loads) {
    if (range.load.status !== "ready") {
      return { state: loadingState, retry };
    }

    ranges.push({
      key: range.key,
      seriesLabel: comparisonDateRange === null ? null : formatFunnelRangeSeriesLabel(range.key, range.dateRange),
      dateRange: range.dateRange,
      report: range.load.report,
    });
  }

  return { state: { status: "ready", ranges }, retry };
}

/**
 * The series `FunnelStepsChart` draws for a comparison, one per range in its own colour and named
 * with its dates, or `undefined` for a single range, which keeps the plain chart.
 */
export function buildFunnelRangeGroups<StepId extends string>(
  ranges: ReadonlyArray<Readonly<{
    key: FunnelRangeKey;
    seriesLabel: string | null;
    stages: ReadonlyArray<FunnelStage<StepId>>;
  }>>,
): FunnelChartGroups<StepId> | undefined {
  const groups = ranges.flatMap((range) => (range.seriesLabel === null ? [] : [{
    key: range.key,
    label: range.seriesLabel,
    color: funnelRangeColors[range.key],
    stages: range.stages,
  }]));

  return groups.length === 0 ? undefined : { kind: "groups", groups };
}

/** A note about one range, named by its series once two ranges share the card. */
export function formatFunnelRangeNote(seriesLabel: string | null, note: string): string {
  return seriesLabel === null ? note : `${seriesLabel}: ${note}`;
}
