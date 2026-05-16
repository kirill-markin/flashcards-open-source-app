import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app";
import { HttpError } from "../errors";
import { isTransientDatabaseError } from "../dbTransient";
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
