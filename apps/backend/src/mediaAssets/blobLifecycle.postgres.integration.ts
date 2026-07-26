import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { transactionWithWorkspaceScope, type DatabaseExecutor } from "../database";
import { unsafeTransaction } from "../database/unsafe";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../testSupport/postgresIntegration";
import {
  claimMediaBlobCleanupInExecutor, failMediaBlobWriterInExecutor,
  finalizeMediaBlobWriterInExecutor, markMediaBlobWriterAmbiguousInExecutor,
  MediaBlobLifecycleBusyError, MediaBlobLifecycleConflictError, MediaBlobWriterFenceError,
  reconcileMediaBlobWriterInExecutor, reserveMediaBlobWriterInExecutor,
  terminalizeMediaBlobWriterFailureInExecutor,
  type MediaBlobWriterReservationInput,
} from "./blobLifecycle";
import { createImageNormalizedMediaAssetForWorkspace } from ".";
import { buildMediaBlobStorageKey } from "./storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion, passthroughMediaBlobNormalizationVersion } from "./types";
type LifecycleUpgradeRow = Readonly<{
  storage_key: string; mime_type: string; size_bytes: string; normalization_version: string;
  created_at_matches: boolean; updated_at_matches: boolean; workspace_fence: boolean; catalog_fence: boolean;
  backend_table_access: boolean; auth_table_access: boolean;
  backend_reserve_access: boolean; backend_fence_access: boolean;
  backend_terminalize_access: boolean; auth_terminalize_access: boolean;
  backend_generated_failure_access: boolean;
}>;
function createUniqueSha256(): string { return createHash("sha256").update(randomUUID()).digest("hex"); }
const lifecycleMigrationSql = readFileSync(resolve(
  __dirname, "../../../../db/migrations/0091_durable_media_blob_lifecycle.sql",
), "utf8");
const writerSupportMigrationSql = readFileSync(resolve(
  __dirname, "../../../../db/migrations/0092_media_blob_writer_support.sql",
), "utf8");
function input(workspaceId: string, mediaAssetId: string, operationId: string, sha256: string): MediaBlobWriterReservationInput {
  return {
    writerKind: "direct_ingestion", workspaceId, mediaAssetId, operationId,
    sha256, storageKey: buildMediaBlobStorageKey(sha256), mimeType: "image/jpeg",
    sizeBytes: 42, normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
  };
}
function hasSqlState(error: unknown, sqlState: string): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === sqlState; }
async function createCleanupCandidate(
  fixture: PostgresIntegrationFixture, sha256: string,
): Promise<Readonly<{ blobId: string; lifecycleInput: MediaBlobWriterReservationInput }>> {
  const lifecycleInput = input(fixture.workspaceId, randomUUID(), `cleanup-${randomUUID()}`, sha256);
  const reservation = await transactionWithWorkspaceScope(
    { userId: fixture.userId, workspaceId: fixture.workspaceId },
    (executor) => reserveMediaBlobWriterInExecutor(executor, lifecycleInput),
  );
  const blobId = randomUUID();
  await fixture.ownerPool.query(
    `INSERT INTO content.media_blobs
       (media_blob_id, sha256, mime_type, size_bytes, storage_key, normalization_version)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [blobId, sha256, lifecycleInput.mimeType, lifecycleInput.sizeBytes,
      lifecycleInput.storageKey, lifecycleInput.normalizationVersion],
  );
  await transactionWithWorkspaceScope(
    { userId: fixture.userId, workspaceId: fixture.workspaceId },
    (executor) => failMediaBlobWriterInExecutor(executor, reservation.reservationToken),
  );
  await fixture.ownerPool.query("UPDATE content.media_blob_lifecycles SET cleanup_eligible_at = now() - interval '1 second' WHERE sha256 = $1", [sha256]);
  return { blobId, lifecycleInput };
}
async function assertCleanupLeaseStartsAfterLockWait(
  fixture: PostgresIntegrationFixture, sha256: string,
): Promise<void> {
  await createCleanupCandidate(fixture, sha256);
  const blocker = await fixture.ownerPool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT 1 FROM content.media_blob_lifecycles WHERE sha256 = $1 FOR UPDATE",
      [sha256],
    );
    const claim = claimMediaBlobCleanupInExecutor(fixture.runtimePool, sha256, 1_000);
    await blocker.query("SELECT pg_sleep(1.1)");
    await blocker.query("UPDATE content.media_blob_lifecycles SET cleanup_eligible_at = clock_timestamp() WHERE sha256 = $1", [sha256]);
    await blocker.query("COMMIT");
    assert.notEqual(await claim, null);
    assert.equal((await fixture.ownerPool.query<{ lease_started_after_lock: boolean }>(
      "SELECT cleanup_lease_expires_at >= cleanup_eligible_at + interval '1 second' AS lease_started_after_lock FROM content.media_blob_lifecycles WHERE sha256 = $1",
      [sha256],
    )).rows[0]?.lease_started_after_lock, true);
  } catch (error) {
    await blocker.query("ROLLBACK");
    throw error;
  } finally {
    blocker.release();
  }
}
async function assertExpiredCleanupLeaseAllowsOperation(
  fixture: PostgresIntegrationFixture, sha256: string, operation: () => Promise<unknown>,
): Promise<void> {
  assert.notEqual(await unsafeTransaction(
    (executor) => claimMediaBlobCleanupInExecutor(executor, sha256, 1_000),
  ), null);
  const blocker = await fixture.ownerPool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT 1 FROM content.media_blob_lifecycles WHERE sha256 = $1 FOR UPDATE", [sha256],
    );
    const outcome = operation();
    await blocker.query("SELECT pg_sleep(1.1)");
    await blocker.query("COMMIT");
    await outcome;
  } catch (error) {
    await blocker.query("ROLLBACK");
    throw error;
  } finally {
    blocker.release();
  }
}
async function assertReferenceWinsCleanupClaim(
  fixture: PostgresIntegrationFixture, sha256: string, query: string, values: ReadonlyArray<string>,
): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    const blockerPid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
    if (blockerPid === undefined) throw new Error("PostgreSQL did not return the reference blocker pid.");
    await client.query("BEGIN");
    await client.query(query, [...values]);
    const claim = fixture.runtimePool.query<{ lease_token: string | null }>(
      "SELECT content.claim_media_blob_cleanup($1, $2) AS lease_token", [sha256, 60_000],
    );
    let claimBlocked = false;
    for (let attempt = 0; attempt < 80 && !claimBlocked; attempt += 1) {
      const wait = await fixture.ownerPool.query<{ blocked: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'backend_app'
         AND query LIKE 'SELECT content.claim_media_blob_cleanup%'
         AND $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [blockerPid],
      );
      claimBlocked = wait.rows[0]?.blocked === true;
      if (!claimBlocked) await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    assert.equal(claimBlocked, true);
    await client.query("COMMIT");
    assert.equal((await claim).rows[0]?.lease_token, null);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function assertLifecycleMigrationUpgrade(fixture: PostgresIntegrationFixture, sha256: string): Promise<void> {
  const client = await fixture.ownerPool.connect();
  const blobId = randomUUID();
  const storageKey = buildMediaBlobStorageKey(sha256);
  try {
    await client.query("BEGIN");
    await client.query(`
      DROP TRIGGER media_assets_blob_reference_fence ON content.media_assets; DROP TRIGGER package_media_assets_blob_reference_fence ON catalog.package_media_assets;
      DROP FUNCTION content.mark_generated_media_promotion_blob_writer_ambiguous(UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT);
      DROP FUNCTION content.fail_generated_media_promotion_job_with_blob_writer(UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER);
      DROP FUNCTION content.generated_media_promotion_blob_writer_lease_matches(UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT);
      DROP FUNCTION content.terminalize_media_blob_writer_failure(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT, INTEGER);
      DROP FUNCTION content.media_blob_writer_exact_match(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT);
      DROP FUNCTION content.fence_workspace_media_asset_reference(), content.fence_catalog_media_asset_reference(), content.fence_media_blob_reference(UUID);
      DROP FUNCTION content.reserve_media_blob_writer(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT), content.finalize_media_blob_writer(UUID, TEXT, UUID, UUID);
      DROP FUNCTION content.mark_media_blob_writer_ambiguous(UUID), content.reconcile_media_blob_writer(UUID, TEXT, UUID, UUID, INTEGER);
      DROP FUNCTION content.fail_media_blob_writer(UUID, INTEGER), content.claim_media_blob_cleanup(TEXT, INTEGER), content.generated_media_promotion_operation_applied(UUID, UUID);
      DROP TABLE content.media_blob_writer_reservations, content.media_blob_lifecycles
    `);
    await client.query(
      `INSERT INTO content.media_blobs (media_blob_id, sha256, mime_type, size_bytes, storage_key,
         normalization_version, created_at, updated_at)
       VALUES ($1, $2, 'application/octet-stream', 0, $3, 'passthrough-v1', $4, $4)`,
      [blobId, sha256, storageKey, fixture.createdAt],
    );
    await client.query(lifecycleMigrationSql);
    await client.query(writerSupportMigrationSql);
    assert.deepEqual((await client.query<LifecycleUpgradeRow>(
      `SELECT lifecycles.storage_key, lifecycles.mime_type, lifecycles.size_bytes::text, lifecycles.normalization_version,
              lifecycles.created_at = $2::timestamptz AS created_at_matches, lifecycles.updated_at = $2::timestamptz AS updated_at_matches,
              EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'media_assets_blob_reference_fence') AS workspace_fence,
              EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'package_media_assets_blob_reference_fence') AS catalog_fence,
              has_table_privilege('backend_app', 'content.media_blob_lifecycles', 'SELECT') AS backend_table_access,
              has_table_privilege('auth_app', 'content.media_blob_writer_reservations', 'SELECT') AS auth_table_access,
              has_function_privilege('backend_app', 'content.reserve_media_blob_writer(text,text,text,bigint,text,text,uuid,uuid,text)', 'EXECUTE') AS backend_reserve_access,
              has_function_privilege('backend_app', 'content.fence_media_blob_reference(uuid)', 'EXECUTE') AS backend_fence_access,
              has_function_privilege('backend_app', 'content.terminalize_media_blob_writer_failure(uuid,text,text,text,bigint,text,text,uuid,uuid,text,integer)', 'EXECUTE') AS backend_terminalize_access,
              has_function_privilege('auth_app', 'content.terminalize_media_blob_writer_failure(uuid,text,text,text,bigint,text,text,uuid,uuid,text,integer)', 'EXECUTE') AS auth_terminalize_access,
              has_function_privilege('backend_app', 'content.fail_generated_media_promotion_job_with_blob_writer(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)', 'EXECUTE') AS backend_generated_failure_access
       FROM content.media_blob_lifecycles AS lifecycles WHERE lifecycles.sha256 = $1`,
      [sha256, fixture.createdAt],
    )).rows[0], {
      storage_key: storageKey, mime_type: "application/octet-stream", size_bytes: "0", normalization_version: passthroughMediaBlobNormalizationVersion,
      created_at_matches: true, updated_at_matches: true, workspace_fence: true, catalog_fence: true,
      backend_table_access: false, auth_table_access: false,
      backend_reserve_access: true, backend_fence_access: false,
      backend_terminalize_access: true, auth_terminalize_access: false,
      backend_generated_failure_access: true,
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
test("media blob lifecycle coordinates writers, ambiguity, cleanup leases, and global grants", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const referencedSha = createUniqueSha256();
    const cleanupSha = createUniqueSha256();
    const mediaRaceSha = createUniqueSha256();
    const catalogRaceSha = createUniqueSha256();
    const legacySha = createUniqueSha256();
    const backfillSha = createUniqueSha256();
    const leaseWaitSha = createUniqueSha256();
    const referenceLeaseSha = createUniqueSha256();
    const reservationLeaseSha = createUniqueSha256();
    const revokedSha = createUniqueSha256();
    const fixtureSha256s = [
      referencedSha, cleanupSha, mediaRaceSha, catalogRaceSha, legacySha, backfillSha, leaseWaitSha,
      referenceLeaseSha, reservationLeaseSha, revokedSha,
    ];
    const cleanupBlobId = randomUUID();
    const concurrentWorkspaceId = randomUUID();
    const authorId = randomUUID();
    const packageId = randomUUID();
    const catalogSlug = `lifecycle-${randomUUID()}`;
    const referencedInput = input(
      fixture.workspaceId, randomUUID(), `lifecycle-reference-${randomUUID()}`, referencedSha,
    );
    const concurrentInput = input(
      concurrentWorkspaceId, randomUUID(), `lifecycle-concurrent-${randomUUID()}`, referencedSha,
    );
    const cleanupInput = {
      ...input(fixture.workspaceId, randomUUID(), "o".repeat(1_024), cleanupSha),
      mimeType: "application/vnd.flashcards_test+json",
      sizeBytes: 0,
    };
    try {
      await fixture.ownerPool.query(
        `WITH inserted_workspace AS (
           INSERT INTO org.workspaces
             (workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id)
           VALUES ($1, 'Lifecycle concurrent', $2, $3, $4)
           RETURNING workspace_id
         )
         INSERT INTO org.workspace_memberships (workspace_id, user_id, role)
         SELECT workspace_id, $5, 'owner' FROM inserted_workspace`,
        [concurrentWorkspaceId, fixture.createdAt, fixture.replicaId,
          `lifecycle-workspace-${concurrentWorkspaceId}`, fixture.userId],
      );
      await assertLifecycleMigrationUpgrade(fixture, backfillSha);
      await assertCleanupLeaseStartsAfterLockWait(fixture, leaseWaitSha);
      const expiredReference = await createCleanupCandidate(fixture, referenceLeaseSha);
      await assertExpiredCleanupLeaseAllowsOperation(
        fixture, referenceLeaseSha,
        () => fixture.ownerPool.query(
          "SELECT content.fence_media_blob_reference($1)", [expiredReference.blobId],
        ),
      );
      const expiredReservation = await createCleanupCandidate(fixture, reservationLeaseSha);
      await assertExpiredCleanupLeaseAllowsOperation(
        fixture, reservationLeaseSha,
        () => transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, expiredReservation.lifecycleInput),
        ),
      );
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.outOfScopeWorkspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, {
            ...referencedInput, workspaceId: fixture.outOfScopeWorkspaceId,
          }),
        ),
        (error: unknown) => hasSqlState(error, "42501"),
      );
      const [first, concurrent] = await Promise.all([
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, referencedInput),
        ),
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: concurrentWorkspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, concurrentInput),
        ),
      ]);
      assert.notEqual(first.reservationToken, concurrent.reservationToken);
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, {
            ...referencedInput, operationId: `${referencedInput.operationId}-conflict`, sizeBytes: 43,
          }),
        ),
        MediaBlobLifecycleConflictError,
      );
      const adopted = await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        (executor) => reserveMediaBlobWriterInExecutor(executor, {
          ...referencedInput, writerKind: "multipart_completion",
          operationId: `${referencedInput.operationId}-normalization`,
          normalizationVersion: passthroughMediaBlobNormalizationVersion,
        }),
      );
      assert.equal(adopted.normalizationVersion, imageJpegCardMediaBlobNormalizationVersion);
      const generatedAdopted = await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        (executor) => reserveMediaBlobWriterInExecutor(executor, {
          ...referencedInput, writerKind: "generated_promotion",
          mediaAssetId: randomUUID(), operationId: randomUUID(),
          normalizationVersion: passthroughMediaBlobNormalizationVersion,
        }),
      );
      assert.equal(
        generatedAdopted.normalizationVersion,
        imageJpegCardMediaBlobNormalizationVersion,
      );
      const deniedOperations: ReadonlyArray<(executor: DatabaseExecutor) => Promise<unknown>> = [
        (executor) => finalizeMediaBlobWriterInExecutor(executor, {
          reservationToken: first.reservationToken, sha256: referencedSha,
          workspaceId: fixture.workspaceId, mediaAssetId: referencedInput.mediaAssetId,
        }),
        (executor) => markMediaBlobWriterAmbiguousInExecutor(executor, first.reservationToken),
        (executor) => reconcileMediaBlobWriterInExecutor(executor, {
          reservationToken: first.reservationToken, sha256: referencedSha,
          workspaceId: fixture.workspaceId, mediaAssetId: referencedInput.mediaAssetId,
        }),
        (executor) => failMediaBlobWriterInExecutor(executor, first.reservationToken),
      ];
      for (const deniedOperation of deniedOperations) {
        await assert.rejects(
          transactionWithWorkspaceScope(
            { userId: fixture.userId, workspaceId: fixture.outOfScopeWorkspaceId },
            deniedOperation,
          ),
          (error: unknown) => hasSqlState(error, "42501"),
        );
      }
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => finalizeMediaBlobWriterInExecutor(executor, {
            reservationToken: randomUUID(), sha256: referencedSha,
            workspaceId: fixture.workspaceId, mediaAssetId: referencedInput.mediaAssetId,
          }),
        ),
        MediaBlobWriterFenceError,
      );
      await createImageNormalizedMediaAssetForWorkspace(
        fixture.userId,
        fixture.workspaceId,
        {
          mediaAssetId: referencedInput.mediaAssetId, sourceUrl: null,
          createdAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt,
          lastModifiedByReplicaId: fixture.replicaId,
          lastOperationId: referencedInput.operationId,
          sizeBytes: referencedInput.sizeBytes, sha256: referencedSha,
        },
      );
      await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        (executor) => finalizeMediaBlobWriterInExecutor(executor, {
          reservationToken: first.reservationToken, sha256: referencedSha,
          workspaceId: fixture.workspaceId, mediaAssetId: referencedInput.mediaAssetId,
        }),
      );
      await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: concurrentWorkspaceId },
        (executor) => failMediaBlobWriterInExecutor(executor, concurrent.reservationToken),
      );
      await createImageNormalizedMediaAssetForWorkspace(
        fixture.userId, fixture.workspaceId, {
          mediaAssetId: randomUUID(), sourceUrl: null,
          createdAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt,
          lastModifiedByReplicaId: fixture.replicaId,
          lastOperationId: `legacy-${randomUUID()}`, sizeBytes: 42, sha256: legacySha,
        },
      );
      assert.equal((await fixture.ownerPool.query(
        "SELECT normalization_version FROM content.media_blob_lifecycles WHERE sha256 = $1",
        [legacySha],
      )).rows[0]?.normalization_version, imageJpegCardMediaBlobNormalizationVersion);
      const cleanupWriter = await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        (executor) => reserveMediaBlobWriterInExecutor(executor, cleanupInput),
      );
      await fixture.ownerPool.query(
        `INSERT INTO content.media_blobs
           (media_blob_id, sha256, mime_type, size_bytes, storage_key, normalization_version)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cleanupBlobId, cleanupSha, cleanupInput.mimeType, cleanupInput.sizeBytes,
          cleanupInput.storageKey, cleanupInput.normalizationVersion],
      );
      await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        async (executor) => {
        await markMediaBlobWriterAmbiguousInExecutor(
          executor, cleanupWriter.reservationToken,
        );
        assert.equal(await claimMediaBlobCleanupInExecutor(executor, cleanupSha, 60_000), null);
        assert.equal(
          await reconcileMediaBlobWriterInExecutor(executor, {
            reservationToken: cleanupWriter.reservationToken, sha256: cleanupSha,
            workspaceId: cleanupInput.workspaceId, mediaAssetId: cleanupInput.mediaAssetId,
          }),
          "unreferenced",
        );
        },
      );
      assert.equal(
        await transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reconcileMediaBlobWriterInExecutor(executor, {
            reservationToken: cleanupWriter.reservationToken, sha256: cleanupSha,
            workspaceId: cleanupInput.workspaceId, mediaAssetId: cleanupInput.mediaAssetId,
          }),
        ),
        "unreferenced",
      );
      const retriedCleanupWriter = await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        (executor) => reserveMediaBlobWriterInExecutor(executor, cleanupInput),
      );
      assert.equal(retriedCleanupWriter.state, "active");
      assert.notEqual(retriedCleanupWriter.reservationToken, cleanupWriter.reservationToken);
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reconcileMediaBlobWriterInExecutor(executor, {
            reservationToken: cleanupWriter.reservationToken, sha256: cleanupSha,
            workspaceId: cleanupInput.workspaceId, mediaAssetId: cleanupInput.mediaAssetId,
          }),
        ),
        MediaBlobWriterFenceError,
      );
      await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        (executor) => failMediaBlobWriterInExecutor(executor, retriedCleanupWriter.reservationToken),
      );
      await fixture.ownerPool.query(
        "UPDATE content.media_blob_lifecycles SET cleanup_eligible_at = now() - interval '1 second' WHERE sha256 = $1",
        [cleanupSha],
      );
      const cleanupLease = await unsafeTransaction(
        (executor) => claimMediaBlobCleanupInExecutor(executor, cleanupSha, 60_000),
      );
      assert.notEqual(cleanupLease, null);
      assert.equal(
        await unsafeTransaction(
          (executor) => claimMediaBlobCleanupInExecutor(executor, cleanupSha, 60_000),
        ),
        null,
      );
      await assert.rejects(
        transactionWithWorkspaceScope(
          { userId: fixture.userId, workspaceId: fixture.workspaceId },
          (executor) => reserveMediaBlobWriterInExecutor(executor, cleanupInput),
        ),
        MediaBlobLifecycleBusyError,
      );
      await fixture.ownerPool.query(
        `WITH inserted_author AS (
           INSERT INTO catalog.authors (author_id, slug, display_name) VALUES ($1, $3, 'Lifecycle integration')
           RETURNING author_id
         )
         INSERT INTO catalog.packages (package_id, author_id, slug, title, summary, description,
                                       language_tags, topic_tags, license)
         SELECT $2, author_id, $3 || '-package', 'Lifecycle', 'Lifecycle', 'Lifecycle',
                ARRAY['en'], ARRAY[]::text[], 'CC0-1.0'
         FROM inserted_author`,
        [authorId, packageId, catalogSlug],
      );
      const tombstonedAssetId = randomUUID();
      await fixture.ownerPool.query(
        `INSERT INTO content.media_assets
           (media_asset_id, workspace_id, media_blob_id, source_url, created_at,
            client_updated_at, last_modified_by_replica_id, last_operation_id, deleted_at)
         VALUES ($1, $2, $3, NULL, $4, $4, $5, $6, $4)`,
        [tombstonedAssetId, fixture.workspaceId, cleanupBlobId, fixture.createdAt,
          fixture.replicaId, `tombstone-${randomUUID()}`],
      );
      await assert.rejects(
        fixture.ownerPool.query(
          "UPDATE content.media_assets SET deleted_at = NULL WHERE media_asset_id = $1",
          [tombstonedAssetId],
        ),
        (error: unknown) => hasSqlState(error, "55P03"),
      );
      await assert.rejects(
        fixture.ownerPool.query(
          "UPDATE content.media_assets SET media_blob_id = $1 WHERE media_asset_id = $2",
          [cleanupBlobId, referencedInput.mediaAssetId],
        ),
        (error: unknown) => hasSqlState(error, "55P03"),
      );
      await assert.rejects(
        fixture.ownerPool.query(
          `INSERT INTO catalog.package_media_assets
             (package_media_asset_id, package_id, package_media_key, media_blob_id)
           VALUES ($1, $2, 'claimed', $3)`,
          [randomUUID(), packageId, cleanupBlobId],
        ),
        (error: unknown) => hasSqlState(error, "55P03"),
      );
      const mediaRace = await createCleanupCandidate(fixture, mediaRaceSha);
      await assertReferenceWinsCleanupClaim(
        fixture, mediaRaceSha,
        `INSERT INTO content.media_assets
           (media_asset_id, workspace_id, media_blob_id, source_url, created_at,
            client_updated_at, last_modified_by_replica_id, last_operation_id)
         VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
        [mediaRace.lifecycleInput.mediaAssetId, fixture.workspaceId, mediaRace.blobId,
          fixture.createdAt, fixture.replicaId, mediaRace.lifecycleInput.operationId],
      );
      const catalogRace = await createCleanupCandidate(fixture, catalogRaceSha);
      await fixture.ownerPool.query(
        `INSERT INTO content.media_assets
           (media_asset_id, workspace_id, media_blob_id, source_url, created_at,
            client_updated_at, last_modified_by_replica_id, last_operation_id, deleted_at)
         VALUES ($1, $2, $3, NULL, $4, $4, $5, $6, $4)`,
        [catalogRace.lifecycleInput.mediaAssetId, fixture.workspaceId, catalogRace.blobId,
          fixture.createdAt, fixture.replicaId, catalogRace.lifecycleInput.operationId],
      );
      await assertReferenceWinsCleanupClaim(
        fixture, catalogRaceSha,
        `INSERT INTO catalog.package_media_assets
           (package_media_asset_id, package_id, package_media_key, media_blob_id)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), packageId, `race-${randomUUID()}`, catalogRace.blobId],
      );
      const revokedInput = input(
        concurrentWorkspaceId, randomUUID(), `revoked-${randomUUID()}`, revokedSha,
      );
      const revokedReservation = await transactionWithWorkspaceScope(
        { userId: fixture.userId, workspaceId: concurrentWorkspaceId },
        (executor) => reserveMediaBlobWriterInExecutor(executor, revokedInput),
      );
      await fixture.ownerPool.query(
        "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
        [concurrentWorkspaceId, fixture.userId],
      );
      const exactParams: Array<string | number> = [
        revokedReservation.reservationToken, revokedInput.sha256, revokedInput.storageKey,
        revokedInput.mimeType, revokedInput.sizeBytes, revokedReservation.normalizationVersion,
        revokedInput.writerKind, revokedInput.workspaceId, revokedInput.mediaAssetId,
        revokedInput.operationId, 3_600_000,
      ];
      for (const [index, value] of [
        [0, randomUUID()], [1, createUniqueSha256()],
        [2, buildMediaBlobStorageKey(createUniqueSha256())], [3, "image/png"], [4, 43],
        [5, passthroughMediaBlobNormalizationVersion], [7, randomUUID()],
        [8, randomUUID()], [9, `wrong-${randomUUID()}`],
      ] as const) {
        const rejectedParams = [...exactParams];
        rejectedParams[index] = value;
        assert.equal((await fixture.runtimePool.query<{ reconciliation_status: string }>(
          "SELECT content.terminalize_media_blob_writer_failure($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS reconciliation_status",
          rejectedParams,
        )).rows[0]?.reconciliation_status, "stale");
      }
      assert.equal(await unsafeTransaction(
        (executor) => terminalizeMediaBlobWriterFailureInExecutor(executor, {
          ...revokedInput, reservationToken: revokedReservation.reservationToken,
          normalizationVersion: revokedReservation.normalizationVersion,
        }),
      ), "unreferenced");
    } finally {
      await fixture.ownerPool.query("DELETE FROM catalog.packages WHERE package_id = $1", [packageId]);
      await fixture.ownerPool.query("DELETE FROM catalog.authors WHERE author_id = $1", [authorId]);
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blob_writer_reservations WHERE sha256 = ANY($1::text[])",
        [fixtureSha256s],
      );
      await fixture.ownerPool.query(
        `DELETE FROM content.media_blobs AS blobs
         WHERE blobs.sha256 = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM content.media_assets AS assets
                           WHERE assets.media_blob_id = blobs.media_blob_id)
           AND NOT EXISTS (SELECT 1 FROM catalog.package_media_assets AS package_assets
                           WHERE package_assets.media_blob_id = blobs.media_blob_id)`,
        [fixtureSha256s],
      );
      await fixture.ownerPool.query(
        `DELETE FROM content.media_blob_lifecycles AS lifecycles
         WHERE lifecycles.sha256 = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM content.media_blobs AS blobs
                           WHERE blobs.sha256 = lifecycles.sha256)
           AND NOT EXISTS (SELECT 1 FROM content.media_blob_writer_reservations AS reservations
                           WHERE reservations.sha256 = lifecycles.sha256)`,
        [fixtureSha256s],
      );
      await fixture.ownerPool.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1",
        [concurrentWorkspaceId],
      );
    }
  });
});
