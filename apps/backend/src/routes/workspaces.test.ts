import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app";
import { isTransientDatabaseError } from "../dbTransient";
import { HttpError } from "../errors";
import type { RequestContext } from "../server/requestContext";
import type { WorkspaceSummary } from "../workspaces";
import { createWorkspaceRoutes } from "./workspaces";

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

function createWorkspaceTestApp(routes: Hono<AppEnv>): Hono<AppEnv> {
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

test("POST /workspaces retries transient database failures during workspace creation", async () => {
  let loadCalls = 0;
  let createCalls = 0;
  const workspace: WorkspaceSummary = {
    workspaceId,
    name: "Study",
    createdAt: "2026-04-17T00:00:00.000Z",
    isSelected: true,
  };
  const routes = createWorkspaceRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => {
      loadCalls += 1;
      return {
        requestAuthInputs: {} as never,
        requestContext: createRequestContext(),
      };
    },
    createWorkspaceForUserWithObservationScopeFn: async (userId, name, scope) => {
      createCalls += 1;
      assert.equal(userId, "user-1");
      assert.equal(name, "Study");
      assert.equal(scope?.requestId, "request-1");

      if (createCalls === 1) {
        throw createCodedError("40P01", "deadlock detected");
      }

      return workspace;
    },
    withTransientDatabaseRetryFn: retryTransientOnce,
  });
  const app = createWorkspaceTestApp(routes);

  const response = await app.request("http://localhost/workspaces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: " Study ",
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    workspace,
  });
  assert.equal(loadCalls, 2);
  assert.equal(createCalls, 2);
});
