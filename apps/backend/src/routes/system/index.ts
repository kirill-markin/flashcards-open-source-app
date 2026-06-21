import { Hono } from "hono";
import { createAgentDiscoveryEnvelope } from "../../agent/discovery";
import {
  createAgentAccountEnvelope,
  shouldUseAgentSetupEnvelope,
} from "../../agent/setup";
import { unsafeQuery } from "../../database/unsafe";
import { loadOpenApiDocument } from "../../shared/openapi";
import { getSessionCsrfToken } from "../../auth/requestSecurity";
import { loadRequestContextFromRequest } from "../../server/requestContext";
import type { AppEnv } from "../../server/app";
import {
  registerAccountPreferencesRoutes,
  updateAccountPreferences,
} from "./accountPreferences";
import { registerAccountDeletionRoute } from "./accountDeletion";
import {
  ensurePublicProfileForUser,
  registerCommunityProfileRoutes,
  updateLeaderboardParticipation,
} from "./communityProfile";
import {
  acceptFriendInvitation,
  createFriendInvitation,
  previewFriendInvitation,
  registerFriendInvitationRoutes,
} from "./friendInvitations";
import {
  loadLeaderboardProfile,
  loadProgressLeaderboard,
  loadStreakLeaderboard,
  loadUserProgressReviewSchedule,
  loadUserProgressSeries,
  loadUserProgressSummary,
  registerProgressRoutes,
} from "./progress";
import type { SystemRoutesOptions } from "./types";

export function createSystemRoutes(options: SystemRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const loadUserProgressReviewScheduleFn = options.loadUserProgressReviewScheduleFn ?? loadUserProgressReviewSchedule;
  const loadUserProgressSeriesFn = options.loadUserProgressSeriesFn ?? loadUserProgressSeries;
  const loadUserProgressSummaryFn = options.loadUserProgressSummaryFn ?? loadUserProgressSummary;
  const loadLeaderboardProfileFn = options.loadLeaderboardProfileFn ?? loadLeaderboardProfile;
  const loadProgressLeaderboardFn = options.loadProgressLeaderboardFn ?? loadProgressLeaderboard;
  const loadStreakLeaderboardFn = options.loadStreakLeaderboardFn ?? loadStreakLeaderboard;
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

  registerAccountPreferencesRoutes(app, {
    allowedOrigins: options.allowedOrigins,
    loadRequestContextFromRequestFn,
    updateAccountPreferencesFn,
  });
  registerCommunityProfileRoutes(app, {
    allowedOrigins: options.allowedOrigins,
    loadRequestContextFromRequestFn,
    ensurePublicProfileForUserFn,
    updateLeaderboardParticipationFn,
  });
  registerFriendInvitationRoutes(app, {
    allowedOrigins: options.allowedOrigins,
    loadRequestContextFromRequestFn,
    createFriendInvitationFn,
    previewFriendInvitationFn,
    acceptFriendInvitationFn,
  });
  registerProgressRoutes(app, {
    allowedOrigins: options.allowedOrigins,
    loadRequestContextFromRequestFn,
    loadUserProgressReviewScheduleFn,
    loadUserProgressSeriesFn,
    loadUserProgressSummaryFn,
    loadLeaderboardProfileFn,
    loadProgressLeaderboardFn,
    loadStreakLeaderboardFn,
  });
  registerAccountDeletionRoute(app, {
    allowedOrigins: options.allowedOrigins,
  });

  return app;
}
