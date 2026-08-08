import { Hono } from "hono";
import { AuthError } from "../auth";
import {
  assertImageMediaAssetIngestionPreconditionsForWorkspace,
} from "../mediaAssets";
import {
  createDirectImageIngestionDeadlineError,
  createDirectImageIngestionRequestDeadline,
  ingestImageMediaAssetWithRequestDeadline,
  type DirectImageIngestionRequestDeadline,
} from "../mediaAssets/ingestion";
import {
  parseMediaAssetImageIngestionMetadataHeaders,
  readMediaAssetImageIngestionBytesWithAbortSignal,
} from "../mediaAssets/validators";
import { assertUserHasWorkspaceAccess } from "../workspaces/selection";
import {
  loadRequestContextFromRequestWithAbortSignal,
  parseWorkspaceIdParam,
} from "../server/requestContext";
import type { AppEnv } from "../server/appEnv";
import type {
  BackendFailureDetails,
  BackendObservationScope,
} from "../observability/sentry/events";
import {
  addBackendRuntimeBreadcrumb,
  normalizeCaughtError,
} from "../observability/runtime";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import { HttpError } from "../shared/errors";
import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../database";
import {
  createStandaloneDirectImageIngestionRequestTiming,
  getDirectImageIngestionRequestTiming,
} from "../server/mediaRequests/directImageIngestionRequestTiming";

export type DirectImageIngestionRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestWithAbortSignalFn?:
    typeof loadRequestContextFromRequestWithAbortSignal;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  assertImageMediaAssetIngestionPreconditionsForWorkspaceFn?:
    typeof assertImageMediaAssetIngestionPreconditionsForWorkspace;
  ingestImageMediaAssetWithRequestDeadlineFn?:
    typeof ingestImageMediaAssetWithRequestDeadline;
}>;

function createDirectImageIngestionScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return {
    service: "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    chatRequestId: null,
    runId: null,
    sessionId: null,
    clientAppVersion,
    clientPlatform,
  };
}

function createDirectImageIngestionFailureDetails(
  error: unknown,
): BackendFailureDetails {
  const mediaAssetStorage = error instanceof HttpError
    ? error.details?.mediaAssetStorage
    : undefined;
  return {
    statusCode: error instanceof AuthError || error instanceof HttpError
      ? error.statusCode
      : 500,
    code: error instanceof AuthError
      ? "AUTH_UNAUTHORIZED"
      : error instanceof HttpError
        ? error.code
        : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
    validationIssues: error instanceof HttpError
      ? (error.details?.validationIssues ?? []).map((issue) => ({
        path: issue.path,
        code: issue.code,
      }))
      : [],
    ...(mediaAssetStorage === undefined ? {} : { mediaAssetStorage }),
  };
}

function mapDirectImageIngestionDeadlineError(
  error: unknown,
  deadline: DirectImageIngestionRequestDeadline,
): unknown {
  if (
    error instanceof HttpError
    && error.code === "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED"
  ) {
    return error;
  }
  if (
    error instanceof DatabaseDeadlineExceededError
    || (
      typeof error === "object"
      && error !== null
      && (
        ("code" in error && (error.code === "57014" || error.code === "55P03"))
        || (
          "sqlState" in error
          && (error.sqlState === "57014" || error.sqlState === "55P03")
        )
        || (
          "errorCode" in error
          && (error.errorCode === "57014" || error.errorCode === "55P03")
        )
      )
    )
    || deadline.preprocessingSignal.aborted
    || deadline.requestSignal.aborted
  ) {
    return createDirectImageIngestionDeadlineError("request");
  }
  return error;
}

export function createDirectImageIngestionRoutes(
  options: DirectImageIngestionRoutesOptions,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestWithAbortSignalFn =
    options.loadRequestContextFromRequestWithAbortSignalFn
    ?? loadRequestContextFromRequestWithAbortSignal;
  const assertUserHasWorkspaceAccessFn =
    options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const assertImageMediaAssetIngestionPreconditionsForWorkspaceFn =
    options.assertImageMediaAssetIngestionPreconditionsForWorkspaceFn
    ?? assertImageMediaAssetIngestionPreconditionsForWorkspace;
  const ingestImageMediaAssetWithRequestDeadlineFn =
    options.ingestImageMediaAssetWithRequestDeadlineFn
    ?? ingestImageMediaAssetWithRequestDeadline;

  app.post("/workspaces/:workspaceId/media-assets/images", async (context) => {
    let userId: string | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    const requestTiming = getDirectImageIngestionRequestTiming()
      ?? createStandaloneDirectImageIngestionRequestTiming(Date.now());
    const ingestionDeadline =
      createDirectImageIngestionRequestDeadline(requestTiming);

    try {
      const prepared = await runDatabaseOperationsWithDeadline(
        ingestionDeadline.preprocessingDeadlineAtMs,
        async () => {
          const loadedContext = await loadRequestContextFromRequestWithAbortSignalFn(
            context.req.raw,
            options.allowedOrigins,
            ingestionDeadline.preprocessingSignal,
          );
          userId = loadedContext.requestContext.userId;
          workspaceId = parseWorkspaceIdParam(
            context.req.param("workspaceId"),
          );
          await assertUserHasWorkspaceAccessFn(
            loadedContext.requestContext.userId,
            workspaceId,
          );
          const metadata = parseMediaAssetImageIngestionMetadataHeaders(
            context.req.raw.headers,
          );
          mediaAssetId = metadata.mediaAssetId;
          await assertImageMediaAssetIngestionPreconditionsForWorkspaceFn(
            loadedContext.requestContext.userId,
            workspaceId,
            metadata,
            ingestionDeadline.preprocessingDeadlineAtMs,
          );
          const imageBytes = await readMediaAssetImageIngestionBytesWithAbortSignal(
            context.req.raw,
            ingestionDeadline.preprocessingSignal,
          );
          return {
            loadedContext,
            workspaceId,
            metadata,
            imageBytes,
          };
        },
      );
      const scope = createDirectImageIngestionScope(
        context.get("requestId"),
        context.req.path,
        context.req.method,
        prepared.loadedContext.requestContext.userId,
        prepared.workspaceId,
        context.get("clientAppVersion"),
        context.get("clientPlatform"),
      );
      const result = await runDatabaseOperationsWithDeadline(
        ingestionDeadline.requestDeadlineAtMs,
        () => ingestImageMediaAssetWithRequestDeadlineFn({
          userId: prepared.loadedContext.requestContext.userId,
          workspaceId: prepared.workspaceId,
          metadata: prepared.metadata,
          imageBytes: prepared.imageBytes,
          observationScope: scope,
        }, ingestionDeadline),
      );
      addBackendRuntimeBreadcrumb({
        action: "media_asset_image_ingest",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: prepared.metadata.mediaAssetId,
          mimeType: result.mediaAsset.mimeType,
          sizeBytes: result.mediaAsset.sizeBytes,
          applied: result.applied,
        },
      });
      return context.json(result);
    } catch (error) {
      const mappedError = mapDirectImageIngestionDeadlineError(
        error,
        ingestionDeadline,
      );
      const scope = createDirectImageIngestionScope(
        context.get("requestId"),
        context.req.path,
        context.req.method,
        userId,
        workspaceId,
        context.get("clientAppVersion"),
        context.get("clientPlatform"),
      );
      const details = {
        mediaAssetId,
        ...createDirectImageIngestionFailureDetails(mappedError),
      };
      reportBackendExceptionOrBreadcrumb(
        mappedError,
        {
          action: "media_asset_image_ingest_error",
          error: normalizeCaughtError(mappedError),
          scope,
          details,
        },
        {
          action: "media_asset_image_ingest_error",
          scope,
          details,
        },
      );
      throw mappedError;
    } finally {
      ingestionDeadline.dispose();
    }
  });

  return app;
}
