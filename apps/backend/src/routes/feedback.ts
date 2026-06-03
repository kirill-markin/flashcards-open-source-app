import { Hono } from "hono";
import {
  loadFeedbackStateForUser,
  recordFeedbackPromptEventForUser,
  submitFeedbackForUser,
  type FeedbackPlatform,
  type FeedbackPromptEventInput,
  type FeedbackPromptEventType,
  type FeedbackState,
  type FeedbackSubmissionInput,
  type FeedbackTrigger,
} from "../feedback";
import { HttpError } from "../shared/errors";
import { withTransientDatabaseRetry } from "../database/transient";
import {
  loadRequestContextFromRequest,
  type RequestContext,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
  parseJsonBody,
} from "../server/requestParsing";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../observability/sentry";
import type { AppEnv } from "../server/app";

type FeedbackRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  loadFeedbackStateForUserFn?: typeof loadFeedbackStateForUser;
  recordFeedbackPromptEventForUserFn?: typeof recordFeedbackPromptEventForUser;
  submitFeedbackForUserFn?: typeof submitFeedbackForUser;
  withTransientDatabaseRetryFn?: typeof withTransientDatabaseRetry;
}>;

type FeedbackStateResponse = Readonly<{
  feedbackState: FeedbackState;
}>;

const feedbackMessageMaximumLength = 5000;
const feedbackPlatforms: ReadonlySet<string> = new Set(["web", "ios", "android"]);
const feedbackTriggers: ReadonlySet<string> = new Set(["settings", "automatic"]);
const feedbackPromptEventTypes: ReadonlySet<string> = new Set(["automatic_prompt_shown"]);

function createFeedbackRouteScope(
  requestId: string,
  route: string,
  method: string,
  requestContext: RequestContext | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    requestContext?.userId ?? null,
    null,
    null,
    null,
    null,
  );
}

function assertFeedbackHumanTransport(transport: RequestContext["transport"]): void {
  if (transport !== "api_key") {
    return;
  }

  throw new HttpError(
    403,
    "This endpoint requires Guest, Bearer, or Session authentication",
    "FEEDBACK_HUMAN_AUTH_REQUIRED",
  );
}

function expectOptionalNullableUuidString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return expectUuidString(value, fieldName);
}

function expectOptionalNullableTrimmedString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`, "FEEDBACK_INVALID_REQUEST");
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function expectFeedbackPlatform(value: unknown): FeedbackPlatform {
  const platform = expectNonEmptyString(value, "platform");
  if (feedbackPlatforms.has(platform)) {
    return platform as FeedbackPlatform;
  }

  throw new HttpError(400, "platform must be web, ios, or android", "FEEDBACK_PLATFORM_INVALID");
}

function expectFeedbackTrigger(value: unknown): FeedbackTrigger {
  const trigger = expectNonEmptyString(value, "trigger");
  if (feedbackTriggers.has(trigger)) {
    return trigger as FeedbackTrigger;
  }

  throw new HttpError(400, "trigger must be settings or automatic", "FEEDBACK_TRIGGER_INVALID");
}

function expectFeedbackPromptEventType(value: unknown): FeedbackPromptEventType {
  const eventType = expectNonEmptyString(value, "eventType");
  if (feedbackPromptEventTypes.has(eventType)) {
    return eventType as FeedbackPromptEventType;
  }

  throw new HttpError(
    400,
    "eventType must be automatic_prompt_shown",
    "FEEDBACK_PROMPT_EVENT_TYPE_INVALID",
  );
}

function expectIsoTimestamp(value: unknown, fieldName: string): string {
  const rawValue = expectNonEmptyString(value, fieldName);
  const timestampMillis = Date.parse(rawValue);
  if (!Number.isFinite(timestampMillis)) {
    throw new HttpError(400, `${fieldName} must be an ISO timestamp`, "FEEDBACK_TIMESTAMP_INVALID");
  }

  return new Date(timestampMillis).toISOString();
}

function expectTimeZone(value: unknown): string {
  const timeZone = expectNonEmptyString(value, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new HttpError(400, "timezone must be a valid IANA timezone", "FEEDBACK_TIMEZONE_INVALID");
  }

  return timeZone;
}

function expectFeedbackMessage(value: unknown): string {
  const message = expectNonEmptyString(value, "message");
  if (message.length > feedbackMessageMaximumLength) {
    throw new HttpError(
      400,
      `message must be ${feedbackMessageMaximumLength} characters or fewer`,
      "FEEDBACK_MESSAGE_TOO_LONG",
    );
  }

  return message;
}

function parseFeedbackPromptEventInput(body: Record<string, unknown>): FeedbackPromptEventInput {
  return {
    feedbackPromptEventId: expectUuidString(body.feedbackPromptEventId, "feedbackPromptEventId"),
    workspaceId: expectOptionalNullableUuidString(body.workspaceId, "workspaceId"),
    installationId: expectOptionalNullableTrimmedString(body.installationId, "installationId"),
    platform: expectFeedbackPlatform(body.platform),
    appVersion: expectOptionalNullableTrimmedString(body.appVersion, "appVersion"),
    locale: expectNonEmptyString(body.locale, "locale"),
    timezone: expectTimeZone(body.timezone),
    eventType: expectFeedbackPromptEventType(body.eventType),
    createdAtClient: expectIsoTimestamp(body.createdAtClient, "createdAtClient"),
  };
}

function parseFeedbackSubmissionInput(body: Record<string, unknown>): FeedbackSubmissionInput {
  return {
    feedbackSubmissionId: expectUuidString(body.feedbackSubmissionId, "feedbackSubmissionId"),
    workspaceId: expectOptionalNullableUuidString(body.workspaceId, "workspaceId"),
    installationId: expectOptionalNullableTrimmedString(body.installationId, "installationId"),
    platform: expectFeedbackPlatform(body.platform),
    appVersion: expectOptionalNullableTrimmedString(body.appVersion, "appVersion"),
    locale: expectNonEmptyString(body.locale, "locale"),
    timezone: expectTimeZone(body.timezone),
    trigger: expectFeedbackTrigger(body.trigger),
    message: expectFeedbackMessage(body.message),
    createdAtClient: expectIsoTimestamp(body.createdAtClient, "createdAtClient"),
  };
}

export function createFeedbackRoutes(options: FeedbackRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const loadFeedbackStateForUserFn = options.loadFeedbackStateForUserFn ?? loadFeedbackStateForUser;
  const recordFeedbackPromptEventForUserFn = options.recordFeedbackPromptEventForUserFn
    ?? recordFeedbackPromptEventForUser;
  const submitFeedbackForUserFn = options.submitFeedbackForUserFn ?? submitFeedbackForUser;
  const withTransientDatabaseRetryFn = options.withTransientDatabaseRetryFn ?? withTransientDatabaseRetry;

  app.get("/feedback/state", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    const feedbackState = await withTransientDatabaseRetryFn(
      async () => {
        const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
        requestContext = loadedContext.requestContext;
        assertFeedbackHumanTransport(requestContext.transport);
        return loadFeedbackStateForUserFn(requestContext.userId);
      },
      () => createFeedbackRouteScope(requestId, context.req.path, context.req.method, requestContext),
    );

    return context.json({ feedbackState } satisfies FeedbackStateResponse);
  });

  app.post("/feedback/prompt-events", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let body: Promise<Record<string, unknown>> | null = null;

    function loadBody(): Promise<Record<string, unknown>> {
      if (body === null) {
        body = parseJsonBody(context.req.raw).then(expectRecord);
      }

      return body;
    }

    const feedbackState = await withTransientDatabaseRetryFn(
      async () => {
        const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
        requestContext = loadedContext.requestContext;
        assertFeedbackHumanTransport(requestContext.transport);
        const input = parseFeedbackPromptEventInput(await loadBody());
        return recordFeedbackPromptEventForUserFn(requestContext.userId, input);
      },
      () => createFeedbackRouteScope(requestId, context.req.path, context.req.method, requestContext),
    );

    return context.json({ feedbackState } satisfies FeedbackStateResponse);
  });

  app.post("/feedback/submissions", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let body: Promise<Record<string, unknown>> | null = null;

    function loadBody(): Promise<Record<string, unknown>> {
      if (body === null) {
        body = parseJsonBody(context.req.raw).then(expectRecord);
      }

      return body;
    }

    const feedbackState = await withTransientDatabaseRetryFn(
      async () => {
        const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
        requestContext = loadedContext.requestContext;
        assertFeedbackHumanTransport(requestContext.transport);
        const input = parseFeedbackSubmissionInput(await loadBody());
        return submitFeedbackForUserFn(requestContext.userId, input);
      },
      () => createFeedbackRouteScope(requestId, context.req.path, context.req.method, requestContext),
    );

    return context.json({ feedbackState } satisfies FeedbackStateResponse);
  });

  return app;
}
