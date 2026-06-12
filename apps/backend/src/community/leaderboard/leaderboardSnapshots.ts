import { unsafeRepeatableReadTransaction } from "../../database/unsafe";
import { type DatabaseExecutor } from "../../database";
import {
  LEADERBOARD_SNAPSHOT_METRIC_VERSION,
  LEADERBOARD_WINDOWS,
  assertSupportedLeaderboardMetricVersion,
  truncateToServerHour,
  type LeaderboardWindow,
  type LeaderboardWindowKey,
} from "./leaderboardWindows";

/**
 * Community leaderboard snapshot generation.
 *
 * Each hourly job run regenerates every window's snapshot from opted-in
 * public profiles plus their countable community.public_review_activity_facts.
 * The cross-user read, exclusion rules, tie-neutral ordering, and atomic entry
 * replacement live in the SECURITY DEFINER function
 * community.refresh_leaderboard_snapshot (see db/migrations/0059_leaderboard_snapshots.sql
 * through db/migrations/0062_leaderboard_guest_participants.sql); this module
 * owns the injectable clock, the window set, metric-version validation, and
 * sequencing the per-window refreshes inside one repeatable-read transaction.
 */

type RefreshLeaderboardSnapshotParams = Readonly<{
  metricVersion: string;
  window: LeaderboardWindow;
  asOfServerHour: string;
  generatedAt: string;
}>;

type RefreshLeaderboardSnapshotFn = (
  executor: DatabaseExecutor,
  params: RefreshLeaderboardSnapshotParams,
) => Promise<string>;

type WithTransactionFn = <Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
) => Promise<Result>;

export type LeaderboardSnapshotWindowResult = Readonly<{
  windowKey: LeaderboardWindowKey;
  snapshotId: string;
}>;

export type LeaderboardSnapshotRunResult = Readonly<{
  metricVersion: string;
  generatedAt: string;
  asOfServerHour: string;
  windows: ReadonlyArray<LeaderboardSnapshotWindowResult>;
}>;

export type GenerateLeaderboardSnapshotsDependencies = Readonly<{
  metricVersion: string;
  now: () => Date;
  withTransactionFn: WithTransactionFn;
  refreshLeaderboardSnapshotFn: RefreshLeaderboardSnapshotFn;
}>;

type LeaderboardSnapshotIdRow = Readonly<{
  snapshot_id: string;
}>;

export async function refreshLeaderboardSnapshotInExecutor(
  executor: DatabaseExecutor,
  params: RefreshLeaderboardSnapshotParams,
): Promise<string> {
  const result = await executor.query<LeaderboardSnapshotIdRow>(
    "SELECT community.refresh_leaderboard_snapshot($1, $2, $3, $4, $5) AS snapshot_id",
    [
      params.metricVersion,
      params.window.windowKey,
      params.window.lowerBoundHours,
      params.asOfServerHour,
      params.generatedAt,
    ],
  );

  const row = result.rows[0];
  if (row === undefined || row.snapshot_id === null) {
    throw new Error(
      `community.refresh_leaderboard_snapshot returned no snapshot id for window ${params.window.windowKey}.`,
    );
  }

  return row.snapshot_id;
}

export async function generateLeaderboardSnapshotsWithDependencies(
  dependencies: GenerateLeaderboardSnapshotsDependencies,
): Promise<LeaderboardSnapshotRunResult> {
  assertSupportedLeaderboardMetricVersion(dependencies.metricVersion);

  const generatedAtDate = dependencies.now();
  const generatedAt = generatedAtDate.toISOString();
  const asOfServerHour = truncateToServerHour(generatedAtDate).toISOString();

  const windows = await dependencies.withTransactionFn(async (executor) => {
    const windowResults: Array<LeaderboardSnapshotWindowResult> = [];
    for (const window of LEADERBOARD_WINDOWS) {
      const snapshotId = await dependencies.refreshLeaderboardSnapshotFn(executor, {
        metricVersion: dependencies.metricVersion,
        window,
        asOfServerHour,
        generatedAt,
      });
      windowResults.push({ windowKey: window.windowKey, snapshotId });
    }

    return windowResults;
  });

  return {
    metricVersion: dependencies.metricVersion,
    generatedAt,
    asOfServerHour,
    windows,
  };
}

export async function generateLeaderboardSnapshots(): Promise<LeaderboardSnapshotRunResult> {
  return generateLeaderboardSnapshotsWithDependencies({
    metricVersion: LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    now: () => new Date(),
    withTransactionFn: unsafeRepeatableReadTransaction,
    refreshLeaderboardSnapshotFn: refreshLeaderboardSnapshotInExecutor,
  });
}
