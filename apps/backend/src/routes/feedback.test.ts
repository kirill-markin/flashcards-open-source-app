import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AuthError } from "../auth";
import type { AppEnv } from "../server/app";
import type { RequestContext } from "../server/requestContext";
import { HttpError } from "../shared/errors";
import type { BackendObservationScope } from "../observability/sentry";
import type {
  FeedbackNotificationEmailInput,
  FeedbackPromptEventInput,
  FeedbackState,
  FeedbackSubmissionInput,
  StoredFeedbackSubmission,
} from "../feedback/types";
import type { FeedbackServiceDependencies } from "../feedback";
import { createFeedbackRoutes } from "./feedback";

type PromptEventRecord = FeedbackPromptEventInput & Readonly<{
  userId: string;
  createdAtServer: string;
}>;

type SubmissionRecord = FeedbackSubmissionInput & Readonly<{
  userId: string;
  email: string | null;
  createdAtServer: string;
  emailNotificationStatus: "pending" | "sent" | "failed";
  emailNotificationError: string | null;
}>;

type FeedbackStoreState = {
  promptEvents: Map<string, PromptEventRecord>;
  submissions: Map<string, SubmissionRecord>;
  sentEmails: Array<FeedbackNotificationEmailInput>;
  sendEmailError: Error | null;
  nextTimestampIndex: number;
};

type FeedbackTestAppOptions = Readonly<{
  transport: RequestContext["transport"];
  state: FeedbackStoreState;
  loadRequestContextError: AuthError | null;
}>;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const promptEventId = "22222222-2222-4222-8222-222222222222";
const submissionId = "33333333-3333-4333-8333-333333333333";
const installationId = "44444444-4444-4444-8444-444444444444";
const serverTimestamps = [
  "2026-06-03T10:00:00.000Z",
  "2026-06-03T10:01:00.000Z",
  "2026-06-03T10:02:00.000Z",
] as const;

function createRequestContext(transport: RequestContext["transport"]): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: workspaceId,
    email: transport === "guest" ? null : "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-04-17T00:00:00.000Z",
    transport,
    connectionId: transport === "api_key" ? "connection-1" : null,
    guestSessionId: transport === "guest" ? "guest-session-1" : null,
    guestPlatform: transport === "guest" ? "ios" : null,
  };
}

function createEmptyStoreState(sendEmailError: Error | null): FeedbackStoreState {
  return {
    promptEvents: new Map(),
    submissions: new Map(),
    sentEmails: [],
    sendEmailError,
    nextTimestampIndex: 0,
  };
}

function nextServerTimestamp(state: FeedbackStoreState): string {
  const timestamp = serverTimestamps[state.nextTimestampIndex];
  if (timestamp === undefined) {
    throw new Error("Test timestamp fixture exhausted");
  }

  state.nextTimestampIndex += 1;
  return timestamp;
}

function addDaysToIsoTimestamp(value: string, days: number): string {
  const date = new Date(value);
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}

function getLaterIsoTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function createFeedbackStateForUser(state: FeedbackStoreState, userId: string): FeedbackState {
  const promptTimes = Array.from(state.promptEvents.values())
    .filter((event) => event.userId === userId && event.eventType === "automatic_prompt_shown")
    .map((event) => event.createdAtServer);
  const submissionTimes = Array.from(state.submissions.values())
    .filter((submission) => submission.userId === userId)
    .map((submission) => submission.createdAtServer);
  const lastAutomaticPromptShownAt = promptTimes.length === 0
    ? null
    : promptTimes.reduce((latest, current) => getLaterIsoTimestamp(latest, current) ?? current);
  const lastFeedbackSubmittedAt = submissionTimes.length === 0
    ? null
    : submissionTimes.reduce((latest, current) => getLaterIsoTimestamp(latest, current) ?? current);
  const cooldownBaseAt = getLaterIsoTimestamp(lastAutomaticPromptShownAt, lastFeedbackSubmittedAt);

  return {
    automaticPromptCooldownDays: 30,
    lastAutomaticPromptShownAt,
    lastFeedbackSubmittedAt,
    nextAutomaticPromptAt: cooldownBaseAt === null ? null : addDaysToIsoTimestamp(cooldownBaseAt, 30),
  };
}

function createFeedbackDependencies(state: FeedbackStoreState): FeedbackServiceDependencies {
  return {
    loadFeedbackStateForUserFn: async (userId) => createFeedbackStateForUser(state, userId),
    recordFeedbackPromptEventForUserFn: async (userId, input) => {
      const existing = state.promptEvents.get(input.feedbackPromptEventId);
      if (existing !== undefined && existing.userId !== userId) {
        throw new HttpError(
          409,
          "feedbackPromptEventId is already used by another feedback prompt event.",
          "FEEDBACK_PROMPT_EVENT_ID_CONFLICT",
        );
      }

      if (existing === undefined) {
        state.promptEvents.set(input.feedbackPromptEventId, {
          ...input,
          userId,
          createdAtServer: nextServerTimestamp(state),
        });
      }

      return createFeedbackStateForUser(state, userId);
    },
    storeFeedbackSubmissionForUserFn: async (userId, email, input): Promise<StoredFeedbackSubmission> => {
      const existing = state.submissions.get(input.feedbackSubmissionId);
      if (existing !== undefined && existing.userId !== userId) {
        throw new HttpError(
          409,
          "feedbackSubmissionId is already used by another feedback submission.",
          "FEEDBACK_SUBMISSION_ID_CONFLICT",
        );
      }

      if (existing !== undefined) {
        return {
          feedbackSubmissionId: existing.feedbackSubmissionId,
          createdAtServer: existing.createdAtServer,
          emailNotificationRequired: false,
        };
      }

      const createdAtServer = nextServerTimestamp(state);
      state.submissions.set(input.feedbackSubmissionId, {
        ...input,
        userId,
        email,
        createdAtServer,
        emailNotificationStatus: "pending",
        emailNotificationError: null,
      });
      return {
        feedbackSubmissionId: input.feedbackSubmissionId,
        createdAtServer,
        emailNotificationRequired: true,
      };
    },
    updateFeedbackSubmissionEmailStatusFn: async (userId, targetSubmissionId, status, errorMessage) => {
      const existing = state.submissions.get(targetSubmissionId);
      if (existing === undefined || existing.userId !== userId) {
        throw new Error(`Missing submission ${targetSubmissionId}`);
      }

      state.submissions.set(targetSubmissionId, {
        ...existing,
        emailNotificationStatus: status,
        emailNotificationError: errorMessage,
      });
    },
    sendFeedbackNotificationEmailFn: async (input) => {
      if (state.sendEmailError !== null) {
        throw state.sendEmailError;
      }

      state.sentEmails.push(input);
    },
  };
}

async function runWithoutRetry<Result>(
  operation: () => Promise<Result>,
  _getObservationScope: () => BackendObservationScope,
): Promise<Result> {
  return operation();
}

function createFeedbackTestApp(options: FeedbackTestAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId: context.get("requestId"),
        code: "AUTH_UNAUTHORIZED",
      });
    }

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
  app.route("/", createFeedbackRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => {
      if (options.loadRequestContextError !== null) {
        throw options.loadRequestContextError;
      }

      return {
        requestAuthInputs: {} as never,
        requestContext: createRequestContext(options.transport),
      };
    },
    feedbackServiceDependencies: createFeedbackDependencies(options.state),
    withTransientDatabaseRetryFn: runWithoutRetry,
  }));
  return app;
}

function createPromptEventBody(): FeedbackPromptEventInput {
  return {
    feedbackPromptEventId: promptEventId,
    workspaceId,
    installationId,
    platform: "ios",
    appVersion: "1.2.3",
    locale: "en-US",
    timezone: "Europe/Madrid",
    eventType: "automatic_prompt_shown",
    createdAtClient: "2026-06-03T09:59:00.000Z",
  };
}

function createSubmissionBody(message: string): FeedbackSubmissionInput {
  return {
    feedbackSubmissionId: submissionId,
    workspaceId,
    installationId,
    platform: "web",
    appVersion: "1.2.3",
    locale: "en-US",
    timezone: "Europe/Madrid",
    trigger: "settings",
    message,
    createdAtClient: "2026-06-03T10:00:00.000Z",
  };
}

async function postJson(app: Hono<AppEnv>, path: string, body: unknown): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function postRawJson(app: Hono<AppEnv>, path: string, body: string): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
}

test("GET /feedback/state returns empty state", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "bearer",
    state,
    loadRequestContextError: null,
  });

  const response = await app.request("http://localhost/feedback/state");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: null,
      lastFeedbackSubmittedAt: null,
      nextAutomaticPromptAt: null,
    },
  });
});

test("POST /feedback/prompt-events records automatic prompt state idempotently", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "session",
    state,
    loadRequestContextError: null,
  });
  const body = createPromptEventBody();

  const firstResponse = await postJson(app, "/feedback/prompt-events", body);
  const secondResponse = await postJson(app, "/feedback/prompt-events", body);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), {
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: "2026-06-03T10:00:00.000Z",
      lastFeedbackSubmittedAt: null,
      nextAutomaticPromptAt: "2026-07-03T10:00:00.000Z",
    },
  });
  assert.deepEqual(await secondResponse.json(), {
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: "2026-06-03T10:00:00.000Z",
      lastFeedbackSubmittedAt: null,
      nextAutomaticPromptAt: "2026-07-03T10:00:00.000Z",
    },
  });
  assert.equal(state.promptEvents.size, 1);
});

test("POST /feedback/submissions records submission state and does not duplicate email on replay", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "bearer",
    state,
    loadRequestContextError: null,
  });
  const body = createSubmissionBody(" Please make review faster. ");

  const firstResponse = await postJson(app, "/feedback/submissions", body);
  const secondResponse = await postJson(app, "/feedback/submissions", body);
  const stateResponse = await app.request("http://localhost/feedback/state");

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), {
    feedbackSubmissionId: submissionId,
    createdAtServer: "2026-06-03T10:00:00.000Z",
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: null,
      lastFeedbackSubmittedAt: "2026-06-03T10:00:00.000Z",
      nextAutomaticPromptAt: "2026-07-03T10:00:00.000Z",
    },
  });
  assert.deepEqual(await secondResponse.json(), {
    feedbackSubmissionId: submissionId,
    createdAtServer: "2026-06-03T10:00:00.000Z",
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: null,
      lastFeedbackSubmittedAt: "2026-06-03T10:00:00.000Z",
      nextAutomaticPromptAt: "2026-07-03T10:00:00.000Z",
    },
  });
  assert.deepEqual(await stateResponse.json(), {
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: null,
      lastFeedbackSubmittedAt: "2026-06-03T10:00:00.000Z",
      nextAutomaticPromptAt: "2026-07-03T10:00:00.000Z",
    },
  });
  assert.equal(state.submissions.size, 1);
  assert.equal(state.sentEmails.length, 1);
  assert.equal(state.sentEmails[0]?.message, "Please make review faster.");
  assert.equal(state.submissions.get(submissionId)?.emailNotificationStatus, "sent");
});

test("POST /feedback/submissions rejects empty and too-long messages", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "bearer",
    state,
    loadRequestContextError: null,
  });

  const emptyResponse = await postJson(app, "/feedback/submissions", createSubmissionBody("   "));
  const tooLongResponse = await postJson(app, "/feedback/submissions", createSubmissionBody("x".repeat(5001)));

  assert.equal(emptyResponse.status, 400);
  assert.deepEqual(await emptyResponse.json(), {
    error: "Feedback request is invalid.",
    requestId: "request-1",
    code: "FEEDBACK_INVALID_INPUT",
  });
  assert.equal(tooLongResponse.status, 400);
  assert.deepEqual(await tooLongResponse.json(), {
    error: "Feedback request is invalid.",
    requestId: "request-1",
    code: "FEEDBACK_INVALID_INPUT",
  });
  assert.equal(state.submissions.size, 0);
});

test("POST /feedback/submissions accepts a 5000-character escaped Unicode message", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "bearer",
    state,
    loadRequestContextError: null,
  });
  const body = createSubmissionBody("placeholder");
  const escapedMessage = "\\u0800".repeat(5000);
  const rawBody = JSON.stringify({ ...body, message: "__MESSAGE__" })
    .replace("\"__MESSAGE__\"", `"${escapedMessage}"`);

  const response = await postRawJson(app, "/feedback/submissions", rawBody);

  assert.equal(response.status, 200);
  assert.equal(state.submissions.get(submissionId)?.message.length, 5000);
  assert.equal(state.sentEmails.length, 1);
});

test("feedback routes accept human and guest auth and reject ApiKey auth", async () => {
  const acceptedTransports: ReadonlyArray<RequestContext["transport"]> = ["session", "bearer", "guest"];
  for (const transport of acceptedTransports) {
    const state = createEmptyStoreState(null);
    const app = createFeedbackTestApp({
      transport,
      state,
      loadRequestContextError: null,
    });
    const response = await app.request("http://localhost/feedback/state");

    assert.equal(response.status, 200);
  }

  const apiKeyState = createEmptyStoreState(null);
  const apiKeyApp = createFeedbackTestApp({
    transport: "api_key",
    state: apiKeyState,
    loadRequestContextError: null,
  });
  const apiKeyResponse = await apiKeyApp.request("http://localhost/feedback/state");

  assert.equal(apiKeyResponse.status, 403);
  assert.deepEqual(await apiKeyResponse.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication.",
    requestId: "request-1",
    code: "FEEDBACK_HUMAN_AUTH_REQUIRED",
  });
});

test("feedback routes require authentication", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "bearer",
    state,
    loadRequestContextError: new AuthError(401, "Missing authentication token"),
  });

  const response = await app.request("http://localhost/feedback/state");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Missing authentication token",
    requestId: "request-1",
    code: "AUTH_UNAUTHORIZED",
  });
});

test("POST feedback routes authenticate before parsing invalid bodies", async () => {
  const state = createEmptyStoreState(null);
  const app = createFeedbackTestApp({
    transport: "bearer",
    state,
    loadRequestContextError: new AuthError(401, "Missing authentication token"),
  });

  const promptResponse = await postJson(app, "/feedback/prompt-events", { invalid: true });
  const submissionResponse = await postJson(app, "/feedback/submissions", { invalid: true });

  assert.equal(promptResponse.status, 401);
  assert.deepEqual(await promptResponse.json(), {
    error: "Missing authentication token",
    requestId: "request-1",
    code: "AUTH_UNAUTHORIZED",
  });
  assert.equal(submissionResponse.status, 401);
  assert.deepEqual(await submissionResponse.json(), {
    error: "Missing authentication token",
    requestId: "request-1",
    code: "AUTH_UNAUTHORIZED",
  });
  assert.equal(state.promptEvents.size, 0);
  assert.equal(state.submissions.size, 0);
});

test("POST /feedback/submissions returns success when email notification fails", async () => {
  const state = createEmptyStoreState(new Error("Resend is unavailable"));
  const app = createFeedbackTestApp({
    transport: "guest",
    state,
    loadRequestContextError: null,
  });

  const response = await postJson(app, "/feedback/submissions", createSubmissionBody("Offline mode needs a clearer badge."));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    feedbackSubmissionId: submissionId,
    createdAtServer: "2026-06-03T10:00:00.000Z",
    feedbackState: {
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: null,
      lastFeedbackSubmittedAt: "2026-06-03T10:00:00.000Z",
      nextAutomaticPromptAt: "2026-07-03T10:00:00.000Z",
    },
  });
  assert.equal(state.sentEmails.length, 0);
  assert.equal(state.submissions.get(submissionId)?.emailNotificationStatus, "failed");
  assert.equal(state.submissions.get(submissionId)?.emailNotificationError, "Resend is unavailable");
});
