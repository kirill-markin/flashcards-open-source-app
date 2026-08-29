import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import type { CatalogPublicSnapshot } from "../../types";

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

/** Alias object naming the immutable artifact `GET /v1/catalog` redirects to. */
export type CatalogDumpPointer = Readonly<{
  objectKey: string;
  url: string;
  generatedAt: string;
}>;

export const catalogDumpPointerUnavailableCode = "CATALOG_DUMP_POINTER_UNAVAILABLE";

const maxS3AttemptCount = 3;
const catalogDumpObjectKeyPrefix = "catalog";
const latestCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/latest.json`;
const pointerCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/pointer.json`;
const immutableCatalogDumpObjectKeyPattern = new RegExp(
  `^${catalogDumpObjectKeyPrefix}/[0-9a-f]{64}\\.json$`,
  "u",
);
const catalogDumpContentType = "application/json; charset=utf-8";
export const immutableCatalogDumpCacheControl = "public, max-age=31536000, immutable";
const revalidatedCatalogDumpCacheControl = "public, max-age=60";

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
  body: string;
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
        CacheControl: params.cacheControl,
      })),
    });
  } catch (error) {
    throw new Error(
      `Failed to write the public catalog dump to s3://${params.bucketName}/${params.objectKey}: ${formatCatalogDumpS3ErrorSummary(error)}`,
    );
  }
}

function parseCatalogDumpPointerJson(
  bodyText: string,
  cdnBaseUrl: string,
): CatalogDumpPointer {
  const parsed: unknown = JSON.parse(bodyText);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Public catalog dump pointer must be a JSON object.");
  }

  const { objectKey, url, generatedAt } = parsed as Readonly<{
    objectKey?: unknown;
    url?: unknown;
    generatedAt?: unknown;
  }>;
  // The route turns objectKey into a Location header, so it is held to the key
  // shape the builder writes. Without this a control character in the key would
  // reach header validation and fail the request as a 500 instead of this 503.
  if (typeof objectKey !== "string" || !immutableCatalogDumpObjectKeyPattern.test(objectKey)) {
    throw new Error(
      `Public catalog dump pointer objectKey does not name an immutable ${catalogDumpObjectKeyPrefix} artifact.`,
    );
  }
  if (typeof generatedAt !== "string" || generatedAt === "") {
    throw new Error("Public catalog dump pointer is missing generatedAt.");
  }
  if (typeof url !== "string" || url === "") {
    throw new Error("Public catalog dump pointer is missing url.");
  }

  // The route sends clients to this URL, so a pointer that names anything other
  // than the configured distribution is treated as unreadable instead of being
  // turned into an open redirect.
  if (url !== `${cdnBaseUrl}/${objectKey}`) {
    throw new Error(
      `Public catalog dump pointer url does not name an object on ${cdnBaseUrl}.`,
    );
  }

  return { objectKey, url, generatedAt };
}

function createCatalogDumpPointerUnavailableError(
  config: CatalogDumpStorageConfig | null,
  error: unknown,
): HttpError {
  const location = config === null
    ? "public catalog dump storage"
    : `s3://${config.bucketName}/${pointerCatalogDumpObjectKey}`;
  return new HttpError(
    503,
    `Public catalog dump pointer is unavailable from ${location}: ${formatCatalogDumpS3ErrorSummary(error)}`,
    catalogDumpPointerUnavailableCode,
  );
}

/**
 * Reads the alias object naming the current immutable catalog artifact.
 *
 * `GET /v1/catalog` redirects to `url` instead of recomputing the snapshot, so
 * an unreadable pointer has to fail loudly. Recomputing per request is exactly
 * the load the artifact pipeline removed, and reintroducing it as a fallback
 * would bring back the API Gateway timeouts it was built to stop.
 */
export async function loadCatalogDumpPointerFromS3(
  observationScope: BackendObservationScope,
): Promise<CatalogDumpPointer> {
  let config: CatalogDumpStorageConfig | null = null;

  try {
    const resolvedConfig = getCatalogDumpStorageConfig();
    config = resolvedConfig;
    const response = await runCatalogDumpS3OperationWithRetries({
      operation: "get_object",
      observationScope,
      bucketName: resolvedConfig.bucketName,
      objectKey: pointerCatalogDumpObjectKey,
      run: async () => getCatalogDumpS3Client().send(new GetObjectCommand({
        Bucket: resolvedConfig.bucketName,
        Key: pointerCatalogDumpObjectKey,
      })),
    });

    if (response.Body === undefined) {
      throw new Error(
        `S3 returned an empty body for s3://${resolvedConfig.bucketName}/${pointerCatalogDumpObjectKey}`,
      );
    }

    return parseCatalogDumpPointerJson(
      await response.Body.transformToString(),
      resolvedConfig.cdnBaseUrl,
    );
  } catch (error) {
    throw createCatalogDumpPointerUnavailableError(config, error);
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
