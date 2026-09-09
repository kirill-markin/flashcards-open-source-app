import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { BackendObservationScope } from "../../../../observability/sentry";
import { HttpError } from "../../../../shared/errors";
import {
  formatCatalogDumpS3ErrorSummary,
  getCatalogDumpS3Client,
  getCatalogDumpStorageConfig,
  runCatalogDumpS3OperationWithRetries,
  type CatalogDumpStorageConfig,
} from "./dumpStorage";

/** Alias object naming the immutable artifact `GET /v1/catalog` redirects to. */
export type CatalogDumpPointer = Readonly<{
  objectKey: string;
  url: string;
  generatedAt: string;
}>;

export const catalogDumpPointerUnavailableCode = "CATALOG_DUMP_POINTER_UNAVAILABLE";

const catalogDumpObjectKeyPrefix = "catalog";
const pointerCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/pointer.json`;
const immutableCatalogDumpObjectKeyPattern = new RegExp(
  `^${catalogDumpObjectKeyPrefix}/[0-9a-f]{64}\\.json$`,
  "u",
);

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
