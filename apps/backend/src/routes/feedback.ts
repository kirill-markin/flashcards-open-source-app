import { Hono } from "hono";
import { withTransientDatabaseRetry } from "../database/transient";
import {
  feedbackServiceDependencies,
  loadFeedbackStateForRequest,
  recordFeedbackPromptEventForRequest,
  submitFeedbackForRequest,
  type FeedbackPromptEventInput,
  type FeedbackRequestUser,
  type FeedbackServiceDependencies,
  type FeedbackSubmissionInput,
} from "../feedback";
import { parseFeedbackPromptEventInput, parseFeedbackSubmissionInput } from "../feedback/input";
import { HttpError } from "../shared/errors";
import { loadRequestContextFromRequest, type RequestContext } from "../server/requestContext";
import { expectRecord, parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";

type FeedbackRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  feedbackServiceDependencies?: FeedbackServiceDependencies;
  withTransientDatabaseRetryFn?: typeof withTransientDatabaseRetry;
}>;

const feedbackJsonBodyMaxBytes = 65_536;

function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

function createFeedbackRouteScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
  );
}

function assertFeedbackTransport(requestContext: RequestContext): void {
  if (requestContext.transport === "api_key") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication.",
      "FEEDBACK_HUMAN_AUTH_REQUIRED",
    );
  }
}

function toFeedbackRequestUser(requestContext: RequestContext): FeedbackRequestUser {
  return {
    userId: requestContext.userId,
    email: requestContext.email,
  };
}

async function parseFeedbackJsonBody(request: Request): Promise<Record<string, unknown>> {
  return expectRecord(await parseJsonBodyWithByteLimit(
    request,
    feedbackJsonBodyMaxBytes,
    "Feedback request body is too large.",
    "FEEDBACK_BODY_TOO_LARGE",
  ));
}

export function createFeedbackRoutes(options: FeedbackRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const dependencies = options.feedbackServiceDependencies ?? feedbackServiceDependencies;
  const withTransientDatabaseRetryFn = options.withTransientDatabaseRetryFn ?? withTransientDatabaseRetry;

  app.get("/feedback/state", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;

    try {
      const state = await withTransientDatabaseRetryFn(
        async () => {
          const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
          requestContext = loadedContext.requestContext;
          assertFeedbackTransport(loadedContext.requestContext);
          return loadFeedbackStateForRequest(
            toFeedbackRequestUser(loadedContext.requestContext),
            createFeedbackRouteScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, null),
            withTransientDatabaseRetryFn,
            dependencies,
          );
        },
        () => createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          null,
        ),
      );

      addBackendBreadcrumb({
        action: "feedback_state",
        scope: createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          null,
        ),
        details: {
          statusCode: 200,
        },
      });
      return context.json(state);
    } catch (error) {
      const scope = createFeedbackRouteScope(
        requestId,
        context.req.path,
        context.req.method,
        getRequestContextUserId(requestContext),
        null,
      );
      const details = {
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "feedback_state_error", error: normalizeCaughtError(error), scope, details },
        { action: "feedback_state_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/feedback/prompt-events", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let input: FeedbackPromptEventInput | null = null;

    try {
      const loadedContext = await withTransientDatabaseRetryFn(
        async () => {
          const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
          requestContext = loadedContext.requestContext;
          assertFeedbackTransport(loadedContext.requestContext);
          return loadedContext;
        },
        () => createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          null,
        ),
      );
      input = parseFeedbackPromptEventInput(await parseFeedbackJsonBody(context.req.raw));

      const state = await recordFeedbackPromptEventForRequest(
        toFeedbackRequestUser(loadedContext.requestContext),
        input,
        createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          loadedContext.requestContext.userId,
          input.workspaceId,
        ),
        withTransientDatabaseRetryFn,
        dependencies,
      );

      addBackendBreadcrumb({
        action: "feedback_prompt_event",
        scope: createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          input?.workspaceId ?? null,
        ),
        details: {
          statusCode: 200,
          platform: input?.platform ?? null,
          eventType: input?.eventType ?? null,
        },
      });
      return context.json(state);
    } catch (error) {
      const scope = createFeedbackRouteScope(
        requestId,
        context.req.path,
        context.req.method,
        getRequestContextUserId(requestContext),
        input?.workspaceId ?? null,
      );
      const details = {
        platform: input?.platform ?? null,
        eventType: input?.eventType ?? null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "feedback_prompt_event_error", error: normalizeCaughtError(error), scope, details },
        { action: "feedback_prompt_event_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/feedback/submissions", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let input: FeedbackSubmissionInput | null = null;

    try {
      const loadedContext = await withTransientDatabaseRetryFn(
        async () => {
          const loadedRequestContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
          requestContext = loadedRequestContext.requestContext;
          assertFeedbackTransport(loadedRequestContext.requestContext);
          return loadedRequestContext;
        },
        () => createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          null,
        ),
      );
      input = parseFeedbackSubmissionInput(await parseFeedbackJsonBody(context.req.raw));

      const response = await submitFeedbackForRequest(
        toFeedbackRequestUser(loadedContext.requestContext),
        input,
        requestId,
        createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          loadedContext.requestContext.userId,
          input.workspaceId,
        ),
        withTransientDatabaseRetryFn,
        dependencies,
      );

      addBackendBreadcrumb({
        action: "feedback_submission",
        scope: createFeedbackRouteScope(
          requestId,
          context.req.path,
          context.req.method,
          loadedContext.requestContext.userId,
          input.workspaceId,
        ),
        details: {
          statusCode: 200,
          platform: input.platform,
          trigger: input.trigger,
        },
      });
      return context.json(response);
    } catch (error) {
      const scope = createFeedbackRouteScope(
        requestId,
        context.req.path,
        context.req.method,
        getRequestContextUserId(requestContext),
        input?.workspaceId ?? null,
      );
      const details = {
        platform: input?.platform ?? null,
        trigger: input?.trigger ?? null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "feedback_submission_error", error: normalizeCaughtError(error), scope, details },
        { action: "feedback_submission_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
