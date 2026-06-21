export type ProgressSeriesInput = Readonly<{
  timeZone: string;
  from: string;
  to: string;
}>;

export type ProgressSummaryInput = Readonly<{
  timeZone: string;
  today: string;
}>;

export type ProgressReviewScheduleInput = Readonly<{
  timeZone: string;
  today: string;
}>;

export type ProgressScopeKey = string;

export type DailyReviewPoint = Readonly<{
  date: string;
  reviewCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
}>;

export const streakDayStates = [
  "reviewed",
  "frozen",
  "missed",
  "pending",
] as const;

export type StreakDayState = typeof streakDayStates[number];

export type StreakFreeze = Readonly<{
  availableCredits: number;
  capacity: number;
  balanceUnits: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}>;

export type StreakDay = Readonly<{
  date: string;
  state: StreakDayState;
}>;

export type ProgressSummary = Readonly<{
  currentStreakDays: number;
  longestStreakDays: number;
  hasReviewedToday: boolean;
  lastReviewedOn: string | null;
  activeReviewDays: number;
  streakFreeze: StreakFreeze;
}>;

export type ProgressReviewHistoryWatermark = Readonly<{
  workspaceId: string;
  reviewSequenceId: number;
}>;

export type ReviewProgressBadgeState = Readonly<{
  streakDays: number;
  hasReviewedToday: boolean;
  streakFreeze: StreakFreeze;
  isInteractive: boolean;
}>;

export type ReviewLeaderboardBadgeState = Readonly<{
  rank: number | null;
  windowKey: ProgressLeaderboardWindowKey | null;
  isInteractive: boolean;
}>;

export type ProgressChartData = Readonly<{
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
}>;

export type ProgressSummaryPayload = Readonly<{
  timeZone: string;
  generatedAt: string | null;
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
  summary: ProgressSummary;
}>;

export type ProgressSeries = Readonly<{
  timeZone: string;
  from: string;
  to: string;
  generatedAt: string | null;
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
  streakDays: ReadonlyArray<StreakDay>;
}>;

/** Canonical bucket order for the progress chart and the runtime validation set for incoming bucket keys. Reordering or removing entries is a breaking change for the UI. */
export const progressReviewScheduleBucketKeys = [
  "new",
  "today",
  "days1To7",
  "days8To30",
  "days31To90",
  "days91To360",
  "years1To2",
  "later",
] as const;

export type ProgressReviewScheduleBucketKey = typeof progressReviewScheduleBucketKeys[number];

export type ProgressReviewScheduleBucket = Readonly<{
  key: ProgressReviewScheduleBucketKey;
  count: number;
}>;

export type ProgressReviewSchedule = Readonly<{
  timeZone: string;
  generatedAt: string | null;
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
  totalCards: number;
  buckets: ReadonlyArray<ProgressReviewScheduleBucket>;
}>;

export type ProgressSummarySnapshot = ProgressSummaryPayload & Readonly<{
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

export type ProgressSeriesSnapshot = ProgressSeries & Readonly<{
  chartData: ProgressChartData;
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

export type ProgressReviewScheduleSnapshot = ProgressReviewSchedule & Readonly<{
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

/** Canonical leaderboard window order for the period control and the runtime validation set for incoming window keys. Keep in sync with apps/backend/src/community/leaderboard/leaderboardWindows.ts. */
export const progressLeaderboardWindowKeys = [
  "last_24_hours",
  "last_3_days",
  "last_7_days",
  "last_30_days",
  "all_time",
] as const;

export type ProgressLeaderboardWindowKey = typeof progressLeaderboardWindowKeys[number];

/** Rolling window lower bounds in whole hours from the current instant; null means unbounded (all time). Keep in sync with apps/backend/src/community/leaderboard/leaderboardWindows.ts. */
export const progressLeaderboardWindowLowerBoundHours: Readonly<Record<ProgressLeaderboardWindowKey, number | null>> = {
  last_24_hours: 24,
  last_3_days: 72,
  last_7_days: 168,
  last_30_days: 720,
  all_time: null,
};

export const progressLeaderboardStatuses = [
  "ready",
  "linked_account_required",
  "participation_disabled",
  "snapshot_unavailable",
] as const;

export type ProgressLeaderboardStatus = typeof progressLeaderboardStatuses[number];

export type ProgressLeaderboardMetric = Readonly<{
  metricVersion: "qualified_reviews_v1";
  title: string;
  description: string;
}>;

export type ProgressLeaderboardViewer = Readonly<{
  publicProfileId: string;
  displayName: string;
  rank: number;
  qualifiedReviewCount: number;
}>;

export const progressLeaderboardParticipantRowKinds = ["top", "neighbor", "viewer"] as const;

export type ProgressLeaderboardParticipantRowKind = typeof progressLeaderboardParticipantRowKinds[number];

export type ProgressLeaderboardParticipantRow = Readonly<{
  kind: ProgressLeaderboardParticipantRowKind;
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  qualifiedReviewCount: number;
  rank: number;
}>;

export type ProgressLeaderboardGapRow = Readonly<{
  kind: "gap";
}>;

export type ProgressLeaderboardRow = ProgressLeaderboardParticipantRow | ProgressLeaderboardGapRow;

export const progressLeaderboardRankingRowKinds = ["participant", "viewer"] as const;

export type ProgressLeaderboardRankingRowKind = typeof progressLeaderboardRankingRowKinds[number];

export type ProgressLeaderboardRankingRow = Readonly<{
  kind: ProgressLeaderboardRankingRowKind;
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  qualifiedReviewCount: number;
  rank: number;
}>;

export type ProgressLeaderboardWindow = Readonly<{
  windowKey: ProgressLeaderboardWindowKey;
  snapshotId: string;
  snapshotGeneratedAt: string;
  asOfServerHour: string;
  nextRefreshAfter: string;
  participantCount: number;
  viewer: ProgressLeaderboardViewer;
  rows: ReadonlyArray<ProgressLeaderboardRow>;
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>;
}>;

export type ProgressLeaderboard = Readonly<{
  status: ProgressLeaderboardStatus;
  metric: ProgressLeaderboardMetric;
  defaultWindowKey: ProgressLeaderboardWindowKey;
  windows: ReadonlyArray<ProgressLeaderboardWindow>;
}>;

/** Locally counted qualified reviews (rating !== 0) per rolling window, used only to overlay the viewer row count. */
export type ProgressLeaderboardLocalViewerCounts = Readonly<Record<ProgressLeaderboardWindowKey, number>>;

export type ProgressLeaderboardSnapshot = ProgressLeaderboard & Readonly<{
  source: "server";
  isApproximate: boolean;
}>;

export const progressStreakLeaderboardStatuses = [
  "ready",
  "linked_account_required",
  "participation_disabled",
  "snapshot_unavailable",
] as const;

export type ProgressStreakLeaderboardStatus = typeof progressStreakLeaderboardStatuses[number];

export type ProgressStreakLeaderboardMetric = Readonly<{
  metricVersion: "streak_days_v1";
  title: string;
  description: string;
}>;

export type ProgressStreakLeaderboardViewer = Readonly<{
  publicProfileId: string;
  displayName: "You";
  rank: number;
  streakDays: number;
}>;

export const progressStreakLeaderboardParticipantRowKinds = ["top", "neighbor", "viewer"] as const;

export type ProgressStreakLeaderboardParticipantRowKind = typeof progressStreakLeaderboardParticipantRowKinds[number];

export type ProgressStreakLeaderboardParticipantRow = Readonly<{
  kind: ProgressStreakLeaderboardParticipantRowKind;
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  streakDays: number;
  rank: number;
}>;

export type ProgressStreakLeaderboardGapRow = Readonly<{
  kind: "gap";
}>;

export type ProgressStreakLeaderboardRow = ProgressStreakLeaderboardParticipantRow | ProgressStreakLeaderboardGapRow;

export const progressStreakLeaderboardRankingRowKinds = ["participant", "viewer"] as const;

export type ProgressStreakLeaderboardRankingRowKind = typeof progressStreakLeaderboardRankingRowKinds[number];

export type ProgressStreakLeaderboardRankingRow = Readonly<{
  kind: ProgressStreakLeaderboardRankingRowKind;
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  streakDays: number;
  rank: number;
}>;

export type ProgressStreakLeaderboardReady = Readonly<{
  status: "ready";
  metric: ProgressStreakLeaderboardMetric;
  snapshotId: string;
  snapshotGeneratedAt: string;
  asOfUtcDate: string;
  nextRefreshAfter: string;
  participantCount: number;
  viewer: ProgressStreakLeaderboardViewer;
  rows: ReadonlyArray<ProgressStreakLeaderboardRow>;
  rankingRows: ReadonlyArray<ProgressStreakLeaderboardRankingRow>;
}>;

export type ProgressStreakLeaderboardNonReady = Readonly<{
  status: Exclude<ProgressStreakLeaderboardStatus, "ready">;
  metric: ProgressStreakLeaderboardMetric;
}>;

export type ProgressStreakLeaderboard = ProgressStreakLeaderboardReady | ProgressStreakLeaderboardNonReady;

export type ProgressStreakLeaderboardReadySnapshot = Omit<
  ProgressStreakLeaderboardReady,
  "snapshotId" | "snapshotGeneratedAt" | "asOfUtcDate" | "nextRefreshAfter"
> & Readonly<{
  snapshotId: string | null;
  snapshotGeneratedAt: string | null;
  asOfUtcDate: string | null;
  nextRefreshAfter: string | null;
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

export type ProgressStreakLeaderboardNonReadySnapshot = ProgressStreakLeaderboardNonReady & Readonly<{
  source: "server";
  isApproximate: boolean;
}>;

export type ProgressStreakLeaderboardSnapshot =
  | ProgressStreakLeaderboardReadySnapshot
  | ProgressStreakLeaderboardNonReadySnapshot;

export type ProgressRenderedSeriesSummaryContext = Readonly<{
  lowerBoundSummary: ProgressSummary;
  activeDates: ReadonlyArray<string>;
  activeDatesMissingFromServerBase: ReadonlyArray<string>;
}>;

export type ProgressSummarySourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  referenceLocalDate: string | null;
  localFallback: ProgressSummarySnapshot | null;
  localFallbackActiveDates: ReadonlyArray<string>;
  serverBase: ProgressSummarySnapshot | null;
  hasPendingLocalReviews: boolean;
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null;
  renderedSnapshot: ProgressSummarySnapshot | null;
  isLoading: boolean;
  errorMessage: string;
  technicalError: Error | null;
}>;

export type ProgressSeriesSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  localFallback: ProgressSeriesSnapshot | null;
  localFallbackActiveDates: ReadonlyArray<string>;
  serverBase: ProgressSeriesSnapshot | null;
  pendingLocalOverlay: ProgressChartData | null;
  renderedSnapshot: ProgressSeriesSnapshot | null;
  isLoading: boolean;
  errorMessage: string;
  technicalError: Error | null;
}>;

export type ProgressReviewScheduleSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  localFallback: ProgressReviewScheduleSnapshot | null;
  serverBase: ProgressReviewScheduleSnapshot | null;
  progressScheduleLocalVersion: number;
  serverBaseProgressScheduleLocalVersion: number | null;
  serverBaseLocalCardTotalDelta: number;
  hasPendingLocalCardChanges: boolean;
  hasCompleteLocalCardState: boolean;
  pendingLocalCardTotalDelta: number;
  renderedSnapshot: ProgressReviewScheduleSnapshot | null;
  isLoading: boolean;
  errorMessage: string;
  technicalError: Error | null;
}>;

export type ProgressLeaderboardSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  serverBase: ProgressLeaderboardSnapshot | null;
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null;
  renderedSnapshot: ProgressLeaderboardSnapshot | null;
  /** True only while a server leaderboard load is expected; local viewer counts never drive this flag. */
  isLoading: boolean;
  /** Last server leaderboard load failure; empty after a successful or skipped server load. */
  errorMessage: string;
  technicalError: Error | null;
  /** True when `errorMessage` came from a transport-level failure (offline/unreachable) rather than an HTTP error response. */
  isNetworkError: boolean;
  /** Last local viewer-count load failure; kept apart from `errorMessage` so a local-only failure is never rendered as a server or offline state. */
  localViewerCountsErrorMessage: string;
  localViewerCountsTechnicalError: Error | null;
}>;

export type ProgressStreakLeaderboardSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  serverBase: ProgressStreakLeaderboardSnapshot | null;
  currentSummary: ProgressSummarySnapshot | null;
  renderedSnapshot: ProgressStreakLeaderboardSnapshot | null;
  isLoading: boolean;
  errorMessage: string;
  technicalError: Error | null;
  isNetworkError: boolean;
}>;

export type ProgressSourceState = Readonly<{
  summary: ProgressSummarySourceState;
  series: ProgressSeriesSourceState;
  reviewSchedule: ProgressReviewScheduleSourceState;
  leaderboard: ProgressLeaderboardSourceState;
  streakLeaderboard: ProgressStreakLeaderboardSourceState;
}>;
