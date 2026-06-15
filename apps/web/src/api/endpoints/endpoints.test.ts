// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressReviewSchedule } from "../../types";
import { persistLocalePreference } from "../../i18n/runtime";
import {
  createChatSnapshotResponse,
  createJsonResponse,
  createLegacyChatConfigResponseValue,
  createNewChatSessionResponse,
  createProgressReviewScheduleResponse,
  createProgressReviewScheduleResponseValue,
  createStartChatRunResponse,
  createStopChatRunResponse,
  createStorageMock,
  replaceProgressReviewScheduleBucketCount,
  setNavigatorLanguages,
  swapFirstProgressReviewScheduleBuckets,
} from "../ApiTestSupport";
import { buildLoginUrl, getPreferredAuthUiLocale } from "../authUrls";
import {
  createNewChatSession,
  getChatSnapshot,
  startChatRun,
  stopChatRun,
  transcribeChatAudio,
} from "./chat";
import {
  loadFeedbackState,
  recordFeedbackPromptEvent,
  submitFeedback,
} from "./feedback";
import {
  loadProgressLeaderboard,
  loadProgressReviewSchedule,
  loadProgressSeries,
  loadProgressSummary,
} from "./progress";
import {
  acceptFriendInvitation,
  createFriendInvitation,
  previewFriendInvitation,
} from "./communityFriends";
import { primeSessionCsrfToken, resetApiClientStateForTests } from "../transport/transport";

const observabilityMocks = vi.hoisted(() => ({
  addWebBreadcrumbMock: vi.fn(),
  captureWebExceptionMock: vi.fn(),
  captureWebWarningMock: vi.fn(),
  setWebObservabilityUserMock: vi.fn(),
}));

vi.mock("../../observability/webObservability", () => ({
  addWebBreadcrumb: observabilityMocks.addWebBreadcrumbMock,
  captureWebException: observabilityMocks.captureWebExceptionMock,
  captureWebWarning: observabilityMocks.captureWebWarningMock,
  normalizeCaughtError: (error: unknown): Error => error instanceof Error ? error : new Error(`Caught non-Error value of type ${typeof error}`),
  setWebObservabilityUser: observabilityMocks.setWebObservabilityUserMock,
}));

function resetObservabilityMocks(): void {
  observabilityMocks.addWebBreadcrumbMock.mockReset();
  observabilityMocks.captureWebExceptionMock.mockReset();
  observabilityMocks.captureWebWarningMock.mockReset();
  observabilityMocks.setWebObservabilityUserMock.mockReset();
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  resetApiClientStateForTests();
  resetObservabilityMocks();
});

afterEach(() => {
  window.localStorage.clear();
  setNavigatorLanguages([], "");
  resetApiClientStateForTests();
  vi.restoreAllMocks();
});

describe("auth URL endpoints", () => {
  it("prefers the stored app locale over raw browser detection", () => {
    persistLocalePreference("ar");
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");

    expect(getPreferredAuthUiLocale()).toBe("ar");
  });

  it("prefers the first supported browser language", () => {
    setNavigatorLanguages(["fr-FR", "es-MX", "en-GB"], "fr-FR");

    expect(getPreferredAuthUiLocale()).toBe("es-MX");
  });

  it("maps compatible browser locales to the supported exact locale set", () => {
    setNavigatorLanguages(["zh-CN"], "zh-CN");

    expect(getPreferredAuthUiLocale()).toBe("zh-Hans");
  });

  it("falls back to English when browser languages are unsupported", () => {
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");

    expect(getPreferredAuthUiLocale()).toBe("en");
  });

  it("includes a sanitized locale hint in the login URL", () => {
    const loginUrl = new URL(buildLoginUrl("https://app.flashcards-open-source-app.com/review", "es-MX"));

    expect(loginUrl.origin).toBe("http://localhost:8081");
    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("redirect_uri")).toBe("https://app.flashcards-open-source-app.com/review");
    expect(loginUrl.searchParams.get("locale")).toBe("es-MX");
  });

  it("upgrades a legacy base-language locale hint to an exact supported locale tag", () => {
    const loginUrl = new URL(buildLoginUrl("https://app.flashcards-open-source-app.com/review", "es"));

    expect(loginUrl.searchParams.get("locale")).toBe("es-ES");
  });
});

describe("community friend API endpoints", () => {
  it("decodes friend invitation create, preview, and accept responses", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
        expiresAt: "2026-04-22T10:00:00.000Z",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        status: "active",
        expiresAt: "2026-04-22T10:00:00.000Z",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        status: "already_friends",
        existingFriendDisplayName: "Alex",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createFriendInvitation({
      inviteeDisplayName: "Priya",
    })).resolves.toEqual({
      inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
      expiresAt: "2026-04-22T10:00:00.000Z",
    });
    await expect(previewFriendInvitation("raw-token")).resolves.toEqual({
      status: "active",
      expiresAt: "2026-04-22T10:00:00.000Z",
    });
    await expect(acceptFriendInvitation("raw-token", {
      inviterDisplayName: "Alex",
    })).resolves.toEqual({
      status: "already_friends",
      existingFriendDisplayName: "Alex",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/v1/me/community/friend-invitations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ inviteeDisplayName: "Priya" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/v1/community/friend-invitations/raw-token",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8080/v1/me/community/friend-invitations/raw-token/accept",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ inviterDisplayName: "Alex" }),
      }),
    );
  });

  it("decodes optional friend display names on leaderboard rows", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        status: "ready",
        metric: {
          metricVersion: "qualified_reviews_v1",
          title: "Qualified reviews",
          description: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
        },
        defaultWindowKey: "last_24_hours",
        windows: [{
          windowKey: "last_24_hours",
          snapshotId: "0cc86d10-18cb-4d64-a2f2-a5fd960b45b2",
          snapshotGeneratedAt: "2026-04-21T10:00:05.000Z",
          asOfServerHour: "2026-04-21T10:00:00.000Z",
          nextRefreshAfter: "2026-04-21T11:00:00.000Z",
          participantCount: 2,
          viewer: {
            publicProfileId: "viewer-profile",
            displayName: "You",
            rank: 2,
            qualifiedReviewCount: 7,
          },
          rows: [
            {
              kind: "top",
              publicProfileId: "friend-profile",
              anonymousDisplayName: "Silver Bright Harbor",
              friendDisplayName: "Mina",
              qualifiedReviewCount: 8,
              rank: 1,
            },
            {
              kind: "viewer",
              publicProfileId: "viewer-profile",
              anonymousDisplayName: "Quiet Maple Grove",
              qualifiedReviewCount: 7,
              rank: 2,
            },
          ],
          rankingRows: [
            {
              kind: "participant",
              publicProfileId: "friend-profile",
              anonymousDisplayName: "Silver Bright Harbor",
              friendDisplayName: "Mina",
              qualifiedReviewCount: 8,
              rank: 1,
            },
            {
              kind: "viewer",
              publicProfileId: "viewer-profile",
              anonymousDisplayName: "Quiet Maple Grove",
              qualifiedReviewCount: 7,
              rank: 2,
            },
          ],
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const leaderboard = await loadProgressLeaderboard();

    expect(leaderboard.windows[0]?.rows[0]?.friendDisplayName).toBe("Mina");
    expect(leaderboard.windows[0]?.rows[1]?.friendDisplayName).toBeUndefined();
    expect(leaderboard.windows[0]?.rankingRows[0]?.friendDisplayName).toBe("Mina");
    expect(leaderboard.windows[0]?.rankingRows[1]?.friendDisplayName).toBeUndefined();
  });
});

describe("progress API endpoints", () => {
  it("decodes progress summary responses with generatedAt metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        reviewHistoryWatermarks: [
          { workspaceId: "workspace-1", reviewSequenceId: 42 },
        ],
        summary: {
          currentStreakDays: 1,
          hasReviewedToday: true,
          lastReviewedOn: "2026-04-03",
          activeReviewDays: 2,
        },
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
      summary: {
        currentStreakDays: 1,
        hasReviewedToday: true,
        lastReviewedOn: "2026-04-03",
        activeReviewDays: 2,
      },
    });
  });

  it("decodes progress summary responses without review-history watermark metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        summary: {
          currentStreakDays: 1,
          hasReviewedToday: true,
          lastReviewedOn: "2026-04-03",
          activeReviewDays: 2,
        },
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
      summary: {
        currentStreakDays: 1,
        hasReviewedToday: true,
        lastReviewedOn: "2026-04-03",
        activeReviewDays: 2,
      },
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
});

describe("feedback API endpoints", () => {
  const emptyFeedbackState = {
    automaticPromptCooldownDays: 30,
    lastAutomaticPromptShownAt: null,
    lastFeedbackSubmittedAt: null,
    nextAutomaticPromptAt: null,
  };

  const nextFeedbackState = {
    automaticPromptCooldownDays: 30,
    lastAutomaticPromptShownAt: "2026-04-18T09:00:00.000Z",
    lastFeedbackSubmittedAt: null,
    nextAutomaticPromptAt: "2026-05-18T09:00:00.000Z",
  };

  it("decodes feedback state responses", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        feedbackState: emptyFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadFeedbackState()).resolves.toEqual(emptyFeedbackState);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/feedback/state",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends automatic prompt event payloads and accepts ok envelopes", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ok: true,
        feedbackState: nextFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const promptEventPayload = {
      feedbackPromptEventId: "feedback-prompt-event-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web" as const,
      appVersion: "1.10.0",
      locale: "en" as const,
      timezone: "Europe/Madrid",
      eventType: "automatic_prompt_shown",
      createdAtClient: "2026-04-18T09:00:00.000Z",
    };

    await expect(recordFeedbackPromptEvent(promptEventPayload)).resolves.toEqual(nextFeedbackState);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/feedback/prompt-events");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(promptEventPayload));
  });

  it("sends feedback submission contract payloads and parses returned state", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const submissionPayload = {
      feedbackSubmissionId: "feedback-submission-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web" as const,
      appVersion: "1.10.0",
      locale: "en" as const,
      timezone: "Europe/Madrid",
      trigger: "settings" as const,
      message: "Make review faster",
      createdAtClient: "2026-04-18T09:00:00.000Z",
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ok: true,
        feedbackState: nextFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitFeedback(submissionPayload)).resolves.toEqual(nextFeedbackState);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/feedback/submissions");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(submissionPayload));
  });

  it("rejects feedback POST responses with non-true ok values", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ok: false,
        feedbackState: emptyFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(recordFeedbackPromptEvent({
      feedbackPromptEventId: "feedback-prompt-event-2",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web",
      appVersion: "1.10.0",
      locale: "en",
      timezone: "Europe/Madrid",
      eventType: "automatic_prompt_dismissed",
      createdAtClient: "2026-04-18T09:00:00.000Z",
    })).rejects.toThrow("Invalid API response for POST /feedback/prompt-events: ok must be true");
  });
});

describe("chat API endpoints", () => {
  it("includes workspaceId and uiLocale in POST /chat requests", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createStartChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await startChatRun({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    });

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    }));
  });

  it("includes workspaceId and uiLocale in POST /chat/new requests", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await createNewChatSession("session-1", "workspace-1", "es-ES");

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      uiLocale: "es-ES",
    }));
  });

  it("includes workspaceId in GET /chat requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createChatSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getChatSnapshot("session-1", "workspace-1");

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/chat");
    expect(requestUrl.searchParams.get("sessionId")).toBe("session-1");
    expect(requestUrl.searchParams.get("workspaceId")).toBe("workspace-1");
  });

  it("accepts legacy chat config metadata without exposing it in web state", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        conversation: {
          messages: [],
          updatedAt: 1,
          mainContentInvalidationVersion: 0,
        },
        composerSuggestions: [],
        chatConfig: createLegacyChatConfigResponseValue(),
        activeRun: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatSnapshot("session-1", "workspace-1")).resolves.toMatchObject({
      sessionId: "session-1",
      chatConfig: {
        features: {
          dictationEnabled: true,
          attachmentsEnabled: true,
        },
      },
    });
  });

  it("accepts reduced POST /chat/stop responses without unused run identifiers", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createStopChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatRun("session-1", "workspace-1", null)).resolves.toEqual({
      sessionId: "session-1",
      stopped: true,
      stillRunning: false,
    });

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
    }));
  });

  it("includes runId in POST /chat/stop requests when known", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createStopChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatRun("session-1", "workspace-1", "run-1")).resolves.toEqual({
      sessionId: "session-1",
      stopped: true,
      stillRunning: false,
    });

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      runId: "run-1",
    }));
  });

  it("includes workspaceId in POST /chat/transcriptions requests", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "hello",
        sessionId: "session-1",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeChatAudio(
      new Blob(["audio"], { type: "audio/webm" }),
      "web",
      "session-1",
      "workspace-1",
    );

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const formData = chatRequestInit?.body;
    expect(formData).toBeInstanceOf(FormData);
    if (!(formData instanceof FormData)) {
      throw new Error("Expected FormData");
    }

    expect(formData.get("sessionId")).toBe("session-1");
    expect(formData.get("workspaceId")).toBe("workspace-1");
    expect(formData.get("source")).toBe("web");
    expect(formData.get("file")).toBeInstanceOf(File);
  });
});
