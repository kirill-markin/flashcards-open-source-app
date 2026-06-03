import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  deriveFeedbackState,
  type FeedbackPromptEventInput,
  type FeedbackState,
  type FeedbackSubmissionInput,
} from "../feedback";
import { HttpError } from "../shared/errors";
import type { RequestContext } from "../server/requestContext";
import type { AppEnv } from "../server/app";
import { createFeedbackRoutes } from "./feedback";

type FeedbackTestAppOptions = Readonly<{
  transport: RequestContext["transport"];
  onLoadState?: (userId: string) => Promise<FeedbackState>;
  onRecordPromptEvent?: (
    userId: string,
    input: FeedbackPromptEventInput,
  ) => Promise<FeedbackState>;
  onSubmitFeedback?: (
    userId: string,
    input: FeedbackSubmissionInput,
  ) => Promise<FeedbackState>;
}>;

function createRequestContext(transport: RequestContext["transport"]): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-04-01T00:00:00.000Z",
    transport,
    connectionId: transport === "api_key" ? "connection-1" : null,
  };
}

function createState(): FeedbackState {
  return deriveFeedbackState(
    "2026-04-01T00:00:00.000Z",
    "2026-04-02T00:00:00.000Z",
  );
}

function createFeedbackTestApp(options: FeedbackTestAppOptions): Hono<AppEnv> {
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
  app.route("/", createFeedbackRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(options.transport),
    }),
    loadFeedbackStateForUserFn: options.onLoadState ?? (async () => createState()),
    recordFeedbackPromptEventForUserFn: options.onRecordPromptEvent ?? (async () => createState()),
    submitFeedbackForUserFn: options.onSubmitFeedback ?? (async () => createState()),
    withTransientDatabaseRetryFn: async (operation) => operation(),
  }));
  return app;
}

test("feedback state cooldown uses latest prompt or submission timestamp", () => {
  assert.deepEqual(
    deriveFeedbackState(
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
    {
      lastAutomaticPromptShownAt: "2026-04-01T00:00:00.000Z",
      lastFeedbackSubmittedAt: "2026-04-03T00:00:00.000Z",
      nextAutomaticPromptAt: "2026-05-03T00:00:00.000Z",
    },
  );
});

test("GET /feedback/state returns feedback state for human authentication", async () => {
  const humanTransports: ReadonlyArray<RequestContext["transport"]> = ["bearer", "guest", "session"];

  for (const transport of humanTransports) {
    const app = createFeedbackTestApp({
      transport,
      onLoadState: async (userId) => {
        assert.equal(userId, "user-1");
        return createState();
      },
    });

    const response = await app.request("http://localhost/feedback/state");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      feedbackState: createState(),
    });
  }
});

test("feedback endpoints reject ApiKey authentication", async () => {
  let called = false;
  const app = createFeedbackTestApp({
    transport: "api_key",
    onLoadState: async () => {
      called = true;
      return createState();
    },
    onSubmitFeedback: async () => {
      called = true;
      return createState();
    },
  });

  const response = await app.request("http://localhost/feedback/state");

  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "FEEDBACK_HUMAN_AUTH_REQUIRED",
  });
});

test("POST /feedback/submissions validates, trims, and submits feedback", async () => {
  let receivedInput: FeedbackSubmissionInput | null = null;
  const app = createFeedbackTestApp({
    transport: "bearer",
    onSubmitFeedback: async (userId, input) => {
      assert.equal(userId, "user-1");
      receivedInput = input;
      return createState();
    },
  });

  const response = await app.request("http://localhost/feedback/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      feedbackSubmissionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      installationId: " installation-1 ",
      platform: "android",
      appVersion: "1.6.0",
      locale: "en-US",
      timezone: "Europe/Madrid",
      trigger: "settings",
      message: "  Make review faster.  ",
      createdAtClient: "2026-04-17T10:11:12.123Z",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(receivedInput, {
    feedbackSubmissionId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    installationId: "installation-1",
    platform: "android",
    appVersion: "1.6.0",
    locale: "en-US",
    timezone: "Europe/Madrid",
    trigger: "settings",
    message: "Make review faster.",
    createdAtClient: "2026-04-17T10:11:12.123Z",
  });
  assert.deepEqual(await response.json(), {
    feedbackState: createState(),
  });
});

test("POST /feedback/submissions rejects empty messages", async () => {
  let called = false;
  const app = createFeedbackTestApp({
    transport: "session",
    onSubmitFeedback: async () => {
      called = true;
      return createState();
    },
  });

  const response = await app.request("http://localhost/feedback/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      feedbackSubmissionId: "22222222-2222-4222-8222-222222222222",
      platform: "android",
      locale: "en-US",
      timezone: "Europe/Madrid",
      trigger: "settings",
      message: "   ",
      createdAtClient: "2026-04-17T10:11:12.123Z",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("POST /feedback/submissions rejects messages over the maximum length", async () => {
  let called = false;
  const app = createFeedbackTestApp({
    transport: "session",
    onSubmitFeedback: async () => {
      called = true;
      return createState();
    },
  });

  const response = await app.request("http://localhost/feedback/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      feedbackSubmissionId: "22222222-2222-4222-8222-222222222222",
      platform: "android",
      locale: "en-US",
      timezone: "Europe/Madrid",
      trigger: "settings",
      message: "x".repeat(5001),
      createdAtClient: "2026-04-17T10:11:12.123Z",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    error: "message must be 5000 characters or fewer",
    requestId: "request-1",
    code: "FEEDBACK_MESSAGE_TOO_LONG",
  });
});

test("POST /feedback/submissions accepts idempotent retry submissions", async () => {
  let submitCount = 0;
  const app = createFeedbackTestApp({
    transport: "bearer",
    onSubmitFeedback: async (_userId, input) => {
      submitCount += 1;
      assert.equal(input.feedbackSubmissionId, "22222222-2222-4222-8222-222222222222");
      return createState();
    },
  });
  const requestBody = JSON.stringify({
    feedbackSubmissionId: "22222222-2222-4222-8222-222222222222",
    platform: "android",
    locale: "en-US",
    timezone: "Europe/Madrid",
    trigger: "settings",
    message: "Improve reviews.",
    createdAtClient: "2026-04-17T10:11:12.123Z",
  });

  const firstResponse = await app.request("http://localhost/feedback/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: requestBody,
  });
  const retryResponse = await app.request("http://localhost/feedback/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: requestBody,
  });

  assert.equal(firstResponse.status, 200);
  assert.equal(retryResponse.status, 200);
  assert.equal(submitCount, 2);
  assert.deepEqual(await retryResponse.json(), {
    feedbackState: createState(),
  });
});

test("POST /feedback/prompt-events records automatic prompt shown events", async () => {
  let receivedInput: FeedbackPromptEventInput | null = null;
  const app = createFeedbackTestApp({
    transport: "guest",
    onRecordPromptEvent: async (userId, input) => {
      assert.equal(userId, "user-1");
      receivedInput = input;
      return createState();
    },
  });

  const response = await app.request("http://localhost/feedback/prompt-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      feedbackPromptEventId: "33333333-3333-4333-8333-333333333333",
      workspaceId: null,
      installationId: null,
      platform: "android",
      appVersion: null,
      locale: "en-US",
      timezone: "Europe/Madrid",
      eventType: "automatic_prompt_shown",
      createdAtClient: "2026-04-17T10:11:12.123Z",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(receivedInput, {
    feedbackPromptEventId: "33333333-3333-4333-8333-333333333333",
    workspaceId: null,
    installationId: null,
    platform: "android",
    appVersion: null,
    locale: "en-US",
    timezone: "Europe/Madrid",
    eventType: "automatic_prompt_shown",
    createdAtClient: "2026-04-17T10:11:12.123Z",
  });
});

test("POST /feedback/submissions propagates optional workspace access errors", async () => {
  const app = createFeedbackTestApp({
    transport: "bearer",
    onSubmitFeedback: async () => {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    },
  });

  const response = await app.request("http://localhost/feedback/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      feedbackSubmissionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      platform: "android",
      locale: "en-US",
      timezone: "Europe/Madrid",
      trigger: "automatic",
      message: "Improve reviews.",
      createdAtClient: "2026-04-17T10:11:12.123Z",
    }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Workspace not found",
    requestId: "request-1",
    code: "WORKSPACE_NOT_FOUND",
  });
});
