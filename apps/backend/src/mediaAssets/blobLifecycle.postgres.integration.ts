import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import {
  DatabaseDeadlineExceededError, transactionWithWorkspaceScope, transactionWithWorkspaceScopeDeadline, type DatabaseExecutor,
} from "../database";
import { unsafeTransaction } from "../database/unsafe";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../testSupport/postgresIntegration";
import {
  assertDirectMediaBlobStorageCapabilityForMutation,
  beginDirectMediaBlobWriterAttemptWithOwner,
  claimMediaBlobCleanupInExecutor, failMediaBlobWriterInExecutor,
  fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor,
  finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor,
  finalizeMediaBlobWriterInExecutor, markMediaBlobWriterAmbiguousInExecutor,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError, MediaBlobLifecycleConflictError,
  MediaBlobWriterFenceError, MediaBlobWriterLeaseDeadlineError,
  reconcileMediaBlobWriterInExecutor, reserveMediaBlobWriterInExecutor,
  resolveDirectMediaBlobWriterAttemptAfterAccessRevocation,
  resolveDirectMediaBlobWriterAttemptFailureWithOwner,
  terminalizeMediaBlobWriterFailureInExecutor,
  transactionWithDirectMediaBlobWriterApplyDeadline,
  type DirectMediaBlobWriterAttemptInput,
  type DirectMediaBlobWriterAttemptLease,
  type DirectMediaBlobWriterApplyExecutor,
  type DirectMediaBlobStorageCapability,
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
function directAttemptInput(
  fixture: Pick<PostgresIntegrationFixture, "userId" | "workspaceId" | "replicaId" | "createdAt">,
  sha256: string,
): DirectMediaBlobWriterAttemptInput {
  return {
    attemptToken: randomUUID(), userId: fixture.userId, workspaceId: fixture.workspaceId,
    mediaAssetId: randomUUID(), operationId: randomUUID(),
    lastModifiedByReplicaId: fixture.replicaId, sha256,
    storageKey: buildMediaBlobStorageKey(sha256), mimeType: "image/jpeg", sizeBytes: 42,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion, sourceUrl: null,
    assetCreatedAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt,
  };
}
function createDirectAttemptDeadline(): string {
  return new Date(Date.now() + 30_000).toISOString();
}
function createDirectAttemptLease(): DirectMediaBlobWriterAttemptLease {
  const nowMs = Date.now();
  return {
    leaseTargetAt: new Date(nowMs + 60_000).toISOString(),
    operationDeadlineAt: new Date(nowMs + 30_000).toISOString(),
  };
}
async function insertDirectAttemptAsset(
  executor: DatabaseExecutor, input: DirectMediaBlobWriterAttemptInput,
): Promise<void> {
  await executor.query(
    `WITH blob AS (INSERT INTO content.media_blobs (media_blob_id,sha256,mime_type,size_bytes,storage_key,normalization_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING media_blob_id) INSERT INTO content.media_assets (media_asset_id,workspace_id,media_blob_id,source_url,created_at,client_updated_at,last_modified_by_replica_id,last_operation_id) SELECT $7,$8,media_blob_id,$9,$10,$11,$12,$13 FROM blob`,
    [randomUUID(), input.sha256, input.mimeType, input.sizeBytes, input.storageKey,
      input.normalizationVersion, input.mediaAssetId, input.workspaceId, input.sourceUrl,
      input.assetCreatedAt, input.clientUpdatedAt, input.lastModifiedByReplicaId, input.operationId],
  );
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
      DROP TABLE content.media_blob_writer_owner_snapshots;
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

async function waitForDirectAttemptAdvisoryLock(
  fixture: PostgresIntegrationFixture,
): Promise<void> {
  const deadlineAtMs = Date.now() + 2_000;
  for (;;) {
    const waiting = (await fixture.ownerPool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity
         WHERE usename = 'backend_app'
           AND wait_event_type = 'Lock'
           AND query LIKE '%begin_direct_media_blob_writer_attempt_with_owner%'
       ) AS waiting`,
    )).rows[0]?.waiting;
    if (waiting === true) return;
    if (Date.now() >= deadlineAtMs) {
      throw new Error("Direct writer attempt did not reach its advisory lock.");
    }
    await wait(10);
  }
}

test("direct writer acquisition rolls back a lease extended by lock latency", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const sha256 = createUniqueSha256();
    const attemptInput = directAttemptInput(fixture, sha256);
    const holder = await fixture.ownerPool.connect();
    let holderCommitted = false;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0))",
        [fixture.userId, fixture.workspaceId],
      );
      const nowMs = Date.now();
      const outcome = beginDirectMediaBlobWriterAttemptWithOwner(
        attemptInput,
        {
          operationDeadlineAt: new Date(nowMs + 4_000).toISOString(),
          leaseTargetAt: new Date(nowMs + 5_000).toISOString(),
        },
      ).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await waitForDirectAttemptAdvisoryLock(fixture);
      await wait(250);
      await holder.query("COMMIT");
      holderCommitted = true;

      const settled = await outcome;
      assert.equal(settled.value, null);
      assert.ok(settled.error instanceof MediaBlobWriterLeaseDeadlineError);
      const residue = (await fixture.ownerPool.query<{
        attempt_exists: boolean;
        reservation_exists: boolean;
        lifecycle_exists: boolean;
      }>(
        `SELECT
           EXISTS (
             SELECT 1 FROM content.media_blob_writer_attempts
             WHERE attempt_token = $1
           ) AS attempt_exists,
           EXISTS (
             SELECT 1 FROM content.media_blob_writer_reservations
             WHERE sha256 = $2
           ) AS reservation_exists,
           EXISTS (
             SELECT 1 FROM content.media_blob_lifecycles
             WHERE sha256 = $2
           ) AS lifecycle_exists`,
        [attemptInput.attemptToken, sha256],
      )).rows[0];
      assert.deepEqual(residue, {
        attempt_exists: false,
        reservation_exists: false,
        lifecycle_exists: false,
      });
    } finally {
      if (!holderCommitted) {
        await holder.query("ROLLBACK");
      }
      holder.release();
    }
  });
});

test("media blob lifecycle coordinates writers, ambiguity, cleanup leases, and global grants", async (testContext) => {
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
    const attemptSha = createUniqueSha256();
    const failedAttemptSha = createUniqueSha256();
    const takeoverAttemptSha = createUniqueSha256();
    const revokedAttemptSha = createUniqueSha256();
    const abortedAttemptSha = createUniqueSha256();
    const snapshotAttemptSha = createUniqueSha256();
    const deadlineAttemptSha = createUniqueSha256();
    const deniedAttemptSha = createUniqueSha256();
    const attemptFixtureSha256s = [
      attemptSha, failedAttemptSha, takeoverAttemptSha, revokedAttemptSha, abortedAttemptSha,
      snapshotAttemptSha, deadlineAttemptSha, deniedAttemptSha,
    ];
    const fixtureSha256s = [
      referencedSha, cleanupSha, mediaRaceSha, catalogRaceSha, legacySha, backfillSha, leaseWaitSha,
      referenceLeaseSha, reservationLeaseSha, revokedSha, ...attemptFixtureSha256s,
    ];
    const cleanupBlobId = randomUUID();
    const concurrentWorkspaceId = randomUUID();
    const abortedWorkspaceId = randomUUID();
    const abortedReplicaId = randomUUID();
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
      const attemptInput = directAttemptInput(fixture, attemptSha);
      const initialLease = createDirectAttemptLease();
      const attempt = await beginDirectMediaBlobWriterAttemptWithOwner(attemptInput, initialLease);
      assert.equal(attempt.status, "acquired");
      if (!("reservationToken" in attempt)) throw new Error("Direct attempt did not return a token.");
      assert.equal((await fixture.ownerPool.query<{ committed: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM content.media_blob_writer_attempts WHERE attempt_token=$1 AND reservation_token=$2) AS committed",
        [attemptInput.attemptToken, attempt.reservationToken],
      )).rows[0]?.committed, true);
      const exactAttempt = { ...attemptInput, reservationToken: attempt.reservationToken,
        normalizationVersion: attempt.normalizationVersion };
      assert.doesNotThrow(() => assertDirectMediaBlobStorageCapabilityForMutation(
        attempt.storageCapability, exactAttempt,
      ));
      for (const mismatch of [
        { ...exactAttempt, attemptToken: randomUUID() },
        { ...exactAttempt, reservationToken: randomUUID() },
        { ...exactAttempt, sourceUrl: "https://mismatch.invalid/" },
      ]) assert.throws(
        () => assertDirectMediaBlobStorageCapabilityForMutation(
          attempt.storageCapability, mismatch,
        ),
        MediaBlobWriterFenceError,
      );
      assert.throws(() => assertDirectMediaBlobStorageCapabilityForMutation(
        Object.freeze({}) as DirectMediaBlobStorageCapability, exactAttempt,
      ), MediaBlobWriterFenceError);
      for (const copy of [
        Object.freeze({ ...attempt.storageCapability }),
        Object.freeze(Object.create(attempt.storageCapability)),
        Object.freeze(structuredClone(attempt.storageCapability)),
      ] as ReadonlyArray<DirectMediaBlobStorageCapability>) {
        assert.throws(() => assertDirectMediaBlobStorageCapabilityForMutation(
          copy, exactAttempt,
        ), MediaBlobWriterFenceError);
      }
      const dateNowMock = testContext.mock.method(
        Date, "now", () => Date.parse(initialLease.operationDeadlineAt),
      );
      try {
        assert.throws(() => assertDirectMediaBlobStorageCapabilityForMutation(
          attempt.storageCapability, exactAttempt,
        ), MediaBlobWriterFenceError);
      } finally {
        dateNowMock.mock.restore();
      }
      const snapshotBase = directAttemptInput(fixture, snapshotAttemptSha);
      let sourceUrlReads = 0;
      const getterInput = Object.defineProperty({ ...snapshotBase }, "sourceUrl", {
        enumerable: true,
        get: () => (sourceUrlReads += 1) === 1 ? null : "https://mutated.invalid/",
      }) as DirectMediaBlobWriterAttemptInput;
      const snapshotAttempt = await beginDirectMediaBlobWriterAttemptWithOwner(
        getterInput, createDirectAttemptLease(),
      );
      assert.equal(sourceUrlReads, 1);
      if (!("reservationToken" in snapshotAttempt)) throw new Error("Snapshot attempt did not acquire.");
      const exactSnapshot = { ...snapshotBase, reservationToken: snapshotAttempt.reservationToken,
        normalizationVersion: snapshotAttempt.normalizationVersion };
      assert.doesNotThrow(() => assertDirectMediaBlobStorageCapabilityForMutation(
        snapshotAttempt.storageCapability, exactSnapshot,
      ));
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        exactSnapshot, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "unreferenced");
      assert.equal((await beginDirectMediaBlobWriterAttemptWithOwner(
        snapshotBase, createDirectAttemptLease(),
      )).status, "unreferenced");
      const invalidSourceInput = directAttemptInput(fixture, createUniqueSha256());
      Object.defineProperty(invalidSourceInput, "sourceUrl", { value: 42 });
      assert.throws(() => beginDirectMediaBlobWriterAttemptWithOwner(
        invalidSourceInput, createDirectAttemptLease()), TypeError);
      const deadlineHolder = await fixture.ownerPool.connect();
      try {
        await deadlineHolder.query("BEGIN");
        await deadlineHolder.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0))",
          [fixture.userId, fixture.workspaceId],
        );
        const deadlineFailure = (error: unknown): boolean =>
          error instanceof DatabaseDeadlineExceededError || hasSqlState(error, "55P03") || hasSqlState(error, "57014");
        const deadlineNowMs = Date.now();
        await assert.rejects(beginDirectMediaBlobWriterAttemptWithOwner(
          directAttemptInput(fixture, deadlineAttemptSha), {
            leaseTargetAt: new Date(deadlineNowMs + 2_000).toISOString(),
            operationDeadlineAt: new Date(deadlineNowMs + 500).toISOString(),
          }), deadlineFailure);
        await assert.rejects(resolveDirectMediaBlobWriterAttemptFailureWithOwner(
          exactAttempt, mediaBlobCleanupDelayMs,
          new Date(Date.now() + 500).toISOString()), deadlineFailure);
        await assert.rejects(resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
          exactAttempt, mediaBlobCleanupDelayMs,
          new Date(Date.now() + 500).toISOString()), deadlineFailure);
        const applyLockDeadline = new Date(Date.now() + 500).toISOString();
        await assert.rejects(transactionWithDirectMediaBlobWriterApplyDeadline(
          exactAttempt,
          applyLockDeadline,
          (executor, snapshot, exactDeadline) =>
            fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
              executor, snapshot, mediaBlobCleanupDelayMs, exactDeadline,
            ),
        ), deadlineFailure);
      } finally {
        await deadlineHolder.query("ROLLBACK");
        deadlineHolder.release();
      }
      const renewed = await beginDirectMediaBlobWriterAttemptWithOwner(
        attemptInput, createDirectAttemptLease(),
      );
      assert.equal(renewed.status, "replayed");
      if (!("reservationToken" in renewed)) throw new Error("Renewal did not return a token.");
      assert.equal(renewed.reservationToken, attempt.reservationToken);
      assert.doesNotThrow(() => assertDirectMediaBlobStorageCapabilityForMutation(
        renewed.storageCapability, exactAttempt,
      ));
      assert.equal(
        (await beginDirectMediaBlobWriterAttemptWithOwner(
          { ...attemptInput, attemptToken: randomUUID() }, createDirectAttemptLease(),
        )).status,
        "busy",
      );
      assert.equal((await beginDirectMediaBlobWriterAttemptWithOwner(
        { ...directAttemptInput(fixture, createUniqueSha256()),
          lastModifiedByReplicaId: randomUUID() }, createDirectAttemptLease(),
      )).status, "replica_mismatch");
      assert.equal(
        await resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
          exactAttempt, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
        ),
        "access_active",
      );
      const ordinaryExecutorDeadline = createDirectAttemptDeadline();
      await assert.rejects(transactionWithWorkspaceScopeDeadline(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        Date.parse(ordinaryExecutorDeadline),
        (executor) => fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
          executor as DirectMediaBlobWriterApplyExecutor,
          exactAttempt, mediaBlobCleanupDelayMs, ordinaryExecutorDeadline,
        ),
      ), TypeError);
      const rollbackDeadline = createDirectAttemptDeadline();
      let rolledBackExecutor: DirectMediaBlobWriterApplyExecutor | null = null;
      await assert.rejects(transactionWithDirectMediaBlobWriterApplyDeadline(
        exactAttempt,
        rollbackDeadline,
        async (executor, snapshot, exactDeadline) => {
          rolledBackExecutor = executor;
          const copiedExecutor: DatabaseExecutor = Object.freeze({ ...executor });
          const wrappedExecutor: DatabaseExecutor = Object.freeze({ query: executor.query });
          for (const lookalike of [
            copiedExecutor as DirectMediaBlobWriterApplyExecutor,
            wrappedExecutor as DirectMediaBlobWriterApplyExecutor,
          ]) {
            assert.throws(() => fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
              lookalike, snapshot, mediaBlobCleanupDelayMs, exactDeadline,
            ), TypeError);
          }
          const mismatchedDeadline = new Date(Date.parse(exactDeadline) + 1).toISOString();
          assert.throws(() => fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
            executor, snapshot, mediaBlobCleanupDelayMs, mismatchedDeadline,
          ), TypeError);
          assert.throws(() => finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
            executor, snapshot, mediaBlobCleanupDelayMs, mismatchedDeadline,
          ), TypeError);
          for (const mismatchedAttempt of [
            exactSnapshot,
            { ...snapshot, attemptToken: exactSnapshot.attemptToken },
            { ...snapshot, reservationToken: exactSnapshot.reservationToken },
            { ...snapshot, sourceUrl: "https://mismatched-payload.invalid/" },
          ]) {
            assert.throws(() => fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
              executor, mismatchedAttempt, mediaBlobCleanupDelayMs, exactDeadline,
            ), TypeError);
            assert.throws(() => finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
              executor, mismatchedAttempt, mediaBlobCleanupDelayMs, exactDeadline,
            ), TypeError);
          }
          assert.equal(await fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
            executor, snapshot, mediaBlobCleanupDelayMs, exactDeadline,
          ), "ready");
          throw new Error("Direct writer apply rollback evidence.");
        },
      ), /Direct writer apply rollback evidence/u);
      const exactRolledBackExecutor = rolledBackExecutor;
      if (exactRolledBackExecutor === null) {
        throw new Error("Apply executor did not enter rollback evidence.");
      }
      assert.throws(() => fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
        exactRolledBackExecutor, exactAttempt, mediaBlobCleanupDelayMs, rollbackDeadline,
      ), TypeError);
      const applyDeadline = createDirectAttemptDeadline();
      await transactionWithDirectMediaBlobWriterApplyDeadline(
        exactAttempt,
        applyDeadline,
        async (executor, snapshot, exactDeadline) => {
          assert.equal(await fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
            executor, snapshot, mediaBlobCleanupDelayMs, exactDeadline,
          ), "ready");
          await insertDirectAttemptAsset(executor, snapshot);
          assert.equal(await finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
            executor, snapshot, mediaBlobCleanupDelayMs, exactDeadline,
          ), "live_applied");
        },
      );
      assert.equal((await beginDirectMediaBlobWriterAttemptWithOwner(
        attemptInput, createDirectAttemptLease(),
      )).status, "live_applied");
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        exactAttempt, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "live_applied");
      const failedInput = directAttemptInput(fixture, failedAttemptSha);
      const failed = await beginDirectMediaBlobWriterAttemptWithOwner(
        failedInput, createDirectAttemptLease(),
      );
      if (!("reservationToken" in failed)) throw new Error("Failed attempt did not acquire.");
      const exactFailed = { ...failedInput, reservationToken: failed.reservationToken,
        normalizationVersion: failed.normalizationVersion };
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        { ...exactFailed, reservationToken: randomUUID() },
        mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "writer_conflict");
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        exactFailed, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "unreferenced");
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        exactFailed, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "unreferenced");
      const terminalReplayDeadline = createDirectAttemptDeadline();
      assert.equal(await transactionWithDirectMediaBlobWriterApplyDeadline(
        exactFailed,
        terminalReplayDeadline,
        (executor, snapshot, exactDeadline) =>
          finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
            executor, snapshot, mediaBlobCleanupDelayMs, exactDeadline),
      ), "unreferenced");
      const takeoverInput = directAttemptInput(fixture, takeoverAttemptSha);
      const expiring = await beginDirectMediaBlobWriterAttemptWithOwner(
        takeoverInput, createDirectAttemptLease(),
      );
      if (!("reservationToken" in expiring)) throw new Error("Expiring attempt did not acquire.");
      await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [takeoverInput.attemptToken]);
      const takeoverInputNext = { ...takeoverInput, attemptToken: randomUUID() };
      const takeover = await beginDirectMediaBlobWriterAttemptWithOwner(
        takeoverInputNext, createDirectAttemptLease(),
      );
      assert.equal(takeover.status, "expired_takeover");
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        { ...takeoverInput, reservationToken: expiring.reservationToken,
          normalizationVersion: expiring.normalizationVersion }, mediaBlobCleanupDelayMs,
        createDirectAttemptDeadline(),
      ), "stale_attempt");
      const revokedAttemptInput = directAttemptInput(fixture, revokedAttemptSha);
      const revoked = await beginDirectMediaBlobWriterAttemptWithOwner(
        revokedAttemptInput, createDirectAttemptLease(),
      );
      if (!("reservationToken" in revoked)) throw new Error("Revoked attempt did not acquire.");
      const exactRevoked = { ...revokedAttemptInput, reservationToken: revoked.reservationToken,
        normalizationVersion: revoked.normalizationVersion };
      await fixture.ownerPool.query("DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [fixture.workspaceId, fixture.userId]);
      assert.equal((await beginDirectMediaBlobWriterAttemptWithOwner(
        directAttemptInput(fixture, deniedAttemptSha), createDirectAttemptLease(),
      )).status, "access_denied");
      assert.equal(await resolveDirectMediaBlobWriterAttemptFailureWithOwner(
        exactRevoked, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "access_denied");
      assert.equal(await resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
        exactRevoked, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "busy");
      await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [revokedAttemptInput.attemptToken]);
      assert.equal(await resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
        exactRevoked, mediaBlobCleanupDelayMs, createDirectAttemptDeadline()), "unreferenced");
      assert.equal(await resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
        exactRevoked, mediaBlobCleanupDelayMs, createDirectAttemptDeadline(),
      ), "unreferenced");
      await fixture.ownerPool.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [fixture.workspaceId, fixture.userId]);
      await fixture.ownerPool.query(
        `WITH workspace AS (
           INSERT INTO org.workspaces (workspace_id,name,fsrs_client_updated_at,
             fsrs_last_modified_by_replica_id,fsrs_last_operation_id)
           VALUES ($1,'Aborted wrapper evidence',$2,$3,$4) RETURNING workspace_id),
         membership AS (
           INSERT INTO org.workspace_memberships(workspace_id,user_id,role) SELECT workspace_id,$5,'owner' FROM workspace)
         INSERT INTO sync.workspace_replicas (replica_id,workspace_id,user_id,actor_kind,actor_key,platform,app_version)
         VALUES ($3,$1,$5,'ai_chat',$6,'system','postgres-integration')`,
        [abortedWorkspaceId, fixture.createdAt, abortedReplicaId, randomUUID(), fixture.userId,
          `postgres-integration-${abortedReplicaId}`],
      );
      const abortedInput = directAttemptInput({
        userId: fixture.userId, workspaceId: abortedWorkspaceId,
        replicaId: abortedReplicaId, createdAt: fixture.createdAt,
      }, abortedAttemptSha);
      const aborted = await beginDirectMediaBlobWriterAttemptWithOwner(
        abortedInput, createDirectAttemptLease(),
      );
      if (!("reservationToken" in aborted)) throw new Error("Aborted attempt did not acquire.");
      await fixture.ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [abortedWorkspaceId]);
      assert.equal((await beginDirectMediaBlobWriterAttemptWithOwner(
        abortedInput, createDirectAttemptLease(),
      )).status, "aborted");
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
      await fixture.ownerPool.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1", [abortedWorkspaceId],
      );
      await fixture.ownerPool.query("DELETE FROM catalog.packages WHERE package_id = $1", [packageId]);
      await fixture.ownerPool.query("DELETE FROM catalog.authors WHERE author_id = $1", [authorId]);
      await fixture.ownerPool.query("DELETE FROM content.media_assets WHERE media_blob_id IN (SELECT media_blob_id FROM content.media_blobs WHERE sha256=ANY($1::text[]))", [attemptFixtureSha256s]);
      await fixture.ownerPool.query("DELETE FROM content.media_blob_writer_attempts WHERE sha256=ANY($1::text[])", [attemptFixtureSha256s]);
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
      const attemptResidue = (await fixture.ownerPool.query(`SELECT (SELECT count(*)::int FROM content.media_blob_writer_attempts WHERE sha256=ANY($1::text[])) AS attempts,(SELECT count(*)::int FROM content.media_blob_writer_reservations WHERE sha256=ANY($1::text[])) AS reservations,(SELECT count(*)::int FROM content.media_blob_lifecycles WHERE sha256=ANY($1::text[])) AS lifecycles,(SELECT count(*)::int FROM content.media_blobs WHERE sha256=ANY($1::text[])) AS blobs`, [attemptFixtureSha256s])).rows[0];
      assert.deepEqual(attemptResidue, { attempts: 0, reservations: 0, lifecycles: 0, blobs: 0 });
      await fixture.ownerPool.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1",
        [concurrentWorkspaceId],
      );
    }
  });
});
