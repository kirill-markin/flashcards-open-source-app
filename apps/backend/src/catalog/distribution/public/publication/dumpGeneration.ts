import { unsafeRepeatableReadReadOnlyTransaction } from "../../../../database/core";
import { parsePublicOrigin } from "../../../../shared/publicUrls";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../../../../observability/sentry";
import { loadPublicCatalogSnapshotInExecutor } from "../snapshot";
import { buildCatalogBrowseIndex } from "./browseIndex";
import {
  getCatalogDumpStorageConfig,
  writeCatalogBrowseIndexToS3,
  writeCatalogDumpToS3,
  type CatalogDumpWriteResult,
} from "./dumpStorage";
import {
  loadPublicCatalogMediaBlobsForPublicationInExecutor,
  publishPublicCatalogMediaToCatalogDumpBucket,
} from "./mediaPublication";

function getRequiredCatalogDumpEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for the public catalog dump.`);
  }

  return value.trim();
}

/**
 * Builds the snapshot the public catalog dump publishes. The builder runs without
 * an HTTP request, so both public base URLs come from the environment instead of
 * the request URL the `GET /v1/catalog` route resolves them from.
 *
 * The snapshot and the media set it references are read in one transaction. The
 * snapshot names a CDN object per media asset and is cached for a year, so a
 * delist landing between two separate reads would let the reconcile withdraw a
 * blob the snapshot being written still links.
 *
 * Media blobs are reconciled onto the CDN before the snapshot is written, and a
 * failed reconcile fails the whole run, so a published snapshot never precedes
 * the media objects it references.
 *
 * The browse index is derived from the same snapshot and written only after the
 * full dump, so an index failure fails the run without withholding the dump.
 */
export async function generateAndWriteCatalogDump(
  observationScope: BackendObservationScope,
): Promise<CatalogDumpWriteResult> {
  const configuredApiBaseUrl = getRequiredCatalogDumpEnv("PUBLIC_API_BASE_URL");
  const publicApiBaseUrl = configuredApiBaseUrl.endsWith("/")
    ? configuredApiBaseUrl.slice(0, -1)
    : configuredApiBaseUrl;
  const publicAppBaseUrl = parsePublicOrigin(
    getRequiredCatalogDumpEnv("PUBLIC_APP_BASE_URL"),
    "PUBLIC_APP_BASE_URL",
  );
  const catalogMediaCdnBaseUrl = getCatalogDumpStorageConfig().cdnBaseUrl;
  const generatedAt = new Date().toISOString();
  const { snapshot, mediaBlobs } = await unsafeRepeatableReadReadOnlyTransaction(
    async (executor) => {
      const loadedSnapshot = await loadPublicCatalogSnapshotInExecutor(executor, {
        publicApiBaseUrl,
        publicAppBaseUrl,
        catalogMediaCdnBaseUrl,
        generatedAt,
      });
      const loadedMediaBlobs = await loadPublicCatalogMediaBlobsForPublicationInExecutor(executor);
      return { snapshot: loadedSnapshot, mediaBlobs: loadedMediaBlobs };
    },
  );

  await publishPublicCatalogMediaToCatalogDumpBucket(observationScope, mediaBlobs);
  const dumpResult = await writeCatalogDumpToS3(observationScope, snapshot);

  try {
    const browseIndexResult = await writeCatalogBrowseIndexToS3(
      observationScope,
      buildCatalogBrowseIndex(snapshot),
    );
    addBackendBreadcrumb({
      action: "catalog_browse_index_generated",
      scope: observationScope,
      details: {
        objectKey: browseIndexResult.objectKey,
        sha256: browseIndexResult.sha256,
        deckCount: browseIndexResult.deckCount,
        byteLength: browseIndexResult.byteLength,
        gzipByteLength: browseIndexResult.gzipByteLength,
      },
    });
  } catch (error) {
    throw new Error(
      `Public catalog dump ${dumpResult.objectKey} was published, but its browse index was not: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return dumpResult;
}
