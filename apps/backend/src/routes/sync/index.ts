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
  resolveAccountKindForTransport,
  resolveEntitlementSnapshotForUser,
  type EntitlementWire,
} from "../../billing/snapshot";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../../server/requestContext";
import { parseJsonBody } from "../../server/requestParsing";
import {
  createBackendFailureDetails,
} from "../../server/logging";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
  isServiceUnavailableDatabaseError,
  isTransientDatabaseError,
  withTransientDatabaseRetry,
} from "../../database/transient";
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
  resolveEntitlementSnapshotForUserFn?: typeof resolveEntitlementSnapshotForUser;
}>;

type SyncPullRouteState = Readonly<{
  requestContext: RequestContext;
  workspaceId: string;
  input: SyncPullInput;
  result: SyncPullResult;
  // Absent when the entitlement could not be resolved, which the response reflects by omitting the
  // field rather than by failing the pull.
  entitlement: EntitlementWire | null;
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
  const resolveEntitlementSnapshotForUserFn = options.resolveEntitlementSnapshotForUserFn
    ?? resolveEntitlementSnapshotForUser;

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
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform")),
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
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
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

    // A billing-data problem degrades the paywall, never sync. The resolve is awaited inside the state
    // that produces the 200, so an operator grant naming a tier outside the catalogue, a stored status
    // this code cannot read, or a failing billing read would otherwise become a /sync/pull 500 and stop
    // this device receiving remote changes at all. The field is omitted instead of falling back to a
    // free resolution, because publishing `free` for someone who paid would silently downgrade them,
    // while an absent field leaves the client on the last snapshot it saw - which is how client-side
    // premium is specified to fail (docs/premium-entitlements.md, "Offline behaviour").
    async function resolvePullEntitlement(
      pullRequestContext: RequestContext,
      pullWorkspaceId: string,
    ): Promise<EntitlementWire | null> {
      const accountKind = resolveAccountKindForTransport(pullRequestContext.transport);
      try {
        return await resolveEntitlementSnapshotForUserFn(
          pullRequestContext.userId,
          accountKind,
          new Date(),
        );
      } catch (error) {
        const scope = createSyncScope(
          requestId,
          context.req.path,
          context.req.method,
          pullRequestContext.userId,
          pullWorkspaceId,
          context.get("clientAppVersion"),
          context.get("clientPlatform"),
        );
        const details = {
          accountKind,
          ...createBackendFailureDetails(error),
        };
        // A transient database failure is the same self-healing condition the enclosing retry wrapper
        // absorbs without any report one line above, so it is recorded rather than opened as an issue:
        // a failover would otherwise burst one exception per request through the whole window. Both
        // predicates are asked, exactly as the retry wrapper asks them, because the database layer
        // wraps such a failure before it reaches here: what arrives is a 503 boundary error that no
        // longer carries the driver's code or message, so only isServiceUnavailableDatabaseError
        // recognises it.
        // An unconfirmed commit is recorded the same way for a reason that belongs to this one table
        // and must not be generalised to any other write: the only write behind this call is the
        // billing.entitlement_snapshots cache, which is droppable, so not knowing whether it committed
        // costs nothing. The next pull resolves again and either finds the row or writes it, and the
        // clock guard on that upsert keeps an older resolution from overwriting a newer one.
        // The exception path below is for what a retry cannot fix - an unreadable tier or status, or a
        // permission failure.
        if (
          isTransientDatabaseError(error)
          || isServiceUnavailableDatabaseError(error)
          || error instanceof DatabaseCommitOutcomeUnknownError
        ) {
          // The driver diagnostics ride along, because both classes keep their SQLSTATE and message on
          // the error rather than in the failure details, and this breadcrumb is the whole record: the
          // pull answered 200 and nothing else reports. Same field names as database_transient_retry.
          addBackendBreadcrumb({
            action: "sync_pull_entitlement_error",
            scope,
            details: { ...details, ...getDatabaseErrorFields(error) },
          });
          return null;
        }

        reportBackendExceptionOrBreadcrumb(
          error,
          {
            action: "sync_pull_entitlement_error",
            error: normalizeCaughtError(error),
            scope,
            details,
          },
          { action: "sync_pull_entitlement_error", scope, details },
        );
        return null;
      }
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
          // Assembled here rather than inside the hot-change reader: the entitlement belongs to the
          // person, not to the workspace changes, and naming a billing table inside a read that every
          // authenticated request shares would pin every Postgres integration boundary to this schema.
          const entitlement = await resolvePullEntitlement(requestContext, workspaceId);
          return {
            requestContext,
            workspaceId,
            input,
            result,
            entitlement,
          };
        },
        () => createSyncScope(
          requestId,
          context.req.path,
          context.req.method,
          getRequestContextUserId(requestContext),
          workspaceId,
          context.get("clientAppVersion"),
          context.get("clientPlatform"),
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
          context.get("clientAppVersion"),
          context.get("clientPlatform"),
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
      // Additive field, omitted when the entitlement could not be resolved. Released clients ignore
      // unknown keys, and none of them reads it yet.
      return context.json(
        routeState.entitlement === null
          ? routeState.result
          : { ...routeState.result, entitlement: routeState.entitlement },
      );
    } catch (error) {
      const scope = createSyncScope(
        requestId,
        context.req.path,
        context.req.method,
        getRequestContextUserId(requestContext),
        workspaceId,
        context.get("clientAppVersion"),
        context.get("clientPlatform"),
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
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform")),
        details: buildSyncBootstrapDetails(input, result, durationMs),
      });
      return context.json(result);
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
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
          context.get("clientAppVersion"),
          context.get("clientPlatform"),
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
          context.get("clientAppVersion"),
          context.get("clientPlatform"),
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
        context.get("clientAppVersion"),
        context.get("clientPlatform"),
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
        scope: createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform")),
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
      const scope = createSyncScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
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
