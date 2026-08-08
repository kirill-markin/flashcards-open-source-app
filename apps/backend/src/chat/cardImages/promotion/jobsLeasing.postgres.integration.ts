import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { transactionWithWorkspaceScope } from "../../../database";
import { MediaBlobWriterFenceError } from "../../../mediaAssets/blobLifecycle";
import { testObservationScope } from "../../../mediaAssets/storage/testHelpers";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../../mediaAssets/storageKeys";
import { withPostgresIntegrationFixture } from "../../../testSupport/postgresIntegration";
import { extractMarkdownImageDestinationUrls } from "../../../workspacePackages/markdownMedia";
import { InactiveChatRunClaimError } from "../../runs/claimFence";
import {
  assertGeneratedMediaBlobStorageCapabilityForMutation,
  claimGeneratedMediaPromotionJobs,
  enqueueGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJobAfterAccessRevocation,
  failGeneratedMediaPromotionJobWithExecutor,
  failGeneratedMediaPromotionJobWithBlobWriterInExecutor,
  GeneratedMediaPromotionJobConflictError,
  GeneratedMediaPromotionJobLeaseLostError,
  GeneratedMediaPromotionProtocolInactiveError,
  isGeneratedMediaPromotionOperationAppliedWithExecutor,
  markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor,
  markGeneratedMediaPromotionJobAppliedWithExecutor,
  markGeneratedMediaBlobWriterAmbiguous,
  reserveGeneratedMediaBlobWriter,
  rescheduleGeneratedMediaPromotionJobWithExecutor,
  type ClaimedGeneratedMediaPromotionJob,
  type GeneratedMediaBlobStorageCapability,
} from "./jobs";
import {
  byJobId,
  claim,
  createInput,
  createRun,
  hasPostgresCode,
  transition,
  uniqueSha256,
} from "./jobsPostgresTestSupport";
import {
  applyGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJob,
  processClaimedGeneratedMediaPromotionJobWithDependencies,
  rescheduleGeneratedMediaPromotionJob,
} from "./processor";

type JobStateRow = Readonly<{
  state: string;
  retry_count: number;
  last_error_code: string | null;
}>;

type SecurityRow = Readonly<{
  rls_enabled: boolean;
  policy_count: string;
  backend_can_update: boolean;
  backend_can_delete: boolean;
  auth_can_select: boolean;
}>;

const placeholderTerminalStateMigrationSql = readFileSync(resolve(
  __dirname,
  "../../../../../../db/migrations/0104_generated_image_placeholder_terminal_state.sql",
), "utf8");

function immutablePayloadMismatches(
  job: ClaimedGeneratedMediaPromotionJob,
): ReadonlyArray<ClaimedGeneratedMediaPromotionJob> {
  const operationId = randomUUID();
  const workspaceId = randomUUID();
  const mediaAssetId = randomUUID();
  const sha256 = uniqueSha256();
  return [
    {
      ...job,
      operationId,
      stagingStorageKey: buildMediaUploadStagingStorageKey(
        job.workspaceId,
        job.mediaAssetId,
        operationId,
      ),
    },
    { ...job, userId: "forged-generated-promotion-user" },
    {
      ...job,
      workspaceId,
      stagingStorageKey: buildMediaUploadStagingStorageKey(
        workspaceId,
        job.mediaAssetId,
        job.operationId,
      ),
    },
    { ...job, cardId: randomUUID() },
    { ...job, targetSide: job.targetSide === "front" ? "back" : "front" },
    { ...job, altText: "Forged immutable alt text" },
    {
      ...job,
      mediaAssetId,
      stagingStorageKey: buildMediaUploadStagingStorageKey(
        job.workspaceId,
        mediaAssetId,
        job.operationId,
      ),
    },
    { ...job, replicaId: randomUUID() },
    {
      ...job,
      sha256,
      blobStorageKey: buildMediaBlobStorageKey(sha256),
    },
    { ...job, mimeType: "image/png" },
    { ...job, sizeBytes: job.sizeBytes + 1 },
  ];
}

test("promotion jobs enforce enqueue identity, global leasing, fencing, and RLS", async (testContext) => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const concurrentInput = { ...createInput(fixture, run), targetSide: "front" as const };
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob({ ...concurrentInput, claimToken: new Date(0).toISOString() }),
      InactiveChatRunClaimError,
    );
    await fixture.ownerPool.query(
      "UPDATE ai.chat_runs SET cancel_requested_at = now() WHERE run_id = $1",
      [run.runId],
    );
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob(concurrentInput),
      InactiveChatRunClaimError,
    );
    await fixture.ownerPool.query(
      "UPDATE ai.chat_runs SET cancel_requested_at = NULL WHERE run_id = $1",
      [run.runId],
    );
    await fixture.ownerPool.query(
      "UPDATE sync.workspace_replicas SET user_id = 'unowned-replica-user' WHERE replica_id = $1", [fixture.replicaId]);
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob(concurrentInput), (error: unknown) =>
        hasPostgresCode(error, "MEDIA_ASSET_REPLICA_INVALID"),
    );
    await fixture.ownerPool.query(
      "UPDATE sync.workspace_replicas SET user_id = $1 WHERE replica_id = $2", [fixture.userId, fixture.replicaId]);
    const concurrentEnqueue = await Promise.all([
      enqueueGeneratedMediaPromotionJob(concurrentInput),
      enqueueGeneratedMediaPromotionJob(concurrentInput),
    ]);
    assert.deepEqual(concurrentEnqueue.map((result) => result.outcome).sort(), [
      "created", "existing",
    ]);
    assert.deepEqual(
      await enqueueGeneratedMediaPromotionJob(concurrentInput),
      {
        outcome: "existing",
        jobId: concurrentInput.jobId,
        placeholderApplied: true,
      },
    );
    await fixture.ownerPool.query(
      `UPDATE content.cards
       SET front_text = replace(front_text, $1, '')
       WHERE workspace_id = $2 AND card_id = $3`,
      [
        `\n\n![${concurrentInput.altText}](fcasset:${concurrentInput.mediaAssetId}?state=pending)`,
        fixture.workspaceId,
        fixture.cardId,
      ],
    );
    assert.deepEqual(
      await enqueueGeneratedMediaPromotionJob(concurrentInput),
      {
        outcome: "existing",
        jobId: concurrentInput.jobId,
        placeholderApplied: false,
      },
    );
    await fixture.ownerPool.query(
      `UPDATE content.cards
       SET front_text = front_text || E'\\n\\n' || $1
       WHERE workspace_id = $2 AND card_id = $3`,
      [
        `![${concurrentInput.altText}](fcasset:${concurrentInput.mediaAssetId}?state=pending)`,
        fixture.workspaceId,
        fixture.cardId,
      ],
    );
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob({
        ...concurrentInput,
        altText: "Different immutable alt text",
      }),
      GeneratedMediaPromotionJobConflictError,
    );
    const inputs = [
      concurrentInput,
      createInput(fixture, run),
      createInput(fixture, run),
      createInput(fixture, run),
    ];
    for (const input of inputs.slice(1)) {
      assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    }
    const protocolVersions = await fixture.ownerPool.query<{ protocol_version: number }>(
      `SELECT DISTINCT protocol_version
       FROM content.generated_media_promotion_jobs
       WHERE job_id = ANY($1::uuid[])`,
      [inputs.map((input) => input.jobId)],
    );
    assert.deepEqual(protocolVersions.rows, [{ protocol_version: 2 }]);
    const oldWorkerClaims = await fixture.runtimePool.query<{ job_id: string }>(
      "SELECT job_id FROM content.claim_generated_media_promotion_jobs($1, $2, $3)",
      ["pre-lifecycle-worker", 60_000, inputs.length],
    );
    assert.deepEqual(oldWorkerClaims.rows, []);
    const wrongScopeCount = await transactionWithWorkspaceScope(
      { userId: fixture.userId, workspaceId: randomUUID() },
      async (executor) => executor.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM content.generated_media_promotion_jobs",
        [],
      ),
    );
    assert.equal(wrongScopeCount.rows[0]?.count, "0");
    const claims = await Promise.all([
      claim("integration-worker-a", 2),
      claim("integration-worker-b", 2),
    ]);
    const claimed = claims.flat();
    assert.equal(claimed.length, 4);
    assert.equal(new Set(claimed.map((job) => job.jobId)).size, 4);
    assert.equal(new Set(claimed.map((job) => job.leaseToken)).size, 4);
    const applied = byJobId(claimed, inputs[0]?.jobId ?? "");
    assert.equal(applied.userId, fixture.userId);
    await fixture.ownerPool.query(
      "UPDATE sync.workspace_replicas SET user_id = 'reassigned-user' WHERE replica_id = $1",
      [fixture.replicaId],
    );
    await assert.rejects(
      transition(fixture, async (executor) =>
        markGeneratedMediaPromotionJobAppliedWithExecutor(executor, {
          jobId: applied.jobId,
          leaseToken: randomUUID(),
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    for (const mismatchedJob of immutablePayloadMismatches(applied)) {
      await assert.rejects(
        reserveGeneratedMediaBlobWriter(mismatchedJob, Date.now() + 10_000),
        GeneratedMediaPromotionJobLeaseLostError,
      );
    }
    assert.equal((await fixture.ownerPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM content.media_blob_writer_reservations
       WHERE writer_kind = 'generated_promotion'
         AND workspace_id = $1
         AND media_asset_id = $2
         AND operation_id = $3`,
      [applied.workspaceId, applied.mediaAssetId, applied.operationId],
    )).rows[0]?.count, "0");
    let forgedStorageCalls = 0;
    let forgedApplyCalls = 0;
    const forgedResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      { ...applied, altText: "Forged processor payload" },
      {
        leaseOwner: applied.leaseOwner, leaseDurationMs: 60_000,
        maximumJobs: 1, deadlineAtMs: Date.now() + 10_000,
        observationScope: testObservationScope, signal: new AbortController().signal,
      },
      {
        claimJobsFn: async () => [],
        reserveWriterFn: reserveGeneratedMediaBlobWriter,
        promoteObjectFn: async () => {
          forgedStorageCalls += 1;
        },
        applyJobFn: async () => {
          forgedApplyCalls += 1;
        },
        rescheduleJobFn: async () => {
          assert.fail("A forged job must not be rescheduled.");
        },
        failJobFn: async () => {
          assert.fail("A forged job must not reach failure application.");
        },
        failAfterAccessRevocationFn: async () => {
          assert.fail("A forged job must not reach access-revocation resolution.");
        },
        markWriterAmbiguousFn: async () => {
          assert.fail("A forged job must not mark a writer ambiguous.");
        },
        nowFn: Date.now,
      },
    );
    assert.equal(forgedResult.outcome, "lease_lost");
    assert.equal(forgedStorageCalls, 0);
    assert.equal(forgedApplyCalls, 0);
    const appliedWriter = await reserveGeneratedMediaBlobWriter(applied, Date.now() + 10_000);
    assert.doesNotThrow(() => assertGeneratedMediaBlobStorageCapabilityForMutation(
      appliedWriter.storageCapability,
      appliedWriter.writer,
    ));
    for (const mismatchedWriter of [
      { ...appliedWriter.writer, reservationToken: randomUUID() },
      { ...appliedWriter.writer, altText: "Mismatched immutable generated payload" },
    ]) {
      assert.throws(
        () => assertGeneratedMediaBlobStorageCapabilityForMutation(
          appliedWriter.storageCapability,
          mismatchedWriter,
        ),
        MediaBlobWriterFenceError,
      );
    }
    assert.throws(
      () => assertGeneratedMediaBlobStorageCapabilityForMutation(
        Object.freeze({}) as GeneratedMediaBlobStorageCapability,
        appliedWriter.writer,
      ),
      MediaBlobWriterFenceError,
    );
    for (const copiedCapability of [
      Object.freeze({ ...appliedWriter.storageCapability }),
      Object.freeze(Object.create(appliedWriter.storageCapability)),
      Object.freeze(structuredClone(appliedWriter.storageCapability)),
    ] as ReadonlyArray<GeneratedMediaBlobStorageCapability>) {
      assert.throws(
        () => assertGeneratedMediaBlobStorageCapabilityForMutation(
          copiedCapability,
          appliedWriter.writer,
        ),
        MediaBlobWriterFenceError,
      );
    }
    const dateNowMock = testContext.mock.method(
      Date,
      "now",
      () => Date.parse(appliedWriter.writer.leaseExpiresAt),
    );
    try {
      assert.throws(
        () => assertGeneratedMediaBlobStorageCapabilityForMutation(
          appliedWriter.storageCapability,
          appliedWriter.writer,
        ),
        MediaBlobWriterFenceError,
      );
    } finally {
      dateNowMock.mock.restore();
    }
    const promotionDeletedAt = new Date(Date.parse(fixture.createdAt) + 60_000).toISOString();
    await fixture.ownerPool.query(
      "UPDATE content.cards SET deleted_at = $1 WHERE workspace_id = $2 AND card_id = $3",
      [promotionDeletedAt, fixture.workspaceId, fixture.cardId],
    );
    await applyGeneratedMediaPromotionJob(appliedWriter, Date.now() + 10_000);
    await applyGeneratedMediaPromotionJob(appliedWriter, Date.now() + 10_000);
    await transition(fixture, async (executor) => {
      assert.equal(await isGeneratedMediaPromotionOperationAppliedWithExecutor(
        executor, applied.jobId, applied.operationId,
      ), true);
      assert.equal(await isGeneratedMediaPromotionOperationAppliedWithExecutor(
        executor, applied.jobId, randomUUID(),
      ), false);
    });
    const appliedCard = await fixture.ownerPool.query<{
      front_text: string; back_text: string; deleted_at: Date;
    }>(
      `SELECT front_text, back_text, deleted_at
       FROM content.cards
       WHERE workspace_id = $1 AND card_id = $2`,
      [fixture.workspaceId, fixture.cardId],
    );
    assert.equal(
      appliedCard.rows[0]?.back_text,
      [
        "Original answer",
        ...inputs.slice(1).map((input) => (
          `![${input.altText}](fcasset:${input.mediaAssetId}?state=pending)`
        )),
      ].join("\n\n"),
    );
    assert.equal(
      appliedCard.rows[0]?.front_text.match(new RegExp(`fcasset:${applied.mediaAssetId}`, "gu"))?.length,
      1,
    );
    assert.ok(appliedCard.rows[0]?.front_text.startsWith("Original question\n\n![Generated integration image]"));
    assert.equal(appliedCard.rows[0]?.deleted_at.toISOString(), promotionDeletedAt);
    assert.equal(
      (await fixture.ownerPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM content.media_assets WHERE media_asset_id = $1",
        [applied.mediaAssetId],
      )).rows[0]?.count,
      "1",
    );
    const rescheduled = byJobId(claimed, inputs[1]?.jobId ?? "");
    const nextAttemptAt = new Date(Date.now() + 60_000);
    const retryError = { code: "S3_TRANSIENT", message: "Temporary object-store failure." };
    await assert.rejects(
      transition(fixture, async (executor) =>
        rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
          ...rescheduled, leaseToken: randomUUID(), nextAttemptAt, error: retryError,
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await assert.rejects(
      fixture.ownerPool.query(
        `SELECT content.reschedule_generated_media_promotion_job(
           $1, $2, statement_timestamp(), 'S3_TRANSIENT', NULL)`,
        [rescheduled.jobId, rescheduled.leaseToken],
      ),
      (error: unknown) => hasPostgresCode(error, "23514"),
    );
    await transition(fixture, async (executor) =>
      rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
        ...rescheduled, nextAttemptAt, error: retryError,
      }));
    const reclaimedInput = inputs[2];
    if (reclaimedInput === undefined) throw new Error("Missing reclaim input.");
    const expired = byJobId(claimed, reclaimedInput.jobId);
    const writer = await reserveGeneratedMediaBlobWriter(
      expired,
      Date.now() + 10_000,
    );
    const writerInput = writer.writer;
    await assert.rejects(
      transition(fixture, (executor) =>
        markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, {
          ...writerInput, leaseToken: randomUUID(),
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await transition(fixture, (executor) =>
      markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, writerInput));
    await fixture.ownerPool.query(
      `UPDATE content.generated_media_promotion_jobs
       SET updated_at = created_at,
           lease_expires_at = created_at + interval '1 millisecond'
       WHERE job_id = $1`,
      [expired.jobId],
    );
    const reclaimed = byJobId(
      await claim("integration-reclaimer", 1),
      expired.jobId,
    );
    assert.notEqual(reclaimed.leaseToken, expired.leaseToken);
    await assert.rejects(
      transition(fixture, (executor) =>
        markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, writerInput)),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const rescheduledState = await fixture.ownerPool.query<JobStateRow>(
      `SELECT state, retry_count, last_error_code
       FROM content.generated_media_promotion_jobs WHERE job_id = $1`,
      [rescheduled.jobId],
    );
    assert.deepEqual(rescheduledState.rows[0], {
      state: "pending",
      retry_count: 1,
      last_error_code: "S3_TRANSIENT",
    });
    await assert.rejects(
      transition(fixture, async (executor) =>
        failGeneratedMediaPromotionJobWithBlobWriterInExecutor(executor, {
          ...writerInput,
          error: { code: "STALE_WORKER", message: "Stale worker must be fenced." },
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const reclaimedWriter = await reserveGeneratedMediaBlobWriter(
      reclaimed,
      Date.now() + 10_000,
    );
    await failGeneratedMediaPromotionJob(
      reclaimed,
      Date.now() + 10_000,
      { code: "CORRUPT_STAGING", message: "Staged object proof is invalid." },
      reclaimedWriter,
    );
    assert.deepEqual((await fixture.ownerPool.query<{
      job_state: string; reservation_state: string;
    }>(
      `SELECT jobs.state AS job_state, reservations.state AS reservation_state
       FROM content.generated_media_promotion_jobs AS jobs
       INNER JOIN content.media_blob_writer_reservations AS reservations
         ON reservations.reservation_token = $2
       WHERE jobs.job_id = $1`,
      [reclaimed.jobId, writer.reservationToken],
    )).rows[0], { job_state: "failed", reservation_state: "unreferenced" });
    const failedCard = await fixture.ownerPool.query<{ back_text: string; deleted_at: Date }>(
      `SELECT back_text, deleted_at
       FROM content.cards
       WHERE workspace_id = $1 AND card_id = $2`,
      [fixture.workspaceId, fixture.cardId],
    );
    assert.equal(
      failedCard.rows[0]?.back_text.includes(
        `![Generated integration image](fcasset:${reclaimed.mediaAssetId}?state=failed)`,
      ),
      true,
    );
    assert.equal(failedCard.rows[0]?.deleted_at.toISOString(), promotionDeletedAt);
    const terminalInput = inputs[3];
    if (terminalInput === undefined) throw new Error("Missing terminal input.");
    const terminal = byJobId(claimed, terminalInput.jobId);
    const terminalWriter = await reserveGeneratedMediaBlobWriter(terminal, Date.now() + 10_000);
    await transition(fixture, (executor) =>
      rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
        ...terminal,
        nextAttemptAt: new Date(Date.now() + 60_000),
        error: {
          code: "DATABASE_TRANSIENT",
          message: "Generated writer retry must recover without an in-memory token.",
        },
      }));
    await fixture.ownerPool.query(
      "UPDATE content.generated_media_promotion_jobs SET next_attempt_at = created_at WHERE job_id = $1",
      [terminal.jobId],
    );
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    const reclaimedTerminal = byJobId(
      await claim("integration-revoked", 1),
      terminal.jobId,
    );
    const revokedResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      reclaimedTerminal,
      {
        leaseOwner: "integration-revoked", leaseDurationMs: 60_000,
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
    assert.equal(revokedResult.outcome, "failed");
    assert.equal(revokedResult.errorCode, "WORKSPACE_ACCESS_REVOKED");
    assert.equal((await fixture.ownerPool.query<{ state: string }>(
      "SELECT state FROM content.media_blob_writer_reservations WHERE reservation_token = $1",
      [terminalWriter.reservationToken],
    )).rows[0]?.state, "unreferenced");
    await assert.rejects(
      transition(fixture, async (executor) =>
        failGeneratedMediaPromotionJobWithExecutor(executor, {
          ...terminal,
          error: { code: "UNSAFE\nCODE", message: "Unsafe error." },
        })),
      TypeError,
    );
    const security = await fixture.ownerPool.query<SecurityRow>(
      `SELECT
         relrowsecurity AS rls_enabled,
         (SELECT count(*)::text FROM pg_policies
          WHERE schemaname = 'content'
            AND tablename = 'generated_media_promotion_jobs') AS policy_count,
         has_table_privilege('backend_app', 'content.generated_media_promotion_jobs', 'UPDATE')
           AS backend_can_update,
         has_table_privilege('backend_app', 'content.generated_media_promotion_jobs', 'DELETE')
           AS backend_can_delete,
         has_table_privilege('auth_app', 'content.generated_media_promotion_jobs', 'SELECT')
           AS auth_can_select
       FROM pg_class
       WHERE oid = 'content.generated_media_promotion_jobs'::regclass`,
    );
    assert.deepEqual(security.rows[0], {
      rls_enabled: true,
      policy_count: "2",
      backend_can_update: false,
      backend_can_delete: false,
      auth_can_select: false,
    });
    await assert.rejects(
      fixture.ownerPool.query(
        "UPDATE content.generated_media_promotion_jobs SET alt_text = 'Changed' WHERE job_id = $1",
        [applied.jobId],
      ),
      (error: unknown) => hasPostgresCode(error, "23514"),
    );
  });
});

test("protocol activation fences lifecycle jobs from pre-change workers", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const input = createInput(fixture, run);
    const client = await fixture.ownerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DROP FUNCTION content.generated_media_promotion_protocol_v2_active()",
      );
      await client.query("COMMIT");

      await assert.rejects(
        enqueueGeneratedMediaPromotionJob(input),
        GeneratedMediaPromotionProtocolInactiveError,
      );
      assert.equal(
        (await fixture.ownerPool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM content.generated_media_promotion_jobs WHERE job_id = $1",
          [input.jobId],
        )).rows[0]?.count,
        "0",
      );
      assert.deepEqual(
        extractMarkdownImageDestinationUrls(
          (await fixture.ownerPool.query<{ back_text: string }>(
            `SELECT back_text
             FROM content.cards
             WHERE workspace_id = $1 AND card_id = $2`,
            [fixture.workspaceId, fixture.cardId],
          )).rows[0]?.back_text ?? "",
        ),
        [],
      );

      await client.query("BEGIN");
      await client.query(placeholderTerminalStateMigrationSql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    assert.deepEqual(
      await enqueueGeneratedMediaPromotionJob(input),
      {
        outcome: "created",
        jobId: input.jobId,
        placeholderApplied: true,
      },
    );
    assert.deepEqual(
      (await fixture.runtimePool.query<{ job_id: string }>(
        "SELECT job_id FROM content.claim_generated_media_promotion_jobs($1, $2, $3)",
        ["pre-lifecycle-worker", 60_000, 1],
      )).rows,
      [],
    );

    const claimed = await claim("lifecycle-worker", 1);
    assert.equal(claimed[0]?.jobId, input.jobId);
    const writer = await reserveGeneratedMediaBlobWriter(
      byJobId(claimed, input.jobId),
      Date.now() + 10_000,
    );
    await applyGeneratedMediaPromotionJob(writer, Date.now() + 10_000);

    assert.deepEqual(
      (await fixture.ownerPool.query<{ state: string; protocol_version: number }>(
        `SELECT state, protocol_version
         FROM content.generated_media_promotion_jobs
         WHERE job_id = $1`,
        [input.jobId],
      )).rows[0],
      { state: "applied", protocol_version: 2 },
    );
    assert.deepEqual(
      extractMarkdownImageDestinationUrls(
        (await fixture.ownerPool.query<{ back_text: string }>(
          `SELECT back_text
           FROM content.cards
           WHERE workspace_id = $1 AND card_id = $2`,
          [fixture.workspaceId, fixture.cardId],
        )).rows[0]?.back_text ?? "",
      ),
      [`fcasset:${input.mediaAssetId}`],
    );
  });
});

