import { Hono } from "hono";
import { HttpError } from "../errors";
import {
  parseSyncBootstrapInput,
  parseSyncPullInput,
  parseSyncPushInput,
  parseSyncReviewHistoryImportInput,
  parseSyncReviewHistoryPullInput,
  processSyncBootstrap,
  processSyncPull,
  processSyncPush,
  processSyncReviewHistoryImport,
  processSyncReviewHistoryPull,
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
        installationId: input.installationId,
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
        installationId: input.installationId,
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
        installationId: input.installationId,
        afterHotChangeId: input.afterHotChangeId,
        nextHotChangeId: result.nextHotChangeId,
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
        installationId: input.installationId,
        afterHotChangeId: input.afterHotChangeId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/bootstrap", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncBootstrapInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");

    try {
      const result = await processSyncBootstrap(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_bootstrap", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        installationId: input.installationId,
        mode: input.mode,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_bootstrap_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        installationId: input.installationId,
        mode: input.mode,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/review-history/pull", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncReviewHistoryPullInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");

    try {
      const result = await processSyncReviewHistoryPull(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_review_history_pull", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        installationId: input.installationId,
        afterReviewSequenceId: input.afterReviewSequenceId,
        nextReviewSequenceId: result.nextReviewSequenceId,
        reviewEventsCount: result.reviewEvents.length,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_review_history_pull_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        installationId: input.installationId,
        afterReviewSequenceId: input.afterReviewSequenceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/review-history/import", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncReviewHistoryImportInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");

    try {
      const result = await processSyncReviewHistoryImport(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_review_history_import", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        installationId: input.installationId,
        reviewEventsCount: input.reviewEvents.length,
        importedCount: result.importedCount,
        duplicateCount: result.duplicateCount,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_review_history_import_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        installationId: input.installationId,
        reviewEventsCount: input.reviewEvents.length,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  return app;
}
