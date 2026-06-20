import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../observability/sentry";
import { STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION } from "../community/leaderboard/streakLeaderboardSnapshots";
import { withTransientDatabaseRetry } from "../database/transient";

initializeBackendSentry("streak-leaderboard-snapshot");

type StreakLeaderboardSnapshotResponse = Readonly<{
  ok: true;
  metricVersion: string;
  generatedAt: string;
  asOfUtcDate: string;
  snapshotId: string;
  pagesScanned: number;
  participantsScanned: number;
  entryCount: number;
}>;

type StreakLeaderboardSnapshotRuntime = Readonly<{
  generateStreakLeaderboardSnapshots: typeof import("../community/leaderboard/streakLeaderboardSnapshots").generateStreakLeaderboardSnapshots;
}>;

let streakLeaderboardSnapshotRuntimePromise: Promise<StreakLeaderboardSnapshotRuntime> | null = null;

async function createStreakLeaderboardSnapshotRuntime(): Promise<StreakLeaderboardSnapshotRuntime> {
  const { generateStreakLeaderboardSnapshots } = await import("../community/leaderboard/streakLeaderboardSnapshots");
  return {
    generateStreakLeaderboardSnapshots,
  };
}

function getStreakLeaderboardSnapshotRuntime(): Promise<StreakLeaderboardSnapshotRuntime> {
  if (streakLeaderboardSnapshotRuntimePromise === null) {
    streakLeaderboardSnapshotRuntimePromise = createStreakLeaderboardSnapshotRuntime();
  }

  return streakLeaderboardSnapshotRuntimePromise;
}

const streakLeaderboardSnapshotHandler: Handler<
  unknown,
  StreakLeaderboardSnapshotResponse
> = async (_event, context) => {
  const observationScope = createBackendObservationScope(
    "streak-leaderboard-snapshot",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  try {
    const runtime = await getStreakLeaderboardSnapshotRuntime();
    const result = await withTransientDatabaseRetry(
      () => runtime.generateStreakLeaderboardSnapshots(),
      () => observationScope,
    );

    addBackendBreadcrumb({
      action: "streak_leaderboard_snapshot_generated",
      scope: observationScope,
      details: {
        metricVersion: result.metricVersion,
        generatedAtUtc: result.generatedAt,
        asOfUtcDate: result.asOfUtcDate,
        snapshotId: result.snapshotId,
        pagesScanned: result.pagesScanned,
        participantsScanned: result.participantsScanned,
        entryCount: result.entryCount,
      },
    });

    return {
      ok: true,
      metricVersion: result.metricVersion,
      generatedAt: result.generatedAt,
      asOfUtcDate: result.asOfUtcDate,
      snapshotId: result.snapshotId,
      pagesScanned: result.pagesScanned,
      participantsScanned: result.participantsScanned,
      entryCount: result.entryCount,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "streak_leaderboard_snapshot_failed",
      error: normalizedError,
      scope: observationScope,
      details: {
        metricVersion: STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
        message: normalizedError.message,
      },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(streakLeaderboardSnapshotHandler);
