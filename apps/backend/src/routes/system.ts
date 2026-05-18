import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { deleteAccountForAuthenticatedUser } from "../accountDeletion";
import { createAgentDiscoveryEnvelope } from "../agent/discovery";
import { createAgentAccountEnvelope, shouldUseAgentSetupEnvelope } from "../agent/setup";
import { HttpError } from "../errors";
import {
  loadUserProgressReviewSchedule,
  loadUserProgressSeries,
  loadUserProgressSummary,
  parseProgressReviewScheduleInputFromRequest,
  parseProgressSeriesInputFromRequest,
  parseProgressSummaryInputFromRequest,
  type ProgressReviewSchedule,
  type ProgressSeries,
  type ProgressSummaryResponse,
} from "../progress";
import { unsafeQuery } from "../dbUnsafe";
import { loadOpenApiDocument } from "../openapi";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  getSessionCsrfToken,
  toAuthRequest,
} from "../requestSecurity";
import { expectRecord, parseJsonBody } from "../server/requestParsing";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { summarizeValidationIssues } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendFailureDetails,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../app";

type SystemRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  loadUserProgressReviewScheduleFn?: typeof loadUserProgressReviewSchedule;
  loadUserProgressSeriesFn?: typeof loadUserProgressSeries;
  loadUserProgressSummaryFn?: typeof loadUserProgressSummary;
}>;

type ProgressRequestedParameters = Readonly<{
  timeZone: string | null;
  from: string | null;
  to: string | null;
}>;

function readRequestedProgressParameters(requestUrl: URL): ProgressRequestedParameters {
  return {
    timeZone: requestUrl.searchParams.get("timeZone"),
    from: requestUrl.searchParams.get("from"),
    to: requestUrl.searchParams.get("to"),
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

function createFailureDetails(error: unknown): BackendFailureDetails {
  return {
    statusCode: error instanceof HttpError ? error.statusCode : 500,
    code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
    validationIssues: summarizeValidationIssues(error),
  };
}

export function createSystemRoutes(options: SystemRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const loadUserProgressReviewScheduleFn = options.loadUserProgressReviewScheduleFn ?? loadUserProgressReviewSchedule;
  const loadUserProgressSeriesFn = options.loadUserProgressSeriesFn ?? loadUserProgressSeries;
  const loadUserProgressSummaryFn = options.loadUserProgressSummaryFn ?? loadUserProgressSummary;

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
    });
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
        ...createFailureDetails(error),
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
        ...createFailureDetails(error),
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
        ...createFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "me_progress_series_error", error: normalizeCaughtError(error), scope, details },
        { action: "me_progress_series_error", scope, details },
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
        ...createFailureDetails(error),
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
