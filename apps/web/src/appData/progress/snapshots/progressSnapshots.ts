import type {
  DailyReviewPoint,
  ProgressChartData,
  ProgressLeaderboard,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardMetric,
  ProgressLeaderboardRow,
  ProgressLeaderboardSnapshot,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardViewer,
  ProgressLeaderboardWindow,
  ProgressReviewSchedule,
  ProgressReviewScheduleBucket,
  ProgressReviewScheduleSnapshot,
  ProgressReviewScheduleSourceState,
  ProgressReviewHistoryWatermark,
  ProgressRenderedSeriesSummaryContext,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSeriesSnapshot,
  ProgressSeriesSourceState,
  ProgressSourceState,
  ProgressSummary,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
  ProgressSummarySourceState,
} from "../../../types";
import { progressLeaderboardWindowKeys } from "../../../types";
import { shiftLocalDate } from "../../../progress/progressDates";

export function createProgressChartData(dailyReviews: ReadonlyArray<DailyReviewPoint>): ProgressChartData {
  return {
    dailyReviews,
  };
}

function buildDailyReviewCountMap(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const day of dailyReviews) {
    counts.set(day.date, day.reviewCount);
  }

  return counts;
}

function expandProgressDailyReviews(
  input: ProgressSeriesInput,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): ReadonlyArray<DailyReviewPoint> {
  const dailyReviewCountMap = buildDailyReviewCountMap(dailyReviews);
  const expandedDailyReviews: Array<DailyReviewPoint> = [];

  for (let currentDate = input.from; currentDate <= input.to; currentDate = shiftLocalDate(currentDate, 1)) {
    expandedDailyReviews.push({
      date: currentDate,
      reviewCount: dailyReviewCountMap.get(currentDate) ?? 0,
    });
  }

  return expandedDailyReviews;
}

export function normalizeProgressSeries(series: ProgressSeries): ProgressSeries {
  const input: ProgressSeriesInput = {
    timeZone: series.timeZone,
    from: series.from,
    to: series.to,
  };

  return {
    timeZone: series.timeZone,
    from: series.from,
    to: series.to,
    generatedAt: series.generatedAt,
    reviewHistoryWatermarks: series.reviewHistoryWatermarks,
    dailyReviews: expandProgressDailyReviews(input, series.dailyReviews),
  };
}

export function createProgressSummarySnapshot(
  payload: ProgressSummaryPayload,
  source: ProgressSummarySnapshot["source"],
  isApproximate: boolean,
): ProgressSummarySnapshot {
  return {
    timeZone: payload.timeZone,
    generatedAt: payload.generatedAt,
    reviewHistoryWatermarks: payload.reviewHistoryWatermarks,
    summary: payload.summary,
    source,
    isApproximate,
  };
}

export function createProgressSeriesSnapshot(
  series: ProgressSeries,
  source: ProgressSeriesSnapshot["source"],
  isApproximate: boolean,
): ProgressSeriesSnapshot {
  const normalizedSeries = normalizeProgressSeries(series);

  return {
    ...normalizedSeries,
    chartData: createProgressChartData(normalizedSeries.dailyReviews),
    source,
    isApproximate,
  };
}

export function createProgressReviewScheduleSnapshot(
  reviewSchedule: ProgressReviewSchedule,
  source: ProgressReviewScheduleSnapshot["source"],
  isApproximate: boolean,
): ProgressReviewScheduleSnapshot {
  return {
    timeZone: reviewSchedule.timeZone,
    generatedAt: reviewSchedule.generatedAt,
    reviewHistoryWatermarks: reviewSchedule.reviewHistoryWatermarks,
    totalCards: reviewSchedule.totalCards,
    buckets: reviewSchedule.buckets,
    source,
    isApproximate,
  };
}

export function createProgressLeaderboardSnapshot(
  leaderboard: ProgressLeaderboard,
  isApproximate: boolean,
): ProgressLeaderboardSnapshot {
  return {
    status: leaderboard.status,
    metric: leaderboard.metric,
    defaultWindowKey: leaderboard.defaultWindowKey,
    windows: leaderboard.windows,
    source: "server",
    isApproximate,
  };
}

function overlayProgressLeaderboardWindowViewerCount(
  window: ProgressLeaderboardWindow,
  localViewerCount: number,
): ProgressLeaderboardWindow {
  return {
    ...window,
    viewer: {
      ...window.viewer,
      qualifiedReviewCount: localViewerCount,
    },
    rows: window.rows.map((row): ProgressLeaderboardRow => (
      row.kind === "viewer"
        ? {
          ...row,
          qualifiedReviewCount: localViewerCount,
        }
        : row
    )),
  };
}

/**
 * Replaces only the viewer's qualified review count with the locally computed
 * live count. Ranks, participant counts, and all other users' rows stay exactly
 * as the server snapshot reported them, so a diverging local count never
 * invents a new rank.
 */
function mergeProgressLeaderboardWithLocalViewerCounts(
  serverBase: ProgressLeaderboardSnapshot,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSnapshot {
  if (localViewerCounts === null || serverBase.status !== "ready") {
    return serverBase;
  }

  let hasOverlay = false;
  const windows = serverBase.windows.map((window): ProgressLeaderboardWindow => {
    const localViewerCount = localViewerCounts[window.windowKey];

    if (localViewerCount === window.viewer.qualifiedReviewCount) {
      return window;
    }

    hasOverlay = true;
    return overlayProgressLeaderboardWindowViewerCount(window, localViewerCount);
  });

  if (hasOverlay === false) {
    return serverBase;
  }

  return {
    ...serverBase,
    windows,
    isApproximate: true,
  };
}

function buildRenderedLeaderboard(
  serverBase: ProgressLeaderboardSnapshot | null,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
  canRenderServerBase: boolean,
): ProgressLeaderboardSnapshot | null {
  if (canRenderServerBase === false || serverBase === null) {
    return null;
  }

  return mergeProgressLeaderboardWithLocalViewerCounts(serverBase, localViewerCounts);
}

export function buildLocalFallbackSeries(
  input: ProgressSeriesInput,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): ProgressSeries {
  return {
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
    generatedAt: null,
    reviewHistoryWatermarks: [],
    dailyReviews: expandProgressDailyReviews(input, dailyReviews),
  };
}

type ProgressSeriesMergeResult = Readonly<{
  series: ProgressSeries;
  hasOverlay: boolean;
}>;

function mergeProgressSeriesWithOverlay(
  serverBase: ProgressSeries,
  overlay: ProgressChartData | null,
  localFallback: ProgressSeriesSnapshot | null,
): ProgressSeriesMergeResult {
  const pendingReviewCounts = buildDailyReviewCountMap(overlay?.dailyReviews ?? []);
  const localFallbackReviewCounts = localFallback === null
    ? new Map<string, number>()
    : buildDailyReviewCountMap(localFallback.dailyReviews);
  const normalizedServerBase = normalizeProgressSeries(serverBase);
  let hasOverlay = false;
  const dailyReviews = normalizedServerBase.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? 0;
    const localFallbackReviewCount = localFallbackReviewCounts.get(day.date) ?? 0;
    const reviewCountWithPendingOverlay = day.reviewCount + pendingReviewCount;
    const reviewCount = Math.max(reviewCountWithPendingOverlay, localFallbackReviewCount);

    if (reviewCount === day.reviewCount) {
      return day;
    }

    hasOverlay = true;
    return {
      date: day.date,
      reviewCount,
    };
  });

  if (hasOverlay === false) {
    return {
      series: normalizedServerBase,
      hasOverlay: false,
    };
  }

  return {
    series: {
      ...normalizedServerBase,
      dailyReviews,
    },
    hasOverlay: true,
  };
}

function maxLocalDate(
  first: string | null,
  second: string | null,
): string | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return first >= second ? first : second;
}

function createEmptyProgressSummary(): ProgressSummary {
  return {
    currentStreakDays: 0,
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
  };
}

function sortLocalDates(localDates: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...localDates].sort((leftDate, rightDate) => leftDate.localeCompare(rightDate));
}

function uniqueSortedLocalDates(localDates: ReadonlyArray<string>): ReadonlyArray<string> {
  return sortLocalDates([...new Set(localDates)]);
}

function activeDatesFromSeries(series: ProgressSeries): ReadonlyArray<string> {
  return uniqueSortedLocalDates(
    series.dailyReviews
      .filter((day) => day.reviewCount > 0)
      .map((day) => day.date),
  );
}

function summaryLowerBoundFromActiveDates(
  activeDates: ReadonlyArray<string>,
  today: string,
): ProgressSummary {
  const sortedActiveDates = uniqueSortedLocalDates(activeDates);

  if (sortedActiveDates.length === 0) {
    return createEmptyProgressSummary();
  }

  const activeDateSet = new Set(sortedActiveDates);
  const hasReviewedToday = activeDateSet.has(today);
  let currentDate = hasReviewedToday ? today : shiftLocalDate(today, -1);
  let currentStreakDays = 0;

  while (activeDateSet.has(currentDate)) {
    currentStreakDays += 1;
    currentDate = shiftLocalDate(currentDate, -1);
  }

  return {
    currentStreakDays,
    hasReviewedToday,
    lastReviewedOn: sortedActiveDates.at(-1) ?? null,
    activeReviewDays: sortedActiveDates.length,
  };
}

function validateProgressSeriesPairInputs(
  serverBase: ProgressSeries,
  renderedSeries: ProgressSeries,
): void {
  if (
    serverBase.timeZone === renderedSeries.timeZone
    && serverBase.from === renderedSeries.from
    && serverBase.to === renderedSeries.to
  ) {
    return;
  }

  throw new Error(
    `Progress series summary context inputs must share the same range. serverBase=${serverBase.timeZone} ${serverBase.from}...${serverBase.to}, renderedSeries=${renderedSeries.timeZone} ${renderedSeries.from}...${renderedSeries.to}.`,
  );
}

function activeDatesMissingFromServerBase(
  serverBase: ProgressSeries,
  renderedSeries: ProgressSeries,
): ReadonlyArray<string> {
  validateProgressSeriesPairInputs(serverBase, renderedSeries);

  const normalizedServerBase = normalizeProgressSeries(serverBase);
  const normalizedRenderedSeries = normalizeProgressSeries(renderedSeries);
  const serverReviewCounts = buildDailyReviewCountMap(normalizedServerBase.dailyReviews);

  return normalizedRenderedSeries.dailyReviews
    .filter((day) => day.reviewCount > 0 && (serverReviewCounts.get(day.date) ?? 0) === 0)
    .map((day) => day.date);
}

export function createProgressRenderedSeriesSummaryContext(
  serverBase: ProgressSeriesSnapshot | null,
  renderedSeries: ProgressSeriesSnapshot | null,
): ProgressRenderedSeriesSummaryContext | null {
  if (renderedSeries === null) {
    return null;
  }

  const activeDates = activeDatesFromSeries(renderedSeries);
  const activeDatesMissingFromServerBaseResult = serverBase === null
    ? []
    : activeDatesMissingFromServerBase(serverBase, renderedSeries);

  return {
    lowerBoundSummary: summaryLowerBoundFromActiveDates(activeDates, renderedSeries.to),
    activeDates,
    activeDatesMissingFromServerBase: activeDatesMissingFromServerBaseResult,
    serverBaseReviewHistoryWatermarks: serverBase?.reviewHistoryWatermarks ?? null,
  };
}

function serverAndSeriesShareReviewHistoryBase(
  serverBaseReviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
): boolean {
  const seriesBaseReviewHistoryWatermarks = renderedSeriesContext?.serverBaseReviewHistoryWatermarks;

  if (seriesBaseReviewHistoryWatermarks === null || seriesBaseReviewHistoryWatermarks === undefined) {
    return false;
  }

  return areProgressReviewHistoryWatermarksEqual(
    serverBaseReviewHistoryWatermarks,
    seriesBaseReviewHistoryWatermarks,
  );
}

function localFallbackActiveReviewDayDeltaCandidates(
  localFallbackActiveDates: ReadonlyArray<string>,
  serverBase: ProgressSummary,
): ReadonlyArray<string> {
  const serverLastReviewedOn = serverBase.lastReviewedOn;

  if (serverLastReviewedOn === null) {
    return localFallbackActiveDates;
  }

  return localFallbackActiveDates.filter((localDate) => localDate > serverLastReviewedOn);
}

function activeReviewDayDeltaCandidates(
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  serverBase: ProgressSummary,
  hasSharedServerAndSeriesReviewHistoryBase: boolean,
): ReadonlyArray<string> {
  const renderedSeriesCandidates = renderedSeriesContext === null
    ? []
    : hasSharedServerAndSeriesReviewHistoryBase
      ? renderedSeriesContext.activeDatesMissingFromServerBase
      : renderedSeriesContext.activeDates;

  return uniqueSortedLocalDates([
    ...renderedSeriesCandidates,
    ...localFallbackActiveReviewDayDeltaCandidates(localFallbackActiveDates, serverBase),
  ]);
}

function shouldApplyActiveReviewDayDelta(
  localDate: string,
  serverBase: ProgressSummary,
  hasSharedServerAndSeriesReviewHistoryBase: boolean,
  referenceLocalDate: string,
): boolean {
  if (localDate === referenceLocalDate && serverBase.hasReviewedToday) {
    return false;
  }

  if (hasSharedServerAndSeriesReviewHistoryBase) {
    return true;
  }

  if (serverBase.lastReviewedOn === null) {
    return true;
  }

  return localDate > serverBase.lastReviewedOn;
}

function activeReviewDayDelta(
  deltaCandidates: ReadonlyArray<string>,
  serverBase: ProgressSummary,
  hasSharedServerAndSeriesReviewHistoryBase: boolean,
  referenceLocalDate: string,
): number {
  return deltaCandidates.filter((localDate) => shouldApplyActiveReviewDayDelta(
    localDate,
    serverBase,
    hasSharedServerAndSeriesReviewHistoryBase,
    referenceLocalDate,
  )).length;
}

function currentStreakDaysWithLocalDelta(
  serverBase: ProgressSummary,
  localFallbackActiveDates: ReadonlyArray<string>,
  renderedSeriesActiveDates: ReadonlyArray<string>,
  referenceLocalDate: string,
): number {
  if (serverBase.hasReviewedToday || serverBase.currentStreakDays === 0) {
    return serverBase.currentStreakDays;
  }

  if (serverBase.lastReviewedOn === null) {
    return serverBase.currentStreakDays;
  }

  const activeDateSet = new Set([
    ...localFallbackActiveDates,
    ...renderedSeriesActiveDates,
  ]);
  let currentDate = shiftLocalDate(serverBase.lastReviewedOn, 1);
  let continuousLocalDelta = 0;

  while (currentDate <= referenceLocalDate && activeDateSet.has(currentDate)) {
    continuousLocalDelta += 1;
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return serverBase.currentStreakDays + continuousLocalDelta;
}

function hasProgressSummaryOverlay(
  mergedPayload: ProgressSummaryPayload,
  serverBase: ProgressSummarySnapshot,
): boolean {
  return areProgressSummariesEqual(mergedPayload.summary, serverBase.summary) === false;
}

function mergeProgressSummary(
  serverBase: ProgressSummarySnapshot,
  localFallback: ProgressSummarySnapshot | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  referenceLocalDate: string,
): ProgressSummaryPayload {
  const localFallbackSummary = localFallback?.summary ?? createEmptyProgressSummary();
  const renderedSeriesLowerBound = renderedSeriesContext?.lowerBoundSummary;
  const hasSharedServerAndSeriesReviewHistoryBase = serverAndSeriesShareReviewHistoryBase(
    serverBase.reviewHistoryWatermarks,
    renderedSeriesContext,
  );
  const serverActiveReviewDaysWithLocalDelta = serverBase.summary.activeReviewDays + activeReviewDayDelta(
    activeReviewDayDeltaCandidates(
      renderedSeriesContext,
      localFallbackActiveDates,
      serverBase.summary,
      hasSharedServerAndSeriesReviewHistoryBase,
    ),
    serverBase.summary,
    hasSharedServerAndSeriesReviewHistoryBase,
    referenceLocalDate,
  );
  const serverCurrentStreakDaysWithLocalDelta = currentStreakDaysWithLocalDelta(
    serverBase.summary,
    localFallbackActiveDates,
    renderedSeriesContext?.activeDates ?? [],
    referenceLocalDate,
  );

  return {
    timeZone: serverBase.timeZone,
    generatedAt: serverBase.generatedAt,
    reviewHistoryWatermarks: serverBase.reviewHistoryWatermarks,
    summary: {
      currentStreakDays: Math.max(
        serverCurrentStreakDaysWithLocalDelta,
        localFallbackSummary.currentStreakDays,
        renderedSeriesLowerBound?.currentStreakDays ?? 0,
      ),
      hasReviewedToday: serverBase.summary.hasReviewedToday
        || localFallbackSummary.hasReviewedToday
        || (renderedSeriesLowerBound?.hasReviewedToday ?? false),
      lastReviewedOn: maxLocalDate(
        maxLocalDate(
          serverBase.summary.lastReviewedOn,
          localFallbackSummary.lastReviewedOn,
        ),
        renderedSeriesLowerBound?.lastReviewedOn ?? null,
      ),
      activeReviewDays: Math.max(
        serverActiveReviewDaysWithLocalDelta,
        localFallbackSummary.activeReviewDays,
        renderedSeriesLowerBound?.activeReviewDays ?? 0,
      ),
    },
  };
}

function isProgressReviewScheduleServerBaseStale(
  serverBaseProgressScheduleLocalVersion: number | null,
  progressScheduleLocalVersion: number,
): boolean {
  return serverBaseProgressScheduleLocalVersion !== null
    && serverBaseProgressScheduleLocalVersion < progressScheduleLocalVersion;
}

function canRenderLocalReviewScheduleForServerBase(
  serverBase: ProgressReviewScheduleSnapshot | null,
  localFallback: ProgressReviewScheduleSnapshot | null,
  hasCompleteLocalCardState: boolean,
  localCardTotalDelta: number,
): boolean {
  return serverBase !== null
    && hasCompleteLocalCardState
    && localFallback !== null
    && localFallback.totalCards - localCardTotalDelta === serverBase.totalCards;
}

function buildRenderedSummary(
  serverBase: ProgressSummarySnapshot | null,
  localFallback: ProgressSummarySnapshot | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  hasPendingLocalReviews: boolean,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  referenceLocalDate: string | null,
  canRenderServerBase: boolean,
): ProgressSummarySnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    if (referenceLocalDate === null) {
      throw new Error("Progress summary reference local date is required when rendering a server summary.");
    }

    const mergedPayload = mergeProgressSummary(
      serverBase,
      localFallback,
      localFallbackActiveDates,
      renderedSeriesContext,
      referenceLocalDate,
    );

    if (hasPendingLocalReviews || hasProgressSummaryOverlay(mergedPayload, serverBase)) {
      return createProgressSummarySnapshot(
        mergedPayload,
        "server",
        true,
      );
    }

    return serverBase;
  }

  return localFallback;
}

function buildRenderedSeries(
  serverBase: ProgressSeriesSnapshot | null,
  localFallback: ProgressSeriesSnapshot | null,
  pendingLocalOverlay: ProgressChartData | null,
  canRenderServerBase: boolean,
): ProgressSeriesSnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    const mergeResult = mergeProgressSeriesWithOverlay(serverBase, pendingLocalOverlay, localFallback);
    return createProgressSeriesSnapshot(
      mergeResult.series,
      "server",
      mergeResult.hasOverlay,
    );
  }

  return localFallback;
}

function buildRenderedReviewSchedule(
  serverBase: ProgressReviewScheduleSnapshot | null,
  localFallback: ProgressReviewScheduleSnapshot | null,
  hasPendingLocalCardChanges: boolean,
  hasCompleteLocalCardState: boolean,
  pendingLocalCardTotalDelta: number,
  progressScheduleLocalVersion: number,
  serverBaseProgressScheduleLocalVersion: number | null,
  serverBaseLocalCardTotalDelta: number,
  canRenderServerBase: boolean,
): ProgressReviewScheduleSnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    if (hasPendingLocalCardChanges && canRenderLocalReviewScheduleForServerBase(
      serverBase,
      localFallback,
      hasCompleteLocalCardState,
      pendingLocalCardTotalDelta,
    )) {
      return localFallback;
    }

    if (isProgressReviewScheduleServerBaseStale(
      serverBaseProgressScheduleLocalVersion,
      progressScheduleLocalVersion,
    ) && canRenderLocalReviewScheduleForServerBase(
      serverBase,
      localFallback,
      hasCompleteLocalCardState,
      serverBaseLocalCardTotalDelta,
    )) {
      return localFallback;
    }

    if (hasPendingLocalCardChanges) {
      return createProgressReviewScheduleSnapshot(serverBase, "server", true);
    }

    return serverBase;
  }

  return localFallback;
}

export function resolveProgressReviewScheduleServerBaseLocalCardTotalDelta(
  currentState: ProgressReviewScheduleSourceState,
  localFallback: ProgressReviewScheduleSnapshot,
  hasCompleteLocalCardState: boolean,
  pendingLocalCardTotalDelta: number,
  progressScheduleLocalVersion: number,
): number {
  const serverBase = currentState.serverBase;
  const serverBaseProgressScheduleLocalVersion = currentState.serverBaseProgressScheduleLocalVersion;
  if (
    serverBase === null
    || serverBaseProgressScheduleLocalVersion === null
    || isProgressReviewScheduleServerBaseStale(
      serverBaseProgressScheduleLocalVersion,
      progressScheduleLocalVersion,
    ) === false
  ) {
    return 0;
  }

  if (canRenderLocalReviewScheduleForServerBase(
    serverBase,
    localFallback,
    hasCompleteLocalCardState,
    pendingLocalCardTotalDelta,
  )) {
    return pendingLocalCardTotalDelta;
  }

  if (canRenderLocalReviewScheduleForServerBase(
    serverBase,
    currentState.localFallback,
    currentState.hasCompleteLocalCardState,
    currentState.serverBaseLocalCardTotalDelta,
  )) {
    return localFallback.totalCards - serverBase.totalCards;
  }

  if (canRenderLocalReviewScheduleForServerBase(
    serverBase,
    localFallback,
    hasCompleteLocalCardState,
    currentState.serverBaseLocalCardTotalDelta,
  )) {
    return currentState.serverBaseLocalCardTotalDelta;
  }

  return 0;
}

export function resolveProgressReviewScheduleLoadedServerBaseLocalCardTotalDelta(
  currentState: ProgressReviewScheduleSourceState,
  serverBase: ProgressReviewScheduleSnapshot,
): number {
  if (
    currentState.hasPendingLocalCardChanges
    && canRenderLocalReviewScheduleForServerBase(
      serverBase,
      currentState.localFallback,
      currentState.hasCompleteLocalCardState,
      currentState.pendingLocalCardTotalDelta,
    )
  ) {
    return currentState.pendingLocalCardTotalDelta;
  }

  return 0;
}

function areDailyReviewsEqual(
  left: ReadonlyArray<DailyReviewPoint>,
  right: ReadonlyArray<DailyReviewPoint>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftDay = left[index];
    const rightDay = right[index];

    if (leftDay?.date !== rightDay?.date || leftDay?.reviewCount !== rightDay?.reviewCount) {
      return false;
    }
  }

  return true;
}

function areProgressChartDataEqual(left: ProgressChartData | null, right: ProgressChartData | null): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areDailyReviewsEqual(left.dailyReviews, right.dailyReviews);
}

function areProgressSummariesEqual(left: ProgressSummary, right: ProgressSummary): boolean {
  return left.currentStreakDays === right.currentStreakDays
    && left.hasReviewedToday === right.hasReviewedToday
    && left.lastReviewedOn === right.lastReviewedOn
    && left.activeReviewDays === right.activeReviewDays;
}

function areProgressReviewHistoryWatermarksEqual(
  left: ReadonlyArray<ProgressReviewHistoryWatermark>,
  right: ReadonlyArray<ProgressReviewHistoryWatermark>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftWatermark = left[index];
    const rightWatermark = right[index];

    if (
      leftWatermark?.workspaceId !== rightWatermark?.workspaceId
      || leftWatermark?.reviewSequenceId !== rightWatermark?.reviewSequenceId
    ) {
      return false;
    }
  }

  return true;
}

function areStringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function areProgressSummaryPayloadsEqual(
  left: ProgressSummaryPayload | null,
  right: ProgressSummaryPayload | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.timeZone === right.timeZone
    && left.generatedAt === right.generatedAt
    && areProgressReviewHistoryWatermarksEqual(left.reviewHistoryWatermarks, right.reviewHistoryWatermarks)
    && areProgressSummariesEqual(left.summary, right.summary);
}

function areProgressSummarySnapshotsEqual(
  left: ProgressSummarySnapshot | null,
  right: ProgressSummarySnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areProgressSummaryPayloadsEqual(left, right)
    && left.source === right.source
    && left.isApproximate === right.isApproximate;
}

function areProgressRenderedSeriesSummaryContextsEqual(
  left: ProgressRenderedSeriesSummaryContext | null,
  right: ProgressRenderedSeriesSummaryContext | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  const watermarksAreEqual = left.serverBaseReviewHistoryWatermarks === null
    ? right.serverBaseReviewHistoryWatermarks === null
    : right.serverBaseReviewHistoryWatermarks !== null
      && areProgressReviewHistoryWatermarksEqual(
        left.serverBaseReviewHistoryWatermarks,
        right.serverBaseReviewHistoryWatermarks,
      );

  return areProgressSummariesEqual(left.lowerBoundSummary, right.lowerBoundSummary)
    && areStringArraysEqual(left.activeDates, right.activeDates)
    && areStringArraysEqual(left.activeDatesMissingFromServerBase, right.activeDatesMissingFromServerBase)
    && watermarksAreEqual;
}

function areProgressSeriesEqual(left: ProgressSeries | null, right: ProgressSeries | null): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.timeZone === right.timeZone
    && left.from === right.from
    && left.to === right.to
    && left.generatedAt === right.generatedAt
    && areProgressReviewHistoryWatermarksEqual(left.reviewHistoryWatermarks, right.reviewHistoryWatermarks)
    && areDailyReviewsEqual(left.dailyReviews, right.dailyReviews);
}

function areProgressSeriesSnapshotsEqual(
  left: ProgressSeriesSnapshot | null,
  right: ProgressSeriesSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areProgressSeriesEqual(left, right)
    && left.source === right.source
    && left.isApproximate === right.isApproximate;
}

function areProgressReviewScheduleBucketsEqual(
  left: ReadonlyArray<ProgressReviewScheduleBucket>,
  right: ReadonlyArray<ProgressReviewScheduleBucket>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftBucket = left[index];
    const rightBucket = right[index];

    if (leftBucket?.key !== rightBucket?.key || leftBucket?.count !== rightBucket?.count) {
      return false;
    }
  }

  return true;
}

function areProgressReviewSchedulesEqual(
  left: ProgressReviewSchedule | null,
  right: ProgressReviewSchedule | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.timeZone === right.timeZone
    && left.generatedAt === right.generatedAt
    && areProgressReviewHistoryWatermarksEqual(left.reviewHistoryWatermarks, right.reviewHistoryWatermarks)
    && left.totalCards === right.totalCards
    && areProgressReviewScheduleBucketsEqual(left.buckets, right.buckets);
}

function areProgressReviewScheduleSnapshotsEqual(
  left: ProgressReviewScheduleSnapshot | null,
  right: ProgressReviewScheduleSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areProgressReviewSchedulesEqual(left, right)
    && left.source === right.source
    && left.isApproximate === right.isApproximate;
}

function areProgressLeaderboardMetricsEqual(
  left: ProgressLeaderboardMetric,
  right: ProgressLeaderboardMetric,
): boolean {
  return left.metricVersion === right.metricVersion
    && left.title === right.title
    && left.description === right.description;
}

function areProgressLeaderboardViewersEqual(
  left: ProgressLeaderboardViewer,
  right: ProgressLeaderboardViewer,
): boolean {
  return left.publicProfileId === right.publicProfileId
    && left.displayName === right.displayName
    && left.rank === right.rank
    && left.qualifiedReviewCount === right.qualifiedReviewCount;
}

function areProgressLeaderboardRowsEqual(
  left: ProgressLeaderboardRow,
  right: ProgressLeaderboardRow,
): boolean {
  if (left.kind === "gap" || right.kind === "gap") {
    return left.kind === right.kind;
  }

  return left.kind === right.kind
    && left.publicProfileId === right.publicProfileId
    && left.anonymousDisplayName === right.anonymousDisplayName
    && left.qualifiedReviewCount === right.qualifiedReviewCount
    && left.rank === right.rank;
}

function areProgressLeaderboardRowArraysEqual(
  left: ReadonlyArray<ProgressLeaderboardRow>,
  right: ReadonlyArray<ProgressLeaderboardRow>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftRow = left[index];
    const rightRow = right[index];

    if (leftRow === undefined || rightRow === undefined || areProgressLeaderboardRowsEqual(leftRow, rightRow) === false) {
      return false;
    }
  }

  return true;
}

function areProgressLeaderboardWindowsEqual(
  left: ProgressLeaderboardWindow,
  right: ProgressLeaderboardWindow,
): boolean {
  return left.windowKey === right.windowKey
    && left.snapshotId === right.snapshotId
    && left.snapshotGeneratedAt === right.snapshotGeneratedAt
    && left.asOfServerHour === right.asOfServerHour
    && left.nextRefreshAfter === right.nextRefreshAfter
    && left.participantCount === right.participantCount
    && areProgressLeaderboardViewersEqual(left.viewer, right.viewer)
    && areProgressLeaderboardRowArraysEqual(left.rows, right.rows);
}

function areProgressLeaderboardWindowArraysEqual(
  left: ReadonlyArray<ProgressLeaderboardWindow>,
  right: ReadonlyArray<ProgressLeaderboardWindow>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftWindow = left[index];
    const rightWindow = right[index];

    if (
      leftWindow === undefined
      || rightWindow === undefined
      || areProgressLeaderboardWindowsEqual(leftWindow, rightWindow) === false
    ) {
      return false;
    }
  }

  return true;
}

function areProgressLeaderboardSnapshotsEqual(
  left: ProgressLeaderboardSnapshot | null,
  right: ProgressLeaderboardSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.status === right.status
    && left.defaultWindowKey === right.defaultWindowKey
    && left.source === right.source
    && left.isApproximate === right.isApproximate
    && areProgressLeaderboardMetricsEqual(left.metric, right.metric)
    && areProgressLeaderboardWindowArraysEqual(left.windows, right.windows);
}

function areProgressLeaderboardLocalViewerCountsEqual(
  left: ProgressLeaderboardLocalViewerCounts | null,
  right: ProgressLeaderboardLocalViewerCounts | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return progressLeaderboardWindowKeys.every((windowKey) => left[windowKey] === right[windowKey]);
}

function areProgressLeaderboardSourceStatesEqual(
  left: ProgressLeaderboardSourceState,
  right: ProgressLeaderboardSourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && left.isNetworkError === right.isNetworkError
    && left.localViewerCountsErrorMessage === right.localViewerCountsErrorMessage
    && areProgressLeaderboardSnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressLeaderboardLocalViewerCountsEqual(left.localViewerCounts, right.localViewerCounts)
    && areProgressLeaderboardSnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

function areProgressSummarySourceStatesEqual(
  left: ProgressSummarySourceState,
  right: ProgressSummarySourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.referenceLocalDate === right.referenceLocalDate
    && left.hasPendingLocalReviews === right.hasPendingLocalReviews
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && areStringArraysEqual(left.localFallbackActiveDates, right.localFallbackActiveDates)
    && areProgressRenderedSeriesSummaryContextsEqual(left.renderedSeriesContext, right.renderedSeriesContext)
    && areProgressSummarySnapshotsEqual(left.localFallback, right.localFallback)
    && areProgressSummarySnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressSummarySnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

function areProgressSeriesSourceStatesEqual(
  left: ProgressSeriesSourceState,
  right: ProgressSeriesSourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && areProgressSeriesSnapshotsEqual(left.localFallback, right.localFallback)
    && areProgressSeriesSnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressChartDataEqual(left.pendingLocalOverlay, right.pendingLocalOverlay)
    && areProgressSeriesSnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

function areProgressReviewScheduleSourceStatesEqual(
  left: ProgressReviewScheduleSourceState,
  right: ProgressReviewScheduleSourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.progressScheduleLocalVersion === right.progressScheduleLocalVersion
    && left.serverBaseProgressScheduleLocalVersion === right.serverBaseProgressScheduleLocalVersion
    && left.serverBaseLocalCardTotalDelta === right.serverBaseLocalCardTotalDelta
    && left.hasPendingLocalCardChanges === right.hasPendingLocalCardChanges
    && left.hasCompleteLocalCardState === right.hasCompleteLocalCardState
    && left.pendingLocalCardTotalDelta === right.pendingLocalCardTotalDelta
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && areProgressReviewScheduleSnapshotsEqual(left.localFallback, right.localFallback)
    && areProgressReviewScheduleSnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressReviewScheduleSnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

export function areProgressSourceStatesEqual(left: ProgressSourceState, right: ProgressSourceState): boolean {
  return areProgressSummarySourceStatesEqual(left.summary, right.summary)
    && areProgressSeriesSourceStatesEqual(left.series, right.series)
    && areProgressReviewScheduleSourceStatesEqual(left.reviewSchedule, right.reviewSchedule)
    && areProgressLeaderboardSourceStatesEqual(left.leaderboard, right.leaderboard);
}

export function createEmptyProgressSummarySourceState(): ProgressSummarySourceState {
  return {
    scopeKey: null,
    referenceLocalDate: null,
    localFallback: null,
    localFallbackActiveDates: [],
    serverBase: null,
    hasPendingLocalReviews: false,
    renderedSeriesContext: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
  };
}

export function createEmptyProgressSeriesSourceState(): ProgressSeriesSourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    pendingLocalOverlay: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
  };
}

export function createEmptyProgressReviewScheduleSourceState(): ProgressReviewScheduleSourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    progressScheduleLocalVersion: 0,
    serverBaseProgressScheduleLocalVersion: null,
    serverBaseLocalCardTotalDelta: 0,
    hasPendingLocalCardChanges: false,
    hasCompleteLocalCardState: false,
    pendingLocalCardTotalDelta: 0,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
  };
}

export function createEmptyProgressLeaderboardSourceState(): ProgressLeaderboardSourceState {
  return {
    scopeKey: null,
    serverBase: null,
    localViewerCounts: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
    isNetworkError: false,
    localViewerCountsErrorMessage: "",
  };
}

export function createEmptyProgressSourceState(): ProgressSourceState {
  return {
    summary: createEmptyProgressSummarySourceState(),
    series: createEmptyProgressSeriesSourceState(),
    reviewSchedule: createEmptyProgressReviewScheduleSourceState(),
    leaderboard: createEmptyProgressLeaderboardSourceState(),
  };
}

export function createNextSummaryState(
  currentState: ProgressSummarySourceState,
  patch: Readonly<Partial<Omit<ProgressSummarySourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressSummarySourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedSummary(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.localFallbackActiveDates,
      nextStateWithoutRenderedSnapshot.hasPendingLocalReviews,
      nextStateWithoutRenderedSnapshot.renderedSeriesContext,
      nextStateWithoutRenderedSnapshot.referenceLocalDate,
      canRenderServerBase,
    ),
  };
}

export function createNextSeriesState(
  currentState: ProgressSeriesSourceState,
  patch: Readonly<Partial<Omit<ProgressSeriesSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressSeriesSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedSeries(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.pendingLocalOverlay,
      canRenderServerBase,
    ),
  };
}

export function createNextLeaderboardState(
  currentState: ProgressLeaderboardSourceState,
  patch: Readonly<Partial<Omit<ProgressLeaderboardSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressLeaderboardSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedLeaderboard(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localViewerCounts,
      canRenderServerBase,
    ),
  };
}

export function createNextReviewScheduleState(
  currentState: ProgressReviewScheduleSourceState,
  patch: Readonly<Partial<Omit<ProgressReviewScheduleSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressReviewScheduleSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedReviewSchedule(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.hasPendingLocalCardChanges,
      nextStateWithoutRenderedSnapshot.hasCompleteLocalCardState,
      nextStateWithoutRenderedSnapshot.pendingLocalCardTotalDelta,
      nextStateWithoutRenderedSnapshot.progressScheduleLocalVersion,
      nextStateWithoutRenderedSnapshot.serverBaseProgressScheduleLocalVersion,
      nextStateWithoutRenderedSnapshot.serverBaseLocalCardTotalDelta,
      canRenderServerBase,
    ),
  };
}
