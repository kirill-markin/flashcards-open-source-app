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
  type SyncPullInput,
  type SyncPullResult,
  type SyncReviewHistoryPullInput,
  type SyncReviewHistoryPullResult,
} from "../sync";
import {
  assertUserHasWorkspaceAccess,
} from "../workspaces";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import {
  logCloudRouteEvent,
  summarizeValidationIssues,
} from "../server/logging";
import { withTransientDatabaseRetry } from "../dbTransient";
import type { AppEnv } from "../app";

type SyncRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  processSyncPullFn?: typeof processSyncPull;
  processSyncReviewHistoryPullFn?: typeof processSyncReviewHistoryPull;
  withTransientDatabaseRetryFn?: typeof withTransientDatabaseRetry;
}>;

type SyncPullRouteState = Readonly<{
  requestContext: RequestContext;
  workspaceId: string;
  input: SyncPullInput;
  result: SyncPullResult;
}>;

type SyncReviewHistoryPullRouteState = Readonly<{
  requestContext: RequestContext;
  workspaceId: string;
  input: SyncReviewHistoryPullInput;
  result: SyncReviewHistoryPullResult;
}>;

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

function getSyncPullInputLogContext(input: SyncPullInput | null): Record<string, unknown> {
  if (input === null) {
    return {
      installationId: null,
      platform: null,
      appVersion: null,
      afterHotChangeId: null,
    };
  }

  return {
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    afterHotChangeId: input.afterHotChangeId,
  };
}

function getSyncReviewHistoryPullInputLogContext(
  input: SyncReviewHistoryPullInput | null,
): Record<string, unknown> {
  if (input === null) {
    return {
      installationId: null,
      platform: null,
      appVersion: null,
      afterReviewSequenceId: null,
    };
  }

  return {
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    afterReviewSequenceId: input.afterReviewSequenceId,
  };
}

function getSyncConflictLogContext(error: HttpError | unknown): Record<string, unknown> {
  if (!(error instanceof HttpError)) {
    return {};
  }

  const syncConflict = error.details?.syncConflict;
  if (syncConflict === undefined) {
    return {};
  }

  return {
    syncConflictPhase: syncConflict.phase,
    syncConflictEntityType: syncConflict.entityType,
    syncConflictEntityId: syncConflict.entityId,
    conflictingWorkspaceId: syncConflict.conflictingWorkspaceId,
    constraint: syncConflict.constraint,
    sqlState: syncConflict.sqlState,
    table: syncConflict.table,
    entryIndex: syncConflict.entryIndex ?? null,
    reviewEventIndex: syncConflict.reviewEventIndex ?? null,
    syncConflictRecoverable: syncConflict.recoverable,
  };
}

export function createSyncRoutes(options: SyncRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const processSyncPullFn = options.processSyncPullFn ?? processSyncPull;
  const processSyncReviewHistoryPullFn = options.processSyncReviewHistoryPullFn ?? processSyncReviewHistoryPull;
  const withTransientDatabaseRetryFn = options.withTransientDatabaseRetryFn ?? withTransientDatabaseRetry;

  app.post("/workspaces/:workspaceId/sync/push", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
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
        platform: input.platform,
        appVersion: input.appVersion ?? null,
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
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        operationsCount: input.operations.length,
        entityTypes,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
        ...getSyncConflictLogContext(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/pull", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let input: SyncPullInput | null = null;
    let parsedBody: unknown;
    let parsedBodyLoaded = false;

    async function loadSyncPullInput(): Promise<SyncPullInput> {
      if (!parsedBodyLoaded) {
        parsedBody = await parseJsonBody(context.req.raw);
        parsedBodyLoaded = true;
      }

      return parseSyncPullInput(parsedBody);
    }

    try {
      const routeState = await withTransientDatabaseRetryFn(
        async (): Promise<SyncPullRouteState> => {
          const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
          requestContext = loadedContext.requestContext;
          workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
          await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
          input = await loadSyncPullInput();
          const result = await processSyncPullFn(workspaceId, requestContext.userId, input);
          return {
            requestContext,
            workspaceId,
            input,
            result,
          };
        },
      );
      logCloudRouteEvent("sync_pull", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: routeState.requestContext.userId,
        workspaceId: routeState.workspaceId,
        installationId: routeState.input.installationId,
        platform: routeState.input.platform,
        appVersion: routeState.input.appVersion ?? null,
        afterHotChangeId: routeState.input.afterHotChangeId,
        nextHotChangeId: routeState.result.nextHotChangeId,
        changesCount: routeState.result.changes.length,
      }, false);
      return context.json(routeState.result);
    } catch (error) {
      logCloudRouteEvent("sync_pull_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: getRequestContextUserId(requestContext),
        workspaceId,
        ...getSyncPullInputLogContext(input),
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/bootstrap", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
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
        platform: input.platform,
        appVersion: input.appVersion ?? null,
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
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        mode: input.mode,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
        ...getSyncConflictLogContext(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/review-history/pull", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let input: SyncReviewHistoryPullInput | null = null;
    let parsedBody: unknown;
    let parsedBodyLoaded = false;

    async function loadSyncReviewHistoryPullInput(): Promise<SyncReviewHistoryPullInput> {
      if (!parsedBodyLoaded) {
        parsedBody = await parseJsonBody(context.req.raw);
        parsedBodyLoaded = true;
      }

      return parseSyncReviewHistoryPullInput(parsedBody);
    }

    try {
      const routeState = await withTransientDatabaseRetryFn(
        async (): Promise<SyncReviewHistoryPullRouteState> => {
          const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
          requestContext = loadedContext.requestContext;
          workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
          await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
          input = await loadSyncReviewHistoryPullInput();
          const result = await processSyncReviewHistoryPullFn(workspaceId, requestContext.userId, input);
          return {
            requestContext,
            workspaceId,
            input,
            result,
          };
        },
      );
      logCloudRouteEvent("sync_review_history_pull", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: routeState.requestContext.userId,
        workspaceId: routeState.workspaceId,
        installationId: routeState.input.installationId,
        platform: routeState.input.platform,
        appVersion: routeState.input.appVersion ?? null,
        afterReviewSequenceId: routeState.input.afterReviewSequenceId,
        nextReviewSequenceId: routeState.result.nextReviewSequenceId,
        reviewEventsCount: routeState.result.reviewEvents.length,
      }, false);
      return context.json(routeState.result);
    } catch (error) {
      logCloudRouteEvent("sync_review_history_pull_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: getRequestContextUserId(requestContext),
        workspaceId,
        ...getSyncReviewHistoryPullInputLogContext(input),
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/sync/review-history/import", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
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
        platform: input.platform,
        appVersion: input.appVersion ?? null,
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
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        reviewEventsCount: input.reviewEvents.length,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: getInternalErrorMessage(error),
        validationIssues: summarizeValidationIssues(error),
        ...getSyncConflictLogContext(error),
      }, true);
      throw error;
    }
  });

  return app;
}
