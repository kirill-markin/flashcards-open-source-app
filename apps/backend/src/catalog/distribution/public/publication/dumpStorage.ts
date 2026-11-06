import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../../../../observability/sentry";
import type { CatalogBrowseIndex, CatalogPublicSnapshot } from "../../../types";

export type CatalogDumpStorageConfig = Readonly<{
  bucketName: string;
  cdnBaseUrl: string;
}>;

export type CatalogDumpWriteResult = Readonly<{
  bucketName: string;
  objectKey: string;
  sha256: string;
  generatedAt: string;
  byteLength: number;
}>;

export type CatalogBrowseIndexWriteResult = Readonly<{
  objectKey: string;
  sha256: string;
  deckCount: number;
  byteLength: number;
  gzipByteLength: number;
}>;

const maxS3AttemptCount = 3;
const catalogDumpObjectKeyPrefix = "catalog";
const latestCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/latest.json`;
const pointerCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/pointer.json`;
const catalogDumpContentType = "application/json; charset=utf-8";
export const immutableCatalogDumpCacheControl = "public, max-age=31536000, immutable";
const revalidatedCatalogDumpCacheControl = "public, max-age=60";
export const catalogBrowseIndexObjectKeyPrefix = `${catalogDumpObjectKeyPrefix}/browse-index`;
export const catalogBrowseIndexPointerObjectKey = `${catalogBrowseIndexObjectKeyPrefix}/pointer.json`;

let catalogDumpS3Client: S3Client | undefined;

export function getCatalogDumpS3Client(): S3Client {
  if (catalogDumpS3Client !== undefined) {
    return catalogDumpS3Client;
  }

  catalogDumpS3Client = new S3Client({});
  return catalogDumpS3Client;
}

function getRequiredCatalogDumpEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for public catalog dump storage.`);
  }

  return value.trim();
}

export function getCatalogDumpStorageConfig(): CatalogDumpStorageConfig {
  const cdnBaseUrl = getRequiredCatalogDumpEnv("CATALOG_DUMP_CDN_BASE_URL");
  return {
    bucketName: getRequiredCatalogDumpEnv("CATALOG_DUMP_S3_BUCKET_NAME"),
    cdnBaseUrl: cdnBaseUrl.endsWith("/") ? cdnBaseUrl.slice(0, -1) : cdnBaseUrl,
  };
}

function getS3ErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return null;
  }

  const metadata = (error as Readonly<{
    $metadata?: Readonly<{
      httpStatusCode?: unknown;
    }>;
  }>).$metadata;

  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function getS3ErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function getS3ErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatCatalogDumpS3ErrorSummary(error: unknown): string {
  const errorName = getS3ErrorName(error);
  const errorMessage = getS3ErrorMessage(error);
  const statusCode = getS3ErrorStatusCode(error);
  const statusSuffix = statusCode === null ? "" : ` status=${statusCode}`;
  return `${errorName}${statusSuffix}: ${errorMessage}`;
}

export async function runCatalogDumpS3OperationWithRetries<Result>(params: Readonly<{
  operation: "get_object" | "put_object" | "list_objects" | "copy_object" | "delete_object";
  observationScope: BackendObservationScope;
  bucketName: string;
  objectKey: string;
  run: () => Promise<Result>;
}>): Promise<Result> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxS3AttemptCount; attempt += 1) {
    try {
      return await params.run();
    } catch (error) {
      lastError = error;
      if (attempt === maxS3AttemptCount) {
        break;
      }

      addBackendBreadcrumb({
        action: "catalog_dump_s3_retry",
        scope: params.observationScope,
        details: {
          operation: params.operation,
          attempt,
          maxAttempts: maxS3AttemptCount,
          bucketName: params.bucketName,
          objectKey: params.objectKey,
          statusCode: getS3ErrorStatusCode(error),
          errorClass: getS3ErrorName(error),
          errorMessage: getS3ErrorMessage(error),
        },
      });
    }
  }

  if (lastError === null) {
    throw new Error(
      `S3 ${params.operation} failed without an error for s3://${params.bucketName}/${params.objectKey}.`,
    );
  }

  throw lastError;
}

async function putCatalogDumpObjectWithRetries(params: Readonly<{
  observationScope: BackendObservationScope;
  bucketName: string;
  objectKey: string;
  body: string | Uint8Array;
  contentEncoding: "gzip" | undefined;
  cacheControl: string;
}>): Promise<void> {
  try {
    await runCatalogDumpS3OperationWithRetries({
      operation: "put_object",
      observationScope: params.observationScope,
      bucketName: params.bucketName,
      objectKey: params.objectKey,
      run: async () => getCatalogDumpS3Client().send(new PutObjectCommand({
        Bucket: params.bucketName,
        Key: params.objectKey,
        Body: params.body,
        ContentType: catalogDumpContentType,
        ContentEncoding: params.contentEncoding,
        CacheControl: params.cacheControl,
      })),
    });
  } catch (error) {
    throw new Error(
      `Failed to write the public catalog dump to s3://${params.bucketName}/${params.objectKey}: ${formatCatalogDumpS3ErrorSummary(error)}`,
    );
  }
}

/**
 * Publishes one snapshot as an immutable content-addressed object plus the
 * `latest.json` and `pointer.json` aliases. The immutable object is written
 * first so a pointer never names an object that does not exist yet.
 */
export async function writeCatalogDumpToS3(
  observationScope: BackendObservationScope,
  snapshot: CatalogPublicSnapshot,
): Promise<CatalogDumpWriteResult> {
  const config = getCatalogDumpStorageConfig();
  const body = JSON.stringify(snapshot);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const objectKey = `${catalogDumpObjectKeyPrefix}/${sha256}.json`;

  await putCatalogDumpObjectWithRetries({
    observationScope,
    bucketName: config.bucketName,
    objectKey,
    body,
    contentEncoding: undefined,
    cacheControl: immutableCatalogDumpCacheControl,
  });
  await putCatalogDumpObjectWithRetries({
    observationScope,
    bucketName: config.bucketName,
    objectKey: latestCatalogDumpObjectKey,
    body,
    contentEncoding: undefined,
    cacheControl: revalidatedCatalogDumpCacheControl,
  });
  await putCatalogDumpObjectWithRetries({
    observationScope,
    bucketName: config.bucketName,
    objectKey: pointerCatalogDumpObjectKey,
    body: JSON.stringify({
      objectKey,
      url: `${config.cdnBaseUrl}/${objectKey}`,
      generatedAt: snapshot.generatedAt,
    }),
    contentEncoding: undefined,
    cacheControl: revalidatedCatalogDumpCacheControl,
  });

  return {
    bucketName: config.bucketName,
    objectKey,
    sha256,
    generatedAt: snapshot.generatedAt,
    byteLength: Buffer.byteLength(body, "utf8"),
  };
}

/**
 * Publishes the browse index as an immutable gzip-encoded object plus the
 * `pointer.json` alias native clients revalidate against. `sha256` is over the
 * uncompressed JSON, the bytes a client holds after decoding, and the immutable
 * object is written first so the pointer never names a missing object.
 */
export async function writeCatalogBrowseIndexToS3(
  observationScope: BackendObservationScope,
  browseIndex: CatalogBrowseIndex,
): Promise<CatalogBrowseIndexWriteResult> {
  const config = getCatalogDumpStorageConfig();
  const body = JSON.stringify(browseIndex);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const objectKey = `${catalogBrowseIndexObjectKeyPrefix}/${sha256}.json`;
  const gzipBody = gzipSync(body);

  await putCatalogDumpObjectWithRetries({
    observationScope,
    bucketName: config.bucketName,
    objectKey,
    body: gzipBody,
    contentEncoding: "gzip",
    cacheControl: immutableCatalogDumpCacheControl,
  });
  await putCatalogDumpObjectWithRetries({
    observationScope,
    bucketName: config.bucketName,
    objectKey: catalogBrowseIndexPointerObjectKey,
    body: JSON.stringify({
      url: `${config.cdnBaseUrl}/${objectKey}`,
      sha256,
      generatedAt: browseIndex.generatedAt,
    }),
    contentEncoding: undefined,
    cacheControl: revalidatedCatalogDumpCacheControl,
  });

  return {
    objectKey,
    sha256,
    deckCount: browseIndex.decks.length,
    byteLength: Buffer.byteLength(body, "utf8"),
    gzipByteLength: gzipBody.byteLength,
  };
}
