import { Hono } from "hono";
import { HttpError } from "../errors";
import {
  parseSyncPullInput,
  parseSyncPushInput,
  processSyncPull,
  processSyncPush,
} from "../sync";
import {
  assertUserHasWorkspaceAccess,
} from "../workspaces";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import {
  logCloudRouteEvent,
  summarizeValidationIssues,
} from "../server/logging";
import type { AppEnv } from "../app";

type SyncRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSyncRoutes(options: SyncRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/workspaces/:workspaceId/sync/push", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncPushInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");
    const entityTypes = [...new Set(input.operations.map((operation) => operation.entityType))];

    try {
      const result = await processSyncPush(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_push", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        operationsCount: input.operations.length,
        entityTypes,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_push_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        operationsCount: input.operations.length,
        entityTypes,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/pull", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncPullInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");

    try {
      const result = await processSyncPull(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_pull", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        afterChangeId: input.afterChangeId,
        nextChangeId: result.nextChangeId,
        changesCount: result.changes.length,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_pull_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        afterChangeId: input.afterChangeId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  return app;
}
