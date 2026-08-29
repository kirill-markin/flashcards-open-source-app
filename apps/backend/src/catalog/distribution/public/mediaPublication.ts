/**
 * Publishes every public catalog media blob into the catalog dump bucket, so the
 * CDN that already serves the snapshot serves the blobs it will reference too.
 *
 * The snapshot is an immutable artifact written with a one-year `Cache-Control`
 * and embeds an absolute URL per media asset, so presigned S3 URLs cannot carry
 * public catalog media: `downloadUrlExpiresSeconds` is one hour and an hour-long
 * URL cannot live inside a year-immutable artifact. Workspace media is untouched
 * and keeps its presigned flow.
 *
 * Objects are keyed by the blob's own `sha256`, matching how the snapshot itself
 * is addressed. That deduplicates a blob shared across package versions and keeps
 * every object immutable: a changed blob is a different key, so no invalidation
 * is ever needed. The snapshot and the public catalog routes name these URLs, so
 * the key is public by design; nothing about the private blob bucket is.
 *
 * The pass is a full reconcile rather than an incremental one: it copies what is
 * missing and deletes what is no longer public, so delisting actually withdraws
 * the blob. It must complete fully or fail the whole dump run, because the
 * snapshot write that follows assumes every blob it references already exists.
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { DatabaseExecutor } from "../../../database";
import { getMediaAssetsStorageConfig } from "../../../mediaAssets/storage/config";
import { buildMediaBlobStorageKey } from "../../../mediaAssets/storageKeys";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../../../observability/sentry";
import { toSafeNumber } from "../../common";
import {
  buildCatalogMediaObjectKey,
  catalogMediaObjectKeyPrefix,
  isCatalogMediaSha256,
  isPublicCatalogMediaDeliverable,
} from "../../publicMediaDelivery";
import {
  formatCatalogDumpS3ErrorSummary,
  getCatalogDumpS3Client,
  getCatalogDumpStorageConfig,
  immutableCatalogDumpCacheControl,
  runCatalogDumpS3OperationWithRetries,
} from "./dumpStorage";

/**
 * Largest share of the published objects one pass may withdraw. A read that
 * returns a fraction of the catalog looks exactly like a catalog that shrank,
 * and the snapshot now links these objects, so a partial read regression would
 * break live media instead of going unnoticed. An ordinary delist withdraws the
 * blobs of one package version out of the whole public catalog and stays far
 * under this floor; anything above it fails the run for a human to look at.
 */
const maximumCatalogMediaWithdrawalFraction = 0.5;

export type CatalogPublicMediaBlob = Readonly<{
  sha256: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}>;

export type CatalogPublicMediaPublicationResult = Readonly<{
  bucketName: string;
  desiredObjectCount: number;
  copiedObjectCount: number;
  deletedObjectCount: number;
}>;

type CatalogPublicMediaBlobRow = Readonly<{
  sha256: string;
  storage_key: string;
  mime_type: string;
  size_bytes: string | number;
}>;

function createCatalogMediaCopySource(bucketName: string, storageKey: string): string {
  return `${bucketName}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function mapCatalogPublicMediaBlob(row: CatalogPublicMediaBlobRow): CatalogPublicMediaBlob {
  // The published key is derived from `sha256`, so a value that is not a plain
  // digest would decide an object key. Refuse it instead of publishing under it.
  if (
    isCatalogMediaSha256(row.sha256) === false
    || row.storage_key !== buildMediaBlobStorageKey(row.sha256)
  ) {
    throw new Error(
      `Published catalog media blob is outside private blob storage. sha256=${JSON.stringify(row.sha256)}`,
    );
  }

  return {
    sha256: row.sha256,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
  };
}

/**
 * Distinct blobs the public catalog exposes: package media on published, listed
 * versions of published, listed packages, plus published, listed collection
 * covers. The status predicates mirror `media.ts` and `collectionMedia.ts` so the
 * published set never differs from what those readers serve.
 */
export async function loadPublicCatalogMediaBlobsForPublicationInExecutor(
  executor: DatabaseExecutor,
): Promise<ReadonlyArray<CatalogPublicMediaBlob>> {
  const result = await executor.query<CatalogPublicMediaBlobRow>(
    [
      "SELECT",
      "media_blobs.sha256 AS sha256,",
      "media_blobs.storage_key AS storage_key,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = media_assets.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "UNION",
      "SELECT",
      "media_blobs.sha256 AS sha256,",
      "media_blobs.storage_key AS storage_key,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM catalog.collections AS collections",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = collections.cover_media_blob_id",
      "WHERE collections.cover_media_blob_id IS NOT NULL",
      "AND collections.status = 'published'",
      "AND collections.delisted_at IS NULL",
      "ORDER BY sha256 ASC",
    ].join(" "),
    [],
  );

  // The mime allowlist and size cap decide what the public catalog may serve at
  // all, so a blob it rejects is never published to the CDN either.
  return result.rows
    .map(mapCatalogPublicMediaBlob)
    .filter((blob: CatalogPublicMediaBlob) => isPublicCatalogMediaDeliverable({
      mimeType: blob.mimeType,
      sizeBytes: blob.sizeBytes,
    }));
}

async function listPublishedCatalogMediaObjectKeys(
  observationScope: BackendObservationScope,
  bucketName: string,
): Promise<Set<string>> {
  const publishedObjectKeys = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const requestContinuationToken = continuationToken;
    const response = await runCatalogDumpS3OperationWithRetries({
      operation: "list_objects",
      observationScope,
      bucketName,
      objectKey: catalogMediaObjectKeyPrefix,
      run: async () => getCatalogDumpS3Client().send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: catalogMediaObjectKeyPrefix,
        ContinuationToken: requestContinuationToken,
      })),
    });

    for (const object of response.Contents ?? []) {
      if (object.Key !== undefined) {
        publishedObjectKeys.add(object.Key);
      }
    }

    continuationToken = response.IsTruncated === true
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken !== undefined);

  return publishedObjectKeys;
}

async function copyCatalogMediaObject(params: Readonly<{
  observationScope: BackendObservationScope;
  dumpBucketName: string;
  mediaAssetsBucketName: string;
  objectKey: string;
  blob: CatalogPublicMediaBlob;
}>): Promise<void> {
  try {
    await runCatalogDumpS3OperationWithRetries({
      operation: "copy_object",
      observationScope: params.observationScope,
      bucketName: params.dumpBucketName,
      objectKey: params.objectKey,
      run: async () => getCatalogDumpS3Client().send(new CopyObjectCommand({
        Bucket: params.dumpBucketName,
        Key: params.objectKey,
        CopySource: createCatalogMediaCopySource(
          params.mediaAssetsBucketName,
          params.blob.storageKey,
        ),
        MetadataDirective: "REPLACE",
        ContentType: params.blob.mimeType,
        CacheControl: immutableCatalogDumpCacheControl,
      })),
    });
  } catch (error) {
    throw new Error(
      `Failed to publish public catalog media to s3://${params.dumpBucketName}/${params.objectKey}: ${formatCatalogDumpS3ErrorSummary(error)}`,
    );
  }
}

async function deleteCatalogMediaObject(params: Readonly<{
  observationScope: BackendObservationScope;
  dumpBucketName: string;
  objectKey: string;
}>): Promise<void> {
  try {
    await runCatalogDumpS3OperationWithRetries({
      operation: "delete_object",
      observationScope: params.observationScope,
      bucketName: params.dumpBucketName,
      objectKey: params.objectKey,
      run: async () => getCatalogDumpS3Client().send(new DeleteObjectCommand({
        Bucket: params.dumpBucketName,
        Key: params.objectKey,
      })),
    });
  } catch (error) {
    throw new Error(
      `Failed to withdraw public catalog media from s3://${params.dumpBucketName}/${params.objectKey}: ${formatCatalogDumpS3ErrorSummary(error)}`,
    );
  }
}

/**
 * Reconciles the `catalog/media/` prefix of the dump bucket against the blobs the
 * public catalog currently exposes.
 *
 * The desired set is read by the caller rather than here, so that it and the
 * snapshot come from one consistent read. A delist landing between two separate
 * reads would otherwise let this pass withdraw a blob the just-written snapshot
 * still describes, and the snapshot is cached for a year.
 *
 * Copies are server-side, so no blob bytes pass through this process. The pass is
 * deliberately not incremental or paginated: at the current scale one full pass
 * is far inside the dump function's timeout, and a full pass is what makes the
 * result independent of which run last succeeded.
 *
 * It refuses to act on a desired set that would withdraw more than
 * `maximumCatalogMediaWithdrawalFraction` of the published objects: a read that
 * lost rows reads exactly like a catalog that shrank, and withdrawing on it
 * would break media the published snapshots link.
 */
export async function publishPublicCatalogMediaToCatalogDumpBucket(
  observationScope: BackendObservationScope,
  desiredBlobs: ReadonlyArray<CatalogPublicMediaBlob>,
): Promise<CatalogPublicMediaPublicationResult> {
  const dumpBucketName = getCatalogDumpStorageConfig().bucketName;
  const mediaAssetsBucketName = getMediaAssetsStorageConfig().bucketName;
  const desiredObjectKeys = new Set<string>(
    desiredBlobs.map((blob: CatalogPublicMediaBlob) => buildCatalogMediaObjectKey(blob.sha256)),
  );
  const publishedObjectKeys = await listPublishedCatalogMediaObjectKeys(
    observationScope,
    dumpBucketName,
  );
  const withdrawableObjectKeys = [...publishedObjectKeys].filter((objectKey: string) => (
    desiredObjectKeys.has(objectKey) === false
  ));

  // A desired set that withdraws most of the prefix is far more likely a read
  // regression — a lost `backend_app` grant on the catalog tables, a predicate
  // bug — than a catalog that genuinely shed that much media at once. Fail the
  // run the same way a failed copy does instead of deleting.
  if (
    withdrawableObjectKeys.length
    > publishedObjectKeys.size * maximumCatalogMediaWithdrawalFraction
  ) {
    throw new Error(
      [
        `Refusing to withdraw ${withdrawableObjectKeys.length} of ${publishedObjectKeys.size} published public catalog media objects from s3://${dumpBucketName}/${catalogMediaObjectKeyPrefix}: the public catalog resolved ${desiredObjectKeys.size} desired blobs.`,
        "This fails the whole dump run, so the public pointer keeps serving the previous artifact and anything delisted since it stays published until an operator acts.",
        "Check first whether the catalog really shed that much media: a lost backend_app grant or a predicate bug reads exactly like this, and re-running fixes nothing on its own.",
        `If the withdrawal is correct, delete the surplus objects under that prefix by hand, in batches that leave each run below a ${maximumCatalogMediaWithdrawalFraction} share of what is still published, until a run reconciles the rest by itself.`,
      ].join(" "),
    );
  }

  let copiedObjectCount = 0;
  for (const blob of desiredBlobs) {
    const objectKey = buildCatalogMediaObjectKey(blob.sha256);
    if (publishedObjectKeys.has(objectKey)) {
      continue;
    }

    await copyCatalogMediaObject({
      observationScope,
      dumpBucketName,
      mediaAssetsBucketName,
      objectKey,
      blob,
    });
    // Two rows can address one blob, so record the copy to keep the pass from
    // writing the same object twice.
    publishedObjectKeys.add(objectKey);
    copiedObjectCount += 1;
  }

  let deletedObjectCount = 0;
  for (const objectKey of withdrawableObjectKeys) {
    await deleteCatalogMediaObject({ observationScope, dumpBucketName, objectKey });
    deletedObjectCount += 1;
  }

  addBackendBreadcrumb({
    action: "catalog_dump_media_published",
    scope: observationScope,
    details: {
      bucketName: dumpBucketName,
      desiredObjectCount: desiredObjectKeys.size,
      copiedObjectCount,
      deletedObjectCount,
    },
  });

  return {
    bucketName: dumpBucketName,
    desiredObjectCount: desiredObjectKeys.size,
    copiedObjectCount,
    deletedObjectCount,
  };
}
