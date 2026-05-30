import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import { isTransientDatabaseError } from "../database/transient";
import type { RequestContext } from "../server/requestContext";
import { createSyncRoutes } from "./sync";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function createCodedError(code: string, message: string): Error & Readonly<{ code: string }> {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function createRequestContext(): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: workspaceId,
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-04-17T00:00:00.000Z",
    transport: "bearer",
    connectionId: null,
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
      assert.equal(input.limit, 500);
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
        limit: 500,
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
  assert.equal(syncLog?.limit, 500);
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
