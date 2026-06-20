// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ProgressLeaderboard, ProgressSourceState } from "../../../types";
import {
  buildServerStreakLeaderboard,
  buildServerSummary,
  flushEffects,
  linkedCloudSettings,
  loadProgressLeaderboardMock,
  loadProgressStreakLeaderboardMock,
  loadProgressSummaryMock,
  renderHarness,
} from "./progressSourceTestSupport";

const summaryAndLeaderboardSections = {
  includeSummary: true,
  includeSeries: false,
  includeReviewSchedule: false,
  includeLeaderboard: true,
} as const;

function buildNonReadyRatingLeaderboard(): ProgressLeaderboard {
  return {
    status: "linked_account_required",
    metric: {
      metricVersion: "qualified_reviews_v1",
      title: "Qualified reviews",
      description: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
    },
    defaultWindowKey: "last_24_hours",
    windows: [],
  };
}

function getReadyStreakLeaderboardState(state: ProgressSourceState): Extract<
  NonNullable<ProgressSourceState["streakLeaderboard"]["renderedSnapshot"]>,
  { status: "ready" }
> {
  const streakLeaderboard = state.streakLeaderboard.renderedSnapshot;
  if (streakLeaderboard === null || streakLeaderboard.status !== "ready") {
    throw new Error("Expected a ready rendered streak leaderboard snapshot.");
  }

  return streakLeaderboard;
}

describe("useProgressSource streak leaderboard", () => {
  it("projects the current summary streak into the server streak leaderboard before equal streak values", async () => {
    loadProgressSummaryMock.mockResolvedValue(buildServerSummary(5, "2026-04-18T09:15:00.000Z"));
    loadProgressLeaderboardMock.mockResolvedValue(buildNonReadyRatingLeaderboard());
    loadProgressStreakLeaderboardMock.mockResolvedValue(buildServerStreakLeaderboard(3));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndLeaderboardSections,
    });

    await flushEffects();

    const streakLeaderboard = getReadyStreakLeaderboardState(harness.getApi().progressSourceState);
    expect(streakLeaderboard.source).toBe("server");
    expect(streakLeaderboard.isApproximate).toBe(true);
    expect(streakLeaderboard.viewer.streakDays).toBe(5);
    expect(streakLeaderboard.viewer.rank).toBe(2);
    expect(streakLeaderboard.rankingRows.map((row) => ({
      publicProfileId: row.publicProfileId,
      streakDays: row.streakDays,
      rank: row.rank,
    }))).toEqual([
      { publicProfileId: "profile-1", streakDays: 8, rank: 1 },
      { publicProfileId: "viewer-profile", streakDays: 5, rank: 2 },
      { publicProfileId: "profile-2", streakDays: 5, rank: 3 },
      { publicProfileId: "profile-4", streakDays: 1, rank: 4 },
    ]);
    expect(streakLeaderboard.rows).toContainEqual(expect.objectContaining({
      kind: "viewer",
      rank: 2,
      streakDays: 5,
    }));
  });

  it("renders a viewer-only local streak row when the server streak leaderboard is non-ready", async () => {
    loadProgressSummaryMock.mockResolvedValue(buildServerSummary(4, "2026-04-18T09:15:00.000Z"));
    loadProgressLeaderboardMock.mockResolvedValue(buildNonReadyRatingLeaderboard());
    loadProgressStreakLeaderboardMock.mockResolvedValue({
      status: "snapshot_unavailable",
      metric: {
        metricVersion: "streak_days_v1",
        title: "Current streak days",
        description: "Ranks use current streak days from the public daily snapshot.",
      },
    });

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndLeaderboardSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.streakLeaderboard.serverBase?.status).toBe("snapshot_unavailable");
    const streakLeaderboard = getReadyStreakLeaderboardState(harness.getApi().progressSourceState);
    expect(streakLeaderboard.source).toBe("local_only");
    expect(streakLeaderboard.viewer.streakDays).toBe(4);
    expect(streakLeaderboard.viewer.rank).toBe(1);
    expect(streakLeaderboard.rankingRows).toEqual([
      {
        kind: "viewer",
        publicProfileId: "local-viewer",
        anonymousDisplayName: "You",
        streakDays: 4,
        rank: 1,
      },
    ]);
  });
});
