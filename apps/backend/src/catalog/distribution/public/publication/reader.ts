import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { BackendObservationScope } from "../../../../observability/sentry";
import { HttpError } from "../../../../shared/errors";
import {
  catalogBrowseIndexObjectKeyPrefix,
  catalogBrowseIndexPointerObjectKey,
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

/** Alias object `GET /v1/catalog/browse-index` returns verbatim to native clients. */
export type CatalogBrowseIndexPointer = Readonly<{
  url: string;
  sha256: string;
  generatedAt: string;
}>;

export const catalogDumpPointerUnavailableCode = "CATALOG_DUMP_POINTER_UNAVAILABLE";
export const catalogBrowseIndexUnavailableCode = "CATALOG_BROWSE_INDEX_UNAVAILABLE";

const catalogDumpObjectKeyPrefix = "catalog";
const pointerCatalogDumpObjectKey = `${catalogDumpObjectKeyPrefix}/pointer.json`;
const immutableCatalogDumpObjectKeyPattern = new RegExp(
  `^${catalogDumpObjectKeyPrefix}/[0-9a-f]{64}\\.json$`,
  "u",
);
const sha256HexPattern = /^[0-9a-f]{64}$/u;

function parsePointerJsonObject(bodyText: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(bodyText);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Pointer must be a JSON object.");
  }

  return parsed as Readonly<Record<string, unknown>>;
}

function parseCatalogDumpPointerJson(
  bodyText: string,
  cdnBaseUrl: string,
): CatalogDumpPointer {
  const { objectKey, url, generatedAt } = parsePointerJsonObject(bodyText);
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

function parseCatalogBrowseIndexPointerJson(
  bodyText: string,
  cdnBaseUrl: string,
): CatalogBrowseIndexPointer {
  const { url, sha256, generatedAt } = parsePointerJsonObject(bodyText);
  if (typeof sha256 !== "string" || !sha256HexPattern.test(sha256)) {
    throw new Error("Public catalog browse index pointer sha256 is not a hex SHA-256 digest.");
  }
  if (typeof generatedAt !== "string" || generatedAt === "") {
    throw new Error("Public catalog browse index pointer is missing generatedAt.");
  }

  // Clients fetch this URL, so it must be the content-addressed object on the
  // configured distribution that the digest names.
  const expectedUrl = `${cdnBaseUrl}/${catalogBrowseIndexObjectKeyPrefix}/${sha256}.json`;
  if (url !== expectedUrl) {
    throw new Error(
      `Public catalog browse index pointer url does not name ${expectedUrl}.`,
    );
  }

  return { url, sha256, generatedAt };
}

/**
 * Reads one alias object naming a current immutable catalog artifact.
 *
 * The routes serve the pointer instead of recomputing the artifact, so an
 * unreadable pointer has to fail loudly as a typed 503. Recomputing per request
 * is exactly the load the artifact pipeline removed, and reintroducing it as a
 * fallback would bring back the API Gateway timeouts it was built to stop.
 */
async function loadCatalogPointerFromS3<Pointer>(params: Readonly<{
  observationScope: BackendObservationScope;
  pointerName: string;
  pointerObjectKey: string;
  unavailableCode: string;
  parse: (bodyText: string, cdnBaseUrl: string) => Pointer;
}>): Promise<Pointer> {
  let config: CatalogDumpStorageConfig | null = null;

  try {
    const resolvedConfig = getCatalogDumpStorageConfig();
    config = resolvedConfig;
    const response = await runCatalogDumpS3OperationWithRetries({
      operation: "get_object",
      observationScope: params.observationScope,
      bucketName: resolvedConfig.bucketName,
      objectKey: params.pointerObjectKey,
      run: async () => getCatalogDumpS3Client().send(new GetObjectCommand({
        Bucket: resolvedConfig.bucketName,
        Key: params.pointerObjectKey,
      })),
    });

    if (response.Body === undefined) {
      throw new Error(
        `S3 returned an empty body for s3://${resolvedConfig.bucketName}/${params.pointerObjectKey}`,
      );
    }

    return params.parse(
      await response.Body.transformToString(),
      resolvedConfig.cdnBaseUrl,
    );
  } catch (error) {
    const location = config === null
      ? "public catalog dump storage"
      : `s3://${config.bucketName}/${params.pointerObjectKey}`;
    throw new HttpError(
      503,
      `${params.pointerName} is unavailable from ${location}: ${formatCatalogDumpS3ErrorSummary(error)}`,
      params.unavailableCode,
    );
  }
}

export async function loadCatalogDumpPointerFromS3(
  observationScope: BackendObservationScope,
): Promise<CatalogDumpPointer> {
  return loadCatalogPointerFromS3({
    observationScope,
    pointerName: "Public catalog dump pointer",
    pointerObjectKey: pointerCatalogDumpObjectKey,
    unavailableCode: catalogDumpPointerUnavailableCode,
    parse: parseCatalogDumpPointerJson,
  });
}

export async function loadCatalogBrowseIndexPointerFromS3(
  observationScope: BackendObservationScope,
): Promise<CatalogBrowseIndexPointer> {
  return loadCatalogPointerFromS3({
    observationScope,
    pointerName: "Public catalog browse index pointer",
    pointerObjectKey: catalogBrowseIndexPointerObjectKey,
    unavailableCode: catalogBrowseIndexUnavailableCode,
    parse: parseCatalogBrowseIndexPointerJson,
  });
}
