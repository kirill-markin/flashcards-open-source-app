import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { replaceCatalogCollectionCoverInExecutor } from "../../../catalog/authoring/media/collectionCovers";
import { replaceCatalogPackageDraftCoverInExecutor } from "../../../catalog/authoring/media/draftMedia";
import {
  transactionWithWorkspaceScope,
} from "../../../database";
import { unsafeTransaction } from "../../../database/unsafe";
import {
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import {
  claimNextMediaBlobCleanup,
  type MediaBlobCleanupClaim,
} from "./repository";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../../storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion } from "../../types";

const deadlineOffsetMs = 30_000;
const imageJpegCatalogCoverMediaBlobNormalizationVersion =
  "image-jpeg-catalog-cover-v1";
type MultipartWriterAttemptRow = Readonly<{
  attempt_status: string;
  reservation_token: string | null;
  normalization_version: string | null;
}>;

function createSha256(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function deadlineAtMs(): number {
  return Date.now() + deadlineOffsetMs;
}

function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

async function claimCandidate(
  token: string,
): Promise<MediaBlobCleanupClaim | null> {
  return claimNextMediaBlobCleanup(token, 60_000, deadlineAtMs());
}

test("catalog image admission stays fenced across reverse-SHA package and collection cover replacement", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const firstCoverSha256 = createSha256();
    const secondCoverSha256 = createSha256();
    const [replacementSha256, attachedSha256] = firstCoverSha256 < secondCoverSha256
      ? [firstCoverSha256, secondCoverSha256] as const
      : [secondCoverSha256, firstCoverSha256] as const;
    const abandonedSha256 = createSha256();
    const sha256s = [attachedSha256, abandonedSha256, replacementSha256];
    const authorId = randomUUID();
    const packageId = randomUUID();
    const collectionId = randomUUID();
    const packageMediaAssetId = randomUUID();
    const mediaBlobId = randomUUID();
    const replacementMediaBlobId = randomUUID();
    const slug = randomUUID();
    const storageKey = (sha256: string) => buildMediaBlobStorageKey(sha256);
    try {
      await fixture.ownerPool.query(
        "INSERT INTO catalog.authors(author_id,slug,display_name) VALUES($1,$2,'Image integration')",
        [authorId, `image-author-${slug}`],
      );
      await fixture.ownerPool.query(
        `INSERT INTO catalog.packages(
           package_id,author_id,slug,title,summary,description,
           language_tags,topic_tags,license
         ) VALUES($1,$2,$3,'Images','Summary','Description',ARRAY['en'],ARRAY['test'],'CC-BY-4.0')`,
        [packageId, authorId, `image-package-${slug}`],
      );
      const admissionParams = (
        sha256: string,
        normalizationVersion: string,
      ) => [
        sha256, storageKey(sha256), "image/jpeg", 42,
        normalizationVersion, 3_600_000,
      ];
      const admitted = await fixture.runtimePool.query<{
        normalization_version: string;
      }>(
        "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
        admissionParams(
          attachedSha256,
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        ),
      );
      assert.equal(
        admitted.rows[0]?.normalization_version,
        imageJpegCatalogCoverMediaBlobNormalizationVersion,
      );
      await fixture.runtimePool.query(
        `INSERT INTO content.media_blobs(
           media_blob_id,sha256,mime_type,size_bytes,storage_key,
           normalization_version
         ) VALUES($1,$2,'image/jpeg',42,$3,$4)`,
        [mediaBlobId, attachedSha256, storageKey(attachedSha256),
          imageJpegCatalogCoverMediaBlobNormalizationVersion],
      );
      await fixture.runtimePool.query(
        `INSERT INTO catalog.package_media_assets(
           package_media_asset_id,package_id,package_version_id,
           package_media_key,media_blob_id
         ) VALUES($1,$2,NULL,'cover',$3)`,
        [packageMediaAssetId, packageId, mediaBlobId],
      );
      const replayedAdmission = await fixture.runtimePool.query<{
        normalization_version: string;
      }>(
        "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
        admissionParams(
          attachedSha256,
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        ),
      );
      assert.equal(
        replayedAdmission.rows[0]?.normalization_version,
        imageJpegCatalogCoverMediaBlobNormalizationVersion,
      );
      assert.equal((await fixture.ownerPool.query<{ fenced: boolean }>(
        "SELECT cleanup_eligible_at IS NULL AS fenced FROM content.media_blob_lifecycles WHERE sha256=$1",
        [attachedSha256],
      )).rows[0]?.fenced, true);
      assert.equal((await fixture.runtimePool.query<{ scheduled: boolean }>(
        "SELECT content.schedule_media_blob_cleanup($1,$2) AS scheduled",
        [mediaBlobId, 1],
      )).rows[0]?.scheduled, false);

      await fixture.runtimePool.query(
        "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
        admissionParams(
          abandonedSha256,
          imageJpegCardMediaBlobNormalizationVersion,
        ),
      );
      const reusedAdmission = await fixture.runtimePool.query<{
        normalization_version: string;
      }>(
        "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
        admissionParams(
          abandonedSha256,
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        ),
      );
      assert.equal(
        reusedAdmission.rows[0]?.normalization_version,
        imageJpegCardMediaBlobNormalizationVersion,
      );
      await assert.rejects(
        fixture.runtimePool.query(
          "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
          [abandonedSha256, storageKey(abandonedSha256), "image/jpeg", 43,
            imageJpegCardMediaBlobNormalizationVersion, 3_600_000],
        ),
        (error: unknown) => hasPostgresCode(error, "23514"),
      );
      assert.equal((await fixture.ownerPool.query<{ delayed: boolean }>(
        "SELECT cleanup_eligible_at>clock_timestamp() AS delayed FROM content.media_blob_lifecycles WHERE sha256=$1",
        [abandonedSha256],
      )).rows[0]?.delayed, true);
      await fixture.ownerPool.query(
        "UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=clock_timestamp()-interval '1 second' WHERE sha256=$1",
        [abandonedSha256],
      );
      assert.equal((await claimCandidate(randomUUID()))?.sha256, abandonedSha256);
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_cleanup_attempts WHERE sha256=$1",
        [abandonedSha256],
      );
      await fixture.ownerPool.query(
        "UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=NULL,cleanup_lease_token=NULL,cleanup_lease_expires_at=NULL WHERE sha256=$1",
        [abandonedSha256],
      );

      await fixture.runtimePool.query(
        "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
        admissionParams(
          replacementSha256,
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        ),
      );
      await fixture.runtimePool.query(
        `INSERT INTO content.media_blobs(
           media_blob_id,sha256,mime_type,size_bytes,storage_key,
           normalization_version
         ) VALUES($1,$2,'image/jpeg',42,$3,$4)`,
        [
          replacementMediaBlobId,
          replacementSha256,
          storageKey(replacementSha256),
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        ],
      );
      assert.ok(replacementSha256 < attachedSha256);
      const replacedPackageCover = await unsafeTransaction(
        (executor) => replaceCatalogPackageDraftCoverInExecutor(
          executor,
          packageId,
          replacementMediaBlobId,
          null,
          null,
          null,
        ),
      );
      assert.equal(replacedPackageCover.applied, true);
      assert.equal(
        replacedPackageCover.mediaAsset.mediaBlobId,
        replacementMediaBlobId,
      );
      const replayedPackageCover = await unsafeTransaction(
        (executor) => replaceCatalogPackageDraftCoverInExecutor(
          executor,
          packageId,
          replacementMediaBlobId,
          null,
          null,
          null,
        ),
      );
      assert.equal(replayedPackageCover.applied, false);
      assert.deepEqual((await fixture.ownerPool.query<Readonly<{
        replacement_fenced: boolean;
        old_cleanup_scheduled: boolean;
      }>>(
        `SELECT
           (SELECT cleanup_eligible_at IS NULL
            FROM content.media_blob_lifecycles WHERE sha256=$1) AS replacement_fenced,
           (SELECT cleanup_eligible_at>clock_timestamp()
            FROM content.media_blob_lifecycles WHERE sha256=$2) AS old_cleanup_scheduled`,
        [replacementSha256, attachedSha256],
      )).rows[0], {
        replacement_fenced: true,
        old_cleanup_scheduled: true,
      });
      await fixture.runtimePool.query(
        "DELETE FROM catalog.package_media_assets WHERE package_media_asset_id=$1",
        [packageMediaAssetId],
      );
      await fixture.runtimePool.query(
        `INSERT INTO catalog.collections(
           collection_id,slug,title,summary,description,language_tags,
           topic_tags,cover_package_id,cover_media_blob_id
         ) VALUES($1,$2,'Images','Summary','Description',ARRAY['en'],
           ARRAY['test'],$3,$4)`,
        [collectionId, `image-collection-${slug}`, packageId, mediaBlobId],
      );
      assert.equal((await fixture.runtimePool.query<{ scheduled: boolean }>(
        "SELECT content.schedule_media_blob_cleanup($1,$2) AS scheduled",
        [mediaBlobId, 1],
      )).rows[0]?.scheduled, false);

      const replaced = await unsafeTransaction(
        (executor) => replaceCatalogCollectionCoverInExecutor(
          executor,
          collectionId,
          replacementMediaBlobId,
        ),
      );
      assert.equal(replaced.applied, true);
      assert.equal(
        replaced.collectionCover.coverMediaBlobId,
        replacementMediaBlobId,
      );
      const replayed = await unsafeTransaction(
        (executor) => replaceCatalogCollectionCoverInExecutor(
          executor,
          collectionId,
          replacementMediaBlobId,
        ),
      );
      assert.equal(replayed.applied, false);
      assert.deepEqual((await fixture.ownerPool.query<Readonly<{
        cover_package_id: string | null;
        cover_media_blob_id: string | null;
        replacement_fenced: boolean;
        old_cleanup_scheduled: boolean;
      }>>(
        `SELECT collections.cover_package_id,collections.cover_media_blob_id,
           replacement_lifecycle.cleanup_eligible_at IS NULL AS replacement_fenced,
           old_lifecycle.cleanup_eligible_at>clock_timestamp() AS old_cleanup_scheduled
         FROM catalog.collections AS collections
         INNER JOIN content.media_blobs AS replacement_blob
           ON replacement_blob.media_blob_id=collections.cover_media_blob_id
         INNER JOIN content.media_blob_lifecycles AS replacement_lifecycle
           ON replacement_lifecycle.sha256=replacement_blob.sha256
         INNER JOIN content.media_blob_lifecycles AS old_lifecycle
           ON old_lifecycle.sha256=$2
         WHERE collections.collection_id=$1`,
        [collectionId, attachedSha256],
      )).rows[0], {
        cover_package_id: packageId,
        cover_media_blob_id: replacementMediaBlobId,
        replacement_fenced: true,
        old_cleanup_scheduled: true,
      });
      await assert.rejects(
        fixture.runtimePool.query(
          "DELETE FROM content.media_blobs WHERE media_blob_id=$1",
          [replacementMediaBlobId],
        ),
        (error: unknown) => hasPostgresCode(error, "23001"),
      );
      await fixture.ownerPool.query(
        "UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=clock_timestamp()-interval '1 second' WHERE sha256=$1",
        [attachedSha256],
      );
      assert.equal((await claimCandidate(randomUUID()))?.sha256, attachedSha256);
      await assert.rejects(
        fixture.runtimePool.query(
          "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
          admissionParams(
            attachedSha256,
            imageJpegCatalogCoverMediaBlobNormalizationVersion,
          ),
        ),
        (error: unknown) => hasPostgresCode(error, "55P03"),
      );
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM catalog.collections WHERE collection_id=$1",
        [collectionId],
      );
      await fixture.ownerPool.query("DELETE FROM catalog.packages WHERE package_id=$1", [packageId]);
      await fixture.ownerPool.query("DELETE FROM catalog.authors WHERE author_id=$1", [authorId]);
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_cleanup_attempts WHERE sha256=ANY($1::text[])", [sha256s],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blobs WHERE sha256=ANY($1::text[])", [sha256s],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_lifecycles WHERE sha256=ANY($1::text[])", [sha256s],
      );
    }
  });
});

test("workspace multipart ingestion adopts existing catalog cover provenance", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const sha256 = createSha256();
    const mediaBlobId = randomUUID();
    const mediaAssetId = randomUUID();
    const sessionId = randomUUID();
    const attemptToken = randomUUID();
    const lastOperationId = randomUUID();
    const s3UploadId = `upload-${randomUUID()}`;
    const storageKey = buildMediaBlobStorageKey(sha256);
    const stagingStorageKey = buildMediaMultipartUploadStagingStorageKey(
      fixture.workspaceId,
      mediaAssetId,
      sessionId,
    );
    const sessionExpiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const completedPartsFingerprint = createSha256();
    const payloadValues = (
      normalizationVersion: string,
    ): ReadonlyArray<string | number | null> => [
      fixture.userId,
      fixture.workspaceId,
      sessionId,
      mediaAssetId,
      fixture.replicaId,
      lastOperationId,
      sha256,
      stagingStorageKey,
      storageKey,
      s3UploadId,
      "image/jpeg",
      42,
      42,
      1,
      null,
      fixture.createdAt,
      fixture.createdAt,
      sessionExpiresAt,
      normalizationVersion,
      completedPartsFingerprint,
    ];
    const beginAttempt = async (
      token: string,
      normalizationVersion: string,
    ): Promise<MultipartWriterAttemptRow> => transactionWithWorkspaceScope(
      { userId: fixture.userId, workspaceId: fixture.workspaceId },
      async (executor) => {
        const result = await executor.query<MultipartWriterAttemptRow>(
          `SELECT attempt_status,reservation_token,normalization_version
           FROM content.begin_media_upload_session_completion_attempt_with_owner(
             $1,$2,
             ROW(
               $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22
             )::content.multipart_media_blob_writer_attempt_payload
           )`,
          [token, 60_000, ...payloadValues(normalizationVersion)],
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new Error("PostgreSQL did not return a multipart writer attempt.");
        }
        return row;
      },
    );
    try {
      await fixture.runtimePool.query(
        "SELECT * FROM content.admit_catalog_image_blob_write($1,$2,$3,$4,$5,$6)",
        [
          sha256,
          storageKey,
          "image/jpeg",
          42,
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
          3_600_000,
        ],
      );
      await fixture.runtimePool.query(
        `INSERT INTO content.media_blobs(
           media_blob_id,sha256,mime_type,size_bytes,storage_key,
           normalization_version
         ) VALUES($1,$2,'image/jpeg',42,$3,$4)`,
        [
          mediaBlobId,
          sha256,
          storageKey,
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        ],
      );
      await fixture.ownerPool.query(
        `INSERT INTO content.media_upload_sessions(
           media_upload_session_id,workspace_id,media_asset_id,
           media_blob_sha256,staging_storage_key,blob_storage_key,
           s3_upload_id,mime_type,size_bytes,part_size_bytes,part_count,state,
           source_url,asset_created_at,client_updated_at,
           last_modified_by_replica_id,last_operation_id,expires_at
         ) VALUES(
           $1,$2,$3,$4,$5,$6,$7,'image/jpeg',42,42,1,'active',NULL,
           $8,$8,$9,$10,$11
         )`,
        [
          sessionId,
          fixture.workspaceId,
          mediaAssetId,
          sha256,
          stagingStorageKey,
          storageKey,
          s3UploadId,
          fixture.createdAt,
          fixture.replicaId,
          lastOperationId,
          sessionExpiresAt,
        ],
      );

      assert.equal(
        (await beginAttempt(
          randomUUID(),
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
        )).attempt_status,
        "stale",
      );
      const begun = await beginAttempt(attemptToken, "passthrough-v1");
      assert.deepEqual(
        [begun.attempt_status, begun.normalization_version],
        ["acquired", imageJpegCatalogCoverMediaBlobNormalizationVersion],
      );
      const reservationToken = begun.reservation_token;
      assert.ok(reservationToken !== null);
      assert.deepEqual((await fixture.ownerPool.query<Readonly<{
        requested_normalization_version: string;
        normalization_version: string;
      }>>(
        `SELECT requested_normalization_version,normalization_version
         FROM content.media_blob_writer_attempts WHERE attempt_token=$1`,
        [attemptToken],
      )).rows[0], {
        requested_normalization_version: "passthrough-v1",
        normalization_version:
          imageJpegCatalogCoverMediaBlobNormalizationVersion,
      });

      const recoveryStatus = await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        async (executor) => (await executor.query<Readonly<{ status: string }>>(
          `SELECT content.resolve_media_upload_session_completion_attempt_failure_with_owner(
             $1,$2,
             ROW(
               $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22
             )::content.multipart_media_blob_writer_attempt_payload,
             $23
           ) AS status`,
          [
            attemptToken,
            reservationToken,
            ...payloadValues(imageJpegCatalogCoverMediaBlobNormalizationVersion),
            3_600_000,
          ],
        )).rows[0]?.status,
      );
      assert.equal(recoveryStatus, "unreferenced_restored");
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_writer_attempts WHERE sha256=$1",
        [sha256],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_upload_sessions WHERE media_upload_session_id=$1",
        [sessionId],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_writer_reservations WHERE sha256=$1",
        [sha256],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blobs WHERE media_blob_id=$1",
        [mediaBlobId],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_lifecycles WHERE sha256=$1",
        [sha256],
      );
    }
  });
});
