import type { Hono } from "hono";
import {
  loadLeaderboardProfile,
  loadProgressLeaderboard,
  loadStreakLeaderboard,
  loadUserProgressReviewSchedule,
  loadUserProgressSeries,
  loadUserProgressSummary,
  parseProgressReviewScheduleInputFromRequest,
  parseProgressSeriesInputFromRequest,
  parseProgressSummaryInputFromRequest,
  type LeaderboardProfile,
  type ProgressLeaderboard,
  type ProgressReviewSchedule,
  type ProgressSeries,
  type ProgressSummaryResponse,
  type StreakLeaderboard,
} from "../../progress";
import {
  addBackendBreadcrumb,
  normalizeCaughtError,
} from "../../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../../observability/reporting";
import { createBackendFailureDetails } from "../../server/logging";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import {
  assertProgressHumanTransport,
  createSystemScope,
  readRequestedProgressParameters,
} from "./support";

export {
  loadLeaderboardProfile,
  loadProgressLeaderboard,
  loadUserProgressReviewSchedule,
  loadUserProgressSeries,
  loadUserProgressSummary,
  loadStreakLeaderboard,
};

type ProgressRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  loadUserProgressReviewScheduleFn: typeof loadUserProgressReviewSchedule;
  loadUserProgressSeriesFn: typeof loadUserProgressSeries;
  loadUserProgressSummaryFn: typeof loadUserProgressSummary;
  loadLeaderboardProfileFn: typeof loadLeaderboardProfile;
  loadProgressLeaderboardFn: typeof loadProgressLeaderboard;
  loadStreakLeaderboardFn: typeof loadStreakLeaderboard;
}>;

export function registerProgressRoutes(
  app: Hono<AppEnv>,
  options: ProgressRoutesOptions,
): void {
  app.get("/me/progress/summary", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedParameters = readRequestedProgressParameters(requestUrl);

    try {
      assertProgressHumanTransport(requestContext.transport);

      const progressInput = parseProgressSummaryInputFromRequest(context.req.raw);
      const progress = await options.loadUserProgressSummaryFn({
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
          longestStreakDays: progress.summary.longestStreakDays,
          hasReviewedToday: progress.summary.hasReviewedToday,
          lastReviewedOn: progress.summary.lastReviewedOn,
          activeReviewDays: progress.summary.activeReviewDays,
          streakFreezeAvailableCredits: progress.summary.streakFreeze.availableCredits,
          streakFreezeCapacity: progress.summary.streakFreeze.capacity,
          streakFreezeBalanceUnits: progress.summary.streakFreeze.balanceUnits,
          streakFreezeUnitsPerCredit: progress.summary.streakFreeze.unitsPerCredit,
          streakFreezeEarnedUnitsPerStreakDay: progress.summary.streakFreeze.earnedUnitsPerStreakDay,
          streakFreezeNextCreditProgressUnits: progress.summary.streakFreeze.nextCreditProgressUnits,
          streakFreezeNextCreditRequiredUnits: progress.summary.streakFreeze.nextCreditRequiredUnits,
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
        longestStreakDays: null,
        hasReviewedToday: null,
        lastReviewedOn: null,
        activeReviewDays: null,
        streakFreezeAvailableCredits: null,
        streakFreezeCapacity: null,
        streakFreezeBalanceUnits: null,
        streakFreezeUnitsPerCredit: null,
        streakFreezeEarnedUnitsPerStreakDay: null,
        streakFreezeNextCreditProgressUnits: null,
        streakFreezeNextCreditRequiredUnits: null,
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
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedParameters = readRequestedProgressParameters(requestUrl);

    try {
      assertProgressHumanTransport(requestContext.transport);

      const progressInput = parseProgressReviewScheduleInputFromRequest(context.req.raw);
      const progress = await options.loadUserProgressReviewScheduleFn({
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
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedParameters = readRequestedProgressParameters(requestUrl);

    try {
      assertProgressHumanTransport(requestContext.transport);

      const progressInput = parseProgressSeriesInputFromRequest(context.req.raw);
      const progress = await options.loadUserProgressSeriesFn({
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

  // Legacy rating leaderboard path. A future /me/progress/leaderboards/rating
  // alias is intentionally outside the streak leaderboard change.
  app.get("/me/progress/leaderboard", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");

    try {
      assertProgressHumanTransport(requestContext.transport);

      const leaderboard = await options.loadProgressLeaderboardFn({
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

  app.get("/me/progress/leaderboards/profiles/:publicProfileId", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const publicProfileId = context.req.param("publicProfileId");

    try {
      assertProgressHumanTransport(requestContext.transport);

      const profile = await options.loadLeaderboardProfileFn({
        userId: requestContext.userId,
        transport: requestContext.transport,
        localeHint: requestContext.locale,
        publicProfileId,
      });
      const bestRatingPlacement = profile.status === "ready" ? profile.metrics.bestRatingPlacement : null;

      addBackendBreadcrumb({
        action: "me_progress_leaderboard_profile",
        scope: createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId),
        details: {
          statusCode: 200,
          authTransport: requestContext.transport,
          status: profile.status,
          isFriend: profile.status === "ready" ? profile.isFriend : null,
          currentStreakDays: profile.status === "ready" ? profile.metrics.currentStreakDays : null,
          bestRatingWindowKey: bestRatingPlacement?.windowKey ?? null,
          bestRatingRank: bestRatingPlacement?.rank ?? null,
          reviewActivityDayCount: profile.status === "ready" ? profile.reviewActivity.days.length : null,
          totalCards: profile.status === "ready" ? profile.stats.totalCards : null,
          generatedAt: profile.status === "ready" ? profile.generatedAt : null,
        },
      });

      return context.json(profile satisfies LeaderboardProfile);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId);
      const details = {
        authTransport: requestContext.transport,
        status: null,
        isFriend: null,
        currentStreakDays: null,
        bestRatingWindowKey: null,
        bestRatingRank: null,
        reviewActivityDayCount: null,
        totalCards: null,
        generatedAt: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_leaderboard_profile_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_leaderboard_profile_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/me/progress/leaderboards/streak", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");

    try {
      assertProgressHumanTransport(requestContext.transport);

      const leaderboard = await options.loadStreakLeaderboardFn({
        userId: requestContext.userId,
        transport: requestContext.transport,
        localeHint: requestContext.locale,
      });

      addBackendBreadcrumb({
        action: "me_progress_streak_leaderboard",
        scope: createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId),
        details: {
          statusCode: 200,
          authTransport: requestContext.transport,
          status: leaderboard.status,
          metricVersion: leaderboard.metric.metricVersion,
          participantCount: leaderboard.status === "ready" ? leaderboard.participantCount : null,
        },
      });

      return context.json(leaderboard satisfies StreakLeaderboard);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, requestContext.userId);
      const details = {
        authTransport: requestContext.transport,
        status: null,
        metricVersion: null,
        participantCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_streak_leaderboard_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_streak_leaderboard_error", scope, details },
      );
      throw error;
    }
  });
}
