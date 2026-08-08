import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  reserveMediaBlobWriterInExecutor,
  type MediaBlobWriterReservation,
} from "../../../mediaAssets/blobLifecycle";
import { testObservationScope } from "../../../mediaAssets/storage/testHelpers";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../../mediaAssets/storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion } from "../../../mediaAssets/types";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import { extractMarkdownImageDestinationUrls } from "../../../workspacePackages/markdownMedia";
import {
  claimGeneratedMediaPromotionJobs,
  enqueueGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJobAfterAccessRevocation,
  failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor,
  GeneratedMediaPromotionJobLeaseLostError,
  markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor,
  markGeneratedMediaPromotionJobAppliedWithExecutor,
  markGeneratedMediaBlobWriterAmbiguous,
  reserveGeneratedMediaBlobWriter,
  rescheduleGeneratedMediaPromotionJobWithExecutor,
  type ClaimedGeneratedMediaPromotionJob,
} from "./jobs";
import {
  byJobId,
  claim,
  createInput,
  createRun,
  hasPostgresCode,
  transition,
  uniqueSha256,
  withSha256,
} from "./jobsPostgresTestSupport";
import {
  applyGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJob,
  processClaimedGeneratedMediaPromotionJobWithDependencies,
  rescheduleGeneratedMediaPromotionJob,
} from "./processor";

type RevocationStateRow = Readonly<{
  job_state: string;
  job_error_code: string | null;
  reservation_state: string | null;
  cleanup_scheduled: boolean | null;
}>;

type AccessNoOpStateRow = Readonly<{
  job_state: string;
  job_error_code: string | null;
  reservation_state: string;
}>;

type RevocationUpgradeRow = Readonly<{
  function_exists: boolean;
  security_definer: boolean;
  exact_search_path: boolean;
  backend_execute: boolean;
  auth_execute: boolean;
  reporting_execute: boolean;
  lock_function_exists: boolean;
  lock_security_definer: boolean;
  lock_exact_search_path: boolean;
  lock_backend_execute: boolean;
  lock_auth_execute: boolean;
  lock_reporting_execute: boolean;
  compatibility_function_exists: boolean;
  compatibility_backend_execute: boolean;
  backend_reservation_select: boolean;
  backend_job_update: boolean;
  writer_support_function_exists: boolean;
  protocol_column_exists: boolean;
  protocol_constraint_exists: boolean;
  backend_protocol_select: boolean;
  backend_protocol_insert: boolean;
  legacy_claim_backend_execute: boolean;
  current_claim_function_exists: boolean;
  current_claim_security_definer: boolean;
  current_claim_exact_search_path: boolean;
  current_claim_backend_execute: boolean;
  current_claim_auth_execute: boolean;
  protocol_activation_exists: boolean;
  protocol_activation_backend_execute: boolean;
}>;

const placeholderTerminalStateMigrationSql = readFileSync(resolve(
  __dirname,
  "../../../../../../db/migrations/0104_generated_image_placeholder_terminal_state.sql",
), "utf8");

async function reserveGeneratedWriter(
  fixture: PostgresIntegrationFixture,
  job: ClaimedGeneratedMediaPromotionJob,
  sha256: string,
): Promise<MediaBlobWriterReservation> {
  return transition(fixture, (executor) => reserveMediaBlobWriterInExecutor(executor, {
    writerKind: "generated_promotion",
    workspaceId: job.workspaceId,
    mediaAssetId: job.mediaAssetId,
    operationId: job.operationId,
    sha256,
    storageKey: buildMediaBlobStorageKey(sha256),
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
  }));
}
function revocationParams(job: ClaimedGeneratedMediaPromotionJob): Array<string | number> {
  return [
    job.jobId, job.leaseToken, job.operationId, job.userId, job.workspaceId,
    job.cardId, job.targetSide, job.altText, job.mediaAssetId, job.replicaId,
    job.stagingStorageKey, job.blobStorageKey, job.sha256, job.mimeType,
    job.sizeBytes, 3_600_000,
  ];
}
async function rawRevocationStatus(
  fixture: PostgresIntegrationFixture,
  params: ReadonlyArray<string | number>,
): Promise<string> {
  const result = await fixture.runtimePool.query<{ revocation_status: string }>(
    `SELECT revocation_status
     FROM content.lock_generated_media_promotion_job_after_access_revocation(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
     )`,
    params.slice(0, 15),
  );
  const status = result.rows[0]?.revocation_status;
  if (status === undefined) throw new Error("PostgreSQL returned no revocation status.");
  return status;
}
async function loadAccessNoOpState(
  fixture: PostgresIntegrationFixture,
  jobId: string,
  reservationToken: string,
): Promise<AccessNoOpStateRow | undefined> {
  const result = await fixture.ownerPool.query<AccessNoOpStateRow>(
    `SELECT
       jobs.state AS job_state,
       jobs.last_error_code AS job_error_code,
       reservations.state AS reservation_state
     FROM content.generated_media_promotion_jobs AS jobs
     INNER JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.reservation_token = $2
     WHERE jobs.job_id = $1`,
    [jobId, reservationToken],
  );
  return result.rows[0];
}
async function assertRevocationMigrationUpgrade(
  fixture: PostgresIntegrationFixture,
): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(placeholderTerminalStateMigrationSql);
    const upgrade = await client.query<RevocationUpgradeRow>(
      `SELECT
         to_regprocedure(
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)'
         ) IS NOT NULL AS function_exists,
         procedures.prosecdef AS security_definer,
         procedures.proconfig = ARRAY['search_path=pg_catalog'] AS exact_search_path,
         has_function_privilege(
           'backend_app',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)',
           'EXECUTE'
         ) AS backend_execute,
         has_function_privilege(
           'auth_app',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)',
           'EXECUTE'
         ) AS auth_execute,
         has_function_privilege(
           'reporting_readonly',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)',
           'EXECUTE'
         ) AS reporting_execute,
         to_regprocedure(
           'content.lock_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint)'
         ) IS NOT NULL AS lock_function_exists,
         lock_procedures.prosecdef AS lock_security_definer,
         lock_procedures.proconfig = ARRAY['search_path=pg_catalog'] AS lock_exact_search_path,
         has_function_privilege(
           'backend_app',
           'content.lock_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint)',
           'EXECUTE'
         ) AS lock_backend_execute,
         has_function_privilege(
           'auth_app',
           'content.lock_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint)',
           'EXECUTE'
         ) AS lock_auth_execute,
         has_function_privilege(
           'reporting_readonly',
           'content.lock_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint)',
           'EXECUTE'
         ) AS lock_reporting_execute,
         to_regprocedure(
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)'
         ) IS NOT NULL AS compatibility_function_exists,
         has_function_privilege(
           'backend_app',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)',
           'EXECUTE'
         ) AS compatibility_backend_execute,
         has_table_privilege(
           'backend_app', 'content.media_blob_writer_reservations', 'SELECT'
         ) AS backend_reservation_select,
         has_table_privilege(
           'backend_app', 'content.generated_media_promotion_jobs', 'UPDATE'
         ) AS backend_job_update,
         to_regprocedure(
           'content.fail_generated_media_promotion_job_with_blob_writer(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)'
         ) IS NOT NULL AS writer_support_function_exists,
         EXISTS (
           SELECT 1
           FROM information_schema.columns AS columns
           WHERE columns.table_schema = 'content'
             AND columns.table_name = 'generated_media_promotion_jobs'
             AND columns.column_name = 'protocol_version'
             AND columns.is_nullable = 'NO'
             AND columns.column_default = '1'
         ) AS protocol_column_exists,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_constraint AS constraints
           WHERE constraints.conrelid = 'content.generated_media_promotion_jobs'::regclass
             AND constraints.conname = 'generated_media_promotion_jobs_protocol_version'
         ) AS protocol_constraint_exists,
         has_column_privilege(
           'backend_app',
           'content.generated_media_promotion_jobs',
           'protocol_version',
           'SELECT'
         ) AS backend_protocol_select,
         has_column_privilege(
           'backend_app',
           'content.generated_media_promotion_jobs',
           'protocol_version',
           'INSERT'
         ) AS backend_protocol_insert,
         has_function_privilege(
           'backend_app',
           'content.claim_generated_media_promotion_jobs(text,integer,integer)',
           'EXECUTE'
         ) AS legacy_claim_backend_execute,
         to_regprocedure(
           'content.claim_generated_media_promotion_jobs(text,integer,integer,integer)'
         ) IS NOT NULL AS current_claim_function_exists,
         current_claim_procedures.prosecdef AS current_claim_security_definer,
         current_claim_procedures.proconfig = ARRAY['search_path=pg_catalog']
           AS current_claim_exact_search_path,
         has_function_privilege(
           'backend_app',
           'content.claim_generated_media_promotion_jobs(text,integer,integer,integer)',
           'EXECUTE'
         ) AS current_claim_backend_execute,
         has_function_privilege(
           'auth_app',
           'content.claim_generated_media_promotion_jobs(text,integer,integer,integer)',
           'EXECUTE'
         ) AS current_claim_auth_execute,
         to_regprocedure(
           'content.generated_media_promotion_protocol_v2_active()'
         ) IS NOT NULL AS protocol_activation_exists,
         has_function_privilege(
           'backend_app',
           'content.generated_media_promotion_protocol_v2_active()',
           'EXECUTE'
         ) AS protocol_activation_backend_execute
       FROM pg_proc AS procedures
       CROSS JOIN pg_proc AS lock_procedures
       CROSS JOIN pg_proc AS current_claim_procedures
       WHERE procedures.oid = to_regprocedure(
         'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)'
       )
         AND lock_procedures.oid = to_regprocedure(
           'content.lock_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint)'
       )
         AND current_claim_procedures.oid = to_regprocedure(
           'content.claim_generated_media_promotion_jobs(text,integer,integer,integer)'
       )`,
    );
    assert.deepEqual(upgrade.rows[0], {
      function_exists: true,
      security_definer: true,
      exact_search_path: true,
      backend_execute: true,
      auth_execute: false,
      reporting_execute: false,
      lock_function_exists: true,
      lock_security_definer: true,
      lock_exact_search_path: true,
      lock_backend_execute: true,
      lock_auth_execute: false,
      lock_reporting_execute: false,
      compatibility_function_exists: true,
      compatibility_backend_execute: true,
      backend_reservation_select: false,
      backend_job_update: false,
      writer_support_function_exists: true,
      protocol_column_exists: true,
      protocol_constraint_exists: true,
      backend_protocol_select: true,
      backend_protocol_insert: true,
      legacy_claim_backend_execute: true,
      current_claim_function_exists: true,
      current_claim_security_definer: true,
      current_claim_exact_search_path: true,
      current_claim_backend_execute: true,
      current_claim_auth_execute: false,
      protocol_activation_exists: true,
      protocol_activation_backend_execute: true,
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
test("access revocation resolves an exact generated writer and fences stale leases", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertRevocationMigrationUpgrade(fixture);
    const run = await createRun(fixture);
    const inputs = Array.from(
      { length: 6 },
      () => withSha256(createInput(fixture, run), uniqueSha256()),
    );
    for (const input of inputs) {
      assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    }
    const initiallyClaimed = await claim("revocation-integration-initial", inputs.length);
    const rescheduled = byJobId(initiallyClaimed, inputs[0]?.jobId ?? "");
    const ambiguous = byJobId(initiallyClaimed, inputs[1]?.jobId ?? "");
    const absent = byJobId(initiallyClaimed, inputs[2]?.jobId ?? "");
    const expired = byJobId(initiallyClaimed, inputs[3]?.jobId ?? "");
    const applied = byJobId(initiallyClaimed, inputs[4]?.jobId ?? "");
    const metadataConflict = byJobId(initiallyClaimed, inputs[5]?.jobId ?? "");
    const rescheduledWriter = await reserveGeneratedWriter(
      fixture, rescheduled, rescheduled.sha256,
    );
    const ambiguousWriter = await reserveGeneratedWriter(
      fixture, ambiguous, ambiguous.sha256,
    );
    const expiredWriter = await reserveGeneratedWriter(
      fixture, expired, expired.sha256,
    );
    const conflictingSha256 = uniqueSha256();
    const metadataConflictWriter = await reserveGeneratedWriter(
      fixture, metadataConflict, conflictingSha256,
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocation(
        rescheduled, Date.now() + 10_000,
      ),
      "access_active",
    );
    assert.deepEqual(
      await loadAccessNoOpState(
        fixture, rescheduled.jobId, rescheduledWriter.reservationToken,
      ),
      {
        job_state: "leased",
        job_error_code: null,
        reservation_state: "active",
      },
    );
    await transition(fixture, (executor) =>
      markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, {
        ...ambiguous,
        reservationToken: ambiguousWriter.reservationToken,
        normalizationVersion: ambiguousWriter.normalizationVersion,
      }));
    await transition(fixture, (executor) =>
      markGeneratedMediaPromotionJobAppliedWithExecutor(executor, applied));
    await transition(fixture, (executor) =>
      rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
        ...rescheduled,
        nextAttemptAt: new Date(),
        error: {
          code: "DATABASE_TRANSIENT",
          message: "Reservation commit outcome requires deterministic replay.",
        },
      }));
    await fixture.ownerPool.query(
      `UPDATE content.generated_media_promotion_jobs
       SET updated_at = created_at,
           lease_expires_at = created_at + interval '1 millisecond'
       WHERE job_id = $1`,
      [expired.jobId],
    );
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    await fixture.ownerPool.query(
      "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [fixture.workspaceId, fixture.userId],
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocation(
        ambiguous, Date.now() + 10_000,
      ),
      "access_active",
    );
    assert.deepEqual(
      await loadAccessNoOpState(
        fixture, ambiguous.jobId, ambiguousWriter.reservationToken,
      ),
      {
        job_state: "leased",
        job_error_code: "DATABASE_COMMIT_OUTCOME_UNKNOWN",
        reservation_state: "ambiguous",
      },
    );
    const parserFencePendingUrl =
      `fcasset:${rescheduled.mediaAssetId}?state=pending`;
    const parserFenceLink = `[Literal lifecycle link](${parserFencePendingUrl})`;
    const parserFenceInlineCode = `\`![Literal lifecycle image](${parserFencePendingUrl})\``;
    const deletedAt = new Date(Date.parse(fixture.createdAt) + 120_000).toISOString();
    await fixture.ownerPool.query(
      `UPDATE content.cards
       SET back_text = back_text || E'\\n\\n' || $1 || E'\\n' || $2,
           deleted_at = $3
       WHERE workspace_id = $4 AND card_id = $5`,
      [
        parserFenceLink,
        parserFenceInlineCode,
        deletedAt,
        fixture.workspaceId,
        fixture.cardId,
      ],
    );
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    await assert.rejects(
      failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, expired,
      ),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const reclaimed = await claim("revocation-integration-reclaimer", 2);
    const reclaimedRescheduled = byJobId(reclaimed, rescheduled.jobId);
    const replacement = byJobId(reclaimed, expired.jobId);
    assert.notEqual(replacement.leaseToken, expired.leaseToken);
    await assert.rejects(
      failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, expired,
      ),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const mismatchedPayloadParams = revocationParams(reclaimedRescheduled);
    mismatchedPayloadParams[6] = reclaimedRescheduled.targetSide === "front" ? "back" : "front";
    assert.equal(
      await rawRevocationStatus(fixture, mismatchedPayloadParams),
      "stale",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, reclaimedRescheduled,
      ),
      "failed",
    );
    const ambiguousResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      ambiguous,
      {
        leaseOwner: "revocation-integration-initial", leaseDurationMs: 60_000,
        maximumJobs: 1, deadlineAtMs: Date.now() + 10_000,
        observationScope: testObservationScope, signal: new AbortController().signal,
      },
      {
        claimJobsFn: claimGeneratedMediaPromotionJobs,
        reserveWriterFn: reserveGeneratedMediaBlobWriter,
        promoteObjectFn: async () => {},
        applyJobFn: applyGeneratedMediaPromotionJob,
        rescheduleJobFn: rescheduleGeneratedMediaPromotionJob,
        failJobFn: failGeneratedMediaPromotionJob,
        failAfterAccessRevocationFn: failGeneratedMediaPromotionJobAfterAccessRevocation,
        markWriterAmbiguousFn: markGeneratedMediaBlobWriterAmbiguous,
        nowFn: Date.now,
      },
    );
    assert.equal(ambiguousResult.outcome, "failed");
    assert.equal(ambiguousResult.errorCode, "WORKSPACE_ACCESS_REVOKED");
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, absent,
      ),
      "failed",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, replacement,
      ),
      "failed",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, applied,
      ),
      "applied",
    );
    const wrongIdentityParams = revocationParams(metadataConflict);
    const wrongMediaAssetId = randomUUID();
    wrongIdentityParams[8] = wrongMediaAssetId;
    wrongIdentityParams[10] = buildMediaUploadStagingStorageKey(
      metadataConflict.workspaceId,
      wrongMediaAssetId,
      metadataConflict.operationId,
    );
    assert.equal(await rawRevocationStatus(fixture, wrongIdentityParams), "stale");
    await assert.rejects(
      failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, metadataConflict,
      ),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    for (const [job, reservation] of [
      [reclaimedRescheduled, rescheduledWriter],
      [ambiguous, ambiguousWriter],
      [replacement, expiredWriter],
    ] as const) {
      const state = await fixture.ownerPool.query<RevocationStateRow>(
        `SELECT
           jobs.state AS job_state,
           jobs.last_error_code AS job_error_code,
           reservations.state AS reservation_state,
           lifecycles.cleanup_eligible_at IS NOT NULL AS cleanup_scheduled
         FROM content.generated_media_promotion_jobs AS jobs
         INNER JOIN content.media_blob_writer_reservations AS reservations
           ON reservations.reservation_token = $2
         INNER JOIN content.media_blob_lifecycles AS lifecycles
           ON lifecycles.sha256 = reservations.sha256
         WHERE jobs.job_id = $1`,
        [job.jobId, reservation.reservationToken],
      );
      assert.deepEqual(state.rows[0], {
        job_state: "failed",
        job_error_code: "WORKSPACE_ACCESS_REVOKED",
        reservation_state: "unreferenced",
        cleanup_scheduled: true,
      });
    }
    assert.deepEqual((await fixture.ownerPool.query<RevocationStateRow>(
      `SELECT
         jobs.state AS job_state,
         jobs.last_error_code AS job_error_code,
         NULL::TEXT AS reservation_state,
         NULL::BOOLEAN AS cleanup_scheduled
       FROM content.generated_media_promotion_jobs AS jobs
       WHERE jobs.job_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM content.media_blob_writer_reservations AS reservations
           WHERE reservations.writer_kind = 'generated_promotion'
             AND reservations.workspace_id = jobs.workspace_id
             AND reservations.media_asset_id = jobs.media_asset_id
             AND reservations.operation_id = jobs.operation_id::TEXT
         )`,
      [absent.jobId],
    )).rows[0], {
      job_state: "failed",
      job_error_code: "WORKSPACE_ACCESS_REVOKED",
      reservation_state: null,
      cleanup_scheduled: null,
    });
    assert.deepEqual((await fixture.ownerPool.query<{
      state: string; last_error_code: string | null;
    }>(
      `SELECT state, last_error_code
       FROM content.generated_media_promotion_jobs
       WHERE job_id = $1`,
      [applied.jobId],
    )).rows[0], { state: "applied", last_error_code: null });
    assert.deepEqual((await fixture.ownerPool.query<{
      job_state: string; reservation_state: string; reservation_sha256: string;
    }>(
      `SELECT
         jobs.state AS job_state,
         reservations.state AS reservation_state,
         reservations.sha256 AS reservation_sha256
       FROM content.generated_media_promotion_jobs AS jobs
       INNER JOIN content.media_blob_writer_reservations AS reservations
         ON reservations.reservation_token = $2
       WHERE jobs.job_id = $1`,
      [metadataConflict.jobId, metadataConflictWriter.reservationToken],
    )).rows[0], {
      job_state: "leased",
      reservation_state: "active",
      reservation_sha256: conflictingSha256,
    });
    const terminalizedCard = await fixture.ownerPool.query<{
      back_text: string;
      card_hot_changes: string;
      deleted_at: Date;
    }>(
      `SELECT
         cards.back_text,
         cards.deleted_at,
         (
           SELECT count(*)::TEXT
           FROM sync.hot_changes AS changes
           WHERE changes.workspace_id = cards.workspace_id
             AND changes.entity_type = 'card'
             AND changes.entity_id = cards.card_id::TEXT
         ) AS card_hot_changes
       FROM content.cards AS cards
       WHERE cards.workspace_id = $1 AND cards.card_id = $2`,
      [fixture.workspaceId, fixture.cardId],
    );
    const terminalizedCardRow = terminalizedCard.rows[0];
    assert.ok(terminalizedCardRow);
    const terminalizedImageDestinations = extractMarkdownImageDestinationUrls(
      terminalizedCardRow.back_text,
    );
    for (const failedJob of [
      reclaimedRescheduled,
      ambiguous,
      absent,
      replacement,
    ]) {
      assert.equal(
        terminalizedImageDestinations.includes(
          `fcasset:${failedJob.mediaAssetId}?state=failed`,
        ),
        true,
      );
      assert.equal(
        terminalizedImageDestinations.includes(
          `fcasset:${failedJob.mediaAssetId}?state=pending`,
        ),
        false,
      );
    }
    assert.equal(
      terminalizedCardRow.back_text.includes(
        `fcasset:${metadataConflict.mediaAssetId}?state=pending`,
      ),
      true,
    );
    assert.equal(terminalizedCardRow.back_text.includes(parserFenceLink), true);
    assert.equal(terminalizedCardRow.back_text.includes(parserFenceInlineCode), true);
    assert.equal(terminalizedCardRow.deleted_at.toISOString(), deletedAt);
    assert.equal(terminalizedCardRow.card_hot_changes, "10");
    await assert.rejects(
      fixture.runtimePool.query(
        "SELECT reservation_token FROM content.media_blob_writer_reservations LIMIT 1",
      ),
      (error: unknown) => hasPostgresCode(error, "42501"),
    );
    await assert.rejects(
      fixture.runtimePool.query(
        "UPDATE content.generated_media_promotion_jobs SET retry_count = retry_count WHERE job_id = $1",
        [metadataConflict.jobId],
      ),
      (error: unknown) => hasPostgresCode(error, "42501"),
    );
  });
});
