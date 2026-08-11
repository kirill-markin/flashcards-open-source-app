import { Hono, type Context } from "hono";
import {
  requireCatalogAdminRequest,
  type CatalogAdminRequestContext,
} from "../../admin/authz";
import {
  ingestCatalogPackageCardImage,
  replaceCatalogPackageCoverImage,
  type CatalogPackageCardImageIngestionInput,
  type CatalogPackageCoverImageIngestionInput,
  type CatalogPackageImageIngestionResult,
} from "../../catalog/authoring/imageIngestion";
import { normalizePackageMediaKey } from "../../catalog/common";
import type { CatalogPackageMediaAsset } from "../../catalog/types";
import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../../database";
import { getDatabaseErrorFields } from "../../database/transient";
import { readMediaAssetImageIngestionBytesWithAbortSignal } from "../../mediaAssets/validators";
import type { BackendObservationScope } from "../../observability/sentry/events";
import {
  addBackendRuntimeBreadcrumb,
  normalizeCaughtError,
} from "../../observability/runtime";
import { reportBackendExceptionOrBreadcrumb } from "../../observability/reporting";
import type { AppEnv } from "../../server/appEnv";
import { createBackendFailureDetails } from "../../server/logging";
import {
  createDirectImageIngestionDeadlineError,
  createDirectImageIngestionRequestDeadline,
  type DirectImageIngestionRequestDeadline,
} from "../../mediaAssets/ingestion";
import {
  createStandaloneDirectImageIngestionRequestTiming,
  getDirectImageIngestionRequestTiming,
} from "../../server/mediaRequests/directImageIngestionRequestTiming";
import { expectUuidString } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";

type PublicCatalogPackageMediaAsset = Omit<CatalogPackageMediaAsset, "mediaBlobId">;

export type CatalogAdminImageIngestionRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  requireAdminRequestFn?: (request: Request, allowedOrigins: ReadonlyArray<string>) => Promise<CatalogAdminRequestContext>;
  ingestCatalogPackageCardImageFn?: (input: CatalogPackageCardImageIngestionInput) => Promise<CatalogPackageImageIngestionResult>;
  replaceCatalogPackageCoverImageFn?: (input: CatalogPackageCoverImageIngestionInput) => Promise<CatalogPackageImageIngestionResult>;
}>;

function parsePackageId(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "packageId is required", "CATALOG_ADMIN_PARAM_REQUIRED");
  }
  try {
    return expectUuidString(value, "packageId");
  } catch {
    throw new HttpError(400, "packageId must be a UUID", "CATALOG_ADMIN_PARAM_INVALID");
  }
}

function parsePackageMediaKey(headers: Headers): string {
  const value = headers.get("x-package-media-key");
  if (value === null) {
    throw new HttpError(400, "x-package-media-key header is required", "CATALOG_PACKAGE_MEDIA_KEY_REQUIRED");
  }
  const packageMediaKey = normalizePackageMediaKey(value, "x-package-media-key");
  if (packageMediaKey === "cover") {
    throw new HttpError(
      400,
      "x-package-media-key cover is reserved; use the package cover PUT endpoint.",
      "CATALOG_PACKAGE_MEDIA_KEY_RESERVED",
    );
  }
  return packageMediaKey;
}

function toPublicCatalogPackageMediaAsset(
  mediaAsset: CatalogPackageMediaAsset,
): PublicCatalogPackageMediaAsset {
  const { mediaBlobId, ...publicMediaAsset } = mediaAsset;
  void mediaBlobId;
  return publicMediaAsset;
}

function createCatalogImageIngestionScope(context: Context<AppEnv>, userId: string | null): BackendObservationScope {
  return {
    service: "backend-api",
    requestId: context.get("requestId"),
    route: context.req.path,
    method: context.req.method,
    userId,
    workspaceId: null,
    chatRequestId: null,
    runId: null,
    sessionId: null,
    clientAppVersion: context.get("clientAppVersion"),
    clientPlatform: context.get("clientPlatform"),
  };
}

function mapCatalogImageIngestionDeadlineError(
  error: unknown,
  deadline: DirectImageIngestionRequestDeadline,
): unknown {
  const { sqlState } = getDatabaseErrorFields(error);
  if (
    error instanceof DatabaseDeadlineExceededError
    || (
      error instanceof HttpError
      && error.code === "CATALOG_IMAGE_INGESTION_DEADLINE_INVALID"
    )
    || sqlState === "55P03"
    || sqlState === "57014"
    || deadline.preprocessingSignal.aborted
    || deadline.requestSignal.aborted
  ) {
    return createDirectImageIngestionDeadlineError("request");
  }
  return error;
}

function reportCatalogImageIngestionFailure(error: unknown, scope: BackendObservationScope): void {
  const details = {
    mediaAssetId: null,
    ...createBackendFailureDetails(error),
  };
  reportBackendExceptionOrBreadcrumb(
    error,
    {
      action: "media_asset_image_ingest_error",
      error: normalizeCaughtError(error),
      scope,
      details,
    },
    { action: "media_asset_image_ingest_error", scope, details },
  );
}

function reportAndRethrowCatalogImageIngestionError(
  error: unknown,
  deadline: DirectImageIngestionRequestDeadline,
  context: Context<AppEnv>,
  userId: string | null,
): never {
  const mappedError = mapCatalogImageIngestionDeadlineError(error, deadline);
  reportCatalogImageIngestionFailure(mappedError, createCatalogImageIngestionScope(context, userId));
  throw mappedError;
}

function addCatalogImageIngestionSuccess(
  scope: BackendObservationScope,
  result: CatalogPackageImageIngestionResult,
  statusCode: number,
): void {
  addBackendRuntimeBreadcrumb({
    action: "media_asset_image_ingest",
    scope,
    details: {
      statusCode,
      mediaAssetId: result.mediaAsset.packageMediaAssetId,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      applied: result.applied,
    },
  });
}

function createRequestDeadline(): DirectImageIngestionRequestDeadline {
  const timing = getDirectImageIngestionRequestTiming()
    ?? createStandaloneDirectImageIngestionRequestTiming(Date.now());
  return createDirectImageIngestionRequestDeadline(timing);
}

export function createCatalogAdminImageIngestionRoutes(options: CatalogAdminImageIngestionRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const requireAdminRequestFn = options.requireAdminRequestFn
    ?? requireCatalogAdminRequest;
  const ingestCatalogPackageCardImageFn = options.ingestCatalogPackageCardImageFn
    ?? ingestCatalogPackageCardImage;
  const replaceCatalogPackageCoverImageFn = options.replaceCatalogPackageCoverImageFn
    ?? replaceCatalogPackageCoverImage;

  app.post("/admin/catalog/packages/:packageId/media-assets/images", async (context) => {
    const deadline = createRequestDeadline();
    let userId: string | null = null;
    try {
      const prepared = await runDatabaseOperationsWithDeadline(
        deadline.preprocessingDeadlineAtMs,
        async () => {
          const admin = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
          userId = admin.userId;
          const packageId = parsePackageId(context.req.param("packageId"));
          const packageMediaKey = parsePackageMediaKey(context.req.raw.headers);
          const imageBytes = await readMediaAssetImageIngestionBytesWithAbortSignal(
            context.req.raw,
            deadline.preprocessingSignal,
          );
          return { packageId, packageMediaKey, imageBytes };
        },
      );
      deadline.disposePreprocessing();
      const scope = createCatalogImageIngestionScope(context, userId);
      const result = await ingestCatalogPackageCardImageFn({
        packageId: prepared.packageId,
        packageMediaKey: prepared.packageMediaKey,
        imageBytes: prepared.imageBytes,
        deadlineAtMs: deadline.requestDeadlineAtMs,
        signal: deadline.requestSignal,
        observationScope: scope,
      });
      addCatalogImageIngestionSuccess(scope, result, 201);
      return context.json({
        mediaAsset: toPublicCatalogPackageMediaAsset(result.mediaAsset),
      }, 201);
    } catch (error) {
      reportAndRethrowCatalogImageIngestionError(error, deadline, context, userId);
    } finally {
      deadline.dispose();
    }
  });

  app.put("/admin/catalog/packages/:packageId/cover", async (context) => {
    const deadline = createRequestDeadline();
    let userId: string | null = null;
    try {
      const prepared = await runDatabaseOperationsWithDeadline(
        deadline.preprocessingDeadlineAtMs,
        async () => {
          const admin = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
          userId = admin.userId;
          const packageId = parsePackageId(context.req.param("packageId"));
          const imageBytes = await readMediaAssetImageIngestionBytesWithAbortSignal(
            context.req.raw,
            deadline.preprocessingSignal,
          );
          return { packageId, imageBytes };
        },
      );
      deadline.disposePreprocessing();
      const scope = createCatalogImageIngestionScope(context, userId);
      const result = await replaceCatalogPackageCoverImageFn({
        packageId: prepared.packageId,
        imageBytes: prepared.imageBytes,
        deadlineAtMs: deadline.requestDeadlineAtMs,
        signal: deadline.requestSignal,
        observationScope: scope,
      });
      addCatalogImageIngestionSuccess(scope, result, 200);
      return context.json({
        mediaAsset: toPublicCatalogPackageMediaAsset(result.mediaAsset),
      });
    } catch (error) {
      reportAndRethrowCatalogImageIngestionError(error, deadline, context, userId);
    } finally {
      deadline.dispose();
    }
  });

  return app;
}
