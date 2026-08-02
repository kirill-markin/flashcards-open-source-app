import { Hono } from "hono";
import {
  listPublicCatalogPackages,
  loadPublicCatalogSnapshot,
  loadPublicCatalogPackageDetail,
  loadPublicCatalogPackageMediaForDownload,
  loadPublicCatalogPackageVersionCardPreview,
} from "../catalog";
import {
  isUnsafePublicPackageMediaKey,
  normalizePackageMediaKey,
  normalizeSlug,
} from "../catalog/common";
import {
  getPublicCatalogMediaDeliveryIssue,
  maximumPublicCatalogMediaDownloadBytes,
} from "../catalog/publicMediaDelivery";
import type {
  CatalogPublicPackageCardPreview,
  CatalogPublicPackageDetail,
  CatalogPublicPackageListInput,
  CatalogPublicPackageMediaDownloadSource,
  CatalogPublicPackageSummary,
  CatalogPublicSnapshot,
} from "../catalog/types";
import {
  loadMediaAssetObjectBytes,
  type LoadedMediaAssetObjectBytes,
  type LoadMediaAssetObjectBytesInput,
} from "../mediaAssets/storage";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../observability/sentry";
import type { AppEnv } from "../server/app";
import { expectUuidString } from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import {
  getPublicApiBaseUrl,
  getPublicAppBaseUrl,
} from "../shared/publicUrls";

type CatalogPublicRoutesOptions = Readonly<{
  loadPublicCatalogSnapshotFn?: (
    publicApiBaseUrl: string,
    publicAppBaseUrl: string,
  ) => Promise<CatalogPublicSnapshot>;
  listPublicCatalogPackagesFn?: (
    input: CatalogPublicPackageListInput,
  ) => Promise<ReadonlyArray<CatalogPublicPackageSummary>>;
  loadPublicCatalogPackageDetailFn?: (packageSlug: string) => Promise<CatalogPublicPackageDetail>;
  loadPublicCatalogPackageVersionCardPreviewFn?: (
    input: Readonly<{ packageVersionId: string; limit: number }>,
  ) => Promise<ReadonlyArray<CatalogPublicPackageCardPreview>>;
  loadPublicCatalogPackageMediaForDownloadFn?: (
    packageVersionId: string,
    packageMediaKey: string,
  ) => Promise<CatalogPublicPackageMediaDownloadSource>;
  loadMediaAssetObjectBytesFn?: (
    input: LoadMediaAssetObjectBytesInput,
  ) => Promise<LoadedMediaAssetObjectBytes>;
}>;

const defaultPackageListLimit = 50;
const defaultCardPreviewLimit = 25;
const maximumPublicCatalogLimit = 100;

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

function createBackendDownloadUrl(
  requestUrl: string,
  packageVersionId: string,
  packageMediaKey: string,
): string {
  return [
    getPublicApiBaseUrl(requestUrl),
    "catalog",
    "package-versions",
    packageVersionId,
    "media-assets",
    packageMediaKey,
    "download",
  ].join("/");
}

function assertPublicCatalogMediaDownloadSupported(
  mediaDownloadSource: CatalogPublicPackageMediaDownloadSource,
): void {
  const issue = getPublicCatalogMediaDeliveryIssue({
    mimeType: mediaDownloadSource.mediaAsset.mimeType,
    sizeBytes: mediaDownloadSource.mediaAsset.sizeBytes,
  });
  if (issue === null) {
    return;
  }

  if (issue.reason === "too_large") {
    // TODO: Route public package media through CDN or streaming delivery before raising this proxy cap.
    throw new HttpError(
      413,
      [
        "Public catalog package media is too large for backend proxy download.",
        `sizeBytes=${mediaDownloadSource.mediaAsset.sizeBytes}`,
        `maxBytes=${maximumPublicCatalogMediaDownloadBytes}`,
      ].join(" "),
      "CATALOG_PUBLIC_MEDIA_DOWNLOAD_TOO_LARGE",
    );
  }

  throw new HttpError(
    415,
    `Public catalog package media type is not supported for backend proxy download. mimeType=${mediaDownloadSource.mediaAsset.mimeType}`,
    "CATALOG_PUBLIC_MEDIA_DOWNLOAD_UNSUPPORTED_TYPE",
  );
}

export function createCatalogPublicRoutes(options: CatalogPublicRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadPublicCatalogSnapshotFn = options.loadPublicCatalogSnapshotFn
    ?? loadPublicCatalogSnapshot;
  const listPublicCatalogPackagesFn = options.listPublicCatalogPackagesFn ?? listPublicCatalogPackages;
  const loadPublicCatalogPackageDetailFn = options.loadPublicCatalogPackageDetailFn
    ?? loadPublicCatalogPackageDetail;
  const loadPublicCatalogPackageVersionCardPreviewFn = options.loadPublicCatalogPackageVersionCardPreviewFn
    ?? loadPublicCatalogPackageVersionCardPreview;
  const loadPublicCatalogPackageMediaForDownloadFn = options.loadPublicCatalogPackageMediaForDownloadFn
    ?? loadPublicCatalogPackageMediaForDownload;
  const loadMediaAssetObjectBytesFn = options.loadMediaAssetObjectBytesFn ?? loadMediaAssetObjectBytes;

  app.get("/catalog", async (context) => context.json(await loadPublicCatalogSnapshotFn(
    getPublicApiBaseUrl(context.req.url),
    getPublicAppBaseUrl(context.req.url),
  )));

  app.get("/catalog/packages", async (context) => {
    const catalogPackages = await listPublicCatalogPackagesFn({
      limit: parseLimitQuery(context.req.query("limit"), "limit", defaultPackageListLimit),
      search: parseOptionalQueryString(context.req.query("q"), "q"),
      languageTag: parseOptionalQueryString(context.req.query("languageTag"), "languageTag"),
      topicTag: parseOptionalQueryString(context.req.query("topicTag"), "topicTag"),
    });

    return context.json({ catalogPackages });
  });

  app.get("/catalog/packages/:packageSlug", async (context) => {
    const packageSlug = parsePackageSlugParam(context.req.param("packageSlug"));
    const catalogPackage = await loadPublicCatalogPackageDetailFn(packageSlug);
    return context.json({ catalogPackage });
  });

  app.get("/catalog/package-versions/:packageVersionId/cards", async (context) => {
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const cards = await loadPublicCatalogPackageVersionCardPreviewFn({
      packageVersionId,
      limit: parseLimitQuery(context.req.query("limit"), "limit", defaultCardPreviewLimit),
    });
    return context.json({ packageVersionId, cards });
  });

  app.get("/catalog/package-versions/:packageVersionId/media-assets/:packageMediaKey/download-url", async (context) => {
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const packageMediaKey = parsePackageMediaKeyParam(context.req.param("packageMediaKey"));

    const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadFn(
      packageVersionId,
      packageMediaKey,
    );
    assertPublicCatalogMediaDownloadSupported(mediaDownloadSource);
    const download = {
      method: "GET",
      url: createBackendDownloadUrl(context.req.url, packageVersionId, packageMediaKey),
      expiresAt: null,
      rangeRequests: false,
    } as const;

    return context.json({ mediaAsset: mediaDownloadSource.mediaAsset, download });
  });

  app.get("/catalog/package-versions/:packageVersionId/media-assets/:packageMediaKey/download", async (context) => {
    const requestId = context.get("requestId");
    const packageVersionId = parsePackageVersionIdParam(context.req.param("packageVersionId"));
    const packageMediaKey = parsePackageMediaKeyParam(context.req.param("packageMediaKey"));
    const scope = createCatalogPublicScope(
      requestId,
      context.req.path,
      context.req.method,
      context.get("clientAppVersion"),
      context.get("clientPlatform"),
    );

    const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadFn(
      packageVersionId,
      packageMediaKey,
    );
    assertPublicCatalogMediaDownloadSupported(mediaDownloadSource);
    const objectBytes = await loadMediaAssetObjectBytesFn({
      workspaceId: packageVersionId,
      mediaAssetId: mediaDownloadSource.mediaAsset.packageMediaKey,
      storageKey: mediaDownloadSource.storageKey,
      mimeType: mediaDownloadSource.mediaAsset.mimeType,
      sizeBytes: mediaDownloadSource.mediaAsset.sizeBytes,
      sha256: mediaDownloadSource.sha256,
      maxByteSize: maximumPublicCatalogMediaDownloadBytes,
      observationScope: scope,
    });

    context.header("Content-Type", objectBytes.mimeType ?? mediaDownloadSource.mediaAsset.mimeType);
    context.header("Content-Length", objectBytes.sizeBytes.toString());
    context.header("Cache-Control", "public, max-age=3600");
    return context.body(new Uint8Array(objectBytes.bytes), 200);
  });

  return app;
}
