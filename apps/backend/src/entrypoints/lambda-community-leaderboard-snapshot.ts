import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../observability/sentry";
import { LEADERBOARD_SNAPSHOT_METRIC_VERSION } from "../community/leaderboard/leaderboardWindows";

initializeBackendSentry("community-leaderboard-snapshot");

type CommunityLeaderboardSnapshotResponse = Readonly<{
  ok: true;
  metricVersion: string;
  generatedAt: string;
  asOfServerHour: string;
  windowCount: number;
}>;

type CommunityLeaderboardSnapshotRuntime = Readonly<{
  generateLeaderboardSnapshots: typeof import("../community/leaderboard/leaderboardSnapshots").generateLeaderboardSnapshots;
}>;

let communityLeaderboardSnapshotRuntimePromise: Promise<CommunityLeaderboardSnapshotRuntime> | null = null;

async function createCommunityLeaderboardSnapshotRuntime(): Promise<CommunityLeaderboardSnapshotRuntime> {
  const { generateLeaderboardSnapshots } = await import("../community/leaderboard/leaderboardSnapshots");
  return {
    generateLeaderboardSnapshots,
  };
}

function getCommunityLeaderboardSnapshotRuntime(): Promise<CommunityLeaderboardSnapshotRuntime> {
  if (communityLeaderboardSnapshotRuntimePromise === null) {
    communityLeaderboardSnapshotRuntimePromise = createCommunityLeaderboardSnapshotRuntime();
  }

  return communityLeaderboardSnapshotRuntimePromise;
}

const communityLeaderboardSnapshotHandler: Handler<
  unknown,
  CommunityLeaderboardSnapshotResponse
> = async (_event, context) => {
  const observationScope = createBackendObservationScope(
    "community-leaderboard-snapshot",
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
    const runtime = await getCommunityLeaderboardSnapshotRuntime();
    const result = await runtime.generateLeaderboardSnapshots();

    addBackendBreadcrumb({
      action: "community_leaderboard_snapshot_generated",
      scope: observationScope,
      details: {
        metricVersion: result.metricVersion,
        generatedAtUtc: result.generatedAt,
        asOfServerHourUtc: result.asOfServerHour,
        windowCount: result.windows.length,
      },
    });

    return {
      ok: true,
      metricVersion: result.metricVersion,
      generatedAt: result.generatedAt,
      asOfServerHour: result.asOfServerHour,
      windowCount: result.windows.length,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "community_leaderboard_snapshot_failed",
      error: normalizedError,
      scope: observationScope,
      details: {
        metricVersion: LEADERBOARD_SNAPSHOT_METRIC_VERSION,
        message: normalizedError.message,
      },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(communityLeaderboardSnapshotHandler);
