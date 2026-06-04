import type { RemoteSyncFlags } from "./types";

export function createEmptyRemoteSyncFlags(): RemoteSyncFlags {
  return {
    didChangeProgressHistory: false,
    didChangeReviewSchedule: false,
  };
}

export function mergeRemoteSyncFlags(leftFlags: RemoteSyncFlags, rightFlags: RemoteSyncFlags): RemoteSyncFlags {
  return {
    didChangeProgressHistory: leftFlags.didChangeProgressHistory || rightFlags.didChangeProgressHistory,
    didChangeReviewSchedule: leftFlags.didChangeReviewSchedule || rightFlags.didChangeReviewSchedule,
  };
}
