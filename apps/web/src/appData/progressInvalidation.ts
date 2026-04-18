import { useSyncExternalStore } from "react";

type ProgressInvalidationSnapshot = Readonly<{
  progressLocalVersion: number;
  progressServerInvalidationVersion: number;
}>;

type ProgressInvalidationListener = () => void;

let progressInvalidationSnapshot: ProgressInvalidationSnapshot = {
  progressLocalVersion: 0,
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

export function invalidateLocalProgress(): void {
  updateProgressInvalidationSnapshot((currentSnapshot) => ({
    ...currentSnapshot,
    progressLocalVersion: currentSnapshot.progressLocalVersion + 1,
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
