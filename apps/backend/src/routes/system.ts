import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { deleteAccountForAuthenticatedUser } from "../auth/accountDeletion";
import { createAgentDiscoveryEnvelope } from "../agent/discovery";
import { createAgentAccountEnvelope, shouldUseAgentSetupEnvelope } from "../agent/setup";
import {
  ensurePublicProfileForUser,
  updateLeaderboardParticipation,
  type PublicProfile,
} from "../community/publicProfiles";
import {
  acceptFriendInvitation,
  createFriendInvitation,
  parseFriendInvitationDisplayName,
  previewFriendInvitation,
  type FriendInvitationAcceptInput,
  type FriendInvitationAcceptResponse,
  type FriendInvitationCreateInput,
  type FriendInvitationCreateResponse,
  type FriendInvitationPreviewResponse,
} from "../community/friendInvitations";
import { HttpError } from "../shared/errors";
import { queryWithUserScope } from "../database";
import {
  loadProgressLeaderboard,
  loadUserProgressReviewSchedule,
  loadUserProgressSeries,
  loadUserProgressSummary,
  parseProgressReviewScheduleInputFromRequest,
  parseProgressSeriesInputFromRequest,
  parseProgressSummaryInputFromRequest,
  type ProgressLeaderboard,
  type ProgressReviewSchedule,
  type ProgressSeries,
  type ProgressSummaryResponse,
} from "../progress";
import { unsafeQuery } from "../database/unsafe";
import { loadOpenApiDocument } from "../shared/openapi";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  getSessionCsrfToken,
  toAuthRequest,
} from "../auth/requestSecurity";
import { expectBoolean, expectRecord, parseJsonBody } from "../server/requestParsing";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";
import type { AuthTransport } from "../auth";
import type { AccountPreferences } from "../auth/ensureUser";

type SystemRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  loadUserProgressReviewScheduleFn?: typeof loadUserProgressReviewSchedule;
  loadUserProgressSeriesFn?: typeof loadUserProgressSeries;
  loadUserProgressSummaryFn?: typeof loadUserProgressSummary;
  loadProgressLeaderboardFn?: typeof loadProgressLeaderboard;
  updateAccountPreferencesFn?: UpdateAccountPreferencesFn;
  ensurePublicProfileForUserFn?: EnsurePublicProfileForUserFn;
  updateLeaderboardParticipationFn?: UpdateLeaderboardParticipationFn;
  createFriendInvitationFn?: CreateFriendInvitationFn;
  previewFriendInvitationFn?: PreviewFriendInvitationFn;
  acceptFriendInvitationFn?: AcceptFriendInvitationFn;
}>;

type ProgressRequestedParameters = Readonly<{
  timeZone: string | null;
  from: string | null;
  to: string | null;
}>;

type AccountPreferencesRow = Readonly<{
  review_reaction_animations_enabled: boolean;
}>;

type UpdateAccountPreferencesFn = (
  userId: string,
  preferences: AccountPreferences,
) => Promise<AccountPreferences>;

type EnsurePublicProfileForUserFn = (userId: string, localeHint: string) => Promise<PublicProfile>;

type UpdateLeaderboardParticipationFn = (
  userId: string,
  leaderboardParticipationEnabled: boolean,
  localeHint: string,
) => Promise<PublicProfile>;

type CreateFriendInvitationFn = (input: FriendInvitationCreateInput) => Promise<FriendInvitationCreateResponse>;

type PreviewFriendInvitationFn = (rawInviteToken: string) => Promise<FriendInvitationPreviewResponse>;

type AcceptFriendInvitationFn = (input: FriendInvitationAcceptInput) => Promise<FriendInvitationAcceptResponse>;

type CommunityPublicProfileResponse = PublicProfile & Readonly<{
  linkedAccountRequiredForLeaderboard: boolean;
}>;

function readRequestedProgressParameters(requestUrl: URL): ProgressRequestedParameters {
  return {
    timeZone: requestUrl.searchParams.get("timeZone"),
    from: requestUrl.searchParams.get("from"),
    to: requestUrl.searchParams.get("to"),
  };
}

function mapAccountPreferencesRow(row: AccountPreferencesRow): AccountPreferences {
  return {
    reviewReactionAnimationsEnabled: row.review_reaction_animations_enabled,
  };
}

function assertProgressHumanTransport(transport: string): void {
  if (transport === "api_key") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "PROGRESS_HUMAN_AUTH_REQUIRED",
    );
  }
}

function assertAccountPreferencesHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "guest") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "ACCOUNT_PREFERENCES_HUMAN_AUTH_REQUIRED",
    );
  }
}

function assertCommunityProfileHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "guest") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "COMMUNITY_PROFILE_HUMAN_AUTH_REQUIRED",
    );
  }
}

function assertFriendInvitationHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "none") {
    throw new HttpError(
      403,
      "This endpoint requires signed-in human authentication",
      "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED",
    );
  }
}

function assertFriendInvitationPublicPreviewTransport(request: Request): void {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader !== null && authorizationHeader.startsWith("ApiKey ")) {
    throw new HttpError(
      403,
      "Friend invitation preview does not support ApiKey authentication",
      "FRIEND_INVITATION_API_KEY_AUTH_UNSUPPORTED",
    );
  }
}

function parseAccountPreferencesInput(body: Record<string, unknown>): AccountPreferences {
  const unexpectedKey = Object.keys(body).find((key) => key !== "reviewReactionAnimationsEnabled");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected preference field: ${unexpectedKey}`,
      "ACCOUNT_PREFERENCES_FIELD_UNKNOWN",
    );
  }

  return {
    reviewReactionAnimationsEnabled: expectBoolean(
      body.reviewReactionAnimationsEnabled,
      "reviewReactionAnimationsEnabled",
    ),
  };
}

function parseCommunityProfileInput(body: Record<string, unknown>): Readonly<{
  leaderboardParticipationEnabled: boolean;
}> {
  const unexpectedKey = Object.keys(body).find((key) => key !== "leaderboardParticipationEnabled");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected community profile field: ${unexpectedKey}`,
      "COMMUNITY_PROFILE_FIELD_UNKNOWN",
    );
  }

  return {
    leaderboardParticipationEnabled: expectBoolean(
      body.leaderboardParticipationEnabled,
      "leaderboardParticipationEnabled",
    ),
  };
}

function parseFriendInvitationCreateInput(body: Record<string, unknown>): Readonly<{
  inviteeDisplayName: string;
}> {
  const unexpectedKey = Object.keys(body).find((key) => key !== "inviteeDisplayName");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected friend invitation field: ${unexpectedKey}`,
      "FRIEND_INVITATION_FIELD_UNKNOWN",
    );
  }

  return {
    inviteeDisplayName: parseFriendInvitationDisplayName(body.inviteeDisplayName, "inviteeDisplayName"),
  };
}

function parseFriendInvitationAcceptInput(body: Record<string, unknown>): Readonly<{
  inviterDisplayName: string;
}> {
  const unexpectedKey = Object.keys(body).find((key) => key !== "inviterDisplayName");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected friend invitation field: ${unexpectedKey}`,
      "FRIEND_INVITATION_FIELD_UNKNOWN",
    );
  }

  return {
    inviterDisplayName: parseFriendInvitationDisplayName(body.inviterDisplayName, "inviterDisplayName"),
  };
}

function parseInviteTokenParam(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new HttpError(
      400,
      "inviteToken is required",
      "FRIEND_INVITATION_TOKEN_REQUIRED",
    );
  }

  return value;
}

async function updateAccountPreferences(
  userId: string,
  preferences: AccountPreferences,
): Promise<AccountPreferences> {
  const result = await queryWithUserScope<AccountPreferencesRow>(
    { userId },
    [
      "UPDATE org.user_settings",
      "SET review_reaction_animations_enabled = $2",
      "WHERE user_id = $1",
      "RETURNING review_reaction_animations_enabled",
    ].join(" "),
    [userId, preferences.reviewReactionAnimationsEnabled],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Failed to update account preferences for user ${userId}`);
  }

  return mapAccountPreferencesRow(row);
}

function createCommunityPublicProfileResponse(
  profile: PublicProfile,
  transport: AuthTransport,
): CommunityPublicProfileResponse {
  return {
    ...profile,
    linkedAccountRequiredForLeaderboard: transport === "guest",
  };
}

function createSystemScope(
  requestId: string,
  route: string,
  method: string,
  userId: string,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    null,
    null,
    null,
    null,
  );
}

export function createSystemRoutes(options: SystemRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const loadUserProgressReviewScheduleFn = options.loadUserProgressReviewScheduleFn ?? loadUserProgressReviewSchedule;
  const loadUserProgressSeriesFn = options.loadUserProgressSeriesFn ?? loadUserProgressSeries;
  const loadUserProgressSummaryFn = options.loadUserProgressSummaryFn ?? loadUserProgressSummary;
  const loadProgressLeaderboardFn = options.loadProgressLeaderboardFn ?? loadProgressLeaderboard;
  const updateAccountPreferencesFn = options.updateAccountPreferencesFn ?? updateAccountPreferences;
  const ensurePublicProfileForUserFn = options.ensurePublicProfileForUserFn ?? ensurePublicProfileForUser;
  const updateLeaderboardParticipationFn = options.updateLeaderboardParticipationFn ?? updateLeaderboardParticipation;
  const createFriendInvitationFn = options.createFriendInvitationFn ?? createFriendInvitation;
  const previewFriendInvitationFn = options.previewFriendInvitationFn ?? previewFriendInvitation;
  const acceptFriendInvitationFn = options.acceptFriendInvitationFn ?? acceptFriendInvitation;

  app.get("/", async (context) => context.json(createAgentDiscoveryEnvelope(context.req.url)));
  app.get("/agent", async (context) => context.json(createAgentDiscoveryEnvelope(context.req.url)));
  app.get("/openapi.json", async (context) => context.json(loadOpenApiDocument()));
  app.get("/swagger.json", async (context) => context.json(loadOpenApiDocument()));

  app.get("/health", async (context) => {
    const result = await unsafeQuery<Readonly<{ now: Date | string }>>("SELECT now() AS now", []);
    return context.json({
      status: "ok",
      service: "flashcards-open-source-app-backend",
      dbTime: result.rows[0]?.now ?? null,
    });
  });

  app.get("/me", async (context) => {
    const { requestAuthInputs, requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
      return context.json(createAgentAccountEnvelope(context.req.url, requestContext));
    }

    return context.json({
      userId: requestContext.userId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      authTransport: requestContext.transport,
      csrfToken: requestContext.transport === "session" && requestAuthInputs.sessionToken !== undefined
        ? await getSessionCsrfToken(requestAuthInputs.sessionToken)
        : null,
      profile: {
        email: requestContext.email,
        locale: requestContext.locale,
        createdAt: requestContext.userSettingsCreatedAt,
      },
      preferences: requestContext.preferences,
    });
  });

  app.patch("/me/preferences", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertAccountPreferencesHumanTransport(requestContext.transport);

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const preferencesInput = parseAccountPreferencesInput(body);
    const preferences = await updateAccountPreferencesFn(requestContext.userId, preferencesInput);

    return context.json({
      preferences,
    });
  });

  app.get("/me/community/profile", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertCommunityProfileHumanTransport(requestContext.transport);

    const profile = await ensurePublicProfileForUserFn(requestContext.userId, requestContext.locale);
    return context.json(createCommunityPublicProfileResponse(profile, requestContext.transport));
  });

  app.patch("/me/community/profile", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertCommunityProfileHumanTransport(requestContext.transport);

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseCommunityProfileInput(body);
    const profile = await updateLeaderboardParticipationFn(
      requestContext.userId,
      input.leaderboardParticipationEnabled,
      requestContext.locale,
    );

    return context.json(createCommunityPublicProfileResponse(profile, requestContext.transport));
  });

  app.post("/me/community/friend-invitations", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertFriendInvitationHumanTransport(requestContext.transport);

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseFriendInvitationCreateInput(body);
    const invitation = await createFriendInvitationFn({
      userId: requestContext.userId,
      inviteeDisplayName: input.inviteeDisplayName,
    });

    return context.json(invitation satisfies FriendInvitationCreateResponse);
  });

  app.get("/community/friend-invitations/:inviteToken", async (context) => {
    assertFriendInvitationPublicPreviewTransport(context.req.raw);
    const rawInviteToken = parseInviteTokenParam(context.req.param("inviteToken"));
    const invitation = await previewFriendInvitationFn(rawInviteToken);
    return context.json(invitation satisfies FriendInvitationPreviewResponse);
  });

  app.post("/me/community/friend-invitations/:inviteToken/accept", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertFriendInvitationHumanTransport(requestContext.transport);

    const rawInviteToken = parseInviteTokenParam(context.req.param("inviteToken"));
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseFriendInvitationAcceptInput(body);
    const invitation = await acceptFriendInvitationFn({
      userId: requestContext.userId,
      rawInviteToken,
      inviterDisplayName: input.inviterDisplayName,
    });

    return context.json(invitation satisfies FriendInvitationAcceptResponse);
  });

  app.get("/me/progress/summary", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedParameters = readRequestedProgressParameters(requestUrl);

    try {
      assertProgressHumanTransport(requestContext.transport);

      const progressInput = parseProgressSummaryInputFromRequest(context.req.raw);
      const progress = await loadUserProgressSummaryFn({
        userId: requestContext.userId,
        timeZone: progressInput.timeZone,
      });

      addBackendBreadcrumb({
        action: "me_progress_summary",
        scope: createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId),
        details: {
          statusCode: 200,
          authTransport: requestContext.transport,
          timeZone: progress.timeZone,
          currentStreakDays: progress.summary.currentStreakDays,
          hasReviewedToday: progress.summary.hasReviewedToday,
          lastReviewedOn: progress.summary.lastReviewedOn,
          activeReviewDays: progress.summary.activeReviewDays,
          generatedAt: progress.generatedAt,
        },
      });

      return context.json(progress satisfies ProgressSummaryResponse);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId);
      const details = {
        authTransport: requestContext.transport,
        timeZone: requestedParameters.timeZone,
        currentStreakDays: null,
        hasReviewedToday: null,
        lastReviewedOn: null,
        activeReviewDays: null,
        generatedAt: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_summary_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_summary_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/me/progress/review-schedule", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedParameters = readRequestedProgressParameters(requestUrl);

    try {
      assertProgressHumanTransport(requestContext.transport);

      const progressInput = parseProgressReviewScheduleInputFromRequest(context.req.raw);
      const progress = await loadUserProgressReviewScheduleFn({
        userId: requestContext.userId,
        timeZone: progressInput.timeZone,
      });

      addBackendBreadcrumb({
        action: "me_progress_review_schedule",
        scope: createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId),
        details: {
          statusCode: 200,
          authTransport: requestContext.transport,
          timeZone: progress.timeZone,
          bucketCount: progress.buckets.length,
          totalCards: progress.totalCards,
          generatedAt: progress.generatedAt,
        },
      });

      return context.json(progress satisfies ProgressReviewSchedule);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId);
      const details = {
        authTransport: requestContext.transport,
        timeZone: requestedParameters.timeZone,
        bucketCount: null,
        totalCards: null,
        generatedAt: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_review_schedule_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_review_schedule_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/me/progress/series", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedParameters = readRequestedProgressParameters(requestUrl);

    try {
      assertProgressHumanTransport(requestContext.transport);

      const progressInput = parseProgressSeriesInputFromRequest(context.req.raw);
      const progress = await loadUserProgressSeriesFn({
        userId: requestContext.userId,
        timeZone: progressInput.timeZone,
        from: progressInput.from,
        to: progressInput.to,
      });
      const hasNonZeroReviewDays = progress.dailyReviews.some((day) => day.reviewCount > 0);

      addBackendBreadcrumb({
        action: "me_progress_series",
        scope: createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId),
        details: {
          statusCode: 200,
          authTransport: requestContext.transport,
          timeZone: progress.timeZone,
          from: progress.from,
          to: progress.to,
          returnedDayCount: progress.dailyReviews.length,
          hasNonZeroReviewDays,
          generatedAt: progress.generatedAt,
        },
      });

      return context.json(progress satisfies ProgressSeries);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId);
      const details = {
        authTransport: requestContext.transport,
        timeZone: requestedParameters.timeZone,
        from: requestedParameters.from,
        to: requestedParameters.to,
        returnedDayCount: null,
        hasNonZeroReviewDays: null,
        generatedAt: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_series_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_series_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/me/progress/leaderboard", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");

    try {
      assertProgressHumanTransport(requestContext.transport);

      const leaderboard = await loadProgressLeaderboardFn({
        userId: requestContext.userId,
        transport: requestContext.transport,
        localeHint: requestContext.locale,
      });

      addBackendBreadcrumb({
        action: "me_progress_leaderboard",
        scope: createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId),
        details: {
          statusCode: 200,
          authTransport: requestContext.transport,
          status: leaderboard.status,
          metricVersion: leaderboard.metric.metricVersion,
          defaultWindowKey: leaderboard.defaultWindowKey,
          windowCount: leaderboard.windows.length,
        },
      });

      return context.json(leaderboard satisfies ProgressLeaderboard);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId);
      const details = {
        authTransport: requestContext.transport,
        status: null,
        metricVersion: null,
        defaultWindowKey: null,
        windowCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_leaderboard_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_leaderboard_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/me/delete", async (context) => {
    const requestId = context.get("requestId");
    const requestAuthInputs = extractRequestAuthInputs(context.req.raw);
    const auth = await authenticateRequest(toAuthRequest(requestAuthInputs));

    if (auth.transport === "session") {
      await enforceSessionCsrfProtection(context.req.method, requestAuthInputs, options.allowedOrigins);
    }

    if (auth.transport !== "session" && auth.transport !== "bearer") {
      throw new HttpError(
        403,
        "Delete account requires a signed-in human session.",
        "ACCOUNT_DELETE_HUMAN_AUTH_REQUIRED",
      );
    }

    const body = expectRecord(await parseJsonBody(context.req.raw));
    if (typeof body.confirmationText !== "string") {
      throw new HttpError(
        400,
        "confirmationText must be a string",
        "ACCOUNT_DELETE_CONFIRMATION_INVALID",
      );
    }

    try {
      await deleteAccountForAuthenticatedUser({
        appUserId: auth.userId,
        authSubjectUserId: auth.subjectUserId,
        email: auth.email,
        cognitoUsername: auth.cognitoUsername,
        confirmationText: body.confirmationText,
      });
      addBackendBreadcrumb({
        action: "account_delete",
        scope: createSystemScope(requestId, context.req.path, context.req.method, auth.userId),
        details: {
          statusCode: 200,
          transport: auth.transport,
        },
      });
      return context.json({ ok: true } as const);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, auth.userId);
      const details = {
        transport: auth.transport,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "account_delete_error", error: normalizeCaughtError(error), scope, details },
        { action: "account_delete_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
