import { useEffect } from "react";
import {
  invalidateLocalProgress,
  invalidateLocalReviewSchedule,
  invalidateServerProgress,
} from "./progressInvalidation";

export type DeferredProgressRefresh = Readonly<{
  didChangeLocalProgress: boolean;
  didChangeReviewSchedule: boolean;
  didChangeServerProgress: boolean;
}>;

type VisibleProgressRatingListener = () => void;

const progressDeferredRefreshDelayMs = 3_000;

const noDeferredProgressRefresh: DeferredProgressRefresh = {
  didChangeLocalProgress: false,
  didChangeReviewSchedule: false,
  didChangeServerProgress: false,
};

/** For changes whose progress effect is unknown, such as a sync that failed after it may have applied pages. */
export const fullDeferredProgressRefresh: DeferredProgressRefresh = {
  didChangeLocalProgress: true,
  didChangeReviewSchedule: true,
  didChangeServerProgress: true,
};

export function mergeDeferredProgressRefreshes(
  left: DeferredProgressRefresh,
  right: DeferredProgressRefresh,
): DeferredProgressRefresh {
  return {
    didChangeLocalProgress: left.didChangeLocalProgress || right.didChangeLocalProgress,
    didChangeReviewSchedule: left.didChangeReviewSchedule || right.didChangeReviewSchedule,
    didChangeServerProgress: left.didChangeServerProgress || right.didChangeServerProgress,
  };
}

const visibleProgressRatingListeners = new Set<VisibleProgressRatingListener>();
let pendingDeferredProgressRefresh: DeferredProgressRefresh = noDeferredProgressRefresh;
let deferredProgressRefreshTimeoutId: number | null = null;
let shownProgressScreenCount = 0;

/*
 * A rating updates only the streak badge in memory; summary, charts and leaderboard rescans wait for
 * `scheduleDeferredProgressRefresh`: docs/fsrs-scheduling-logic.md#non-blocking-review
 */
export function applyRatingToVisibleProgressBadges(): void {
  for (const listener of visibleProgressRatingListeners) {
    listener();
  }
}

export function subscribeToVisibleProgressRatings(listener: VisibleProgressRatingListener): () => void {
  visibleProgressRatingListeners.add(listener);

  return (): void => {
    visibleProgressRatingListeners.delete(listener);
  };
}

function clearDeferredProgressRefreshTimeout(): void {
  if (deferredProgressRefreshTimeoutId !== null) {
    window.clearTimeout(deferredProgressRefreshTimeoutId);
    deferredProgressRefreshTimeoutId = null;
  }
}

function runDeferredProgressRefresh(): void {
  clearDeferredProgressRefreshTimeout();
  const refresh = pendingDeferredProgressRefresh;
  pendingDeferredProgressRefresh = noDeferredProgressRefresh;
  if (refresh.didChangeLocalProgress) {
    invalidateLocalProgress();
  }
  if (refresh.didChangeReviewSchedule) {
    invalidateLocalReviewSchedule();
  }
  if (refresh.didChangeServerProgress) {
    invalidateServerProgress();
  }
}

/** Runs at once while Progress is shown, otherwise once 3 s after the last rating or sync. */
export function scheduleDeferredProgressRefresh(refresh: DeferredProgressRefresh): void {
  pendingDeferredProgressRefresh = mergeDeferredProgressRefreshes(pendingDeferredProgressRefresh, refresh);
  if (shownProgressScreenCount > 0) {
    runDeferredProgressRefresh();
    return;
  }

  clearDeferredProgressRefreshTimeout();
  deferredProgressRefreshTimeoutId = window.setTimeout(runDeferredProgressRefresh, progressDeferredRefreshDelayMs);
}

/**
 * Mounted by the Progress screen. A fresh mount loads fresh data, so a pending deferred refresh is dropped instead
 * of invalidating it into a second load: docs/fsrs-scheduling-logic.md#non-blocking-review
 */
export function useDeferredProgressRefreshWhileShown(): void {
  useEffect(() => {
    shownProgressScreenCount += 1;
    clearDeferredProgressRefreshTimeout();
    pendingDeferredProgressRefresh = noDeferredProgressRefresh;
    return () => {
      shownProgressScreenCount -= 1;
    };
  }, []);
}
