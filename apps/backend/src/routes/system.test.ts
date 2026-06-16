import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import type {
  ProgressLeaderboard,
  ProgressLeaderboardRequest,
  ProgressReviewSchedule,
  ProgressReviewScheduleRequest,
  ProgressSeries,
  ProgressSeriesRequest,
  ProgressSummaryResponse,
} from "../progress";
import { createSystemRoutes } from "./system";
import type { RequestContext } from "../server/requestContext";
import type { AccountPreferences } from "../auth/ensureUser";
import type { PublicProfile } from "../community/publicProfiles";
import type {
  FriendInvitationAcceptInput,
  FriendInvitationAcceptResponse,
  FriendInvitationCreateInput,
  FriendInvitationCreateResponse,
  FriendInvitationPreviewResponse,
} from "../community/friendInvitations";
import { loadOpenApiDocument } from "../shared/openapi";

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
  loadUserProgressSummaryFn?: (args: Readonly<{ userId: string; timeZone: string }>) => Promise<ProgressSummaryResponse>;
  loadProgressLeaderboardFn?: (args: ProgressLeaderboardRequest) => Promise<ProgressLeaderboard>;
}>;

function createDefaultAccountPreferences(): AccountPreferences {
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

function createProgressSummaryResponse(): ProgressSummaryResponse {
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

function createPublicProfile(leaderboardParticipationEnabled: boolean): PublicProfile {
  return {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled,
  };
}

function createProgressSeries(): ProgressSeries {
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

function createProgressReviewSchedule(): ProgressReviewSchedule {
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

function createProgressLeaderboard(): ProgressLeaderboard {
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

function createSystemTestApp(options: SystemTestAppOptions): Hono<AppEnv> {
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

test("GET /me includes account preferences", async () => {
  const app = createSystemTestApp({
    transport: "session",
    getAccountPreferencesFn: createDefaultAccountPreferences,
  });
  const response = await app.request("http://localhost/me");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: null,
    profile: {
      email: "user@example.com",
      locale: "en",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
  });
});

test("review reaction animation preference migration defaults existing rows to true", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0056_review_reaction_animation_preference.sql",
  );
  const migrationSql = readFileSync(migrationPath, "utf8");

  assert.match(migrationSql, /ALTER TABLE org\.user_settings/);
  assert.match(
    migrationSql,
    /ADD COLUMN review_reaction_animations_enabled BOOLEAN NOT NULL DEFAULT TRUE/,
  );
});

test("PATCH /me/preferences persists false and GET /me returns the updated preference", async () => {
  let persistedPreferences: AccountPreferences = createDefaultAccountPreferences();
  const app = createSystemTestApp({
    transport: "bearer",
    getAccountPreferencesFn: () => persistedPreferences,
    updateAccountPreferencesFn: async (userId, preferences) => {
      assert.equal(userId, "user-1");
      persistedPreferences = preferences;
      return persistedPreferences;
    },
  });

  const initialResponse = await app.request("http://localhost/me");
  assert.equal(initialResponse.status, 200);
  assert.deepEqual((await initialResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: true,
  });

  const patchResponse = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
    }),
  });
  assert.equal(patchResponse.status, 200);
  assert.deepEqual(await patchResponse.json(), {
    preferences: {
      reviewReactionAnimationsEnabled: false,
    },
  });

  const updatedResponse = await app.request("http://localhost/me");
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual((await updatedResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: false,
  });
});

test("PATCH /me/preferences rejects session requests without valid CSRF", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    enforceSessionCsrf: true,
    updateAccountPreferencesFn: async (_userId, preferences) => {
      updateCalled = true;
      return preferences;
    },
  });
  const response = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
    }),
  });

  assert.equal(updateCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Invalid X-CSRF-Token header",
    requestId: "request-1",
    code: "SESSION_CSRF_TOKEN_INVALID",
  });
});

test("PATCH /me/preferences rejects ApiKey authentication", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "api_key",
    updateAccountPreferencesFn: async (_userId, preferences) => {
      updateCalled = true;
      return preferences;
    },
  });
  const response = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
    }),
  });

  assert.equal(updateCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "ACCOUNT_PREFERENCES_HUMAN_AUTH_REQUIRED",
  });
});

test("API Gateway predeclares PATCH /me/preferences", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /me\.addResource\("preferences"\)\.addMethod\("PATCH", integration\);/);
});

test("GET /me/community/profile ensures a public profile without returning internal ids", async () => {
  let ensureCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    locale: "zh-CN",
    ensurePublicProfileForUserFn: async (userId, localeHint) => {
      ensureCalled = true;
      assert.equal(userId, "user-1");
      assert.equal(localeHint, "zh-CN");
      return createPublicProfile(true);
    },
  });
  const response = await app.request("http://localhost/me/community/profile");
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(ensureCalled, true);
  assert.deepEqual(payload, {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: true,
    linkedAccountRequiredForLeaderboard: false,
  });
  assert.equal(Object.hasOwn(payload, "userId"), false);
  assert.equal(Object.hasOwn(payload, "workspaceId"), false);
  assert.equal(Object.hasOwn(payload, "replicaId"), false);
  assert.equal(Object.hasOwn(payload, "subjectUserId"), false);
  assert.equal(Object.hasOwn(payload, "email"), false);
});

test("PATCH /me/community/profile updates only leaderboard participation", async () => {
  let persistedProfile = createPublicProfile(true);
  const app = createSystemTestApp({
    transport: "bearer",
    locale: "es-MX",
    ensurePublicProfileForUserFn: async () => persistedProfile,
    updateLeaderboardParticipationFn: async (userId, leaderboardParticipationEnabled, localeHint) => {
      assert.equal(userId, "user-1");
      assert.equal(localeHint, "es-MX");
      persistedProfile = {
        ...persistedProfile,
        leaderboardParticipationEnabled,
      };
      return persistedProfile;
    },
  });

  const response = await app.request("http://localhost/me/community/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leaderboardParticipationEnabled: false,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: false,
    linkedAccountRequiredForLeaderboard: false,
  });

  const readResponse = await app.request("http://localhost/me/community/profile");
  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: false,
    linkedAccountRequiredForLeaderboard: false,
  });
});

test("PATCH /me/community/profile lets guest accounts manage leaderboard participation", async () => {
  let persistedProfile = createPublicProfile(true);
  const app = createSystemTestApp({
    transport: "guest",
    locale: "ru",
    updateLeaderboardParticipationFn: async (userId, leaderboardParticipationEnabled, localeHint) => {
      assert.equal(userId, "user-1");
      assert.equal(localeHint, "ru");
      persistedProfile = {
        ...persistedProfile,
        leaderboardParticipationEnabled,
      };
      return persistedProfile;
    },
  });

  const response = await app.request("http://localhost/me/community/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leaderboardParticipationEnabled: false,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: false,
    linkedAccountRequiredForLeaderboard: true,
  });
});

test("PATCH /me/community/profile rejects attempts to update public identity fields", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    updateLeaderboardParticipationFn: async (_userId, leaderboardParticipationEnabled) => {
      updateCalled = true;
      return createPublicProfile(leaderboardParticipationEnabled);
    },
  });

  const response = await app.request("http://localhost/me/community/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leaderboardParticipationEnabled: false,
      anonymousDisplayName: "Changed Name",
    }),
  });

  assert.equal(updateCalled, false);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Unexpected community profile field: anonymousDisplayName",
    requestId: "request-1",
    code: "COMMUNITY_PROFILE_FIELD_UNKNOWN",
  });
});

test("community profile endpoints reject ApiKey authentication", async () => {
  const cases = [
    {
      url: "http://localhost/me/community/profile",
      init: undefined,
    },
    {
      url: "http://localhost/me/community/profile",
      init: {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leaderboardParticipationEnabled: false,
        }),
      },
    },
  ] as const;

  for (const testCase of cases) {
    let serviceCalled = false;
    const app = createSystemTestApp({
      transport: "api_key",
      ensurePublicProfileForUserFn: async () => {
        serviceCalled = true;
        return createPublicProfile(true);
      },
      updateLeaderboardParticipationFn: async (_userId, leaderboardParticipationEnabled) => {
        serviceCalled = true;
        return createPublicProfile(leaderboardParticipationEnabled);
      },
    });
    const response = await app.request(testCase.url, testCase.init);

    assert.equal(serviceCalled, false);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "This endpoint requires Guest, Bearer, or Session authentication",
      requestId: "request-1",
      code: "COMMUNITY_PROFILE_HUMAN_AUTH_REQUIRED",
    });
  }
});

test("GET /me/community/profile marks guest accounts as requiring linked account for leaderboard", async () => {
  const app = createSystemTestApp({
    transport: "guest",
    ensurePublicProfileForUserFn: async (userId) => {
      assert.equal(userId, "user-1");
      return createPublicProfile(true);
    },
  });

  const response = await app.request("http://localhost/me/community/profile");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: true,
    linkedAccountRequiredForLeaderboard: true,
  });
});

test("API Gateway predeclares /me/community/profile", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityProfile = meCommunity\.addResource\("profile"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("PATCH", integration\);/);
});

test("published OpenAPI includes community profile endpoint without internal ids", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{
      schemas?: Readonly<Record<string, unknown>>;
    }>;
  }>;
  const communityProfilePath = openApiDocument.paths?.["/me/community/profile"];
  const profileSchema = openApiDocument.components?.schemas?.CommunityPublicProfileResponse;
  const serializedSchema = JSON.stringify(profileSchema ?? null);

  assert.notEqual(communityProfilePath?.get, undefined);
  assert.notEqual(communityProfilePath?.patch, undefined);
  assert.equal(serializedSchema.includes("publicProfileId"), true);
  assert.equal(serializedSchema.includes("anonymousDisplayName"), true);
  assert.equal(serializedSchema.includes("leaderboardParticipationEnabled"), true);
  assert.equal(serializedSchema.includes("linkedAccountRequiredForLeaderboard"), true);
  assert.equal(serializedSchema.includes("userId"), false);
  assert.equal(serializedSchema.includes("workspaceId"), false);
  assert.equal(serializedSchema.includes("replicaId"), false);
  assert.equal(serializedSchema.includes("email"), false);
});

test("POST /me/community/friend-invitations creates an invite link for signed-in humans", async () => {
  let createCalled = false;
  const app = createSystemTestApp({
    transport: "bearer",
    createFriendInvitationFn: async (input) => {
      createCalled = true;
      assert.deepEqual(input, {
        userId: "user-1",
        inviteeDisplayName: "Priya 🎯",
      });
      return {
        inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
        expiresAt: "2026-06-17T10:00:00.000Z",
      };
    },
  });

  const response = await app.request("http://localhost/me/community/friend-invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteeDisplayName: "  Priya 🎯  ",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(createCalled, true);
  assert.deepEqual(await response.json(), {
    inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
    expiresAt: "2026-06-17T10:00:00.000Z",
  });
});

test("GET /community/friend-invitations/:inviteToken previews without identity fields", async () => {
  let previewCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    previewFriendInvitationFn: async (rawInviteToken) => {
      previewCalled = true;
      assert.equal(rawInviteToken, "raw-token");
      return {
        status: "active",
        expiresAt: "2026-06-17T10:00:00.000Z",
      };
    },
  });

  const response = await app.request("http://localhost/community/friend-invitations/raw-token");
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(previewCalled, true);
  assert.deepEqual(payload, {
    status: "active",
    expiresAt: "2026-06-17T10:00:00.000Z",
  });
  assert.equal(Object.hasOwn(payload, "inviterUserId"), false);
  assert.equal(Object.hasOwn(payload, "email"), false);
  assert.equal(Object.hasOwn(payload, "publicProfileId"), false);
  assert.equal(Object.hasOwn(payload, "inviteeDisplayName"), false);
});

test("GET /community/friend-invitations/:inviteToken rejects ApiKey authentication", async () => {
  let previewCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    previewFriendInvitationFn: async () => {
      previewCalled = true;
      return { status: "inactive" };
    },
  });

  const response = await app.request("http://localhost/community/friend-invitations/raw-token", {
    headers: {
      Authorization: "ApiKey test-key",
    },
  });

  assert.equal(previewCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Friend invitation preview does not support ApiKey authentication",
    requestId: "request-1",
    code: "FRIEND_INVITATION_API_KEY_AUTH_UNSUPPORTED",
  });
});

test("POST /me/community/friend-invitations/:inviteToken/accept accepts for signed-in humans", async () => {
  let acceptCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    acceptFriendInvitationFn: async (input) => {
      acceptCalled = true;
      assert.deepEqual(input, {
        userId: "user-1",
        rawInviteToken: "raw-token",
        inviterDisplayName: "Alex",
      });
      return { status: "accepted" };
    },
  });

  const response = await app.request("http://localhost/me/community/friend-invitations/raw-token/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviterDisplayName: "  Alex  ",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(acceptCalled, true);
  assert.deepEqual(await response.json(), {
    status: "accepted",
  });
});

test("POST /me/community/friend-invitations/:inviteToken/accept returns self-link errors", async () => {
  const app = createSystemTestApp({
    transport: "bearer",
    acceptFriendInvitationFn: async () => {
      throw new HttpError(
        409,
        "This is your own invitation link.",
        "FRIEND_INVITATION_SELF",
      );
    },
  });

  const response = await app.request("http://localhost/me/community/friend-invitations/raw-token/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviterDisplayName: "Alex",
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "This is your own invitation link.",
    requestId: "request-1",
    code: "FRIEND_INVITATION_SELF",
  });
});

test("friend invitation human endpoints reject ApiKey and Guest authentication", async () => {
  const cases = [
    {
      url: "http://localhost/me/community/friend-invitations",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviteeDisplayName: "Priya",
        }),
      },
    },
    {
      url: "http://localhost/me/community/friend-invitations/raw-token/accept",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviterDisplayName: "Alex",
        }),
      },
    },
  ] as const;
  const transports: ReadonlyArray<RequestContext["transport"]> = ["api_key", "guest"];

  for (const transport of transports) {
    for (const testCase of cases) {
      let serviceCalled = false;
      const app = createSystemTestApp({
        transport,
        createFriendInvitationFn: async () => {
          serviceCalled = true;
          return {
            inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
            expiresAt: "2026-06-17T10:00:00.000Z",
          };
        },
        acceptFriendInvitationFn: async () => {
          serviceCalled = true;
          return { status: "accepted" };
        },
      });
      const response = await app.request(testCase.url, testCase.init);

      assert.equal(serviceCalled, false);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "This endpoint requires signed-in human authentication",
        requestId: "request-1",
        code: "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED",
      });
    }
  }
});

test("friend invitation routes reject invalid display names before service calls", async () => {
  const cases = [
    {
      url: "http://localhost/me/community/friend-invitations",
      body: {
        inviteeDisplayName: "Line\nBreak",
      },
      expectedError: "inviteeDisplayName must not contain control characters or newlines.",
    },
    {
      url: "http://localhost/me/community/friend-invitations/raw-token/accept",
      body: {
        inviterDisplayName: "",
      },
      expectedError: "inviterDisplayName must be 1 to 30 characters after trimming.",
    },
  ] as const;

  for (const testCase of cases) {
    let serviceCalled = false;
    const app = createSystemTestApp({
      transport: "session",
      createFriendInvitationFn: async () => {
        serviceCalled = true;
        return {
          inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
          expiresAt: "2026-06-17T10:00:00.000Z",
        };
      },
      acceptFriendInvitationFn: async () => {
        serviceCalled = true;
        return { status: "accepted" };
      },
    });
    const response = await app.request(testCase.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testCase.body),
    });

    assert.equal(serviceCalled, false);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: testCase.expectedError,
      requestId: "request-1",
      code: "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    });
  }
});

test("API Gateway predeclares friend invitation routes", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityFriendInvitations = meCommunity\.addResource\("friend-invitations"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityFriendInvitations\.addMethod\("POST", integration\);/);
  assert.match(
    apiGatewaySource,
    /meCommunityFriendInvitations\s*\.addResource\("\{inviteToken\}"\)\s*\.addResource\("accept"\)\s*\.addMethod\("POST", integration\);/,
  );
  assert.match(
    apiGatewaySource,
    /const communityFriendInvitations = community\.addResource\("friend-invitations"\);/,
  );
  assert.match(
    apiGatewaySource,
    /communityFriendInvitations\.addResource\("\{inviteToken\}"\)\.addMethod\("GET", integration\);/,
  );
});

test("published OpenAPI documents friend invitations without internal ids", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{ schemas?: Readonly<Record<string, unknown>> }>;
  }>;
  const createPath = openApiDocument.paths?.["/me/community/friend-invitations"];
  const previewPath = openApiDocument.paths?.["/community/friend-invitations/{inviteToken}"];
  const acceptPath = openApiDocument.paths?.["/me/community/friend-invitations/{inviteToken}/accept"];
  const schemas = openApiDocument.components?.schemas ?? {};
  const invitationSchemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => name.startsWith("FriendInvitation")),
  );
  const serializedContract = JSON.stringify({
    createPath,
    previewPath,
    acceptPath,
    invitationSchemas,
  });
  const serializedInvitationSchemas = JSON.stringify(invitationSchemas);

  assert.notEqual(createPath?.post, undefined);
  assert.notEqual(previewPath?.get, undefined);
  assert.notEqual(acceptPath?.post, undefined);
  assert.equal(serializedContract.includes("inviteUrl"), true);
  assert.equal(serializedContract.includes("expiresAt"), true);
  assert.equal(serializedContract.includes("existingFriendDisplayName"), true);
  assert.equal(serializedInvitationSchemas.includes("publicProfileId"), false);
  assert.equal(serializedInvitationSchemas.includes("userId"), false);
  assert.equal(serializedInvitationSchemas.includes("email"), false);
  assert.equal(serializedInvitationSchemas.includes("inviteeDisplayNameForInviter"), false);
});

test("GET /me/progress/summary returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadUserProgressSummaryFn: async ({ userId, timeZone }) => {
        assert.equal(userId, "user-1");
        assert.equal(timeZone, "Europe/Madrid");
        return createProgressSummaryResponse();
      },
    });
    const response = await app.request(
      "http://localhost/me/progress/summary?timeZone=Europe/Madrid",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressSummaryResponse());
  }
});

test("GET /me/progress/review-schedule returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadUserProgressReviewScheduleFn: async ({ userId, timeZone }) => {
        assert.equal(userId, "user-1");
        assert.equal(timeZone, "Europe/Madrid");
        return createProgressReviewSchedule();
      },
    });
    const response = await app.request(
      "http://localhost/me/progress/review-schedule?timeZone=Europe/Madrid",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressReviewSchedule());
  }
});

test("GET /me/progress/series returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadUserProgressSeriesFn: async ({ userId, timeZone, from, to }) => {
        assert.equal(userId, "user-1");
        assert.equal(timeZone, "Europe/Madrid");
        assert.equal(from, "2026-04-11");
        assert.equal(to, "2026-04-17");
        return createProgressSeries();
      },
    });
    const response = await app.request(
      "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressSeries());
  }
});

test("progress endpoints reject ApiKey authentication", async () => {
  const cases = [
    "http://localhost/me/progress/summary?timeZone=Europe/Madrid",
    "http://localhost/me/progress/review-schedule?timeZone=Europe/Madrid",
    "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
  ] as const;

  for (const url of cases) {
    let called = false;
    const app = createSystemTestApp({
      transport: "api_key",
      loadUserProgressSeriesFn: async () => {
        called = true;
        return createProgressSeries();
      },
      loadUserProgressReviewScheduleFn: async () => {
        called = true;
        return createProgressReviewSchedule();
      },
      loadUserProgressSummaryFn: async () => {
        called = true;
        return createProgressSummaryResponse();
      },
    });
    const response = await app.request(url);

    assert.equal(called, false);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "This endpoint requires Guest, Bearer, or Session authentication",
      requestId: "request-1",
      code: "PROGRESS_HUMAN_AUTH_REQUIRED",
    });
  }
});

test("GET /me/progress/leaderboard returns the leaderboard for Session and Bearer", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = ["session", "bearer"];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      locale: "es-MX",
      loadProgressLeaderboardFn: async ({ userId, transport: requestTransport, localeHint }) => {
        assert.equal(userId, "user-1");
        assert.equal(requestTransport, transport);
        assert.equal(localeHint, "es-MX");
        return createProgressLeaderboard();
      },
    });
    const response = await app.request("http://localhost/me/progress/leaderboard");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressLeaderboard());
  }
});

test("GET /me/progress/leaderboard returns linked_account_required for Guest", async () => {
  const app = createSystemTestApp({ transport: "guest" });
  const response = await app.request("http://localhost/me/progress/leaderboard");
  const payload = await response.json() as ProgressLeaderboard;

  assert.equal(response.status, 200);
  assert.equal(payload.status, "linked_account_required");
  assert.deepEqual(payload.windows, []);
  assert.equal(payload.defaultWindowKey, "last_24_hours");
  assert.equal(payload.metric.metricVersion, "qualified_reviews_v1");
});

test("GET /me/progress/leaderboard rejects ApiKey authentication", async () => {
  let called = false;
  const app = createSystemTestApp({
    transport: "api_key",
    loadProgressLeaderboardFn: async () => {
      called = true;
      return createProgressLeaderboard();
    },
  });
  const response = await app.request("http://localhost/me/progress/leaderboard");

  assert.equal(called, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "PROGRESS_HUMAN_AUTH_REQUIRED",
  });
});

test("API Gateway predeclares /me/progress/leaderboard", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /meProgress\.addResource\("leaderboard"\)\.addMethod\("GET", integration\);/,
  );
});

test("published OpenAPI documents the progress leaderboard without internal ids", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{ schemas?: Readonly<Record<string, unknown>> }>;
  }>;
  const leaderboardPath = openApiDocument.paths?.["/me/progress/leaderboard"];
  const schemas = openApiDocument.components?.schemas ?? {};
  const leaderboardSchemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => name.startsWith("ProgressLeaderboard") || name === "LeaderboardWindowKey"),
  );
  const serializedSchemas = JSON.stringify(leaderboardSchemas);

  assert.notEqual(leaderboardPath?.get, undefined);
  assert.notEqual(schemas.ProgressLeaderboardResponse, undefined);
  for (const expectedField of [
    "status",
    "defaultWindowKey",
    "metricVersion",
    "anonymousDisplayName",
    "friendDisplayName",
    "publicProfileId",
    "qualifiedReviewCount",
    "rank",
    "nextRefreshAfter",
    "participantCount",
    "rankingRows",
  ]) {
    assert.equal(serializedSchemas.includes(expectedField), true, `OpenAPI must document ${expectedField}`);
  }
  for (const internalField of [
    "userId",
    "friend_user_id",
    "friendUserId",
    "friend_public_profile_id",
    "friendPublicProfileId",
    "created_from_invitation_id",
    "friendInvitationId",
    "inviter_user_id",
    "inviterUserId",
    "createdFromInvitationId",
    "baseSort",
    "reviewed_by",
    "reviewedBy",
    "email",
  ]) {
    assert.equal(serializedSchemas.includes(internalField), false, `OpenAPI must not expose ${internalField}`);
  }
});

test("GET /me/progress returns 404 after legacy endpoint removal", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressSeriesFn: async () => createProgressSeries(),
    loadUserProgressSummaryFn: async () => createProgressSummaryResponse(),
  });
  const response = await app.request(
    "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
  );

  assert.equal(response.status, 404);
});

test("GET /me/progress/summary validates required and malformed query parameters", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressSummaryFn: async () => createProgressSummaryResponse(),
  });
  const invalidCases = [
    {
      url: "http://localhost/me/progress/summary",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/summary?timeZone=Mars/Olympus",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    const response = await app.request(invalidCase.url);
    const payload = await response.json() as Readonly<{ code: string | null }>;
    assert.equal(response.status, invalidCase.status);
    assert.equal(payload.code, invalidCase.code);
  }
});

test("GET /me/progress/review-schedule validates required and malformed query parameters", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressReviewScheduleFn: async () => createProgressReviewSchedule(),
  });
  const invalidCases = [
    {
      url: "http://localhost/me/progress/review-schedule",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/review-schedule?timeZone=Mars/Olympus",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    const response = await app.request(invalidCase.url);
    const payload = await response.json() as Readonly<{ code: string | null }>;
    assert.equal(response.status, invalidCase.status);
    assert.equal(payload.code, invalidCase.code);
  }
});

test("GET /me/progress/series validates required and malformed query parameters", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressSeriesFn: async () => createProgressSeries(),
  });
  const invalidCases = [
    {
      url: "http://localhost/me/progress/series?from=2026-04-11&to=2026-04-17",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Mars/Olympus&from=2026-04-11&to=2026-04-17",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&to=2026-04-17",
      status: 400,
      code: "PROGRESS_FROM_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11",
      status: 400,
      code: "PROGRESS_TO_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-31&to=2026-04-17",
      status: 400,
      code: "PROGRESS_FROM_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-99",
      status: 400,
      code: "PROGRESS_TO_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-18&to=2026-04-17",
      status: 400,
      code: "PROGRESS_RANGE_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2025-04-16&to=2026-04-17",
      status: 400,
      code: "PROGRESS_RANGE_TOO_LARGE",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    const response = await app.request(invalidCase.url);
    const payload = await response.json() as Readonly<{ code: string | null }>;
    assert.equal(response.status, invalidCase.status);
    assert.equal(payload.code, invalidCase.code);
  }
});
