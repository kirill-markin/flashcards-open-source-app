import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import {
  enqueueGeneratedMediaPromotionJob,
  type EnqueueGeneratedMediaPromotionJobInput,
} from "../../chat/cardImages/promotion/jobs";
import { replaceCatalogCollectionCoverInExecutor } from "../../catalog/authoring/collectionCovers";
import { replaceCatalogPackageDraftCoverInExecutor } from "../../catalog/authoring/draftMedia";
import {
  transactionWithWorkspaceScope,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../testSupport/postgresIntegration";
import {
  authorizeMediaBlobCleanup,
  claimNextMediaBlobCleanup,
  completeMediaBlobCleanup,
  recordMediaBlobCleanupFailure,
  renewMediaBlobCleanupLease,
  type MediaBlobCleanupClaim,
} from "./cleanupRepository";
import {
  MediaBlobLifecycleBusyError,
  reserveMediaBlobWriterInExecutor,
} from "./index";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
  buildMediaUploadStagingStorageKey,
} from "../storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion } from "../types";

const deadlineOffsetMs = 30_000;
const imageJpegCatalogCoverMediaBlobNormalizationVersion =
  "image-jpeg-catalog-cover-v1";
type RunFixture = Readonly<{
  sessionId: string;
  runId: string;
  claimToken: string;
}>;
type ClaimTokenRow = Readonly<{ claim_token: string }>;
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

async function createRun(
  fixture: PostgresIntegrationFixture,
): Promise<RunFixture> {
  const sessionId = randomUUID();
  const runId = randomUUID();
  const assistantItemId = randomUUID();
  const result = await fixture.ownerPool.query<ClaimTokenRow>(
    `WITH inserted_session AS (
       INSERT INTO ai.chat_sessions (
         session_id, user_id, workspace_id, status, active_run_id
       ) VALUES ($1, $2, $3, 'running', $4)
     ), inserted_item AS (
       INSERT INTO ai.chat_items (
         item_id, session_id, item_kind, state, payload
       ) VALUES (
         $5, $1, 'message', 'in_progress',
         '{"role":"assistant","content":[]}'::jsonb
       )
     )
     INSERT INTO ai.chat_runs (
       run_id, session_id, assistant_item_id, status, request_id, model_id,
       reasoning_effort, timezone, turn_input, worker_claimed_at,
       worker_heartbeat_at, started_at
     ) VALUES (
       $4, $1, $5, 'running', $6, 'gpt-5.6-terra', 'xhigh', 'Europe/Madrid',
       '[]'::jsonb, statement_timestamp(), statement_timestamp(),
       statement_timestamp()
     )
     RETURNING worker_claimed_at::text AS claim_token`,
    [
      sessionId,
      fixture.userId,
      fixture.workspaceId,
      runId,
      assistantItemId,
      `cleanup-enqueue-${runId}`,
    ],
  );
  const claimToken = result.rows[0]?.claim_token;
  if (claimToken === undefined) {
    throw new Error(`Run fixture has no claim token. runId=${runId}`);
  }
  return { sessionId, runId, claimToken };
}

function createPromotionInput(
  fixture: PostgresIntegrationFixture,
  run: RunFixture,
  sha256: string,
): EnqueueGeneratedMediaPromotionJobInput {
  const jobId = randomUUID();
  const operationId = randomUUID();
  const mediaAssetId = randomUUID();
  return {
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    sessionId: run.sessionId,
    runId: run.runId,
    claimToken: run.claimToken,
    deadlineAtMs: deadlineAtMs(),
    jobId,
    operationId,
    cardId: fixture.cardId,
    targetSide: "back",
    altText: "Generated cleanup admission integration",
    mediaAssetId,
    replicaId: fixture.replicaId,
    stagingStorageKey: buildMediaUploadStagingStorageKey(
      fixture.workspaceId,
      mediaAssetId,
      operationId,
    ),
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    sha256,
    mimeType: "image/jpeg",
    sizeBytes: 42,
  };
}

async function waitForBlockedBackendQuery(
  fixture: PostgresIntegrationFixture,
  queryFragment: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await fixture.ownerPool.query<Readonly<{
      blocked: boolean;
    }>>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_stat_activity
         WHERE usename = 'backend_app'
           AND wait_event_type = 'Lock'
           AND query LIKE $1
       ) AS blocked`,
      [`%${queryFragment}%`],
    );
    if (result.rows[0]?.blocked === true) return;
    await wait(10);
  }
  throw new Error(
    `Timed out waiting for blocked backend query. queryFragment=${queryFragment}`,
  );
}

async function waitForBlockedPostgresPid(
  fixture: PostgresIntegrationFixture,
  pid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await fixture.ownerPool.query<Readonly<{
      blocked: boolean;
    }>>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_stat_activity
         WHERE pid = $1
           AND wait_event_type = 'Lock'
       ) AS blocked`,
      [pid],
    );
    if (result.rows[0]?.blocked === true) return;
    await wait(10);
  }
  throw new Error(`Timed out waiting for blocked PostgreSQL query. pid=${pid}`);
}

async function createCandidate(
  fixture: PostgresIntegrationFixture,
  sha256: string,
): Promise<void> {
  await fixture.ownerPool.query(
    `INSERT INTO content.media_blob_lifecycles (
       sha256, storage_key, mime_type, size_bytes, normalization_version,
       cleanup_eligible_at
     ) VALUES ($1, $2, 'image/jpeg', 42, $3, now() - interval '1 second')`,
    [
      sha256,
      buildMediaBlobStorageKey(sha256),
      imageJpegCardMediaBlobNormalizationVersion,
    ],
  );
}

async function claimCandidate(
  token: string,
): Promise<MediaBlobCleanupClaim | null> {
  return claimNextMediaBlobCleanup(token, 60_000, deadlineAtMs());
}

async function insertGeneratedJob(
  fixture: PostgresIntegrationFixture,
  sha256: string,
  state: "pending" | "leased" | "failed",
): Promise<string> {
  const jobId = randomUUID();
  const operationId = randomUUID();
  const mediaAssetId = randomUUID();
  const leased = state === "leased";
  const failed = state === "failed";
  await fixture.ownerPool.query(
    `INSERT INTO content.generated_media_promotion_jobs (
       job_id, operation_id, user_id, workspace_id, card_id, target_side,
       alt_text, media_asset_id, replica_id, staging_storage_key,
       blob_storage_key, sha256, mime_type, size_bytes, state,
       retry_count, next_attempt_at, lease_token, lease_owner, lease_expires_at,
       last_error_code, last_error_message, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'back', 'Generated cleanup integration',
       $6, $7, $8, $9, $10, 'image/jpeg', 42, $11,
       CASE WHEN $11 = 'pending' THEN 2 ELSE 0 END,
       CASE WHEN $11 = 'failed' THEN NULL ELSE now() END,
       CASE WHEN $12 THEN $13::uuid ELSE NULL END,
       CASE WHEN $12 THEN 'cleanup-integration' ELSE NULL END,
       CASE WHEN $12 THEN now() + interval '5 minutes' ELSE NULL END,
       CASE
         WHEN $11 = 'pending' THEN 'STORAGE_TRANSIENT'
         WHEN $14 THEN 'RETRY_EXHAUSTED'
         ELSE NULL
       END,
       CASE
         WHEN $11 = 'pending' THEN 'Generated-media promotion will retry.'
         WHEN $14 THEN 'Generated-media promotion failed terminally.'
         ELSE NULL
       END,
       $15, $15
     )`,
    [
      jobId,
      operationId,
      fixture.userId,
      fixture.workspaceId,
      fixture.cardId,
      mediaAssetId,
      fixture.replicaId,
      buildMediaUploadStagingStorageKey(
        fixture.workspaceId,
        mediaAssetId,
        operationId,
      ),
      buildMediaBlobStorageKey(sha256),
      sha256,
      state,
      leased,
      randomUUID(),
      failed,
      fixture.createdAt,
    ],
  );
  return jobId;
}

async function deleteCleanupFixtures(
  fixture: PostgresIntegrationFixture,
  sha256s: ReadonlyArray<string>,
  generatedJobIds: ReadonlyArray<string>,
): Promise<void> {
  await fixture.ownerPool.query(
    "DELETE FROM content.generated_media_promotion_jobs WHERE job_id = ANY($1::uuid[])",
    [generatedJobIds],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_blob_cleanup_claims WHERE cleanup_token IN (SELECT cleanup_token FROM content.media_blob_cleanup_attempts WHERE sha256 = ANY($1::text[]))",
    [sha256s],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_blob_cleanup_attempts WHERE sha256 = ANY($1::text[])",
    [sha256s],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_blob_writer_reservations WHERE sha256 = ANY($1::text[])",
    [sha256s],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_blob_lifecycles WHERE sha256 = ANY($1::text[])",
    [sha256s],
  );
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

test("terminal generated failure is cleanable while live promotion states and global references block deletion", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const terminalSha = createSha256();
    const pendingSha = createSha256();
    const leasedSha = createSha256();
    const ambiguousSha = createSha256();
    const referencedSha = createSha256();
    const sha256s = [
      terminalSha,
      pendingSha,
      leasedSha,
      ambiguousSha,
      referencedSha,
    ];
    const jobIds: Array<string> = [];
    const crossWorkspaceId = randomUUID();
    const crossReplicaId = randomUUID();
    const crossBlobId = randomUUID();
    try {
      for (const sha256 of sha256s) await createCandidate(fixture, sha256);
      jobIds.push(await insertGeneratedJob(fixture, terminalSha, "failed"));
      await fixture.ownerPool.query(
        `INSERT INTO content.media_blob_writer_reservations (
           sha256, writer_kind, workspace_id, media_asset_id, operation_id,
           state
         ) VALUES (
           $1, 'generated_promotion', $2, $3, $4, 'unreferenced'
         )`,
        [terminalSha, fixture.workspaceId, randomUUID(), randomUUID()],
      );
      jobIds.push(await insertGeneratedJob(fixture, pendingSha, "pending"));
      jobIds.push(await insertGeneratedJob(fixture, leasedSha, "leased"));
      jobIds.push(await insertGeneratedJob(fixture, ambiguousSha, "leased"));
      await fixture.ownerPool.query(
        `INSERT INTO content.media_blob_writer_reservations (
           sha256, writer_kind, workspace_id, media_asset_id, operation_id,
           state, ambiguous_at
         ) VALUES ($1, 'generated_promotion', $2, $3, $4, 'ambiguous', now())`,
        [ambiguousSha, fixture.workspaceId, randomUUID(), randomUUID()],
      );

      await fixture.ownerPool.query(
        `WITH workspace AS (
           INSERT INTO org.workspaces (
             workspace_id, name, fsrs_client_updated_at,
             fsrs_last_modified_by_replica_id, fsrs_last_operation_id
           ) VALUES ($1, 'Cross-workspace cleanup reference', $2, $3, $4)
           RETURNING workspace_id
         ), membership AS (
           INSERT INTO org.workspace_memberships (workspace_id, user_id, role)
           SELECT workspace_id, $5, 'owner' FROM workspace
         )
         INSERT INTO sync.workspace_replicas (
           replica_id, workspace_id, user_id, actor_kind, installation_id,
           actor_key, platform, app_version
         ) VALUES ($3, $1, $5, 'ai_chat', NULL, $6, 'system', 'integration')`,
        [
          crossWorkspaceId,
          fixture.createdAt,
          crossReplicaId,
          randomUUID(),
          fixture.userId,
          randomUUID(),
        ],
      );
      await fixture.ownerPool.query(
        `INSERT INTO content.media_blobs (
           media_blob_id, sha256, mime_type, size_bytes, storage_key,
           normalization_version
         ) VALUES ($1, $2, 'image/jpeg', 42, $3, $4)`,
        [
          crossBlobId,
          referencedSha,
          buildMediaBlobStorageKey(referencedSha),
          imageJpegCardMediaBlobNormalizationVersion,
        ],
      );
      await fixture.ownerPool.query(
        `INSERT INTO content.media_assets (
           media_asset_id, workspace_id, media_blob_id, source_url,
           created_at, client_updated_at, last_modified_by_replica_id,
           last_operation_id
         ) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
        [
          randomUUID(),
          crossWorkspaceId,
          crossBlobId,
          fixture.createdAt,
          crossReplicaId,
          randomUUID(),
        ],
      );
      await fixture.ownerPool.query(
        "UPDATE content.media_blob_lifecycles SET cleanup_eligible_at = now() - interval '1 second' WHERE sha256 = $1",
        [referencedSha],
      );

      const terminalClaim = await claimCandidate(randomUUID());
      assert.equal(terminalClaim?.sha256, terminalSha);
      assert.equal(
        (await authorizeMediaBlobCleanup(terminalClaim, deadlineAtMs())).status,
        "authorized",
      );
      assert.equal(
        await completeMediaBlobCleanup(terminalClaim, deadlineAtMs()),
        "completed",
      );
      assert.equal(
        await completeMediaBlobCleanup(terminalClaim, deadlineAtMs()),
        "completed",
      );
      assert.equal(await claimCandidate(randomUUID()), null);
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1",
        [crossWorkspaceId],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blobs WHERE media_blob_id = $1",
        [crossBlobId],
      );
      await deleteCleanupFixtures(fixture, sha256s, jobIds);
    }
  });
});

test("generated promotion enqueue serializes with cleanup authorization on the lifecycle row", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const enqueueFirstSha = createSha256();
    const authorizeFirstSha = createSha256();
    const sha256s = [enqueueFirstSha, authorizeFirstSha];
    const run = await createRun(fixture);
    const enqueueFirstInput = createPromotionInput(
      fixture,
      run,
      enqueueFirstSha,
    );
    const authorizeFirstInput = createPromotionInput(
      fixture,
      run,
      authorizeFirstSha,
    );
    const jobIds = [enqueueFirstInput.jobId, authorizeFirstInput.jobId];
    const lockClient = await fixture.ownerPool.connect();
    let transactionOpen = false;
    let enqueuePromise:
      Promise<Awaited<ReturnType<typeof enqueueGeneratedMediaPromotionJob>>>
      | null = null;
    let authorizationPromise:
      Promise<Awaited<ReturnType<typeof authorizeMediaBlobCleanup>>>
      | null = null;
    try {
      await createCandidate(fixture, enqueueFirstSha);
      const enqueueFirstClaim = await claimCandidate(randomUUID());
      assert.ok(enqueueFirstClaim !== null);
      assert.equal(enqueueFirstClaim.sha256, enqueueFirstSha);

      await lockClient.query("BEGIN");
      transactionOpen = true;
      await lockClient.query(
        `SELECT 1
         FROM content.media_blob_lifecycles
         WHERE sha256 = $1
         FOR UPDATE`,
        [enqueueFirstSha],
      );
      enqueuePromise = enqueueGeneratedMediaPromotionJob(enqueueFirstInput);
      await waitForBlockedBackendQuery(
        fixture,
        "INSERT INTO content.generated_media_promotion_jobs",
      );
      authorizationPromise = authorizeMediaBlobCleanup(
        enqueueFirstClaim,
        deadlineAtMs(),
      );
      await waitForBlockedBackendQuery(
        fixture,
        "authorize_media_blob_cleanup",
      );
      await lockClient.query("COMMIT");
      transactionOpen = false;

      assert.equal((await enqueuePromise).outcome, "created");
      assert.equal((await authorizationPromise).status, "blocked");
      assert.equal(
        (await enqueueGeneratedMediaPromotionJob(enqueueFirstInput)).outcome,
        "existing",
      );
      enqueuePromise = null;
      authorizationPromise = null;

      await createCandidate(fixture, authorizeFirstSha);
      const authorizeFirstClaim = await claimCandidate(randomUUID());
      assert.ok(authorizeFirstClaim !== null);
      assert.equal(authorizeFirstClaim.sha256, authorizeFirstSha);

      await lockClient.query("BEGIN");
      transactionOpen = true;
      await lockClient.query(
        `SELECT 1
         FROM content.media_blob_lifecycles
         WHERE sha256 = $1
         FOR UPDATE`,
        [authorizeFirstSha],
      );
      authorizationPromise = authorizeMediaBlobCleanup(
        authorizeFirstClaim,
        deadlineAtMs(),
      );
      await waitForBlockedBackendQuery(
        fixture,
        "authorize_media_blob_cleanup",
      );
      enqueuePromise = enqueueGeneratedMediaPromotionJob(authorizeFirstInput);
      await waitForBlockedBackendQuery(
        fixture,
        "INSERT INTO content.generated_media_promotion_jobs",
      );
      await lockClient.query("COMMIT");
      transactionOpen = false;

      assert.equal((await authorizationPromise).status, "authorized");
      await assert.rejects(
        enqueuePromise,
        (error: unknown) => error instanceof MediaBlobLifecycleBusyError,
      );
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => executor.query(
            `INSERT INTO content.generated_media_promotion_jobs (
               job_id, operation_id, user_id, workspace_id, card_id,
               target_side, alt_text, media_asset_id, replica_id,
               staging_storage_key, blob_storage_key, sha256, mime_type,
               size_bytes
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
             )`,
            [
              authorizeFirstInput.jobId,
              authorizeFirstInput.operationId,
              authorizeFirstInput.userId,
              authorizeFirstInput.workspaceId,
              authorizeFirstInput.cardId,
              authorizeFirstInput.targetSide,
              authorizeFirstInput.altText,
              authorizeFirstInput.mediaAssetId,
              authorizeFirstInput.replicaId,
              authorizeFirstInput.stagingStorageKey,
              authorizeFirstInput.blobStorageKey,
              authorizeFirstInput.sha256,
              authorizeFirstInput.mimeType,
              authorizeFirstInput.sizeBytes,
            ],
          ),
        ),
        (error: unknown) => hasPostgresCode(error, "55P03"),
      );
      enqueuePromise = null;
      authorizationPromise = null;
    } finally {
      if (transactionOpen) await lockClient.query("ROLLBACK");
      lockClient.release();
      await Promise.allSettled([
        ...(enqueuePromise === null ? [] : [enqueuePromise]),
        ...(authorizationPromise === null ? [] : [authorizationPromise]),
      ]);
      await deleteCleanupFixtures(fixture, sha256s, jobIds);
    }
  });
});

test("direct, multipart, and generated writers block claims and exact generations fence races", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const writerKinds = [
      "direct_ingestion",
      "multipart_completion",
      "generated_promotion",
    ] as const;
    const writerShas = writerKinds.map(() => createSha256());
    const raceSha = createSha256();
    const sha256s = [...writerShas, raceSha];
    try {
      for (const sha256 of sha256s) await createCandidate(fixture, sha256);
      for (let index = 0; index < writerKinds.length; index += 1) {
        await fixture.ownerPool.query(
          `INSERT INTO content.media_blob_writer_reservations (
             sha256, writer_kind, workspace_id, media_asset_id, operation_id
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            writerShas[index],
            writerKinds[index],
            fixture.workspaceId,
            randomUUID(),
            randomUUID(),
          ],
        );
      }
      const firstToken = randomUUID();
      const firstClaim = await claimCandidate(firstToken);
      assert.equal(firstClaim?.sha256, raceSha);
      assert.deepEqual(await claimCandidate(firstToken), firstClaim);

      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, {
            writerKind: "direct_ingestion",
            workspaceId: fixture.workspaceId,
            mediaAssetId: randomUUID(),
            operationId: randomUUID(),
            sha256: raceSha,
            storageKey: buildMediaBlobStorageKey(raceSha),
            mimeType: "image/jpeg",
            sizeBytes: 42,
            normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
          }),
        ),
        (error: unknown) => error instanceof MediaBlobLifecycleBusyError,
      );

      await fixture.ownerPool.query(
        `UPDATE content.media_blob_lifecycles
         SET cleanup_lease_expires_at = now() - interval '1 second'
         WHERE sha256 = $1`,
        [raceSha],
      );
      const secondClaim = await claimCandidate(randomUUID());
      assert.equal(secondClaim?.sha256, raceSha);
      assert.equal(
        secondClaim.cleanupGeneration,
        firstClaim.cleanupGeneration + 1,
      );
      assert.equal(
        (await authorizeMediaBlobCleanup(firstClaim, deadlineAtMs())).status,
        "stale",
      );
      assert.equal(
        await completeMediaBlobCleanup(firstClaim, deadlineAtMs()),
        "stale",
      );
      assert.equal(
        (await authorizeMediaBlobCleanup(secondClaim, deadlineAtMs())).status,
        "authorized",
      );
      assert.equal(
        await completeMediaBlobCleanup(secondClaim, deadlineAtMs()),
        "completed",
      );
      assert.equal(await claimCandidate(randomUUID()), null);
    } finally {
      await deleteCleanupFixtures(fixture, sha256s, []);
    }
  });
});

test("authorized deletion keeps writers fenced while an expired lease is safely resumed", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const sha256 = createSha256();
    try {
      await createCandidate(fixture, sha256);
      const firstClaim = await claimCandidate(randomUUID());
      assert.ok(firstClaim !== null);
      assert.equal(
        (await authorizeMediaBlobCleanup(firstClaim, deadlineAtMs())).status,
        "authorized",
      );
      const renewalToken = randomUUID();
      const renewed = await renewMediaBlobCleanupLease(
        firstClaim,
        renewalToken,
        "head_object",
        firstClaim.leaseExpiresAt,
        60_000,
        deadlineAtMs(),
      );
      assert.equal(renewed.status, "renewed");
      assert.ok(renewed.leaseExpiresAt !== null);
      assert.ok(
        Date.parse(renewed.leaseExpiresAt)
          > Date.parse(firstClaim.leaseExpiresAt),
      );
      assert.deepEqual(
        await renewMediaBlobCleanupLease(
          firstClaim,
          renewalToken,
          "head_object",
          firstClaim.leaseExpiresAt,
          60_000,
          deadlineAtMs(),
        ),
        renewed,
      );
      await assert.rejects(
        renewMediaBlobCleanupLease(
          firstClaim,
          renewalToken,
          "head_object",
          firstClaim.leaseExpiresAt,
          30_000,
          deadlineAtMs(),
        ),
        (error: unknown) => hasPostgresCode(error, "23514"),
      );
      const secondRenewal = await renewMediaBlobCleanupLease(
        firstClaim,
        randomUUID(),
        "head_object",
        renewed.leaseExpiresAt,
        60_000,
        deadlineAtMs(),
      );
      assert.equal(secondRenewal.status, "renewed");
      assert.ok(secondRenewal.leaseExpiresAt !== null);
      assert.ok(
        Date.parse(secondRenewal.leaseExpiresAt)
          > Date.parse(renewed.leaseExpiresAt),
      );
      assert.equal(
        (
          await renewMediaBlobCleanupLease(
            firstClaim,
            renewalToken,
            "head_object",
            firstClaim.leaseExpiresAt,
            60_000,
            deadlineAtMs(),
          )
        ).status,
        "stale",
      );
      assert.equal(
        (
          await renewMediaBlobCleanupLease(
            firstClaim,
            randomUUID(),
            "head_object",
            firstClaim.leaseExpiresAt,
            60_000,
            deadlineAtMs(),
          )
        ).status,
        "stale",
      );
      assert.equal(
        (
          await renewMediaBlobCleanupLease(
            { ...firstClaim, leaseToken: randomUUID() },
            randomUUID(),
            "head_object",
            renewed.leaseExpiresAt,
            60_000,
            deadlineAtMs(),
          )
        ).status,
        "stale",
      );

      await fixture.ownerPool.query(
        `UPDATE content.media_blob_cleanup_attempts
         SET lease_expires_at = now() - interval '1 second'
         WHERE cleanup_token = $1`,
        [firstClaim.cleanupToken],
      );
      const lifecycleFence = (await fixture.ownerPool.query<Readonly<{
        is_infinite: boolean;
      }>>(
        `SELECT cleanup_lease_expires_at = 'infinity'::timestamptz AS is_infinite
         FROM content.media_blob_lifecycles
         WHERE sha256 = $1`,
        [sha256],
      )).rows[0];
      assert.equal(lifecycleFence?.is_infinite, true);

      for (const writerKind of [
        "direct_ingestion",
        "multipart_completion",
        "generated_promotion",
      ] as const) {
        await assert.rejects(
          transactionWithWorkspaceScope(
            { userId: fixture.userId, workspaceId: fixture.workspaceId },
            (executor) => reserveMediaBlobWriterInExecutor(executor, {
              writerKind,
              workspaceId: fixture.workspaceId,
              mediaAssetId: randomUUID(),
              operationId: randomUUID(),
              sha256,
              storageKey: buildMediaBlobStorageKey(sha256),
              mimeType: "image/jpeg",
              sizeBytes: 42,
              normalizationVersion:
                imageJpegCardMediaBlobNormalizationVersion,
            }),
          ),
          (error: unknown) => error instanceof MediaBlobLifecycleBusyError,
        );
      }

      const replacementToken = randomUUID();
      const replacementClaim = await claimCandidate(replacementToken);
      assert.ok(replacementClaim !== null);
      assert.equal(replacementClaim.cleanupToken, firstClaim.cleanupToken);
      assert.equal(
        replacementClaim.cleanupGeneration,
        firstClaim.cleanupGeneration,
      );
      assert.equal(replacementClaim.leaseToken, replacementToken);
      assert.deepEqual(
        await claimCandidate(replacementToken),
        replacementClaim,
      );
      assert.equal(
        (await authorizeMediaBlobCleanup(firstClaim, deadlineAtMs())).status,
        "stale",
      );
      assert.equal(
        (
          await renewMediaBlobCleanupLease(
            firstClaim,
            renewalToken,
            "head_object",
            firstClaim.leaseExpiresAt,
            60_000,
            deadlineAtMs(),
          )
        ).status,
        "stale",
      );
      assert.equal(
        await completeMediaBlobCleanup(firstClaim, deadlineAtMs()),
        "stale",
      );
      assert.equal(
        (
          await authorizeMediaBlobCleanup(
            replacementClaim,
            deadlineAtMs(),
          )
        ).status,
        "authorized",
      );
      const replacementRenewal = await renewMediaBlobCleanupLease(
        replacementClaim,
        randomUUID(),
        "head_object",
        replacementClaim.leaseExpiresAt,
        60_000,
        deadlineAtMs(),
      );
      assert.equal(replacementRenewal.status, "renewed");
      assert.equal(
        await completeMediaBlobCleanup(replacementClaim, deadlineAtMs()),
        "completed",
      );

      await assert.doesNotReject(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, {
            writerKind: "direct_ingestion",
            workspaceId: fixture.workspaceId,
            mediaAssetId: randomUUID(),
            operationId: randomUUID(),
            sha256,
            storageKey: buildMediaBlobStorageKey(sha256),
            mimeType: "image/jpeg",
            sizeBytes: 42,
            normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
          }),
        ),
      );
    } finally {
      await deleteCleanupFixtures(fixture, [sha256], []);
    }
  });
});

test("workspace deletion preserves authorized and deleting cleanup fences", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const workspaceId = randomUUID();
    const replicaId = randomUUID();
    const authorizedSha = createSha256();
    const deletingSha = createSha256();
    const sha256s = [authorizedSha, deletingSha];
    const lockClient = await fixture.ownerPool.connect();
    const deleteClient = await fixture.ownerPool.connect();
    let lockTransactionOpen = false;
    let deletePromise: Promise<unknown> | null = null;
    try {
      await fixture.ownerPool.query(
        `WITH workspace AS (
           INSERT INTO org.workspaces (
             workspace_id, name, fsrs_client_updated_at,
             fsrs_last_modified_by_replica_id, fsrs_last_operation_id
           ) VALUES (
             $1, 'Cleanup fence workspace delete', $2, $3, $4
           )
           RETURNING workspace_id
         ), membership AS (
           INSERT INTO org.workspace_memberships (
             workspace_id, user_id, role
           )
           SELECT workspace_id, $5, 'owner'
           FROM workspace
         )
         INSERT INTO sync.workspace_replicas (
           replica_id, workspace_id, user_id, actor_kind, installation_id,
           actor_key, platform, app_version
         ) VALUES (
           $3, $1, $5, 'ai_chat', NULL, $6, 'system', 'integration'
         )`,
        [
          workspaceId,
          fixture.createdAt,
          replicaId,
          randomUUID(),
          fixture.userId,
          randomUUID(),
        ],
      );
      for (const sha256 of sha256s) await createCandidate(fixture, sha256);
      await fixture.ownerPool.query(
        `INSERT INTO content.media_blob_writer_reservations (
           sha256, writer_kind, workspace_id, media_asset_id, operation_id,
           state
         ) VALUES
           ($1, 'direct_ingestion', $3, $4, $5, 'unreferenced'),
           ($2, 'multipart_completion', $3, $6, $7, 'unreferenced')`,
        [
          authorizedSha,
          deletingSha,
          workspaceId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ],
      );

      const firstClaim = await claimCandidate(randomUUID());
      const secondClaim = await claimCandidate(randomUUID());
      assert.ok(firstClaim !== null);
      assert.ok(secondClaim !== null);
      const claimsBySha = new Map(
        [firstClaim, secondClaim].map((claim) => [claim.sha256, claim]),
      );
      const authorizedClaim = claimsBySha.get(authorizedSha);
      const deletingClaim = claimsBySha.get(deletingSha);
      assert.ok(authorizedClaim !== undefined);
      assert.ok(deletingClaim !== undefined);
      assert.equal(
        (await authorizeMediaBlobCleanup(
          authorizedClaim,
          deadlineAtMs(),
        )).status,
        "authorized",
      );
      assert.equal(
        (await authorizeMediaBlobCleanup(
          deletingClaim,
          deadlineAtMs(),
        )).status,
        "authorized",
      );
      assert.equal(
        (
          await renewMediaBlobCleanupLease(
            deletingClaim,
            randomUUID(),
            "delete_object",
            deletingClaim.leaseExpiresAt,
            60_000,
            deadlineAtMs(),
          )
        ).status,
        "renewed",
      );

      await lockClient.query("BEGIN");
      lockTransactionOpen = true;
      await lockClient.query(
        `SELECT sha256
         FROM content.media_blob_lifecycles
         WHERE sha256 = ANY($1::text[])
         ORDER BY sha256
         FOR UPDATE`,
        [sha256s],
      );
      const deletePid = (
        await deleteClient.query<Readonly<{ pid: number }>>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows[0]?.pid;
      assert.ok(deletePid !== undefined);
      deletePromise = deleteClient.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1",
        [workspaceId],
      );
      await waitForBlockedPostgresPid(fixture, deletePid);
      await lockClient.query("COMMIT");
      lockTransactionOpen = false;
      await deletePromise;
      deletePromise = null;

      const rows = (await fixture.ownerPool.query<Readonly<{
        sha256: string;
        state: string;
        lease_token: string;
        lifecycle_lease_token: string;
        is_infinite: boolean;
      }>>(
        `SELECT
           attempts.sha256,
           attempts.state,
           attempts.lease_token::text AS lease_token,
           lifecycles.cleanup_lease_token::text AS lifecycle_lease_token,
           lifecycles.cleanup_lease_expires_at =
             'infinity'::timestamptz AS is_infinite
         FROM content.media_blob_cleanup_attempts AS attempts
         INNER JOIN content.media_blob_lifecycles AS lifecycles
           ON lifecycles.sha256 = attempts.sha256
         WHERE attempts.sha256 = ANY($1::text[])
         ORDER BY attempts.sha256`,
        [sha256s],
      )).rows;
      const stateBySha = new Map(rows.map((row) => [row.sha256, row]));
      assert.deepEqual(stateBySha.get(authorizedSha), {
        sha256: authorizedSha,
        state: "authorized",
        lease_token: authorizedClaim.leaseToken,
        lifecycle_lease_token: authorizedClaim.leaseToken,
        is_infinite: true,
      });
      assert.deepEqual(stateBySha.get(deletingSha), {
        sha256: deletingSha,
        state: "deleting",
        lease_token: deletingClaim.leaseToken,
        lifecycle_lease_token: deletingClaim.leaseToken,
        is_infinite: true,
      });

      for (const sha256 of sha256s) {
        await assert.rejects(
          transactionWithWorkspaceScope(
            { userId: fixture.userId, workspaceId: fixture.workspaceId },
            (executor) => reserveMediaBlobWriterInExecutor(executor, {
              writerKind: "direct_ingestion",
              workspaceId: fixture.workspaceId,
              mediaAssetId: randomUUID(),
              operationId: randomUUID(),
              sha256,
              storageKey: buildMediaBlobStorageKey(sha256),
              mimeType: "image/jpeg",
              sizeBytes: 42,
              normalizationVersion:
                imageJpegCardMediaBlobNormalizationVersion,
            }),
          ),
          (error: unknown) => error instanceof MediaBlobLifecycleBusyError,
        );
      }
    } finally {
      if (lockTransactionOpen) await lockClient.query("ROLLBACK");
      await Promise.allSettled(deletePromise === null ? [] : [deletePromise]);
      lockClient.release();
      deleteClient.release();
      await fixture.ownerPool.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1",
        [workspaceId],
      );
      await deleteCleanupFixtures(fixture, sha256s, []);
    }
  });
});

test("a begun conditional delete remains durably fenced instead of being reclaimed", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const sha256 = createSha256();
    try {
      await createCandidate(fixture, sha256);
      const cleanupClaim = await claimCandidate(randomUUID());
      assert.ok(cleanupClaim !== null);
      assert.equal(
        (await authorizeMediaBlobCleanup(cleanupClaim, deadlineAtMs())).status,
        "authorized",
      );
      const deleteRenewal = await renewMediaBlobCleanupLease(
        cleanupClaim,
        randomUUID(),
        "delete_object",
        cleanupClaim.leaseExpiresAt,
        60_000,
        deadlineAtMs(),
      );
      assert.equal(deleteRenewal.status, "renewed");
      assert.ok(deleteRenewal.leaseExpiresAt !== null);
      await assert.rejects(
        recordMediaBlobCleanupFailure(
          cleanupClaim,
          {
            failureToken: randomUUID(),
            disposition: "retry",
            retryDelayMs: 60_000,
            phase: "renew",
            errorCode: "DATABASE_COMMIT_OUTCOME_UNKNOWN",
            errorClass: "DatabaseCommitOutcomeUnknownError",
          },
          deadlineAtMs(),
        ),
        (error: unknown) => hasPostgresCode(error, "23514"),
      );

      await fixture.ownerPool.query(
        `UPDATE content.media_blob_cleanup_attempts
         SET lease_expires_at = now() - interval '1 second'
         WHERE cleanup_token = $1`,
        [cleanupClaim.cleanupToken],
      );
      assert.equal(await claimCandidate(randomUUID()), null);
      assert.equal(
        await completeMediaBlobCleanup(cleanupClaim, deadlineAtMs()),
        "stale",
      );
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, {
            writerKind: "direct_ingestion",
            workspaceId: fixture.workspaceId,
            mediaAssetId: randomUUID(),
            operationId: randomUUID(),
            sha256,
            storageKey: buildMediaBlobStorageKey(sha256),
            mimeType: "image/jpeg",
            sizeBytes: 42,
            normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
          }),
        ),
        (error: unknown) => error instanceof MediaBlobLifecycleBusyError,
      );
      const attemptState = (await fixture.ownerPool.query<Readonly<{
        state: string;
        is_infinite: boolean;
      }>>(
        `SELECT
           attempts.state,
           lifecycles.cleanup_lease_expires_at =
             'infinity'::timestamptz AS is_infinite
         FROM content.media_blob_cleanup_attempts AS attempts
         INNER JOIN content.media_blob_lifecycles AS lifecycles
           ON lifecycles.sha256 = attempts.sha256
         WHERE attempts.cleanup_token = $1`,
        [cleanupClaim.cleanupToken],
      )).rows[0];
      assert.deepEqual(attemptState, {
        state: "deleting",
        is_infinite: true,
      });
    } finally {
      await deleteCleanupFixtures(fixture, [sha256], []);
    }
  });
});

test("cleanup retry and terminal failure states retain fences without starving due work", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const sha256s = [createSha256(), createSha256(), createSha256()];
    try {
      for (const sha256 of sha256s) await createCandidate(fixture, sha256);

      const retryClaim = await claimCandidate(randomUUID());
      assert.ok(retryClaim !== null);
      assert.equal(
        (await authorizeMediaBlobCleanup(retryClaim, deadlineAtMs())).status,
        "authorized",
      );
      const retryFailureToken = randomUUID();
      const retryDecision = await recordMediaBlobCleanupFailure(
        retryClaim,
        {
          failureToken: retryFailureToken,
          disposition: "retry",
          retryDelayMs: 300_000,
          phase: "head_object",
          errorCode: "MEDIA_BLOB_CLEANUP_STORAGE_TRANSIENT",
          errorClass: "MediaBlobCleanupStorageTransientError",
        },
        deadlineAtMs(),
      );
      assert.equal(retryDecision.status, "retry_scheduled");
      assert.equal(retryDecision.failureCount, 1);
      assert.ok(retryDecision.nextAttemptAt !== null);
      assert.deepEqual(
        await recordMediaBlobCleanupFailure(
          retryClaim,
          {
            failureToken: retryFailureToken,
            disposition: "retry",
            retryDelayMs: 300_000,
            phase: "head_object",
            errorCode: "MEDIA_BLOB_CLEANUP_STORAGE_TRANSIENT",
            errorClass: "MediaBlobCleanupStorageTransientError",
          },
          deadlineAtMs(),
        ),
        retryDecision,
      );

      const terminalClaim = await claimCandidate(randomUUID());
      assert.ok(terminalClaim !== null);
      assert.notEqual(terminalClaim.sha256, retryClaim.sha256);
      assert.equal(
        (await authorizeMediaBlobCleanup(terminalClaim, deadlineAtMs())).status,
        "authorized",
      );
      const terminalDecision = await recordMediaBlobCleanupFailure(
        terminalClaim,
        {
          failureToken: randomUUID(),
          disposition: "terminal",
          retryDelayMs: 0,
          phase: "delete_object",
          errorCode: "MEDIA_BLOB_CLEANUP_DELETE_AMBIGUOUS",
          errorClass: "MediaBlobCleanupStorageAmbiguousDeleteError",
        },
        deadlineAtMs(),
      );
      assert.deepEqual(
        {
          status: terminalDecision.status,
          nextAttemptAt: terminalDecision.nextAttemptAt,
          failureCount: terminalDecision.failureCount,
        },
        {
          status: "reconciliation_required",
          nextAttemptAt: null,
          failureCount: 1,
        },
      );

      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, {
            writerKind: "direct_ingestion",
            workspaceId: fixture.workspaceId,
            mediaAssetId: randomUUID(),
            operationId: randomUUID(),
            sha256: terminalClaim.sha256,
            storageKey: terminalClaim.storageKey,
            mimeType: "image/jpeg",
            sizeBytes: 42,
            normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
          }),
        ),
        (error: unknown) => error instanceof MediaBlobLifecycleBusyError,
      );

      const unrelatedClaim = await claimCandidate(randomUUID());
      assert.ok(unrelatedClaim !== null);
      assert.notEqual(unrelatedClaim.sha256, retryClaim.sha256);
      assert.notEqual(unrelatedClaim.sha256, terminalClaim.sha256);
      assert.equal(
        (
          await authorizeMediaBlobCleanup(unrelatedClaim, deadlineAtMs())
        ).status,
        "authorized",
      );
      assert.equal(
        await completeMediaBlobCleanup(unrelatedClaim, deadlineAtMs()),
        "completed",
      );
      assert.equal(await claimCandidate(randomUUID()), null);

      await fixture.ownerPool.query(
        `UPDATE content.media_blob_cleanup_attempts
         SET next_attempt_at = now() - interval '1 second'
         WHERE cleanup_token = $1`,
        [retryClaim.cleanupToken],
      );
      const retryReplacement = await claimCandidate(randomUUID());
      assert.ok(retryReplacement !== null);
      assert.equal(retryReplacement.cleanupToken, retryClaim.cleanupToken);
      assert.equal(
        retryReplacement.cleanupGeneration,
        retryClaim.cleanupGeneration,
      );
      assert.equal(retryReplacement.failureCount, 1);
      assert.equal(
        (
          await authorizeMediaBlobCleanup(
            retryReplacement,
            deadlineAtMs(),
          )
        ).status,
        "authorized",
      );
      assert.equal(
        await completeMediaBlobCleanup(retryReplacement, deadlineAtMs()),
        "completed",
      );
      assert.equal(await claimCandidate(randomUUID()), null);
    } finally {
      await deleteCleanupFixtures(fixture, sha256s, []);
    }
  });
});

test("cleanup reclaim index matches the due-work predicate and ordering", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const index = (await fixture.ownerPool.query<Readonly<{
      is_valid: boolean;
      definition: string;
      predicate: string | null;
    }>>(
      `SELECT
         indexes.indisvalid AS is_valid,
         pg_catalog.pg_get_indexdef(indexes.indexrelid) AS definition,
         pg_catalog.pg_get_expr(
           indexes.indpred,
           indexes.indrelid
         ) AS predicate
       FROM pg_catalog.pg_index AS indexes
       INNER JOIN pg_catalog.pg_class AS index_relations
         ON index_relations.oid = indexes.indexrelid
       INNER JOIN pg_catalog.pg_namespace AS namespaces
         ON namespaces.oid = index_relations.relnamespace
       WHERE namespaces.nspname = 'content'
         AND index_relations.relname =
           'media_blob_cleanup_attempts_due_reclaim'`,
    )).rows[0];

    assert.ok(index !== undefined);
    assert.equal(index.is_valid, true);
    assert.match(
      index.definition,
      /COALESCE\(next_attempt_at, lease_expires_at\)/u,
    );
    assert.match(index.definition, /authorized_at/u);
    assert.match(index.definition, /sha256/u);
    assert.match(index.predicate ?? "", /authorized/u);
    assert.match(index.predicate ?? "", /retry_wait/u);
  });
});

test("cleanup tables stay private and only backend_app can execute reconciler functions", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const row = (await fixture.ownerPool.query<Readonly<{
      backend_table_access: boolean;
      backend_claims_table_access: boolean;
      backend_renewals_table_access: boolean;
      backend_failures_table_access: boolean;
      auth_table_access: boolean;
      reporting_table_access: boolean;
      backend_claim_access: boolean;
      backend_authorize_access: boolean;
      backend_complete_access: boolean;
      backend_renew_access: boolean;
      backend_record_failure_access: boolean;
      backend_legacy_claim_access: boolean;
      auth_claim_access: boolean;
      reporting_claim_access: boolean;
    }>>(
      `SELECT
         has_table_privilege(
           'backend_app', 'content.media_blob_cleanup_attempts', 'SELECT'
         ) AS backend_table_access,
         has_table_privilege(
           'backend_app', 'content.media_blob_cleanup_claims', 'SELECT'
         ) AS backend_claims_table_access,
         has_table_privilege(
           'backend_app', 'content.media_blob_cleanup_renewals', 'SELECT'
         ) AS backend_renewals_table_access,
         has_table_privilege(
           'backend_app', 'content.media_blob_cleanup_failures', 'SELECT'
         ) AS backend_failures_table_access,
         has_table_privilege(
           'auth_app', 'content.media_blob_cleanup_attempts', 'SELECT'
         ) AS auth_table_access,
         has_table_privilege(
           'reporting_readonly', 'content.media_blob_cleanup_attempts', 'SELECT'
         ) AS reporting_table_access,
         has_function_privilege(
           'backend_app',
           'content.claim_next_media_blob_cleanup(uuid,integer)',
           'EXECUTE'
         ) AS backend_claim_access,
         has_function_privilege(
           'backend_app',
           'content.authorize_media_blob_cleanup(uuid,bigint,uuid)',
           'EXECUTE'
         ) AS backend_authorize_access,
         has_function_privilege(
           'backend_app',
           'content.complete_media_blob_cleanup(uuid,bigint,uuid)',
           'EXECUTE'
         ) AS backend_complete_access,
         has_function_privilege(
           'backend_app',
           'content.renew_media_blob_cleanup_lease(uuid,bigint,uuid,uuid,text,timestamptz,integer)',
           'EXECUTE'
         ) AS backend_renew_access,
         has_function_privilege(
           'backend_app',
           'content.record_media_blob_cleanup_failure(uuid,bigint,uuid,uuid,text,integer,text,text,text)',
           'EXECUTE'
         ) AS backend_record_failure_access,
         has_function_privilege(
           'backend_app',
           'content.claim_media_blob_cleanup(text,integer)',
           'EXECUTE'
         ) AS backend_legacy_claim_access,
         has_function_privilege(
           'auth_app',
           'content.claim_next_media_blob_cleanup(uuid,integer)',
           'EXECUTE'
         ) AS auth_claim_access,
         has_function_privilege(
           'reporting_readonly',
           'content.claim_next_media_blob_cleanup(uuid,integer)',
           'EXECUTE'
         ) AS reporting_claim_access`,
    )).rows[0];
    assert.deepEqual(row, {
      backend_table_access: false,
      backend_claims_table_access: false,
      backend_renewals_table_access: false,
      backend_failures_table_access: false,
      auth_table_access: false,
      reporting_table_access: false,
      backend_claim_access: true,
      backend_authorize_access: true,
      backend_complete_access: true,
      backend_renew_access: true,
      backend_record_failure_access: true,
      backend_legacy_claim_access: false,
      auth_claim_access: false,
      reporting_claim_access: false,
    });
  });
});
