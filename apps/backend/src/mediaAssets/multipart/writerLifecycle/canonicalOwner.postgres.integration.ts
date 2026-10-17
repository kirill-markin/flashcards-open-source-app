import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { transactionWithWorkspaceScope } from "../../../database";
import { withPostgresIntegrationFixture } from "../../../testSupport/postgresIntegration";
import {
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  completeMediaAssetUploadSessionForWorkspace,
  reserveMediaAssetUploadSessionBlobWriterWithOwner,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptInput,
} from "../../uploadSessions";
import { toMultipartAttemptParams } from "../../uploadSessions/shared";
import {
  applicationObservationScope, close, completionParts, createApplicationDeadlines,
  digest, insertSession, session,
} from "../atomicWriterPostgresTestSupport";
import {
  completeMultipartUploadSessionAtApplicationBoundary,
  multipartCompletionApplicationDependencies,
} from "../completion/completionBoundary";
import { transactionWithMultipartWriterOwnerScope } from "./ownerScope";

test("multipart original leases and terminal replay authorize the canonical owner", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const target = randomUUID();
    const foreign = randomUUID();
    const later = randomUUID();
    const parts = completionParts();
    const input = {
      ...session(fixture, "active", new Date(Date.now() + 3_600_000).toISOString()),
      attemptToken: randomUUID(),
      completedPartsFingerprint: createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
    };
    const abandoned = session(fixture, "completing", new Date(Date.now() + 3_600_000).toISOString());
    const noWriter = session(fixture, "active", new Date(Date.now() - 60_000).toISOString());
    const begin = (payload: MultipartMediaBlobWriterAttemptInput) =>
      beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(payload, Date.now() + 60_000);
    const contender = await fixture.ownerPool.connect();
    const runtime = await fixture.runtimePool.connect();
    const rawBegin = () => runtime.query<{ attempt_status: string }>(
      `SELECT * FROM content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
         $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ::content.multipart_media_blob_writer_attempt_payload)`,
      [input.attemptToken, new Date(Date.now() + 60_000).toISOString(), ...toMultipartAttemptParams(input)],
    );
    try {
      await fixture.ownerPool.query(
        "INSERT INTO org.user_settings(user_id) VALUES ($1),($2),($3)", [target, foreign, later],
      );
      await insertSession(fixture, input, "active");
      const originalRequestSession = await loadMediaAssetUploadSessionForCompletionForWorkspace(
        input.userId, input.workspaceId, input.sessionId,
      );
      await insertSession(fixture, abandoned, "completing");
      await insertSession(fixture, noWriter, "active");
      const acquired = await begin(input);
      assert.equal(acquired.status, "acquired");
      assert.ok("reservationToken" in acquired);
      const originalWriter: MultipartMediaBlobWriterAttemptExactInput = {
        ...input, reservationToken: acquired.reservationToken,
        normalizationVersion: acquired.normalizationVersion,
      };
      const reserved = await reserveMediaAssetUploadSessionBlobWriterWithOwner(
        fixture.userId, fixture.workspaceId, abandoned.sessionId,
      );
      await fixture.ownerPool.query("UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1", [abandoned.sessionId]);
      await contender.query("BEGIN");
      await contender.query("SELECT auth.record_account_retirement($1,$2,$3)", [fixture.userId, target, randomUUID()]);
      await contender.query("UPDATE org.workspace_memberships SET user_id=$2 WHERE workspace_id=$1 AND user_id=$3", [fixture.workspaceId, target, fixture.userId]);
      await contender.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, target]);
      await contender.query("COMMIT");

      await assert.rejects(
        transactionWithWorkspaceScope({ userId: fixture.userId, workspaceId: fixture.workspaceId }, async () => {}),
        { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 },
      );
      const replay = await begin(input);
      assert.equal(replay.status, "replayed");
      assert.ok("reservationToken" in replay);
      assert.equal(replay.reservationToken, acquired.reservationToken);
      assert.equal(replay.normalizationVersion, acquired.normalizationVersion);
      assert.equal((await begin({ ...input, attemptToken: randomUUID() })).status, "busy");
      await assert.rejects(
        beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled(
          { ...input, attemptToken: randomUUID() }, Date.now() + 60_000,
          Date.now() + 30_000, AbortSignal.timeout(500),
        ),
        { name: "TimeoutError" },
      );
      assert.equal((await begin({ ...input, completedPartsFingerprint: digest() })).status, "stale_attempt");
      assert.equal(
        await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
          ...originalWriter, reservationToken: randomUUID(),
        }),
        "writer_conflict",
      );

      await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, foreign]);
      assert.equal((await begin(input)).status, "replica_mismatch");
      await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, target]);
      // The SQL boundary rechecks the current replica after waiting on the canonical access lock.
      await contender.query("BEGIN");
      await contender.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2::text,0::bigint))", [target, fixture.workspaceId]);
      await runtime.query("BEGIN");
      await runtime.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [target, fixture.workspaceId]);
      const runtimePid = (await runtime.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const waitingBegin = rawBegin();
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
          blocked = (await fixture.ownerPool.query<{ blocked: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS blocked",
            [runtimePid],
          )).rows[0].blocked;
          if (!blocked) await delay(10);
        }
        assert.equal(blocked, true);
        await contender.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, foreign]);
      } finally {
        await contender.query("COMMIT");
      }
      assert.equal((await waitingBegin).rows[0].attempt_status, "replica_mismatch");
      await runtime.query("ROLLBACK");
      await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, target]);
      await assert.rejects(
        completeMediaAssetUploadSessionForWorkspace(foreign, fixture.workspaceId, input.sessionId, originalWriter),
        { name: "MediaBlobWriterFenceError" },
      );

      await fixture.ownerPool.query(
        "UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1",
        [input.attemptToken],
      );
      const successorInput = { ...input, attemptToken: randomUUID() };
      const takeover = await begin(successorInput);
      assert.equal(takeover.status, "expired_takeover");
      assert.ok("reservationToken" in takeover);
      assert.equal(takeover.reservationToken, acquired.reservationToken);
      assert.equal(await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(originalWriter), "stale_attempt");
      const writer: MultipartMediaBlobWriterAttemptExactInput = {
        ...successorInput, reservationToken: takeover.reservationToken,
        normalizationVersion: takeover.normalizationVersion,
      };
      const applied = await completeMediaAssetUploadSessionForWorkspace(target, fixture.workspaceId, input.sessionId, writer);
      assert.equal(applied.applied, true);
      assert.equal((await completeMediaAssetUploadSessionForWorkspace(target, fixture.workspaceId, input.sessionId, writer)).applied, false);
      assert.equal((await begin(successorInput)).status, "live_applied");
      const replayDeadlines = createApplicationDeadlines(5_000, 10_000);
      try {
        const terminalReplay = await completeMultipartUploadSessionAtApplicationBoundary(
          input.userId, originalRequestSession, parts, successorInput.attemptToken,
          applicationObservationScope(input), replayDeadlines.operation,
          replayDeadlines.writerLeaseTargetAtMs, replayDeadlines.request,
          {
            ...multipartCompletionApplicationDependencies,
            abortMultipartMediaAssetUploadFn: async () => {
              throw new Error("Terminal replay must not abort storage.");
            },
            completeMultipartMediaAssetUploadFn: async () => {
              throw new Error("Terminal replay must not complete storage.");
            },
          },
        );
        assert.equal(terminalReplay.applied, false);
        assert.deepEqual(terminalReplay.mediaAsset, applied.mediaAsset);
      } finally {
        replayDeadlines.operation.dispose();
        replayDeadlines.request.dispose();
      }
      assert.equal((await begin({ ...successorInput, attemptToken: randomUUID() })).status, "live_applied");
      assert.equal((await begin({ ...successorInput, completedPartsFingerprint: digest() })).status, "stale_attempt");
      assert.equal(await close(abandoned, abandoned.sizeBytes), "unreferenced");
      assert.equal(await close(noWriter, noWriter.sizeBytes), "no_writer_closed");
      const owners = (await fixture.ownerPool.query<{
        attempt_owner: string; snapshot_owner: string; replica_owner: string; source_memberships: number;
      }>(
        `SELECT attempts.user_id AS attempt_owner, snapshots.user_id AS snapshot_owner,
           replicas.user_id AS replica_owner,
           (SELECT count(*)::int FROM org.workspace_memberships WHERE user_id=$2) AS source_memberships
         FROM content.media_blob_writer_attempts AS attempts
         JOIN content.media_blob_writer_owner_snapshots AS snapshots USING (reservation_token)
         JOIN sync.workspace_replicas AS replicas ON replicas.replica_id=attempts.replica_id
         WHERE attempts.attempt_token=$1`,
        [writer.attemptToken, fixture.userId],
      )).rows[0];
      assert.deepEqual(owners, {
        attempt_owner: fixture.userId, snapshot_owner: fixture.userId,
        replica_owner: target, source_memberships: 0,
      });
      assert.equal((await fixture.ownerPool.query(
        "SELECT user_id FROM content.media_blob_writer_owner_snapshots WHERE reservation_token=$1",
        [reserved.reservationToken],
      )).rows[0].user_id, fixture.userId);

      // A writer's canonical fence blocks a competing retirement without waiting on access locks.
      await transactionWithMultipartWriterOwnerScope(
        { userId: fixture.userId, workspaceId: fixture.workspaceId },
        async () => {
          await assert.rejects(
            contender.query("SELECT auth.record_account_retirement($1,$2,$3)", [target, later, randomUUID()]),
            { code: "P0A01" },
          );
        },
      );
      await contender.query("BEGIN");
      await contender.query("SELECT auth.lock_account_retirement($1,$2)", [target, later]);
      await assert.rejects(begin(successorInput), { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 });
      await runtime.query("BEGIN");
      await runtime.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [target, fixture.workspaceId]);
      await assert.rejects(rawBegin(), { code: "P0A01" });
      await runtime.query("ROLLBACK");
      await contender.query("ROLLBACK");
      assert.equal((await begin(successorInput)).status, "live_applied");
    } finally {
      await runtime.query("ROLLBACK");
      runtime.release();
      await contender.query("ROLLBACK");
      contender.release();
      await fixture.ownerPool.query("DELETE FROM auth.account_retirements WHERE retired_user_id=$1", [fixture.userId]);
      await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, fixture.userId]);
      await fixture.ownerPool.query("UPDATE org.workspace_memberships SET user_id=$2 WHERE workspace_id=$1 AND user_id=$3", [fixture.workspaceId, fixture.userId, target]);
      await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [[target, foreign, later]]);
    }
  });
});
