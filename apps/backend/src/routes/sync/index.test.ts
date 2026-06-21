import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import { isTransientDatabaseError } from "../../database/transient";
import type { RequestContext } from "../../server/requestContext";
import type { GuestSessionPlatform } from "../../guestAuth";
import { createSyncRoutes } from "./index";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function createCodedError(code: string, message: string): Error & Readonly<{ code: string }> {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function createRequestContext(): RequestContext {
  return createRequestContextWithTransport("bearer");
}

function createRequestContextWithTransport(transport: RequestContext["transport"]): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: workspaceId,
    email: transport === "guest" ? null : "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-04-17T00:00:00.000Z",
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    transport,
    connectionId: null,
    guestSessionId: transport === "guest" ? "guest-session-1" : null,
    guestPlatform: null,
  };
}

function createGuestRequestContext(guestPlatform: GuestSessionPlatform | null): RequestContext {
  return {
    ...createRequestContextWithTransport("guest"),
    guestPlatform,
  };
}

function createSyncTestApp(routes: Hono<AppEnv>): Hono<AppEnv> {
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
  app.route("/", routes);
  return app;
}

async function captureConsoleLogAsync(run: () => Promise<void>): Promise<ReadonlyArray<string>> {
  const originalLog = console.log;
  const messages: Array<string> = [];
  console.log = (message?: unknown): void => {
    messages.push(typeof message === "string" ? message : String(message));
  };

  try {
    await run();
    return messages;
  } finally {
    console.log = originalLog;
  }
}

function parseLogRecord(message: string): Readonly<Record<string, unknown>> {
  const parsedValue = JSON.parse(message) as unknown;
  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    throw new Error("Expected log record to be a JSON object");
  }

  return parsedValue as Readonly<Record<string, unknown>>;
}

async function retryTransientOnce<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      throw error;
    }
  }

  return operation();
}

test("POST /sync/push accepts card payloads without legacy effortLevel", async () => {
  let processCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncPushFn: async (requestedWorkspaceId, userId, input) => {
      processCalls += 1;
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(userId, "user-1");
      const operation = input.operations[0];
      if (operation?.entityType !== "card") {
        throw new Error("Expected card sync operation");
      }

      assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "effortLevel"), false);
      return {
        operations: [
          {
            operationId: operation.operationId,
            entityType: operation.entityType,
            entityId: operation.entityId,
            status: "applied",
            resultingHotChangeId: 1,
            error: null,
          },
        ],
      };
    },
    bindGuestSessionPlatformFn: async () => {
      throw new Error("Signed-in web sync should not bind a guest session platform");
    },
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId: "install-1",
      platform: "web",
      appVersion: "1.0.0",
      operations: [
        {
          operationId: "operation-card-1",
          entityType: "card",
          action: "upsert",
          entityId: "card-1",
          clientUpdatedAt: "2026-02-28T09:30:00.000Z",
          payload: {
            cardId: "card-1",
            frontText: "Question",
            backText: "Answer",
            tags: ["sync"],
            dueAt: null,
            createdAt: "2026-02-28T09:00:00.000Z",
            reps: 0,
            lapses: 0,
            fsrsCardState: "new",
            fsrsStepIndex: null,
            fsrsStability: null,
            fsrsDifficulty: null,
            fsrsLastReviewedAt: null,
            fsrsScheduledDays: null,
            deletedAt: null,
          },
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    operations: [
      {
        operationId: "operation-card-1",
        entityType: "card",
        entityId: "card-1",
        status: "applied",
        resultingHotChangeId: 1,
        error: null,
      },
    ],
  });
  assert.equal(processCalls, 1);
});

test("sync routes reject guest web platform before creating a workspace replica", async () => {
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createGuestRequestContext(null),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncBootstrapFn: async () => {
      throw new Error("Guest web bootstrap should be rejected before sync processing");
    },
    processSyncPullFn: async () => {
      throw new Error("Guest web pull should be rejected before sync processing");
    },
    processSyncReviewHistoryPullFn: async () => {
      throw new Error("Guest web review-history pull should be rejected before sync processing");
    },
    bindGuestSessionPlatformFn: async () => {
      throw new Error("Guest web sync should be rejected before platform binding");
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createSyncTestApp(routes);
  const requests: ReadonlyArray<Readonly<{
    name: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
  }>> = [
    {
      name: "push",
      path: `/workspaces/${workspaceId}/sync/push`,
      body: {
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        operations: [],
      },
    },
    {
      name: "pull",
      path: `/workspaces/${workspaceId}/sync/pull`,
      body: {
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        afterHotChangeId: 0,
        limit: 100,
      },
    },
    {
      name: "bootstrap",
      path: `/workspaces/${workspaceId}/sync/bootstrap`,
      body: {
        mode: "pull",
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        cursor: null,
        limit: 100,
      },
    },
    {
      name: "review-history pull",
      path: `/workspaces/${workspaceId}/sync/review-history/pull`,
      body: {
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        afterReviewSequenceId: 0,
        limit: 100,
      },
    },
    {
      name: "review-history import",
      path: `/workspaces/${workspaceId}/sync/review-history/import`,
      body: {
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        reviewEvents: [],
      },
    },
  ];

  for (const request of requests) {
    const response = await app.request(`http://localhost${request.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
    });

    assert.equal(response.status, 403, request.name);
    assert.deepEqual(await response.json(), {
      error: "Guest web sync is not supported. Sign in before syncing from the web app.",
      requestId: "request-1",
      code: "GUEST_WEB_SYNC_UNSUPPORTED",
    }, request.name);
  }
});

for (const platform of ["ios", "android"] as const) {
  test(`POST /sync/pull allows guest ${platform} platform`, async () => {
    let processCalls = 0;
    const routes = createSyncRoutes({
      allowedOrigins: [],
      loadRequestContextFromRequestFn: async () => ({
        requestAuthInputs: {} as never,
        requestContext: createGuestRequestContext(platform),
      }),
      assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
        assert.equal(userId, "user-1");
        assert.equal(requestedWorkspaceId, workspaceId);
      },
      processSyncPullFn: async (requestedWorkspaceId, userId, input) => {
        processCalls += 1;
        assert.equal(requestedWorkspaceId, workspaceId);
        assert.equal(userId, "user-1");
        assert.equal(input.platform, platform);
        return {
          changes: [],
          nextHotChangeId: 0,
          hasMore: false,
        };
      },
      bindGuestSessionPlatformFn: async () => {
        throw new Error("Bound guest platform should not be rebound");
      },
      withTransientDatabaseRetryFn: retryTransientOnce,
    });
    const app = createSyncTestApp(routes);

    const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        installationId: "install-1",
        platform,
        appVersion: "1.0.0",
        afterHotChangeId: 0,
        limit: 100,
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      changes: [],
      nextHotChangeId: 0,
      hasMore: false,
    });
    assert.equal(processCalls, 1);
  });
}

test("POST /sync/pull rejects guest platform mismatch before sync processing", async () => {
  let processCalls = 0;
  let bindCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createGuestRequestContext("ios"),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncPullFn: async () => {
      processCalls += 1;
      throw new Error("Guest platform mismatch should be rejected before sync processing");
    },
    bindGuestSessionPlatformFn: async () => {
      bindCalls += 1;
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId: "install-1",
      platform: "android",
      appVersion: "1.0.0",
      afterHotChangeId: 0,
      limit: 100,
    }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Guest session platform does not match this sync request. Create a new guest session for this device.",
    requestId: "request-1",
    code: "GUEST_SESSION_PLATFORM_MISMATCH",
  });
  assert.equal(processCalls, 0);
  assert.equal(bindCalls, 0);
});

test("POST /sync/pull binds a legacy guest session to the first mobile platform", async () => {
  let processCalls = 0;
  let bindGuestSessionId: string | null = null;
  let bindPlatform: GuestSessionPlatform | null = null;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createGuestRequestContext(null),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncPullFn: async (requestedWorkspaceId, userId, input) => {
      processCalls += 1;
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(userId, "user-1");
      assert.equal(input.platform, "ios");
      return {
        changes: [],
        nextHotChangeId: 0,
        hasMore: false,
      };
    },
    bindGuestSessionPlatformFn: async (guestSessionId, platform) => {
      bindGuestSessionId = guestSessionId;
      bindPlatform = platform;
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId: "install-1",
      platform: "ios",
      appVersion: "1.0.0",
      afterHotChangeId: 0,
      limit: 100,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    changes: [],
    nextHotChangeId: 0,
    hasMore: false,
  });
  assert.equal(bindGuestSessionId, "guest-session-1");
  assert.equal(bindPlatform, "ios");
  assert.equal(processCalls, 1);
});

test("POST /sync/pull allows signed-in web sync without guest platform binding", async () => {
  let processCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncPullFn: async (requestedWorkspaceId, userId, input) => {
      processCalls += 1;
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(userId, "user-1");
      assert.equal(input.platform, "web");
      return {
        changes: [],
        nextHotChangeId: 0,
        hasMore: false,
      };
    },
    bindGuestSessionPlatformFn: async () => {
      throw new Error("Signed-in web sync should not bind a guest session platform");
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId: "install-1",
      platform: "web",
      appVersion: "1.0.0",
      afterHotChangeId: 0,
      limit: 100,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    changes: [],
    nextHotChangeId: 0,
    hasMore: false,
  });
  assert.equal(processCalls, 1);
});

test("POST /sync/pull retries transient database failures during request preflight", async () => {
  let loadCalls = 0;
  let processCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => {
      loadCalls += 1;
      if (loadCalls === 1) {
        throw createCodedError("57P01", "admin shutdown");
      }

      return {
        requestAuthInputs: {} as never,
        requestContext: createRequestContext(),
      };
    },
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncPullFn: async (requestedWorkspaceId, userId, input) => {
      processCalls += 1;
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(userId, "user-1");
      assert.equal(input.afterHotChangeId, 7);
      return {
        changes: [],
        nextHotChangeId: 7,
        hasMore: false,
      };
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId: "install-1",
      platform: "web",
      appVersion: "1.0.0",
      afterHotChangeId: 7,
      limit: 100,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    changes: [],
    nextHotChangeId: 7,
    hasMore: false,
  });
  assert.equal(loadCalls, 2);
  assert.equal(processCalls, 1);
});

test("POST /sync/review-history/pull retries transient database failures during request preflight", async () => {
  let loadCalls = 0;
  let processCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => {
      loadCalls += 1;
      if (loadCalls === 1) {
        throw createCodedError("57P01", "admin shutdown");
      }

      return {
        requestAuthInputs: {} as never,
        requestContext: createRequestContext(),
      };
    },
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncReviewHistoryPullFn: async (requestedWorkspaceId, userId, input) => {
      processCalls += 1;
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(userId, "user-1");
      assert.equal(input.afterReviewSequenceId, 11);
      return {
        reviewEvents: [],
        nextReviewSequenceId: 11,
        hasMore: false,
      };
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/review-history/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId: "install-1",
      platform: "web",
      appVersion: "1.0.0",
      afterReviewSequenceId: 11,
      limit: 100,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reviewEvents: [],
    nextReviewSequenceId: 11,
    hasMore: false,
  });
  assert.equal(loadCalls, 2);
  assert.equal(processCalls, 1);
});

test("POST /sync/bootstrap logs successful pull timing and cursor details", async () => {
  let processCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncBootstrapFn: async (requestedWorkspaceId, userId, input) => {
      processCalls += 1;
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(userId, "user-1");
      assert.equal(input.mode, "pull");
      if (input.mode !== "pull") {
        throw new Error("Expected pull bootstrap input");
      }

      assert.equal(input.cursor, null);
      assert.equal(input.limit, 1000);
      return {
        mode: "pull",
        entries: [],
        nextCursor: "cursor-1",
        hasMore: true,
        bootstrapHotChangeId: 42,
        remoteIsEmpty: false,
      };
    },
  });
  const app = createSyncTestApp(routes);

  let responseStatus = 0;
  let responseBody: unknown = null;
  const logMessages = await captureConsoleLogAsync(async () => {
    const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "pull",
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        cursor: null,
        limit: 1000,
      }),
    });
    responseStatus = response.status;
    responseBody = await response.json();
  });

  assert.equal(responseStatus, 200);
  assert.deepEqual(responseBody, {
    mode: "pull",
    entries: [],
    nextCursor: "cursor-1",
    hasMore: true,
    bootstrapHotChangeId: 42,
    remoteIsEmpty: false,
  });
  assert.equal(processCalls, 1);
  const syncLog = logMessages.map(parseLogRecord).find((record) => record.action === "sync_bootstrap");
  assert.notEqual(syncLog, undefined);
  assert.equal(typeof syncLog?.durationMs, "number");
  assert.ok((syncLog?.durationMs as number) >= 0);
  assert.equal(syncLog?.entriesCount, 0);
  assert.equal(syncLog?.hasMore, true);
  assert.equal(syncLog?.nextCursorPresent, true);
  assert.equal(syncLog?.cursorPresent, false);
  assert.equal(syncLog?.limit, 1000);
});

test("POST /sync/bootstrap rejects pull limit above bootstrap max", async () => {
  let processCalls = 0;
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncBootstrapFn: async () => {
      processCalls += 1;
      throw new Error("Invalid bootstrap limit should be rejected before sync processing");
    },
  });
  const app = createSyncTestApp(routes);

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "pull",
      installationId: "install-1",
      platform: "web",
      appVersion: "1.0.0",
      cursor: null,
      limit: 1001,
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Cloud sync failed. Try again.",
    requestId: "request-1",
    code: "SYNC_INVALID_INPUT",
  });
  assert.equal(processCalls, 0);
});

test("POST /sync/bootstrap logs failure timing before returning sync errors", async () => {
  const routes = createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, requestedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
    },
    processSyncBootstrapFn: async () => {
      throw new HttpError(409, "Cloud bootstrap requires an empty remote workspace", "SYNC_BOOTSTRAP_NOT_EMPTY");
    },
  });
  const app = createSyncTestApp(routes);

  let responseStatus = 0;
  let responseBody: unknown = null;
  const logMessages = await captureConsoleLogAsync(async () => {
    const response = await app.request(`http://localhost/workspaces/${workspaceId}/sync/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "push",
        installationId: "install-1",
        platform: "web",
        appVersion: "1.0.0",
        entries: [],
      }),
    });
    responseStatus = response.status;
    responseBody = await response.json();
  });

  assert.equal(responseStatus, 409);
  assert.deepEqual(responseBody, {
    error: "Cloud bootstrap requires an empty remote workspace",
    requestId: "request-1",
    code: "SYNC_BOOTSTRAP_NOT_EMPTY",
  });
  const syncLog = logMessages.map(parseLogRecord).find((record) => record.action === "sync_bootstrap_error");
  assert.notEqual(syncLog, undefined);
  assert.equal(typeof syncLog?.durationMs, "number");
  assert.ok((syncLog?.durationMs as number) >= 0);
  assert.equal(syncLog?.statusCode, 409);
  assert.equal(syncLog?.code, "SYNC_BOOTSTRAP_NOT_EMPTY");
  assert.equal(syncLog?.mode, "push");
  assert.equal(syncLog?.entriesCount, 0);
});
