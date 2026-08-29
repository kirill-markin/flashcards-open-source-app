import { Hono } from "hono";
import {
  listPublicCatalogPackages,
  loadPublicCatalogCollectionCoverForDownload,
  loadPublicCatalogPackageDetail,
  loadPublicCatalogPackageMediaForDownload,
  loadPublicCatalogPackageVersion,
  loadPublicCatalogPackageVersionCardPreview,
} from "../../catalog";
import {
  isUnsafePublicPackageMediaKey,
  normalizePackageMediaKey,
  normalizeSlug,
} from "../../catalog/common";
// Narrow path on purpose: the catalog barrels must not start carrying the dump
// storage module into Lambdas that never touch the artifact bucket.
import {
  catalogDumpPointerUnavailableCode,
  loadCatalogDumpPointerFromS3,
  type CatalogDumpPointer,
} from "../../catalog/distribution/public/dumpStorage";
import {
  buildCatalogMediaCdnUrl,
  getPublicCatalogMediaDeliveryIssue,
  maximumPublicCatalogMediaDownloadBytes,
} from "../../catalog/publicMediaDelivery";
import type {
  CatalogPublicPackageCardPreview,
  CatalogPublicCollectionCoverDownloadSource,
  CatalogPublicPackageDetail,
  CatalogPublicPackageListInput,
  CatalogPublicPackageMediaDownloadSource,
  CatalogPublicPackageSummary,
  CatalogPublicPackageVersionDetail,
} from "../../catalog/types";
import {
  captureBackendWarning,
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import type { AppEnv } from "../../server/app";
import { expectUuidString } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";

type CatalogPublicRoutesOptions = Readonly<{
  loadCatalogDumpPointerFn?: (
    observationScope: BackendObservationScope,
  ) => Promise<CatalogDumpPointer>;
  listPublicCatalogPackagesFn?: (
    input: CatalogPublicPackageListInput,
  ) => Promise<ReadonlyArray<CatalogPublicPackageSummary>>;
  loadPublicCatalogPackageDetailFn?: (
    packageSlug: string,
    catalogMediaCdnBaseUrl: string,
  ) => Promise<CatalogPublicPackageDetail>;
  loadPublicCatalogPackageVersionFn?: (
    packageVersionId: string,
  ) => Promise<CatalogPublicPackageVersionDetail>;
  loadPublicCatalogPackageVersionCardPreviewFn?: (
    input: Readonly<{ packageVersionId: string; limit: number }>,
  ) => Promise<ReadonlyArray<CatalogPublicPackageCardPreview>>;
  loadPublicCatalogPackageMediaForDownloadFn?: (
    packageVersionId: string,
    packageMediaKey: string,
    catalogMediaCdnBaseUrl: string,
  ) => Promise<CatalogPublicPackageMediaDownloadSource>;
  loadPublicCatalogCollectionCoverForDownloadFn?: (
    collectionId: string,
  ) => Promise<CatalogPublicCollectionCoverDownloadSource>;
  resolveCatalogMediaCdnBaseUrlFn?: () => string;
}>;

const defaultPackageListLimit = 50;
const defaultCardPreviewLimit = 25;
const maximumPublicCatalogLimit = 100;
const catalogSnapshotUnavailableMessage = "Public catalog snapshot is unavailable.";

function parseLimitQuery(
  value: string | undefined,
  fieldName: string,
  defaultLimit: number,
): number {
  if (value === undefined) {
    return defaultLimit;
  }

  const parsedLimit = Number.parseInt(value, 10);
  if (
    Number.isSafeInteger(parsedLimit) === false
    || parsedLimit < 1
    || parsedLimit > maximumPublicCatalogLimit
    || parsedLimit.toString() !== value
  ) {
    throw new HttpError(
      400,
      `${fieldName} must be an integer between 1 and ${maximumPublicCatalogLimit}`,
      "CATALOG_PUBLIC_LIMIT_INVALID",
    );
  }

  return parsedLimit;
}

function parseOptionalQueryString(value: string | undefined, fieldName: string): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new HttpError(400, `${fieldName} must not be empty`, "CATALOG_PUBLIC_QUERY_INVALID");
  }

  return trimmedValue;
}

function rejectRemovedTopicTagQuery(value: string | undefined): void {
  if (value !== undefined) {
    throw new HttpError(
      400,
      "topicTag was removed; omit topicTag from public catalog list requests.",
      "CATALOG_PUBLIC_TOPIC_TAG_REMOVED",
    );
  }
}

function parsePackageSlugParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "packageSlug is required", "CATALOG_PUBLIC_PARAM_REQUIRED");
  }

  return normalizeSlug(value, "packageSlug");
}

function parsePackageVersionIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "packageVersionId is required", "CATALOG_PUBLIC_PARAM_REQUIRED");
  }

  try {
    return expectUuidString(value, "packageVersionId");
  } catch {
    throw new HttpError(400, "packageVersionId must be a UUID", "CATALOG_PUBLIC_PARAM_INVALID");
  }
}

function parseCollectionIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "collectionId is required", "CATALOG_PUBLIC_PARAM_REQUIRED");
  }

  try {
    return expectUuidString(value, "collectionId");
  } catch {
    throw new HttpError(400, "collectionId must be a UUID", "CATALOG_PUBLIC_PARAM_INVALID");
  }
}

function parsePackageMediaKeyParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "packageMediaKey is required", "CATALOG_PUBLIC_PARAM_REQUIRED");
  }

  const packageMediaKey = normalizePackageMediaKey(value, "packageMediaKey");
  if (isUnsafePublicPackageMediaKey(packageMediaKey)) {
    throw new HttpError(
      400,
      "packageMediaKey must be a public catalog media key",
      "CATALOG_PUBLIC_PARAM_INVALID",
    );
  }

  return packageMediaKey;
}

function createCatalogPublicScope(
  requestId: string,
  route: string,
  method: string,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    null,
    null,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}

/**
 * The CDN base URL on its own, deliberately not `getCatalogDumpStorageConfig()`.
 *
 * That accessor also requires `CATALOG_DUMP_S3_BUCKET_NAME`, which no route here
 * reads: only the dump run writes to the bucket. Resolving the whole config
 * would let a missing bucket name take down package browse and media delivery
 * over a variable they never use, while `GET /catalog` keeps failing that same
 * configuration as its own typed 503.
 */
function resolveCatalogMediaCdnBaseUrl(): string {
  const cdnBaseUrl = process.env.CATALOG_DUMP_CDN_BASE_URL;
  if (cdnBaseUrl === undefined || cdnBaseUrl.trim() === "") {
    throw new Error(
      "CATALOG_DUMP_CDN_BASE_URL is required for public catalog media delivery.",
    );
  }

  return cdnBaseUrl.trim();
}

function isCatalogDumpPointerUnavailableError(error: unknown): error is HttpError {
  return error instanceof HttpError
    && error.statusCode === 503
    && error.code === catalogDumpPointerUnavailableCode;
}

/**
 * Resolves the published CDN object for one authorized public catalog media
 * asset.
 *
 * The mime allowlist and the size cap decide what the catalog publishes to the
 * CDN at all, so neither is a transport limit any more: they say whether an
 * object exists to point at. An asset outside them keeps answering the same
 * 415 and 413 it always did rather than redirecting to a key that was never
 * written.
 */
function resolvePublicCatalogMediaCdnUrl(
  mediaDownloadSource: CatalogPublicPackageMediaDownloadSource,
): string {
  const issue = getPublicCatalogMediaDeliveryIssue({
    mimeType: mediaDownloadSource.mediaAsset.mimeType,
    sizeBytes: mediaDownloadSource.mediaAsset.sizeBytes,
  });
  if (issue?.reason === "too_large") {
    throw new HttpError(
      413,
      [
        "Public catalog package media is too large for public delivery.",
        `sizeBytes=${mediaDownloadSource.mediaAsset.sizeBytes}`,
        `maxBytes=${maximumPublicCatalogMediaDownloadBytes}`,
      ].join(" "),
      "CATALOG_PUBLIC_MEDIA_DOWNLOAD_TOO_LARGE",
    );
  }
  if (issue?.reason === "unsupported_mime_type") {
    throw new HttpError(
      415,
      `Public catalog package media type is not supported for public delivery. mimeType=${mediaDownloadSource.mediaAsset.mimeType}`,
      "CATALOG_PUBLIC_MEDIA_DOWNLOAD_UNSUPPORTED_TYPE",
    );
  }

  const downloadUrl = mediaDownloadSource.mediaAsset.downloadUrl;
  if (downloadUrl === null) {
    throw new HttpError(
      409,
      `Published catalog package media is not addressable on the public CDN. packageVersionId=${mediaDownloadSource.mediaAsset.packageVersionId}`,
      "CATALOG_PUBLIC_MEDIA_OBJECT_NOT_ADDRESSABLE",
    );
  }

  return downloadUrl;
}

export function createCatalogPublicRoutes(options: CatalogPublicRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadCatalogDumpPointerFn = options.loadCatalogDumpPointerFn ?? loadCatalogDumpPointerFromS3;
  const listPublicCatalogPackagesFn = options.listPublicCatalogPackagesFn ?? listPublicCatalogPackages;
  const loadPublicCatalogPackageDetailFn = options.loadPublicCatalogPackageDetailFn
    ?? loadPublicCatalogPackageDetail;
  const loadPublicCatalogPackageVersionFn = options.loadPublicCatalogPackageVersionFn
    ?? loadPublicCatalogPackageVersion;
  const loadPublicCatalogPackageVersionCardPreviewFn = options.loadPublicCatalogPackageVersionCardPreviewFn
    ?? loadPublicCatalogPackageVersionCardPreview;
  const loadPublicCatalogPackageMediaForDownloadFn = options.loadPublicCatalogPackageMediaForDownloadFn
    ?? loadPublicCatalogPackageMediaForDownload;
  const loadPublicCatalogCollectionCoverForDownloadFn = options.loadPublicCatalogCollectionCoverForDownloadFn
    ?? loadPublicCatalogCollectionCoverForDownload;
  // Resolved per request, not once here: the routes are constructed wherever the
  // app is, including where the catalog dump environment is not configured.
  const resolveCatalogMediaCdnBaseUrlFn = options.resolveCatalogMediaCdnBaseUrlFn
    ?? resolveCatalogMediaCdnBaseUrl;

  /**
   * Redirects to the immutable catalog artifact instead of recomputing the
   * multi-megabyte snapshot per request. Clients that follow redirects need no
   * change; a plain `curl` needs `-L`.
   */
  app.get("/catalog", async (context) => {
    const observationScope = createCatalogPublicScope(
      context.get("requestId"),
      context.req.path,
      context.req.method,
      context.get("clientAppVersion"),
      context.get("clientPlatform"),
    );

    let pointer: CatalogDumpPointer;
    try {
      pointer = await loadCatalogDumpPointerFn(observationScope);
    } catch (error) {
      if (!isCatalogDumpPointerUnavailableError(error)) {
        throw error;
      }

      captureBackendWarning({
        action: "catalog_snapshot_pointer_error",
        message: catalogSnapshotUnavailableMessage,
        scope: observationScope,
        details: {
          statusCode: error.statusCode,
          code: error.code,
          storageErrorMessage: error.message,
        },
      });

      return context.json({
        error: catalogSnapshotUnavailableMessage,
        requestId: context.get("requestId"),
        code: catalogDumpPointerUnavailableCode,
      }, 503);
    }

    return context.redirect(pointer.url, 302);
  });

  app.get("/catalog/packages", async (context) => {
    rejectRemovedTopicTagQuery(context.req.query("topicTag"));
    const catalogPackages = await listPublicCatalogPackagesFn({
      limit: parseLimitQuery(context.req.query("limit"), "limit", defaultPackageListLimit),
      search: parseOptionalQueryString(context.req.query("q"), "q"),
      languageTag: parseOptionalQueryString(context.req.query("languageTag"), "languageTag"),
    });

    return context.json({ catalogPackages });
  });

  app.get("/catalog/packages/:packageSlug", async (context) => {
    const packageSlug = parsePackageSlugParam(context.req.param("packageSlug"));
    const catalogPackage = await loadPublicCatalogPackageDetailFn(
      packageSlug,
      resolveCatalogMediaCdnBaseUrlFn(),
    );
    return context.json({ catalogPackage });
  });

  app.get("/catalog/package-versions/:packageVersionId", async (context) => {
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const catalogPackageVersion = await loadPublicCatalogPackageVersionFn(packageVersionId);
    return context.json({ catalogPackageVersion });
  });

  app.get("/catalog/package-versions/:packageVersionId/cards", async (context) => {
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const cards = await loadPublicCatalogPackageVersionCardPreviewFn({
      packageVersionId,
      limit: parseLimitQuery(context.req.query("limit"), "limit", defaultCardPreviewLimit),
    });
    return context.json({ packageVersionId, cards });
  });

  app.get("/catalog/collections/:collectionId/cover/download-url", async (context) => {
    const collectionId = parseCollectionIdParam(context.req.param("collectionId"));
    const coverDownloadSource = await loadPublicCatalogCollectionCoverForDownloadFn(collectionId);
    const download = {
      method: "GET",
      url: buildCatalogMediaCdnUrl(resolveCatalogMediaCdnBaseUrlFn(), coverDownloadSource.sha256),
      expiresAt: null,
      rangeRequests: false,
    } as const;

    return context.json({
      collectionCover: coverDownloadSource.collectionCover,
      download,
    });
  });

  /**
   * Compatibility route for the URL every previously published snapshot embeds.
   * It still runs the published-and-not-delisted lookup on every request, so
   * withdrawal stays immediate, and the redirect itself is never cached for the
   * same reason. Only the bytes moved to the CDN.
   */
  app.get("/catalog/collections/:collectionId/cover/download", async (context) => {
    const collectionId = parseCollectionIdParam(context.req.param("collectionId"));
    const coverDownloadSource = await loadPublicCatalogCollectionCoverForDownloadFn(collectionId);
    const objectUrl = buildCatalogMediaCdnUrl(
      resolveCatalogMediaCdnBaseUrlFn(),
      coverDownloadSource.sha256,
    );

    context.header("Cache-Control", "public, no-cache");
    return context.redirect(objectUrl, 302);
  });

  app.get("/catalog/package-versions/:packageVersionId/media-assets/:packageMediaKey/download-url", async (context) => {
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const packageMediaKey = parsePackageMediaKeyParam(context.req.param("packageMediaKey"));

    const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadFn(
      packageVersionId,
      packageMediaKey,
      resolveCatalogMediaCdnBaseUrlFn(),
    );
    const download = {
      method: "GET",
      url: resolvePublicCatalogMediaCdnUrl(mediaDownloadSource),
      expiresAt: null,
      rangeRequests: false,
    } as const;

    return context.json({ mediaAsset: mediaDownloadSource.mediaAsset, download });
  });

  /**
   * Compatibility route for the URL every previously published snapshot embeds,
   * and the only public catalog media path that still opens a Postgres
   * connection. It redirects instead of proxying bytes, keeps the
   * published-and-not-delisted lookup on every request, and is never cached:
   * a package version that republishes its media changes which object this key
   * resolves to, and a delist has to stop resolving at once.
   */
  app.get("/catalog/package-versions/:packageVersionId/media-assets/:packageMediaKey/download", async (context) => {
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const packageMediaKey = parsePackageMediaKeyParam(context.req.param("packageMediaKey"));

    const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadFn(
      packageVersionId,
      packageMediaKey,
      resolveCatalogMediaCdnBaseUrlFn(),
    );
    const objectUrl = resolvePublicCatalogMediaCdnUrl(mediaDownloadSource);

    context.header("Cache-Control", "public, no-cache");
    return context.redirect(objectUrl, 302);
  });

  return app;
}
