/**
 * Leaderboard window definitions and the snapshot metric contract.
 *
 * Windows are expressed as whole-hour lower bounds relative to a snapshot's
 * `as_of_server_hour`. The window covers `(as_of - lowerBoundHours, as_of]` on
 * `reviewed_at_client`. `all_time` has no lower bound (`lowerBoundHours === null`)
 * and only the `as_of` upper bound applies.
 */

export const LEADERBOARD_SNAPSHOT_METRIC_VERSION = "qualified_reviews_v1";

export const LEADERBOARD_WINDOW_KEYS = [
  "last_24_hours",
  "last_3_days",
  "last_7_days",
  "last_30_days",
  "all_time",
] as const;

export type LeaderboardWindowKey = (typeof LEADERBOARD_WINDOW_KEYS)[number];

export type LeaderboardWindow = Readonly<{
  windowKey: LeaderboardWindowKey;
  lowerBoundHours: number | null;
}>;

const HOURS_PER_DAY = 24;

/**
 * All five windows generated in one snapshot job run, ordered shortest to longest.
 * Lower bounds are exact hour counts from `as_of_server_hour`.
 */
export const LEADERBOARD_WINDOWS: ReadonlyArray<LeaderboardWindow> = [
  { windowKey: "last_24_hours", lowerBoundHours: 24 },
  { windowKey: "last_3_days", lowerBoundHours: 3 * HOURS_PER_DAY },
  { windowKey: "last_7_days", lowerBoundHours: 7 * HOURS_PER_DAY },
  { windowKey: "last_30_days", lowerBoundHours: 30 * HOURS_PER_DAY },
  { windowKey: "all_time", lowerBoundHours: null },
];

export class UnsupportedLeaderboardMetricVersionError extends Error {
  readonly name = "UnsupportedLeaderboardMetricVersionError";
  readonly metricVersion: string;

  constructor(metricVersion: string) {
    super(`Unsupported leaderboard metric version: ${metricVersion}. Supported: ${LEADERBOARD_SNAPSHOT_METRIC_VERSION}.`);
    this.metricVersion = metricVersion;
  }
}

export class InvalidLeaderboardWindowKeyError extends Error {
  readonly name = "InvalidLeaderboardWindowKeyError";
  readonly windowKey: string;

  constructor(windowKey: string) {
    super(`Invalid leaderboard window key: ${windowKey}. Supported: ${LEADERBOARD_WINDOW_KEYS.join(", ")}.`);
    this.windowKey = windowKey;
  }
}

export function isLeaderboardWindowKey(value: string): value is LeaderboardWindowKey {
  return (LEADERBOARD_WINDOW_KEYS as ReadonlyArray<string>).includes(value);
}

/**
 * Raises {@link UnsupportedLeaderboardMetricVersionError} unless the version is the
 * single metric version this snapshot job supports.
 */
export function assertSupportedLeaderboardMetricVersion(metricVersion: string): void {
  if (metricVersion !== LEADERBOARD_SNAPSHOT_METRIC_VERSION) {
    throw new UnsupportedLeaderboardMetricVersionError(metricVersion);
  }
}

/**
 * Raises {@link InvalidLeaderboardWindowKeyError} unless the key is a known window key.
 */
export function assertLeaderboardWindowKey(windowKey: string): LeaderboardWindowKey {
  if (!isLeaderboardWindowKey(windowKey)) {
    throw new InvalidLeaderboardWindowKeyError(windowKey);
  }

  return windowKey;
}

/**
 * Fallback window when a payload cannot rank the viewer yet. Ready payloads
 * compute their default from the viewer's best placement across all windows.
 */
export const DEFAULT_COMPACT_LEADERBOARD_WINDOW_KEY: LeaderboardWindowKey = "last_24_hours";

export type LeaderboardPlacementCandidate = Readonly<{
  windowKey: LeaderboardWindowKey;
  rank: number;
}>;

export type LeaderboardBestPlacement = Readonly<{
  windowKey: LeaderboardWindowKey;
  rank: number;
}>;

/**
 * Resolves the viewer's strongest leaderboard placement. Lower rank wins, and
 * ties keep the shortest window because LEADERBOARD_WINDOW_KEYS is ordered from
 * shortest to longest.
 */
export function resolveBestLeaderboardPlacement(
  candidates: ReadonlyArray<LeaderboardPlacementCandidate>,
): LeaderboardBestPlacement | null {
  let bestPlacement: LeaderboardBestPlacement | null = null;

  for (const windowKey of LEADERBOARD_WINDOW_KEYS) {
    const candidate = candidates.find((entry) => entry.windowKey === windowKey);
    if (candidate === undefined) {
      continue;
    }

    if (bestPlacement === null || candidate.rank < bestPlacement.rank) {
      bestPlacement = {
        windowKey: candidate.windowKey,
        rank: candidate.rank,
      };
    }
  }

  return bestPlacement;
}

/**
 * Truncates a wall-clock instant to the start of its UTC hour, matching the SQL
 * `date_trunc('hour', now())` semantics used for `as_of_server_hour`.
 */
export function truncateToServerHour(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0,
    0,
    0,
  ));
}
