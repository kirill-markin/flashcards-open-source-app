import { Hono } from "hono";
import { HttpError } from "../shared/errors";
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
  createBackendFailureDetails,
} from "../server/logging";
import { withTransientDatabaseRetry } from "../database/transient";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
  type BackendSyncConflictDetails,
  type SyncPullDetails,
  type SyncReviewHistoryPullDetails,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";

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

function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

function getSyncPullInputDetails(
  input: SyncPullInput | null,
): Pick<SyncPullDetails, "installationId" | "platform" | "appVersion" | "afterHotChangeId"> {
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

function getSyncReviewHistoryPullInputDetails(
  input: SyncReviewHistoryPullInput | null,
): Pick<SyncReviewHistoryPullDetails, "installationId" | "platform" | "appVersion" | "afterReviewSequenceId"> {
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

function getSyncConflictLogContext(error: HttpError | unknown): BackendSyncConflictDetails {
  if (!(error instanceof HttpError)) {
    return emptySyncConflictDetails();
  }

  const syncConflict = error.details?.syncConflict;
  if (syncConflict === undefined) {
    return emptySyncConflictDetails();
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

function emptySyncConflictDetails(): BackendSyncConflictDetails {
  return {
    syncConflictPhase: null,
    syncConflictEntityType: null,
    syncConflictEntityId: null,
    conflictingWorkspaceId: null,
    constraint: null,
    sqlState: null,
    table: null,
    entryIndex: null,
    reviewEventIndex: null,
    syncConflictRecoverable: null,
  };
}

function createSyncScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
  );
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
      addBackendBreadcrumb({
        action: "sync_push",
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
          installationId: input.installationId,
          platform: input.platform,
          appVersion: input.appVersion ?? null,
          operationsCount: input.operations.length,
          entityTypes,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        operationsCount: input.operations.length,
        entityTypes,
        ...createBackendFailureDetails(error),
        ...getSyncConflictLogContext(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "sync_push_error", error: normalizeCaughtError(error), scope, details },
        { action: "sync_push_error", scope, details },
      );
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
        () => createSyncScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          workspaceId,
        ),
      );
      addBackendBreadcrumb({
        action: "sync_pull",
        scope: createSyncScope(
          requestId,
          context.req.path,
          context.req.method,
          routeState.requestContext.userId,
          routeState.workspaceId,
        ),
        details: {
          statusCode: 200,
          installationId: routeState.input.installationId,
          platform: routeState.input.platform,
          appVersion: routeState.input.appVersion ?? null,
          afterHotChangeId: routeState.input.afterHotChangeId,
          nextHotChangeId: routeState.result.nextHotChangeId,
          changesCount: routeState.result.changes.length,
        },
      });
      return context.json(routeState.result);
    } catch (error) {
      const scope = createSyncScope(
        requestId,
        context.req.path,
        context.req.method,
        getRequestContextUserId(requestContext),
        workspaceId,
      );
      const details = {
        ...getSyncPullInputDetails(input),
        nextHotChangeId: null,
        changesCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "sync_pull_error", error: normalizeCaughtError(error), scope, details },
        { action: "sync_pull_error", scope, details },
      );
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
      addBackendBreadcrumb({
        action: "sync_bootstrap",
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
          installationId: input.installationId,
          platform: input.platform,
          appVersion: input.appVersion ?? null,
          mode: input.mode,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        mode: input.mode,
        ...createBackendFailureDetails(error),
        ...getSyncConflictLogContext(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "sync_bootstrap_error", error: normalizeCaughtError(error), scope, details },
        { action: "sync_bootstrap_error", scope, details },
      );
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
        () => createSyncScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          workspaceId,
        ),
      );
      addBackendBreadcrumb({
        action: "sync_review_history_pull",
        scope: createSyncScope(
          requestId,
          context.req.path,
          context.req.method,
          routeState.requestContext.userId,
          routeState.workspaceId,
        ),
        details: {
          statusCode: 200,
          installationId: routeState.input.installationId,
          platform: routeState.input.platform,
          appVersion: routeState.input.appVersion ?? null,
          afterReviewSequenceId: routeState.input.afterReviewSequenceId,
          nextReviewSequenceId: routeState.result.nextReviewSequenceId,
          reviewEventsCount: routeState.result.reviewEvents.length,
        },
      });
      return context.json(routeState.result);
    } catch (error) {
      const scope = createSyncScope(
        requestId,
        context.req.path,
        context.req.method,
        getRequestContextUserId(requestContext),
        workspaceId,
      );
      const details = {
        ...getSyncReviewHistoryPullInputDetails(input),
        nextReviewSequenceId: null,
        reviewEventsCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "sync_review_history_pull_error", error: normalizeCaughtError(error), scope, details },
        { action: "sync_review_history_pull_error", scope, details },
      );
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
      addBackendBreadcrumb({
        action: "sync_review_history_import",
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
          installationId: input.installationId,
          platform: input.platform,
          appVersion: input.appVersion ?? null,
          reviewEventsCount: input.reviewEvents.length,
          importedCount: result.importedCount,
          duplicateCount: result.duplicateCount,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        installationId: input.installationId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        reviewEventsCount: input.reviewEvents.length,
        importedCount: null,
        duplicateCount: null,
        ...createBackendFailureDetails(error),
        ...getSyncConflictLogContext(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "sync_review_history_import_error", error: normalizeCaughtError(error), scope, details },
        { action: "sync_review_history_import_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
