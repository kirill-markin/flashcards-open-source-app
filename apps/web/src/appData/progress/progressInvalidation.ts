import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  progressTimeContextPollIntervalMs,
  updateProgressTimeContext,
} from "./progressTimeContext";

type ProgressInvalidationSnapshot = Readonly<{
  progressLocalVersion: number;
  progressScheduleLocalVersion: number;
  progressServerInvalidationVersion: number;
}>;

type ProgressInvalidationListener = () => void;

let progressInvalidationSnapshot: ProgressInvalidationSnapshot = {
  progressLocalVersion: 0,
  progressScheduleLocalVersion: 0,
  progressServerInvalidationVersion: 0,
};

const progressInvalidationListeners = new Set<ProgressInvalidationListener>();

function notifyProgressInvalidationListeners(): void {
  for (const listener of progressInvalidationListeners) {
    listener();
  }
}

function updateProgressInvalidationSnapshot(
  buildNextSnapshot: (currentSnapshot: ProgressInvalidationSnapshot) => ProgressInvalidationSnapshot,
): void {
  progressInvalidationSnapshot = buildNextSnapshot(progressInvalidationSnapshot);
  notifyProgressInvalidationListeners();
}

function subscribeToProgressInvalidation(listener: ProgressInvalidationListener): () => void {
  progressInvalidationListeners.add(listener);

  return (): void => {
    progressInvalidationListeners.delete(listener);
  };
}

function getProgressInvalidationSnapshot(): ProgressInvalidationSnapshot {
  return progressInvalidationSnapshot;
}

export function resetProgressInvalidationStateForTests(): void {
  progressInvalidationSnapshot = {
    progressLocalVersion: 0,
    progressScheduleLocalVersion: 0,
    progressServerInvalidationVersion: 0,
  };
  notifyProgressInvalidationListeners();
}

export function invalidateLocalProgress(): void {
  updateProgressInvalidationSnapshot((currentSnapshot) => ({
    ...currentSnapshot,
    progressLocalVersion: currentSnapshot.progressLocalVersion + 1,
  }));
}

export function invalidateLocalReviewSchedule(): void {
  updateProgressInvalidationSnapshot((currentSnapshot) => ({
    ...currentSnapshot,
    progressScheduleLocalVersion: currentSnapshot.progressScheduleLocalVersion + 1,
  }));
}

export function invalidateServerProgress(): void {
  updateProgressInvalidationSnapshot((currentSnapshot) => ({
    ...currentSnapshot,
    progressServerInvalidationVersion: currentSnapshot.progressServerInvalidationVersion + 1,
  }));
}

export function invalidateProgress(): void {
  updateProgressInvalidationSnapshot((currentSnapshot) => ({
    ...currentSnapshot,
    progressLocalVersion: currentSnapshot.progressLocalVersion + 1,
    progressServerInvalidationVersion: currentSnapshot.progressServerInvalidationVersion + 1,
  }));
}

export function useProgressInvalidationState(): ProgressInvalidationSnapshot {
  return useSyncExternalStore(
    subscribeToProgressInvalidation,
    getProgressInvalidationSnapshot,
    getProgressInvalidationSnapshot,
  );
}

export function useProgressInvalidationRefresh(): void {
  const isForegroundRefreshQueuedRef = useRef<boolean>(false);

  useEffect(() => {
    updateProgressTimeContext(new Date());

    function refreshForTimeContextChange(): void {
      if (updateProgressTimeContext(new Date())) {
        invalidateProgress();
      }
    }

    function queueForegroundRefresh(): void {
      if (document.visibilityState !== "visible" || isForegroundRefreshQueuedRef.current) {
        return;
      }

      isForegroundRefreshQueuedRef.current = true;
      Promise.resolve().then(() => {
        isForegroundRefreshQueuedRef.current = false;
        if (document.visibilityState !== "visible") {
          return;
        }

        refreshForTimeContextChange();
      });
    }

    const intervalId = window.setInterval(refreshForTimeContextChange, progressTimeContextPollIntervalMs);
    window.addEventListener("focus", queueForegroundRefresh);
    document.addEventListener("visibilitychange", queueForegroundRefresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", queueForegroundRefresh);
      document.removeEventListener("visibilitychange", queueForegroundRefresh);
    };
  }, []);
}
