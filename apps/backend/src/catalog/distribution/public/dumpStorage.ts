import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../../../observability/sentry";
import type { CatalogPublicSnapshot } from "../../types";

type CatalogDumpStorageConfig = Readonly<{
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

const maxS3AttemptCount = 3;
const catalogDumpObjectKeyPrefix = "catalog";
const latestCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/latest.json`;
const pointerCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/pointer.json`;
const catalogDumpContentType = "application/json; charset=utf-8";
const immutableCatalogDumpCacheControl = "public, max-age=31536000, immutable";
const revalidatedCatalogDumpCacheControl = "public, max-age=60";

let catalogDumpS3Client: S3Client | undefined;

function getCatalogDumpS3Client(): S3Client {
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

function getCatalogDumpStorageConfig(): CatalogDumpStorageConfig {
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

function formatS3ErrorSummary(error: unknown): string {
  const errorName = getS3ErrorName(error);
  const errorMessage = getS3ErrorMessage(error);
  const statusCode = getS3ErrorStatusCode(error);
  const statusSuffix = statusCode === null ? "" : ` status=${statusCode}`;
  return `${errorName}${statusSuffix}: ${errorMessage}`;
}

async function putCatalogDumpObjectWithRetries(params: Readonly<{
  observationScope: BackendObservationScope;
  bucketName: string;
  objectKey: string;
  body: string;
  cacheControl: string;
}>): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxS3AttemptCount; attempt += 1) {
    try {
      await getCatalogDumpS3Client().send(new PutObjectCommand({
        Bucket: params.bucketName,
        Key: params.objectKey,
        Body: params.body,
        ContentType: catalogDumpContentType,
        CacheControl: params.cacheControl,
      }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxS3AttemptCount) {
        break;
      }

      addBackendBreadcrumb({
        action: "catalog_dump_s3_retry",
        scope: params.observationScope,
        details: {
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

  throw new Error(
    `Failed to write the public catalog dump to s3://${params.bucketName}/${params.objectKey}: ${formatS3ErrorSummary(lastError)}`,
  );
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
    cacheControl: immutableCatalogDumpCacheControl,
  });
  await putCatalogDumpObjectWithRetries({
    observationScope,
    bucketName: config.bucketName,
    objectKey: latestCatalogDumpObjectKey,
    body,
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
