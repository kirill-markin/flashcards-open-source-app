import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadProgressSeries, loadProgressSummary } from "../api";
import {
  hasPendingProgressReviewEvents,
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
  loadPendingProgressDailyReviews,
} from "../localDb/progress";
import type {
  CloudSettings,
  DailyReviewPoint,
  ProgressChartData,
  ProgressScopeKey,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSeriesSnapshot,
  ProgressSourceState,
  ProgressSummary,
  ProgressSummaryInput,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
  ProgressSummarySourceState,
  ProgressSeriesSourceState,
  WorkspaceSummary,
} from "../types";
import type { SessionVerificationState } from "./warmStart";

const progressRangeDayCount = 140;
const progressRangeStartOffsetDays = 1 - progressRangeDayCount;
const progressSummaryStorageKeyPrefix = "flashcards-progress-server-summary";
const progressSeriesStorageKeyPrefix = "flashcards-progress-server-series";
const progressServerSummaryVersion = 1;
const progressServerSeriesVersion = 1;
const progressTimeContextPollIntervalMs = 60_000;

type PersistedProgressSummary = Readonly<{
  version: 1;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSummaryPayload;
}>;

type PersistedProgressSeries = Readonly<{
  version: 1;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSeries;
}>;

type UseProgressSourceParams = Readonly<{
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  sessionVerificationState: SessionVerificationState;
  progressLocalVersion: number;
  progressServerInvalidationVersion: number;
  sections: ProgressSourceSections;
}>;

type UseProgressSourceResult = Readonly<{
  progressSourceState: ProgressSourceState;
  refreshProgress: () => Promise<void>;
}>;

type ProgressSourceSections = Readonly<{
  includeSummary: boolean;
  includeSeries: boolean;
}>;

type ProgressTimeContext = Readonly<{
  timeZone: string;
  today: string;
}>;

type LocalStorageLike = Storage & Record<string, string | undefined> & Readonly<{
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}>;

const fallbackLocalStorageState = new Map<string, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function getRequiredDatePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day",
): string {
  const partValue = parts.find((part) => part.type === partType)?.value;

  if (partValue === undefined || partValue === "") {
    throw new Error(`Browser timezone date is missing ${partType}`);
  }

  return partValue;
}

function getBrowserTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new Error("Browser timezone is unavailable");
  }

  return timeZone;
}

function formatDateAsLocalDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string): Date {
  const [rawYear, rawMonth, rawDay] = value.split("-");
  const year = Number.parseInt(rawYear ?? "", 10);
  const month = Number.parseInt(rawMonth ?? "", 10);
  const day = Number.parseInt(rawDay ?? "", 10);

  if (Number.isInteger(year) === false || Number.isInteger(month) === false || Number.isInteger(day) === false) {
    throw new Error(`Invalid local date: ${value}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

export function shiftLocalDate(value: string, offsetDays: number): string {
  const nextDate = parseLocalDate(value);
  nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays);
  return nextDate.toISOString().slice(0, 10);
}

function buildProgressTimeContext(now: Date): ProgressTimeContext {
  const timeZone = getBrowserTimeZone();

  return {
    timeZone,
    today: formatDateAsLocalDate(now, timeZone),
  };
}

export function buildProgressSeriesInput(now: Date): ProgressSeriesInput {
  const timeContext = buildProgressTimeContext(now);

  return {
    timeZone: timeContext.timeZone,
    from: shiftLocalDate(timeContext.today, progressRangeStartOffsetDays),
    to: timeContext.today,
  };
}

function createProgressChartData(dailyReviews: ReadonlyArray<DailyReviewPoint>): ProgressChartData {
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

function normalizeProgressSeries(series: ProgressSeries): ProgressSeries {
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
    dailyReviews: expandProgressDailyReviews(input, series.dailyReviews),
  };
}

function createProgressSummarySnapshot(
  payload: ProgressSummaryPayload,
  source: ProgressSummarySnapshot["source"],
  isApproximate: boolean,
): ProgressSummarySnapshot {
  return {
    timeZone: payload.timeZone,
    generatedAt: payload.generatedAt,
    summary: payload.summary,
    source,
    isApproximate,
  };
}

function createProgressSeriesSnapshot(
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

function buildLocalFallbackSeries(
  input: ProgressSeriesInput,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): ProgressSeries {
  return {
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
    generatedAt: null,
    dailyReviews: expandProgressDailyReviews(input, dailyReviews),
  };
}

function mergeProgressSeriesWithOverlay(
  serverBase: ProgressSeries,
  overlay: ProgressChartData | null,
): ProgressSeries {
  if (overlay === null || overlay.dailyReviews.length === 0) {
    return normalizeProgressSeries(serverBase);
  }

  const pendingReviewCounts = buildDailyReviewCountMap(overlay.dailyReviews);
  const normalizedServerBase = normalizeProgressSeries(serverBase);
  let hasOverlay = false;
  const dailyReviews = normalizedServerBase.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? 0;

    if (pendingReviewCount === 0) {
      return day;
    }

    hasOverlay = true;
    return {
      date: day.date,
      reviewCount: day.reviewCount + pendingReviewCount,
    };
  });

  if (hasOverlay === false) {
    return normalizedServerBase;
  }

  return {
    ...normalizedServerBase,
    dailyReviews,
  };
}

function hasPendingOverlayActivity(overlay: ProgressChartData | null): boolean {
  return overlay?.dailyReviews.some((day) => day.reviewCount > 0) ?? false;
}

function buildRenderedSummary(
  serverBase: ProgressSummarySnapshot | null,
  localFallback: ProgressSummarySnapshot | null,
  hasPendingLocalReviews: boolean,
  canRenderServerBase: boolean,
): ProgressSummarySnapshot | null {
  if (canRenderServerBase && serverBase !== null && hasPendingLocalReviews === false) {
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
    const mergedSeries = mergeProgressSeriesWithOverlay(serverBase, pendingLocalOverlay);
    return createProgressSeriesSnapshot(mergedSeries, "server", hasPendingOverlayActivity(pendingLocalOverlay));
  }

  return localFallback;
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

function areProgressSummarySourceStatesEqual(
  left: ProgressSummarySourceState,
  right: ProgressSummarySourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.hasPendingLocalReviews === right.hasPendingLocalReviews
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
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

function areProgressSourceStatesEqual(left: ProgressSourceState, right: ProgressSourceState): boolean {
  return areProgressSummarySourceStatesEqual(left.summary, right.summary)
    && areProgressSeriesSourceStatesEqual(left.series, right.series);
}

function createEmptyProgressSummarySourceState(): ProgressSummarySourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    hasPendingLocalReviews: false,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
  };
}

function createEmptyProgressSeriesSourceState(): ProgressSeriesSourceState {
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

function createEmptyProgressSourceState(): ProgressSourceState {
  return {
    summary: createEmptyProgressSummarySourceState(),
    series: createEmptyProgressSeriesSourceState(),
  };
}

function collectAccessibleWorkspaceIds(
  activeWorkspaceId: string | null,
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>,
): ReadonlyArray<string> {
  const workspaceIds = new Set<string>();

  for (const workspace of availableWorkspaces) {
    workspaceIds.add(workspace.workspaceId);
  }

  if (activeWorkspaceId !== null) {
    workspaceIds.add(activeWorkspaceId);
  }

  return [...workspaceIds].sort((leftWorkspaceId, rightWorkspaceId) => leftWorkspaceId.localeCompare(rightWorkspaceId));
}

export function buildProgressScopeKey(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSeriesInput,
): ProgressScopeKey {
  return `${workspaceIds.join(",")}::${input.timeZone}::${input.from}::${input.to}`;
}

function buildProgressSummaryScopeKey(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSummaryInput,
): ProgressScopeKey {
  return `${workspaceIds.join(",")}::${input.timeZone}::${input.today}`;
}

function buildProgressSummaryStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressSummaryStorageKeyPrefix}:${scopeKey}`;
}

function buildProgressSeriesStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressSeriesStorageKeyPrefix}:${scopeKey}`;
}

function readLocalStorageValue(key: string): string | null {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.getItem === "function") {
    return storage.getItem(key);
  }

  return fallbackLocalStorageState.get(key) ?? null;
}

function writeLocalStorageValue(key: string, value: string): void {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.setItem === "function") {
    storage.setItem(key, value);
    return;
  }

  fallbackLocalStorageState.set(key, value);
}

function parsePersistedProgressSummary(rawValue: string | null): PersistedProgressSummary | null {
  if (rawValue === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      isRecord(parsedValue) === false
      || parsedValue.version !== progressServerSummaryVersion
      || typeof parsedValue.scopeKey !== "string"
      || typeof parsedValue.savedAt !== "string"
      || isRecord(parsedValue.serverBase) === false
      || typeof parsedValue.serverBase.timeZone !== "string"
      || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
      || isRecord(parsedValue.serverBase.summary) === false
      || typeof parsedValue.serverBase.summary.currentStreakDays !== "number"
      || typeof parsedValue.serverBase.summary.hasReviewedToday !== "boolean"
      || (parsedValue.serverBase.summary.lastReviewedOn !== null && typeof parsedValue.serverBase.summary.lastReviewedOn !== "string")
      || typeof parsedValue.serverBase.summary.activeReviewDays !== "number"
    ) {
      return null;
    }

    return {
      version: 1,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase: {
        timeZone: parsedValue.serverBase.timeZone,
        generatedAt: parsedValue.serverBase.generatedAt,
        summary: {
          currentStreakDays: parsedValue.serverBase.summary.currentStreakDays,
          hasReviewedToday: parsedValue.serverBase.summary.hasReviewedToday,
          lastReviewedOn: parsedValue.serverBase.summary.lastReviewedOn,
          activeReviewDays: parsedValue.serverBase.summary.activeReviewDays,
        },
      },
    };
  } catch {
    return null;
  }
}

function parsePersistedProgressSeries(rawValue: string | null): PersistedProgressSeries | null {
  if (rawValue === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      isRecord(parsedValue) === false
      || parsedValue.version !== progressServerSeriesVersion
      || typeof parsedValue.scopeKey !== "string"
      || typeof parsedValue.savedAt !== "string"
      || isRecord(parsedValue.serverBase) === false
      || typeof parsedValue.serverBase.timeZone !== "string"
      || typeof parsedValue.serverBase.from !== "string"
      || typeof parsedValue.serverBase.to !== "string"
      || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
      || Array.isArray(parsedValue.serverBase.dailyReviews) === false
    ) {
      return null;
    }

    const dailyReviews = parsedValue.serverBase.dailyReviews
      .map((day): DailyReviewPoint | null => {
        if (isRecord(day) === false || typeof day.date !== "string" || typeof day.reviewCount !== "number") {
          return null;
        }

        return {
          date: day.date,
          reviewCount: day.reviewCount,
        };
      })
      .filter((day): day is DailyReviewPoint => day !== null);

    if (dailyReviews.length !== parsedValue.serverBase.dailyReviews.length) {
      return null;
    }

    return {
      version: 1,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase: normalizeProgressSeries({
        timeZone: parsedValue.serverBase.timeZone,
        from: parsedValue.serverBase.from,
        to: parsedValue.serverBase.to,
        generatedAt: parsedValue.serverBase.generatedAt,
        dailyReviews,
      }),
    };
  } catch {
    return null;
  }
}

function loadPersistedProgressSummary(scopeKey: ProgressScopeKey): ProgressSummaryPayload | null {
  const persistedValue = parsePersistedProgressSummary(readLocalStorageValue(buildProgressSummaryStorageKey(scopeKey)));

  if (persistedValue === null || persistedValue.scopeKey !== scopeKey) {
    return null;
  }

  return persistedValue.serverBase;
}

function loadPersistedProgressSeries(scopeKey: ProgressScopeKey): ProgressSeries | null {
  const persistedValue = parsePersistedProgressSeries(readLocalStorageValue(buildProgressSeriesStorageKey(scopeKey)));

  if (persistedValue === null || persistedValue.scopeKey !== scopeKey) {
    return null;
  }

  return persistedValue.serverBase;
}

function storePersistedProgressSummary(scopeKey: ProgressScopeKey, serverBase: ProgressSummaryPayload): void {
  const persistedValue: PersistedProgressSummary = {
    version: 1,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressSummaryStorageKey(scopeKey), JSON.stringify(persistedValue));
}

function storePersistedProgressSeries(scopeKey: ProgressScopeKey, serverBase: ProgressSeries): void {
  const persistedValue: PersistedProgressSeries = {
    version: 1,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase: normalizeProgressSeries(serverBase),
  };

  writeLocalStorageValue(buildProgressSeriesStorageKey(scopeKey), JSON.stringify(persistedValue));
}

function createNextSummaryState(
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
      nextStateWithoutRenderedSnapshot.hasPendingLocalReviews,
      canRenderServerBase,
    ),
  };
}

function createNextSeriesState(
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProgressSource(params: UseProgressSourceParams): UseProgressSourceResult {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressServerInvalidationVersion,
    sections,
  } = params;
  const { includeSummary, includeSeries } = sections;
  const [progressSourceState, setProgressSourceState] = useState<ProgressSourceState>(createEmptyProgressSourceState);
  const [timeContext, setTimeContext] = useState<ProgressTimeContext>(() => buildProgressTimeContext(new Date()));
  const [manualRefreshVersion, setManualRefreshVersion] = useState<number>(0);
  const currentSummaryScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentSeriesScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const canLoadServerBaseRef = useRef<boolean>(false);
  const summaryLocalLoadSequenceRef = useRef<number>(0);
  const seriesLocalLoadSequenceRef = useRef<number>(0);
  const summaryServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const seriesServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const requestedSummaryRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());
  const requestedSeriesRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const accessibleWorkspaceIds = useMemo(
    () => collectAccessibleWorkspaceIds(activeWorkspaceId, availableWorkspaces),
    [activeWorkspaceId, availableWorkspaces],
  );
  const summaryInput = useMemo<ProgressSummaryInput>(() => ({
    timeZone: timeContext.timeZone,
    today: timeContext.today,
  }), [timeContext]);
  const seriesInput = useMemo<ProgressSeriesInput>(() => ({
    timeZone: timeContext.timeZone,
    from: shiftLocalDate(timeContext.today, progressRangeStartOffsetDays),
    to: timeContext.today,
  }), [timeContext]);
  const summaryScopeKey = includeSummary === false || accessibleWorkspaceIds.length === 0
    ? null
    : buildProgressSummaryScopeKey(accessibleWorkspaceIds, summaryInput);
  const seriesScopeKey = includeSeries === false || accessibleWorkspaceIds.length === 0
    ? null
    : buildProgressScopeKey(accessibleWorkspaceIds, seriesInput);
  const canLoadServerBase = sessionVerificationState === "verified" && cloudSettings?.cloudState === "linked";
  const summaryRefreshKey = summaryScopeKey === null || canLoadServerBase === false
    ? null
    : `${summaryScopeKey}::${progressServerInvalidationVersion}::${manualRefreshVersion}`;
  const seriesRefreshKey = seriesScopeKey === null || canLoadServerBase === false
    ? null
    : `${seriesScopeKey}::${progressServerInvalidationVersion}::${manualRefreshVersion}`;

  canLoadServerBaseRef.current = canLoadServerBase;

  const commitProgressSourceState = useCallback(function commitProgressSourceState(
    buildNextState: (currentState: ProgressSourceState) => ProgressSourceState,
  ): void {
    setProgressSourceState((currentState) => {
      const nextState = buildNextState(currentState);
      return areProgressSourceStatesEqual(currentState, nextState) ? currentState : nextState;
    });
  }, []);

  useEffect(() => {
    function refreshTimeContext(): void {
      const nextTimeContext = buildProgressTimeContext(new Date());

      setTimeContext((currentTimeContext) => (
        currentTimeContext.timeZone === nextTimeContext.timeZone
        && currentTimeContext.today === nextTimeContext.today
      )
        ? currentTimeContext
        : nextTimeContext);
    }

    const intervalId = window.setInterval(refreshTimeContext, progressTimeContextPollIntervalMs);
    window.addEventListener("focus", refreshTimeContext);
    document.addEventListener("visibilitychange", refreshTimeContext);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshTimeContext);
      document.removeEventListener("visibilitychange", refreshTimeContext);
    };
  }, []);

  useEffect(() => {
    currentSummaryScopeKeyRef.current = summaryScopeKey;

    if (summaryScopeKey === null) {
      commitProgressSourceState((currentState) => ({
        ...currentState,
        summary: createEmptyProgressSummarySourceState(),
      }));
      return;
    }

    const persistedSummary = canLoadServerBase
      ? loadPersistedProgressSummary(summaryScopeKey)
      : null;

    commitProgressSourceState((currentState) => ({
      ...currentState,
      summary: createNextSummaryState(currentState.summary, {
        scopeKey: summaryScopeKey,
        localFallback: null,
        serverBase: persistedSummary === null ? null : createProgressSummarySnapshot(persistedSummary, "server", false),
        hasPendingLocalReviews: false,
        isLoading: true,
        errorMessage: "",
      }, canLoadServerBaseRef.current),
    }));
  }, [canLoadServerBase, commitProgressSourceState, summaryScopeKey]);

  useEffect(() => {
    currentSeriesScopeKeyRef.current = seriesScopeKey;

    if (seriesScopeKey === null) {
      commitProgressSourceState((currentState) => ({
        ...currentState,
        series: createEmptyProgressSeriesSourceState(),
      }));
      return;
    }

    const persistedSeries = canLoadServerBase
      ? loadPersistedProgressSeries(seriesScopeKey)
      : null;

    commitProgressSourceState((currentState) => ({
      ...currentState,
      series: createNextSeriesState(currentState.series, {
        scopeKey: seriesScopeKey,
        localFallback: null,
        serverBase: persistedSeries === null ? null : createProgressSeriesSnapshot(persistedSeries, "server", false),
        pendingLocalOverlay: null,
        isLoading: true,
        errorMessage: "",
      }, canLoadServerBaseRef.current),
    }));
  }, [canLoadServerBase, commitProgressSourceState, seriesScopeKey]);

  useEffect(() => {
    if (summaryScopeKey === null) {
      return;
    }

    const currentSequence = summaryLocalLoadSequenceRef.current + 1;
    summaryLocalLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressSummary(accessibleWorkspaceIds, summaryInput),
      hasPendingProgressReviewEvents(accessibleWorkspaceIds),
    ]).then(([localSummary, hasPendingLocalReviews]) => {
      if (currentSummaryScopeKeyRef.current !== summaryScopeKey || summaryLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      commitProgressSourceState((currentState) => ({
        ...currentState,
        summary: createNextSummaryState(currentState.summary, {
          scopeKey: summaryScopeKey,
          localFallback: createProgressSummarySnapshot({
            timeZone: summaryInput.timeZone,
            generatedAt: null,
            summary: localSummary,
          }, "local_only", true),
          hasPendingLocalReviews,
          isLoading: false,
        }, canLoadServerBaseRef.current),
      }));
    }).catch((error: unknown) => {
      if (currentSummaryScopeKeyRef.current !== summaryScopeKey || summaryLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      commitProgressSourceState((currentState) => ({
        ...currentState,
        summary: createNextSummaryState(currentState.summary, {
          scopeKey: summaryScopeKey,
          localFallback: null,
          hasPendingLocalReviews: false,
          isLoading: false,
          errorMessage: getErrorMessage(error),
        }, canLoadServerBaseRef.current),
      }));
    });
  }, [
    accessibleWorkspaceIds,
    commitProgressSourceState,
    includeSummary,
    manualRefreshVersion,
    progressLocalVersion,
    summaryInput,
    summaryScopeKey,
  ]);

  useEffect(() => {
    if (seriesScopeKey === null) {
      return;
    }

    const currentSequence = seriesLocalLoadSequenceRef.current + 1;
    seriesLocalLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressDailyReviews(accessibleWorkspaceIds, seriesInput),
      loadPendingProgressDailyReviews(accessibleWorkspaceIds, seriesInput),
    ]).then(([localDailyReviews, pendingLocalDailyReviews]) => {
      if (currentSeriesScopeKeyRef.current !== seriesScopeKey || seriesLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      commitProgressSourceState((currentState) => ({
        ...currentState,
        series: createNextSeriesState(currentState.series, {
          scopeKey: seriesScopeKey,
          localFallback: createProgressSeriesSnapshot(buildLocalFallbackSeries(seriesInput, localDailyReviews), "local_only", true),
          pendingLocalOverlay: createProgressChartData(pendingLocalDailyReviews),
          isLoading: false,
        }, canLoadServerBaseRef.current),
      }));
    }).catch((error: unknown) => {
      if (currentSeriesScopeKeyRef.current !== seriesScopeKey || seriesLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      commitProgressSourceState((currentState) => ({
        ...currentState,
        series: createNextSeriesState(currentState.series, {
          scopeKey: seriesScopeKey,
          localFallback: null,
          pendingLocalOverlay: null,
          isLoading: false,
          errorMessage: getErrorMessage(error),
        }, canLoadServerBaseRef.current),
      }));
    });
  }, [
    accessibleWorkspaceIds,
    commitProgressSourceState,
    includeSeries,
    manualRefreshVersion,
    progressLocalVersion,
    seriesInput,
    seriesScopeKey,
  ]);

  const refreshProgressSummary = useCallback(async function refreshProgressSummary(
    targetScopeKey: ProgressScopeKey,
    input: ProgressSummaryInput,
    nextRefreshKey: string,
  ): Promise<void> {
    requestedSummaryRefreshKeysRef.current.set(targetScopeKey, nextRefreshKey);

    const inFlightRefresh = summaryServerRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefreshKey = requestedSummaryRefreshKeysRef.current.get(targetScopeKey);

          if (requestedRefreshKey === undefined) {
            throw new Error(`Missing requested progress summary refresh key for scope ${targetScopeKey}`);
          }

          try {
            const serverSummary = await loadProgressSummary(input);

            if (currentSummaryScopeKeyRef.current === targetScopeKey) {
              storePersistedProgressSummary(targetScopeKey, serverSummary);
              commitProgressSourceState((currentState) => ({
                ...currentState,
                summary: createNextSummaryState(currentState.summary, {
                  scopeKey: targetScopeKey,
                  serverBase: createProgressSummarySnapshot(serverSummary, "server", false),
                  isLoading: false,
                  errorMessage: "",
                }, canLoadServerBaseRef.current),
              }));
            }
          } catch (error) {
            if (currentSummaryScopeKeyRef.current === targetScopeKey) {
              commitProgressSourceState((currentState) => ({
                ...currentState,
                summary: createNextSummaryState(currentState.summary, {
                  scopeKey: targetScopeKey,
                  isLoading: false,
                  errorMessage: getErrorMessage(error),
                }, canLoadServerBaseRef.current),
              }));
            }
          }

          if (requestedSummaryRefreshKeysRef.current.get(targetScopeKey) === requestedRefreshKey) {
            requestedSummaryRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        summaryServerRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    summaryServerRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [commitProgressSourceState]);

  const refreshProgressSeries = useCallback(async function refreshProgressSeries(
    targetScopeKey: ProgressScopeKey,
    input: ProgressSeriesInput,
    nextRefreshKey: string,
  ): Promise<void> {
    requestedSeriesRefreshKeysRef.current.set(targetScopeKey, nextRefreshKey);

    const inFlightRefresh = seriesServerRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefreshKey = requestedSeriesRefreshKeysRef.current.get(targetScopeKey);

          if (requestedRefreshKey === undefined) {
            throw new Error(`Missing requested progress series refresh key for scope ${targetScopeKey}`);
          }

          try {
            const serverSeries = normalizeProgressSeries(await loadProgressSeries(input));

            if (currentSeriesScopeKeyRef.current === targetScopeKey) {
              storePersistedProgressSeries(targetScopeKey, serverSeries);
              commitProgressSourceState((currentState) => ({
                ...currentState,
                series: createNextSeriesState(currentState.series, {
                  scopeKey: targetScopeKey,
                  serverBase: createProgressSeriesSnapshot(serverSeries, "server", false),
                  isLoading: false,
                  errorMessage: "",
                }, canLoadServerBaseRef.current),
              }));
            }
          } catch (error) {
            if (currentSeriesScopeKeyRef.current === targetScopeKey) {
              commitProgressSourceState((currentState) => ({
                ...currentState,
                series: createNextSeriesState(currentState.series, {
                  scopeKey: targetScopeKey,
                  isLoading: false,
                  errorMessage: getErrorMessage(error),
                }, canLoadServerBaseRef.current),
              }));
            }
          }

          if (requestedSeriesRefreshKeysRef.current.get(targetScopeKey) === requestedRefreshKey) {
            requestedSeriesRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        seriesServerRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    seriesServerRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [commitProgressSourceState]);

  useEffect(() => {
    if (summaryScopeKey === null || summaryRefreshKey === null) {
      return;
    }

    if (requestedSummaryRefreshKeysRef.current.get(summaryScopeKey) === summaryRefreshKey) {
      return;
    }

    void refreshProgressSummary(summaryScopeKey, summaryInput, summaryRefreshKey);
  }, [refreshProgressSummary, summaryInput, summaryRefreshKey, summaryScopeKey]);

  useEffect(() => {
    if (seriesScopeKey === null || seriesRefreshKey === null) {
      return;
    }

    if (requestedSeriesRefreshKeysRef.current.get(seriesScopeKey) === seriesRefreshKey) {
      return;
    }

    void refreshProgressSeries(seriesScopeKey, seriesInput, seriesRefreshKey);
  }, [refreshProgressSeries, seriesInput, seriesRefreshKey, seriesScopeKey]);

  const refreshProgress = useCallback(async function refreshProgress(): Promise<void> {
    if (summaryScopeKey === null && seriesScopeKey === null) {
      commitProgressSourceState((currentState) => ({
        summary: createNextSummaryState(currentState.summary, {
          errorMessage: "",
        }, canLoadServerBase),
        series: createNextSeriesState(currentState.series, {
          errorMessage: "",
        }, canLoadServerBase),
      }));
      return;
    }

    const nextManualRefreshVersion = manualRefreshVersion + 1;
    commitProgressSourceState((currentState) => ({
      summary: summaryScopeKey === null
        ? currentState.summary
        : createNextSummaryState(currentState.summary, {
          scopeKey: summaryScopeKey,
          isLoading: true,
          errorMessage: "",
        }, canLoadServerBase),
      series: seriesScopeKey === null
        ? currentState.series
        : createNextSeriesState(currentState.series, {
          scopeKey: seriesScopeKey,
          isLoading: true,
          errorMessage: "",
        }, canLoadServerBase),
    }));
    setManualRefreshVersion(nextManualRefreshVersion);

    if (canLoadServerBase === false) {
      return;
    }

    const refreshPromises: Array<Promise<void>> = [];

    if (summaryScopeKey !== null) {
      refreshPromises.push(refreshProgressSummary(
        summaryScopeKey,
        summaryInput,
        `${summaryScopeKey}::${progressServerInvalidationVersion}::${nextManualRefreshVersion}`,
      ));
    }

    if (seriesScopeKey !== null) {
      refreshPromises.push(refreshProgressSeries(
        seriesScopeKey,
        seriesInput,
        `${seriesScopeKey}::${progressServerInvalidationVersion}::${nextManualRefreshVersion}`,
      ));
    }

    await Promise.all(refreshPromises);
  }, [
    canLoadServerBase,
    commitProgressSourceState,
    manualRefreshVersion,
    progressServerInvalidationVersion,
    refreshProgressSeries,
    refreshProgressSummary,
    seriesInput,
    seriesScopeKey,
    summaryInput,
    summaryScopeKey,
  ]);

  return {
    progressSourceState,
    refreshProgress,
  };
}
