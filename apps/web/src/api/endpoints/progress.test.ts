// @vitest-environment jsdom
import type { ProgressLeaderboardProfileReady, ProgressReviewSchedule, StreakDay } from "../../types";
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import {
  createJsonResponse,
  createProgressReviewScheduleResponse,
  createProgressReviewScheduleResponseValue,
  replaceProgressReviewScheduleBucketCount,
  swapFirstProgressReviewScheduleBuckets,
} from "../ApiTestSupport";
import {
  loadProgressLeaderboardProfile,
  loadProgressReviewSchedule,
  loadProgressSeries,
  loadProgressStreakLeaderboard,
  loadProgressSummary,
} from "./progress";

function createFullStreakFreeze(): Readonly<{
  availableCredits: number;
  capacity: number;
  balanceUnits: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}> {
  return {
    availableCredits: 2,
    capacity: 2,
    balanceUnits: 20,
    unitsPerCredit: 10,
    earnedUnitsPerStreakDay: 1,
    nextCreditProgressUnits: 0,
    nextCreditRequiredUnits: 10,
  };
}

function createProgressSummaryValue(
  currentStreakDays: number,
  hasReviewedToday: boolean,
  lastReviewedOn: string | null,
  activeReviewDays: number,
): Readonly<{
  currentStreakDays: number;
  longestStreakDays: number;
  hasReviewedToday: boolean;
  lastReviewedOn: string | null;
  activeReviewDays: number;
  streakFreeze: ReturnType<typeof createFullStreakFreeze>;
}> {
  return {
    currentStreakDays,
    longestStreakDays: currentStreakDays,
    hasReviewedToday,
    lastReviewedOn,
    activeReviewDays,
    streakFreeze: createFullStreakFreeze(),
  };
}

function createThreeDayStreakDays(): ReadonlyArray<StreakDay> {
  return [
    { date: "2026-04-01", state: "reviewed" },
    { date: "2026-04-02", state: "frozen" },
    { date: "2026-04-03", state: "reviewed" },
  ];
}

function createProgressStreakLeaderboardValue(): Readonly<{
  status: "ready";
  metric: Readonly<{
    metricVersion: "streak_days_v1";
    title: string;
    description: string;
  }>;
  snapshotId: string;
  snapshotGeneratedAt: string;
  asOfUtcDate: string;
  nextRefreshAfter: string;
  participantCount: number;
  viewer: Readonly<{
    publicProfileId: string;
    displayName: "You";
    rank: number;
    streakDays: number;
  }>;
  rows: ReadonlyArray<Readonly<{
    kind: "top" | "viewer";
    publicProfileId: string;
    anonymousDisplayName: string;
    streakDays: number;
    rank: number;
  }>>;
  rankingRows: ReadonlyArray<Readonly<{
    kind: "participant" | "viewer";
    publicProfileId: string;
    anonymousDisplayName: string;
    streakDays: number;
    rank: number;
  }>>;
}> {
  return {
    status: "ready",
    metric: {
      metricVersion: "streak_days_v1",
      title: "Current streak days",
      description: "Ranks use current streak days from the public daily snapshot.",
    },
    snapshotId: "3e6c0b88-5f5a-4db3-8c8c-9d6a3840a1e4",
    snapshotGeneratedAt: "2026-06-10T12:00:05.000Z",
    asOfUtcDate: "2026-06-10",
    nextRefreshAfter: "2026-06-11T12:00:00.000Z",
    participantCount: 2,
    viewer: {
      publicProfileId: "viewer-profile",
      displayName: "You",
      rank: 2,
      streakDays: 3,
    },
    rows: [
      { kind: "top", publicProfileId: "profile-1", anonymousDisplayName: "Silver Bright Harbor", streakDays: 5, rank: 1 },
      { kind: "viewer", publicProfileId: "viewer-profile", anonymousDisplayName: "Jade Swift River", streakDays: 3, rank: 2 },
    ],
    rankingRows: [
      { kind: "participant", publicProfileId: "profile-1", anonymousDisplayName: "Silver Bright Harbor", streakDays: 5, rank: 1 },
      { kind: "viewer", publicProfileId: "viewer-profile", anonymousDisplayName: "Jade Swift River", streakDays: 3, rank: 2 },
    ],
  };
}

function createProgressLeaderboardProfileActivityDays(): ProgressLeaderboardProfileReady["reviewActivity"]["days"] {
  return Array.from({ length: 30 }, (_value, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    reviewCount: index % 4,
  }));
}

function createProgressLeaderboardProfileValue(publicProfileId: string): ProgressLeaderboardProfileReady {
  return {
    status: "ready",
    publicProfileId,
    anonymousDisplayName: "Silver Bright Harbor",
    friendDisplayName: "Mina",
    isFriend: true,
    metrics: {
      currentStreakDays: 6,
      bestRatingPlacement: {
        windowKey: "last_24_hours",
        rank: 2,
      },
    },
    reviewActivity: {
      dateBasis: "profile_local_day_with_utc_fallback",
      days: createProgressLeaderboardProfileActivityDays(),
    },
    stats: {
      joinedAt: "2026-04-01T08:00:00.000Z",
      totalCards: 42,
    },
    generatedAt: "2026-06-10T12:00:05.000Z",
  };
}

describe("progress API endpoints", () => {
  it("decodes progress summary responses with generatedAt metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        reviewHistoryWatermarks: [
          { workspaceId: "workspace-1", reviewSequenceId: 42 },
        ],
        summary: createProgressSummaryValue(1, true, "2026-04-03", 2),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-18T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummaryValue(1, true, "2026-04-03", 2),
    });
  });

  it("decodes progress summary responses without review-history watermark metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        summary: createProgressSummaryValue(1, true, "2026-04-03", 2),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-18T09:15:00.000Z",
      reviewHistoryWatermarks: [],
      summary: createProgressSummaryValue(1, true, "2026-04-03", 2),
    });
  });

  it("decodes progress summary streak freeze policies with capacity above the local default", async () => {
    const streakFreeze = {
      availableCredits: 2,
      capacity: 3,
      balanceUnits: 28,
      unitsPerCredit: 10,
      earnedUnitsPerStreakDay: 2,
      nextCreditProgressUnits: 8,
      nextCreditRequiredUnits: 10,
    } as const;
    const summary = {
      ...createProgressSummaryValue(1, true, "2026-04-03", 2),
      streakFreeze,
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        summary,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-18T09:15:00.000Z",
      reviewHistoryWatermarks: [],
      summary,
    });
  });

  it("decodes progress series responses without summary metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        from: "2026-04-01",
        to: "2026-04-03",
        generatedAt: "2026-04-18T09:15:00.000Z",
        reviewHistoryWatermarks: [
          { workspaceId: "workspace-1", reviewSequenceId: 42 },
        ],
        dailyReviews: [
          {
            date: "2026-04-01",
            reviewCount: 3,
            againCount: 1,
            hardCount: 1,
            goodCount: 1,
            easyCount: 0,
          },
          {
            date: "2026-04-02",
            reviewCount: 0,
            againCount: 0,
            hardCount: 0,
            goodCount: 0,
            easyCount: 0,
          },
          {
            date: "2026-04-03",
            reviewCount: 1,
            againCount: 0,
            hardCount: 0,
            goodCount: 1,
            easyCount: 0,
          },
        ],
        streakDays: createThreeDayStreakDays(),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSeries({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
      generatedAt: "2026-04-18T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [
        {
          date: "2026-04-01",
          reviewCount: 3,
          againCount: 1,
          hardCount: 1,
          goodCount: 1,
          easyCount: 0,
        },
        {
          date: "2026-04-02",
          reviewCount: 0,
          againCount: 0,
          hardCount: 0,
          goodCount: 0,
          easyCount: 0,
        },
        {
          date: "2026-04-03",
          reviewCount: 1,
          againCount: 0,
          hardCount: 0,
          goodCount: 1,
          easyCount: 0,
        },
      ],
      streakDays: createThreeDayStreakDays(),
    });
  });

  it("decodes progress series responses without review-history watermark metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        from: "2026-04-01",
        to: "2026-04-03",
        generatedAt: "2026-04-18T09:15:00.000Z",
        dailyReviews: [
          {
            date: "2026-04-01",
            reviewCount: 3,
            againCount: 1,
            hardCount: 1,
            goodCount: 1,
            easyCount: 0,
          },
          {
            date: "2026-04-02",
            reviewCount: 0,
            againCount: 0,
            hardCount: 0,
            goodCount: 0,
            easyCount: 0,
          },
          {
            date: "2026-04-03",
            reviewCount: 1,
            againCount: 0,
            hardCount: 0,
            goodCount: 1,
            easyCount: 0,
          },
        ],
        streakDays: createThreeDayStreakDays(),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSeries({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
      generatedAt: "2026-04-18T09:15:00.000Z",
      reviewHistoryWatermarks: [],
      dailyReviews: [
        {
          date: "2026-04-01",
          reviewCount: 3,
          againCount: 1,
          hardCount: 1,
          goodCount: 1,
          easyCount: 0,
        },
        {
          date: "2026-04-02",
          reviewCount: 0,
          againCount: 0,
          hardCount: 0,
          goodCount: 0,
          easyCount: 0,
        },
        {
          date: "2026-04-03",
          reviewCount: 1,
          againCount: 0,
          hardCount: 0,
          goodCount: 1,
          easyCount: 0,
        },
      ],
      streakDays: createThreeDayStreakDays(),
    });
  });

  it("rejects progress series responses with missing rating counts", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        from: "2026-04-01",
        to: "2026-04-03",
        generatedAt: "2026-04-18T09:15:00.000Z",
        dailyReviews: [
          {
            date: "2026-04-01",
            reviewCount: 3,
            hardCount: 1,
            goodCount: 1,
            easyCount: 1,
          },
        ],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSeries({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/series: dailyReviews[0].againCount must be number",
    );
  });

  it("decodes streak leaderboard responses from the streak leaderboard path", async () => {
    const responseValue = createProgressStreakLeaderboardValue();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(responseValue));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressStreakLeaderboard()).resolves.toEqual(responseValue);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/me/progress/leaderboards/streak",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects streak leaderboard responses where the viewer is below an equal streak row", async () => {
    const responseValue = createProgressStreakLeaderboardValue();
    const invalidResponseValue = {
      ...responseValue,
      participantCount: 3,
      viewer: {
        ...responseValue.viewer,
        rank: 3,
      },
      rankingRows: [
        responseValue.rankingRows[0],
        { kind: "participant", publicProfileId: "profile-2", anonymousDisplayName: "Amber Calm Ridge", streakDays: 3, rank: 2 },
        { kind: "viewer", publicProfileId: "viewer-profile", anonymousDisplayName: "Jade Swift River", streakDays: 3, rank: 3 },
      ],
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(invalidResponseValue));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressStreakLeaderboard()).rejects.toThrow(
      "Invalid API response for GET /me/progress/leaderboards/streak: rankingRows[2] must be the current viewer row before equal streak values",
    );
  });

  it("decodes leaderboard profile responses from the encoded profile path", async () => {
    const responseValue = createProgressLeaderboardProfileValue("profile/with space");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ...responseValue,
        ignoredField: "ignored",
        metrics: {
          ...responseValue.metrics,
          ignoredMetric: true,
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressLeaderboardProfile("profile/with space")).resolves.toEqual(responseValue);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/me/progress/leaderboards/profiles/profile%2Fwith%20space",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("decodes non-ready leaderboard profile responses", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        status: "profile_unavailable",
        internalUserId: "ignored",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressLeaderboardProfile("profile-1")).resolves.toEqual({
      status: "profile_unavailable",
    });
  });

  it("rejects leaderboard profile responses with invalid activity shape", async () => {
    const responseValue = createProgressLeaderboardProfileValue("profile-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ...responseValue,
        reviewActivity: {
          ...responseValue.reviewActivity,
          days: responseValue.reviewActivity.days.slice(0, 29),
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressLeaderboardProfile("profile-1")).rejects.toThrow(
      "Invalid API response for GET /me/progress/leaderboards/profiles/{publicProfileId}: reviewActivity.days must be 30 daily activity entries",
    );
  });

  it("rejects leaderboard profile responses with a different public profile id", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(createProgressLeaderboardProfileValue("profile-2")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressLeaderboardProfile("profile-1")).rejects.toThrow(
      "Invalid API response for GET /me/progress/leaderboards/profiles/{publicProfileId}: publicProfileId must be \"profile-1\"",
    );
  });

  it("decodes review schedule responses and sends only the timezone query", async () => {
    const responseValue = createProgressReviewScheduleResponseValue();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createProgressReviewScheduleResponse(responseValue));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual(responseValue);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/me/progress/review-schedule?timeZone=Europe%2FMadrid",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("decodes review schedule responses without review-history watermark metadata", async () => {
    const baseResponse = createProgressReviewScheduleResponseValue();
    const responseWithoutWatermarks = {
      timeZone: baseResponse.timeZone,
      generatedAt: baseResponse.generatedAt,
      totalCards: baseResponse.totalCards,
      buckets: baseResponse.buckets,
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(responseWithoutWatermarks));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual({
      ...baseResponse,
      reviewHistoryWatermarks: [],
    });
  });

  const invalidProgressReviewScheduleCases: ReadonlyArray<Readonly<{
    name: string;
    responseValue: ProgressReviewSchedule;
    expectedErrorMessage: string;
  }>> = [
    {
      name: "negative bucket count",
      responseValue: replaceProgressReviewScheduleBucketCount(createProgressReviewScheduleResponseValue(), 0, -1),
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: buckets[0].count must be non-negative integer",
    },
    {
      name: "fractional bucket count",
      responseValue: replaceProgressReviewScheduleBucketCount(createProgressReviewScheduleResponseValue(), 0, 1.5),
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: buckets[0].count must be non-negative integer",
    },
    {
      name: "negative totalCards",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        totalCards: -1,
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: totalCards must be non-negative integer",
    },
    {
      name: "fractional totalCards",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        totalCards: 12.5,
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: totalCards must be non-negative integer",
    },
    {
      name: "totalCards that does not equal the bucket sum",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        totalCards: 13,
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: totalCards must be sum of bucket counts (12)",
    },
    {
      name: "unstable bucket order",
      responseValue: swapFirstProgressReviewScheduleBuckets(createProgressReviewScheduleResponseValue()),
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: buckets[0].key must be bucket key new",
    },
    {
      name: "mismatched timezone",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        timeZone: "UTC",
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: timeZone must be \"Europe/Madrid\"",
    },
  ];

  for (const invalidCase of invalidProgressReviewScheduleCases) {
    it(`rejects review schedule responses with ${invalidCase.name}`, async () => {
      const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
        .mockResolvedValueOnce(createProgressReviewScheduleResponse(invalidCase.responseValue));
      vi.stubGlobal("fetch", fetchMock);

      await expect(loadProgressReviewSchedule({
        timeZone: "Europe/Madrid",
        today: "2026-04-18",
      })).rejects.toThrow(invalidCase.expectedErrorMessage);
    });
  }

  it("rejects review schedule responses with missing generatedAt", async () => {
    const baseResponse = createProgressReviewScheduleResponseValue();
    const responseWithoutGeneratedAt = {
      timeZone: baseResponse.timeZone,
      totalCards: baseResponse.totalCards,
      buckets: baseResponse.buckets,
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify(responseWithoutGeneratedAt), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/review-schedule: generatedAt must be string",
    );
  });

  it("rejects review schedule responses with null generatedAt", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...createProgressReviewScheduleResponseValue(),
        generatedAt: null,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/review-schedule: generatedAt must be string",
    );
  });

  it("rejects progress summary responses with missing generatedAt", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        summary: {
          currentStreakDays: 1,
          hasReviewedToday: true,
          lastReviewedOn: "2026-04-03",
          activeReviewDays: 2,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/summary: generatedAt must be string",
    );
  });

  it("rejects progress series responses with null generatedAt", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        from: "2026-04-01",
        to: "2026-04-03",
        generatedAt: null,
        dailyReviews: [
          { date: "2026-04-01", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
          { date: "2026-04-02", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
          { date: "2026-04-03", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSeries({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/series: generatedAt must be string",
    );
  });

  it("rejects progress summary responses with malformed review-history watermark metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        reviewHistoryWatermarks: [
          { workspaceId: "workspace-1", reviewSequenceId: -1 },
        ],
        summary: {
          currentStreakDays: 1,
          hasReviewedToday: true,
          lastReviewedOn: "2026-04-03",
          activeReviewDays: 2,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/summary: reviewHistoryWatermarks[0].reviewSequenceId must be a non-negative safe integer",
    );
  });

  it("rejects progress summary responses with incoherent streak freeze metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        summary: {
          ...createProgressSummaryValue(1, true, "2026-04-03", 2),
          streakFreeze: {
            ...createFullStreakFreeze(),
            balanceUnits: 19,
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/summary: summary.streakFreeze must be a coherent streak freeze object",
    );
  });

  it("rejects progress summary responses with incoherent streak length metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        summary: {
          ...createProgressSummaryValue(5, true, "2026-04-03", 5),
          longestStreakDays: 4,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/summary: summary must be a coherent progress summary object",
    );
  });
});
