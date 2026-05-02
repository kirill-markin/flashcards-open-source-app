import { useSyncExternalStore } from "react";
import {
  buildProgressDateContext,
  type ProgressDateContext,
} from "../../progress/progressDates";

const progressTimeContextPollIntervalMs = 60_000;

export type ProgressTimeContext = ProgressDateContext;

type ProgressTimeContextListener = () => void;

let progressTimeContextSnapshot: ProgressTimeContext | null = null;

const progressTimeContextListeners = new Set<ProgressTimeContextListener>();

export function buildProgressTimeContext(now: Date): ProgressTimeContext {
  return buildProgressDateContext(now);
}

function areProgressTimeContextsEqual(
  left: ProgressTimeContext,
  right: ProgressTimeContext,
): boolean {
  return left.timeZone === right.timeZone && left.today === right.today;
}

function notifyProgressTimeContextListeners(): void {
  for (const listener of progressTimeContextListeners) {
    listener();
  }
}

function getProgressTimeContextSnapshot(): ProgressTimeContext {
  if (progressTimeContextSnapshot === null) {
    progressTimeContextSnapshot = buildProgressTimeContext(new Date());
  }

  return progressTimeContextSnapshot;
}

function subscribeToProgressTimeContext(
  listener: ProgressTimeContextListener,
): () => void {
  progressTimeContextListeners.add(listener);

  return (): void => {
    progressTimeContextListeners.delete(listener);
  };
}

export function updateProgressTimeContext(now: Date): boolean {
  const nextSnapshot = buildProgressTimeContext(now);
  const currentSnapshot = getProgressTimeContextSnapshot();

  if (areProgressTimeContextsEqual(currentSnapshot, nextSnapshot)) {
    return false;
  }

  progressTimeContextSnapshot = nextSnapshot;
  notifyProgressTimeContextListeners();
  return true;
}

export function resetProgressTimeContextStateForTests(now: Date): void {
  progressTimeContextSnapshot = buildProgressTimeContext(now);
  notifyProgressTimeContextListeners();
}

export function useProgressTimeContext(): ProgressTimeContext {
  return useSyncExternalStore(
    subscribeToProgressTimeContext,
    getProgressTimeContextSnapshot,
    getProgressTimeContextSnapshot,
  );
}

export {
  progressTimeContextPollIntervalMs,
};
