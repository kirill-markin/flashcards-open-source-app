import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { deleteAccountForAuthenticatedUser } from "../accountDeletion";
import { createAgentDiscoveryEnvelope } from "../agentDiscovery";
import { createAgentAccountEnvelope, shouldUseAgentSetupEnvelope } from "../agentSetup";
import { HttpError } from "../errors";
import { loadUserProgressSeries, parseProgressSeriesInputFromRequest, type ProgressSeries } from "../progress";
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
import { logCloudRouteEvent, summarizeValidationIssues } from "../server/logging";
import type { AppEnv } from "../app";

type SystemRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  loadUserProgressSeriesFn?: typeof loadUserProgressSeries;
}>;

export function createSystemRoutes(options: SystemRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const loadUserProgressSeriesFn = options.loadUserProgressSeriesFn ?? loadUserProgressSeries;

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

  app.get("/me/progress", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const requestId = context.get("requestId");
    const requestUrl = new URL(context.req.url);
    const requestedTimeZone = requestUrl.searchParams.get("timeZone");
    const requestedFrom = requestUrl.searchParams.get("from");
    const requestedTo = requestUrl.searchParams.get("to");

    try {
      if (requestContext.transport === "api_key") {
        throw new HttpError(
          403,
          "This endpoint requires Guest, Bearer, or Session authentication",
          "PROGRESS_HUMAN_AUTH_REQUIRED",
        );
      }

      const progressInput = parseProgressSeriesInputFromRequest(context.req.raw);
      const progress = await loadUserProgressSeriesFn({
        userId: requestContext.userId,
        timeZone: progressInput.timeZone,
        from: progressInput.from,
        to: progressInput.to,
      });
      const hasNonZeroReviewDays = progress.dailyReviews.some((day) => day.reviewCount > 0);

      logCloudRouteEvent("me_progress", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        authTransport: requestContext.transport,
        timeZone: progress.timeZone,
        from: progress.from,
        to: progress.to,
        returnedDayCount: progress.dailyReviews.length,
        hasNonZeroReviewDays,
      }, false);

      return context.json(progress satisfies ProgressSeries);
    } catch (error) {
      logCloudRouteEvent("me_progress_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        authTransport: requestContext.transport,
        timeZone: requestedTimeZone,
        from: requestedFrom,
        to: requestedTo,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
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
      logCloudRouteEvent("account_delete", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: auth.userId,
        transport: auth.transport,
      }, false);
      return context.json({ ok: true } as const);
    } catch (error) {
      logCloudRouteEvent("account_delete_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: auth.userId,
        transport: auth.transport,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  return app;
}
