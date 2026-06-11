import type {
  ProgressReviewSchedule,
  ProgressReviewScheduleSnapshot,
  ProgressReviewScheduleSourceState,
} from "../../../types";

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

export function buildRenderedReviewSchedule(
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
