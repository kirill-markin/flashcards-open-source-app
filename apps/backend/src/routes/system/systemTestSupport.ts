import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AccountPreferences } from "../../auth/ensureUser";
import type {
  FriendInvitationAcceptInput,
  FriendInvitationAcceptResponse,
  FriendInvitationCreateInput,
  FriendInvitationCreateResponse,
  FriendInvitationPreviewResponse,
} from "../../community/friendInvitations";
import type { PublicProfile } from "../../community/publicProfiles";
import type {
  ProgressLeaderboard,
  ProgressLeaderboardRequest,
  ProgressReviewSchedule,
  ProgressReviewScheduleRequest,
  ProgressSeries,
  ProgressSeriesRequest,
  ProgressSummaryRequest,
  ProgressSummaryResponse,
} from "../../progress";
import type { AppEnv } from "../../server/app";
import type { RequestContext } from "../../server/requestContext";
import { HttpError } from "../../shared/errors";
import { createSystemRoutes } from "./index";

type SystemTestAppOptions = Readonly<{
  transport: RequestContext["transport"];
  locale?: string;
  enforceSessionCsrf?: boolean;
  getAccountPreferencesFn?: () => AccountPreferences;
  updateAccountPreferencesFn?: (userId: string, preferences: AccountPreferences) => Promise<AccountPreferences>;
  ensurePublicProfileForUserFn?: (userId: string, localeHint: string) => Promise<PublicProfile>;
  updateLeaderboardParticipationFn?: (
    userId: string,
    leaderboardParticipationEnabled: boolean,
    localeHint: string,
  ) => Promise<PublicProfile>;
  createFriendInvitationFn?: (input: FriendInvitationCreateInput) => Promise<FriendInvitationCreateResponse>;
  previewFriendInvitationFn?: (rawInviteToken: string) => Promise<FriendInvitationPreviewResponse>;
  acceptFriendInvitationFn?: (input: FriendInvitationAcceptInput) => Promise<FriendInvitationAcceptResponse>;
  loadUserProgressReviewScheduleFn?: (args: ProgressReviewScheduleRequest) => Promise<ProgressReviewSchedule>;
  loadUserProgressSeriesFn?: (args: ProgressSeriesRequest) => Promise<ProgressSeries>;
  loadUserProgressSummaryFn?: (args: ProgressSummaryRequest) => Promise<ProgressSummaryResponse>;
  loadProgressLeaderboardFn?: (args: ProgressLeaderboardRequest) => Promise<ProgressLeaderboard>;
}>;

export function createDefaultAccountPreferences(): AccountPreferences {
  return {
    reviewReactionAnimationsEnabled: true,
  };
}

function createRequestContext(
  transport: RequestContext["transport"],
  preferences: AccountPreferences,
  locale: string,
): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: "workspace-1",
    email: "user@example.com",
    locale,
    userSettingsCreatedAt: "2026-04-01T00:00:00.000Z",
    preferences,
    transport,
    connectionId: transport === "api_key" ? "connection-1" : null,
    guestSessionId: transport === "guest" ? "guest-session-1" : null,
    guestPlatform: transport === "guest" ? "ios" : null,
  };
}

export function createProgressSummaryResponse(): ProgressSummaryResponse {
  return {
    timeZone: "Europe/Madrid",
    summary: {
      currentStreakDays: 3,
      longestStreakDays: 8,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-17",
      activeReviewDays: 12,
      streakFreeze: {
        availableCredits: 2,
        capacity: 2,
        balanceUnits: 20,
        unitsPerCredit: 10,
        earnedUnitsPerStreakDay: 1,
        nextCreditProgressUnits: 0,
        nextCreditRequiredUnits: 10,
      },
    },
    generatedAt: "2026-04-17T10:11:12.000Z",
    reviewHistoryWatermarks: [
      { workspaceId: "workspace-1", reviewSequenceId: 42 },
    ],
  };
}

export function createPublicProfile(leaderboardParticipationEnabled: boolean): PublicProfile {
  return {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled,
  };
}

export function createProgressSeries(): ProgressSeries {
  return {
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-17",
    dailyReviews: [
      { date: "2026-04-11", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
      { date: "2026-04-12", reviewCount: 3, againCount: 1, hardCount: 0, goodCount: 2, easyCount: 0 },
      { date: "2026-04-13", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
      { date: "2026-04-14", reviewCount: 1, againCount: 0, hardCount: 1, goodCount: 0, easyCount: 0 },
      { date: "2026-04-15", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
      { date: "2026-04-16", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
      { date: "2026-04-17", reviewCount: 4, againCount: 1, hardCount: 1, goodCount: 1, easyCount: 1 },
    ],
    streakDays: [
      { date: "2026-04-11", state: "missed" },
      { date: "2026-04-12", state: "reviewed" },
      { date: "2026-04-13", state: "frozen" },
      { date: "2026-04-14", state: "reviewed" },
      { date: "2026-04-15", state: "frozen" },
      { date: "2026-04-16", state: "frozen" },
      { date: "2026-04-17", state: "reviewed" },
    ],
    generatedAt: "2026-04-17T10:11:12.000Z",
    reviewHistoryWatermarks: [
      { workspaceId: "workspace-1", reviewSequenceId: 42 },
    ],
  };
}

export function createProgressReviewSchedule(): ProgressReviewSchedule {
  return {
    timeZone: "Europe/Madrid",
    generatedAt: "2026-04-17T10:11:12.000Z",
    totalCards: 72,
    buckets: [
      { key: "new", count: 2 },
      { key: "today", count: 4 },
      { key: "days1To7", count: 6 },
      { key: "days8To30", count: 8 },
      { key: "days31To90", count: 10 },
      { key: "days91To360", count: 12 },
      { key: "years1To2", count: 14 },
      { key: "later", count: 16 },
    ],
    reviewHistoryWatermarks: [
      { workspaceId: "workspace-1", reviewSequenceId: 42 },
    ],
  };
}

export function createProgressLeaderboard(): ProgressLeaderboard {
  return {
    status: "ready",
    metric: {
      metricVersion: "qualified_reviews_v1",
      title: "Qualified reviews",
      description: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
    },
    defaultWindowKey: "last_24_hours",
    windows: [
      {
        windowKey: "last_24_hours",
        snapshotId: "0cc86d10-18cb-4d64-a2f2-a5fd960b45b2",
        snapshotGeneratedAt: "2026-06-10T14:00:05.000Z",
        asOfServerHour: "2026-06-10T14:00:00.000Z",
        nextRefreshAfter: "2026-06-10T15:00:00.000Z",
        participantCount: 2,
        viewer: {
          publicProfileId: "5b9d3f2a-1c4e-4a7b-9f0d-2e6c8a1b4d7f",
          displayName: "You",
          rank: 2,
          qualifiedReviewCount: 3,
        },
        rows: [
          {
            kind: "top",
            publicProfileId: "a1d2c3b4-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
            anonymousDisplayName: "Silver Bright Harbor",
            qualifiedReviewCount: 5,
            rank: 1,
          },
          {
            kind: "viewer",
            publicProfileId: "5b9d3f2a-1c4e-4a7b-9f0d-2e6c8a1b4d7f",
            anonymousDisplayName: "Jade Swift River",
            qualifiedReviewCount: 3,
            rank: 2,
          },
        ],
        rankingRows: [
          {
            kind: "participant",
            publicProfileId: "a1d2c3b4-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
            anonymousDisplayName: "Silver Bright Harbor",
            qualifiedReviewCount: 5,
            rank: 1,
          },
          {
            kind: "viewer",
            publicProfileId: "5b9d3f2a-1c4e-4a7b-9f0d-2e6c8a1b4d7f",
            anonymousDisplayName: "Jade Swift River",
            qualifiedReviewCount: 3,
            rank: 2,
          },
        ],
      },
    ],
  };
}

export function createSystemTestApp(options: SystemTestAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId: context.get("requestId"),
        code: error.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: context.get("requestId"),
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", createSystemRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async (request) => {
      if (
        options.enforceSessionCsrf === true
        && options.transport === "session"
        && request.headers.get("x-csrf-token") !== "valid-csrf-token"
      ) {
        throw new HttpError(403, "Invalid X-CSRF-Token header", "SESSION_CSRF_TOKEN_INVALID");
      }

      const preferences = options.getAccountPreferencesFn === undefined
        ? createDefaultAccountPreferences()
        : options.getAccountPreferencesFn();

      return {
        requestAuthInputs: {} as never,
        requestContext: createRequestContext(options.transport, preferences, options.locale ?? "en"),
      };
    },
    updateAccountPreferencesFn: options.updateAccountPreferencesFn,
    ensurePublicProfileForUserFn: options.ensurePublicProfileForUserFn,
    updateLeaderboardParticipationFn: options.updateLeaderboardParticipationFn,
    createFriendInvitationFn: options.createFriendInvitationFn,
    previewFriendInvitationFn: options.previewFriendInvitationFn,
    acceptFriendInvitationFn: options.acceptFriendInvitationFn,
    loadUserProgressReviewScheduleFn: options.loadUserProgressReviewScheduleFn,
    loadUserProgressSeriesFn: options.loadUserProgressSeriesFn,
    loadUserProgressSummaryFn: options.loadUserProgressSummaryFn,
    loadProgressLeaderboardFn: options.loadProgressLeaderboardFn,
  }));

  return app;
}
