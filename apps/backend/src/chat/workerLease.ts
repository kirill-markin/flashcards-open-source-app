export const CHAT_RUN_HEARTBEAT_INTERVAL_MS = 5_000;
export const CHAT_RUN_STALE_HEARTBEAT_MS = 30_000;

/**
 * Returns true when a run heartbeat is old enough that another worker may recover the run.
 */
export function isChatRunHeartbeatStale(
  heartbeatAt: number | null,
  now: number,
): boolean {
  if (heartbeatAt === null) {
    return true;
  }

  return now - heartbeatAt > CHAT_RUN_STALE_HEARTBEAT_MS;
}
