import { Hono } from "hono";
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
} from "../../sync";
import {
  assertUserHasWorkspaceAccess,
} from "../../workspaces";
import { bindGuestSessionPlatform } from "../../guestAuth";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../../server/requestContext";
import { parseJsonBody } from "../../server/requestParsing";
import {
  createBackendFailureDetails,
} from "../../server/logging";
import { withTransientDatabaseRetry } from "../../database/transient";
import {
  addBackendBreadcrumb,
  normalizeCaughtError,
} from "../../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../../observability/reporting";
import type { AppEnv } from "../../server/app";
import {
  buildSyncBootstrapDetails,
  getSyncBootstrapFailureInputDetails,
} from "./bootstrapDetails";
import { getSyncConflictLogContext } from "./conflictDetails";
import { requireSupportedSyncPlatformForTransport } from "./guestPlatform";
import {
  createSyncScope,
  getRequestContextUserId,
  getSyncPullInputDetails,
  getSyncReviewHistoryPullInputDetails,
} from "./observation";

type SyncRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  processSyncBootstrapFn?: typeof processSyncBootstrap;
  processSyncPushFn?: typeof processSyncPush;
  processSyncPullFn?: typeof processSyncPull;
  processSyncReviewHistoryPullFn?: typeof processSyncReviewHistoryPull;
  withTransientDatabaseRetryFn?: typeof withTransientDatabaseRetry;
  bindGuestSessionPlatformFn?: typeof bindGuestSessionPlatform;
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

export function createSyncRoutes(options: SyncRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const processSyncBootstrapFn = options.processSyncBootstrapFn ?? processSyncBootstrap;
  const processSyncPushFn = options.processSyncPushFn ?? processSyncPush;
  const processSyncPullFn = options.processSyncPullFn ?? processSyncPull;
  const processSyncReviewHistoryPullFn = options.processSyncReviewHistoryPullFn ?? processSyncReviewHistoryPull;
  const withTransientDatabaseRetryFn = options.withTransientDatabaseRetryFn ?? withTransientDatabaseRetry;
  const bindGuestSessionPlatformFn = options.bindGuestSessionPlatformFn ?? bindGuestSessionPlatform;

  app.post("/workspaces/:workspaceId/sync/push", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
    const input = parseSyncPushInput(await parseJsonBody(context.req.raw));
    await requireSupportedSyncPlatformForTransport(requestContext, input.platform, bindGuestSessionPlatformFn);
    const requestId = context.get("requestId");
    const entityTypes = [...new Set(input.operations.map((operation) => operation.entityType))];

    try {
      const result = await processSyncPushFn(workspaceId, requestContext.userId, input);
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
          await requireSupportedSyncPlatformForTransport(requestContext, input.platform, bindGuestSessionPlatformFn);
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
    await requireSupportedSyncPlatformForTransport(requestContext, input.platform, bindGuestSessionPlatformFn);
    const requestId = context.get("requestId");
    const startedAtMs = Date.now();

    try {
      const result = await processSyncBootstrapFn(workspaceId, requestContext.userId, input);
      const durationMs = Date.now() - startedAtMs;
      addBackendBreadcrumb({
        action: "sync_bootstrap",
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: buildSyncBootstrapDetails(input, result, durationMs),
      });
      return context.json(result);
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        ...getSyncBootstrapFailureInputDetails(input, durationMs),
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
          await requireSupportedSyncPlatformForTransport(requestContext, input.platform, bindGuestSessionPlatformFn);
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
    await requireSupportedSyncPlatformForTransport(requestContext, input.platform, bindGuestSessionPlatformFn);
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
