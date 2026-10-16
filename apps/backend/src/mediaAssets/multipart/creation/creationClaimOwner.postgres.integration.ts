import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { withPostgresIntegrationFixture } from "../../../testSupport/postgresIntegration";
import {
  acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  handoffMediaAssetUploadSessionCompletionAttempt,
  loadMediaAssetUploadSessionCreationReplayForWorkspace,
  recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  releaseMediaAssetUploadSessionCreationClaimForWorkspace,
  type MultipartMediaBlobWriterAttemptExactInput,
} from "../../uploadSessions";
import { toMultipartAttemptParams } from "../../uploadSessions/shared";
import type { MediaAssetUploadSessionCreateInput } from "../../types";
import {
  applicationObservationScope, completionParts, insertSession, session,
} from "../atomicWriterPostgresTestSupport";
import {
  createMultipartUploadSessionAtApplicationBoundary,
  multipartUploadSessionCreationApplicationDependencies,
} from "./creationBoundary";

test("creation claims and normal handoff keep original proof under canonical ownership", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const target = randomUUID();
    const foreign = randomUUID();
    const later = randomUUID();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const creation = session(fixture, "active", future);
    const released = session(fixture, "active", future);
    const completion = {
      ...session(fixture, "active", future),
      attemptToken: randomUUID(),
      completedPartsFingerprint: createMediaAssetUploadSessionCompletedPartsFingerprint(completionParts()),
    };
    const claimToken = randomUUID();
    const releasedToken = randomUUID();
    const boundaryToken = randomUUID();
    const input: MediaAssetUploadSessionCreateInput = {
      mediaAssetId: creation.mediaAssetId, mimeType: creation.mimeType,
      sizeBytes: creation.sizeBytes, sha256: creation.sha256,
      partSizeBytes: creation.partSizeBytes, partCount: creation.partCount,
      sourceUrl: creation.sourceUrl, createdAt: creation.assetCreatedAt,
      clientUpdatedAt: creation.clientUpdatedAt,
      lastModifiedByReplicaId: creation.lastModifiedByReplicaId,
      lastOperationId: creation.lastOperationId,
    };
    const acquire = (token: string, mediaAssetId: string) =>
      acquireMediaAssetUploadSessionCreationClaimForWorkspace(
        fixture.userId, fixture.workspaceId, mediaAssetId, fixture.replicaId, token, 60_000,
      );
    const contender = await fixture.ownerPool.connect();
    const runtime = await fixture.runtimePool.connect();
    const rawClaim = (token: string, mediaAssetId: string) =>
      runtime.query<{ claim_status: string }>(
        "SELECT * FROM content.acquire_media_upload_session_creation_claim_with_owner($1,$2,$3,$4,$5,$6)",
        [fixture.userId, fixture.workspaceId, mediaAssetId, fixture.replicaId, token, 60_000],
      );
    const rawHandoff = (payload: MultipartMediaBlobWriterAttemptExactInput) =>
      runtime.query<{ attempt_status: string }>(
        "SELECT content.handoff_media_upload_session_completion_attempt($1,$2,ROW(" +
        "$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22" +
        ")::content.multipart_media_blob_writer_attempt_payload) AS attempt_status",
        [payload.attemptToken, payload.reservationToken, ...toMultipartAttemptParams(payload)],
      );
    try {
      await fixture.ownerPool.query(
        "INSERT INTO org.user_settings(user_id) VALUES ($1),($2),($3)", [target, foreign, later],
      );
      const firstClaim = await acquire(claimToken, creation.mediaAssetId);
      assert.equal(firstClaim.status, "acquired");
      assert.equal((await acquire(releasedToken, released.mediaAssetId)).status, "acquired");
      await insertSession(fixture, completion, "active");
      const acquired = await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        completion, Date.now() + 60_000,
      );
      assert.equal(acquired.status, "acquired");
      assert.ok("reservationToken" in acquired);
      const writer: MultipartMediaBlobWriterAttemptExactInput = {
        ...completion, reservationToken: acquired.reservationToken,
        normalizationVersion: acquired.normalizationVersion,
      };
      await contender.query("BEGIN");
      await contender.query(
        "SELECT auth.record_account_retirement($1,$2,$3)", [fixture.userId, target, randomUUID()],
      );
      await contender.query(
        "UPDATE org.workspace_memberships SET user_id=$2 WHERE workspace_id=$1 AND user_id=$3",
        [fixture.workspaceId, target, fixture.userId],
      );
      await contender.query(
        "UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, target],
      );
      await contender.query("COMMIT");

      assert.deepEqual(await acquire(claimToken, creation.mediaAssetId), firstClaim);
      assert.equal((await acquire(claimToken, randomUUID())).status, "stale");
      const recorded = await recordMediaAssetUploadSessionWithCreationClaimForWorkspace(
        fixture.userId, fixture.workspaceId, creation.sessionId, claimToken, input,
        creation.stagingStorageKey, creation.blobStorageKey, creation.s3UploadId, creation.expiresAt,
      );
      assert.equal(recorded.status, "upload_required");
      assert.deepEqual(await acquire(claimToken, creation.mediaAssetId), {
        status: "finalized", uploadSessionId: creation.sessionId,
      });
      const replay = await loadMediaAssetUploadSessionCreationReplayForWorkspace(
        fixture.userId, fixture.workspaceId, creation.sessionId, input,
      );
      assert.equal(replay.uploadSession.sessionId, creation.sessionId);
      assert.equal(replay.uploadSession.lastOperationId, creation.lastOperationId);
      await assert.rejects(
        loadMediaAssetUploadSessionCreationReplayForWorkspace(
          fixture.userId, fixture.workspaceId, creation.sessionId,
          { ...input, lastOperationId: randomUUID() },
        ),
        { code: "MEDIA_ASSET_UPLOAD_SESSION_CREATE_REPLAY_MISMATCH" },
      );
      assert.equal(await releaseMediaAssetUploadSessionCreationClaimForWorkspace(
        fixture.userId, fixture.workspaceId, creation.mediaAssetId, fixture.replicaId, claimToken,
      ), "finalized");
      assert.equal(await releaseMediaAssetUploadSessionCreationClaimForWorkspace(
        fixture.userId, fixture.workspaceId, released.mediaAssetId, fixture.replicaId, releasedToken,
      ), "released");
      assert.equal((await acquire(releasedToken, released.mediaAssetId)).status, "released");

      await runtime.query("BEGIN");
      await runtime.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
        [foreign, fixture.workspaceId],
      );
      assert.equal((await rawClaim(claimToken, creation.mediaAssetId)).rows[0].claim_status, "access_denied");
      assert.equal((await rawHandoff(writer)).rows[0].attempt_status, "access_denied");
      await runtime.query("ROLLBACK");

      // A blocked normal handoff must observe the current replica owner after the wait.
      await contender.query("BEGIN");
      await contender.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2::text,0::bigint))",
        [target, fixture.workspaceId],
      );
      await runtime.query("BEGIN");
      await runtime.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
        [target, fixture.workspaceId],
      );
      const runtimePid = (await runtime.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pendingHandoff = rawHandoff(writer);
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        blocked = (await fixture.ownerPool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS blocked",
          [runtimePid],
        )).rows[0].blocked;
        if (!blocked) await delay(10);
      }
      assert.equal(blocked, true);
      await contender.query(
        "UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, foreign],
      );
      await contender.query("COMMIT");
      assert.equal((await pendingHandoff).rows[0].attempt_status, "ownership_mismatch");
      await runtime.query("ROLLBACK");
      assert.equal((await acquire(randomUUID(), randomUUID())).status, "replica_mismatch");
      await fixture.ownerPool.query(
        "UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, target],
      );

      assert.equal(await handoffMediaAssetUploadSessionCompletionAttempt({
        ...writer, userId: target,
      }), "ownership_mismatch");
      assert.equal(await handoffMediaAssetUploadSessionCompletionAttempt({
        ...writer, completedPartsFingerprint: "0".repeat(64),
      }), "stale_attempt");
      const replacementToken = randomUUID();
      await fixture.ownerPool.query(
        "UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' " +
        "WHERE attempt_token=$1", [writer.attemptToken],
      );
      assert.equal((await acquire(replacementToken, completion.mediaAssetId)).status, "acquired");
      assert.equal(await handoffMediaAssetUploadSessionCompletionAttempt(writer), "stale_attempt");
      assert.equal(await releaseMediaAssetUploadSessionCreationClaimForWorkspace(
        fixture.userId, fixture.workspaceId, completion.mediaAssetId, fixture.replicaId, replacementToken,
      ), "released");
      assert.equal(await handoffMediaAssetUploadSessionCompletionAttempt(writer), "handed_off");
      assert.equal(await handoffMediaAssetUploadSessionCompletionAttempt(writer), "already_pending");
      const stored = (await fixture.ownerPool.query(
        "SELECT user_id,reservation_token,completed_parts_fingerprint,reconciliation_state " +
        "FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [writer.attemptToken],
      )).rows[0];
      assert.deepEqual(stored, {
        user_id: fixture.userId, reservation_token: writer.reservationToken,
        completed_parts_fingerprint: writer.completedPartsFingerprint, reconciliation_state: "pending",
      });
      assert.equal((await fixture.ownerPool.query(
        "SELECT claimed_by_user_id FROM content.media_upload_session_creation_claims WHERE claim_token=$1",
        [claimToken],
      )).rows[0].claimed_by_user_id, fixture.userId);

      // An actual retirement fence refuses persistence without releasing the claim or aborting storage.
      const boundary = session(fixture, "active", future);
      const boundaryInput = {
        ...input, mediaAssetId: boundary.mediaAssetId, sha256: boundary.sha256,
        lastOperationId: boundary.lastOperationId,
      };
      let releases = 0;
      let cleanups = 0;
      await assert.rejects(
        createMultipartUploadSessionAtApplicationBoundary(
          fixture.userId, fixture.workspaceId, boundary.sessionId, boundaryToken, boundaryInput,
          boundary.stagingStorageKey, boundary.blobStorageKey, applicationObservationScope(boundary),
          new AbortController().signal, 60_000,
          {
            ...multipartUploadSessionCreationApplicationDependencies,
            createMultipartMediaAssetUploadFn: async () => {
              await contender.query("BEGIN");
              await contender.query("SELECT auth.lock_account_retirement($1,$2)", [target, later]);
              return {
                storageKey: boundary.stagingStorageKey, s3UploadId: boundary.s3UploadId,
                expiresAt: boundary.expiresAt,
              };
            },
            releaseCreationClaimFn: async (...args) => {
              releases += 1;
              return releaseMediaAssetUploadSessionCreationClaimForWorkspace(...args);
            },
            abortMultipartMediaAssetUploadUntilDeadlineFn: async () => { cleanups += 1; },
          },
        ),
        { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 },
      );
      assert.equal(releases, 0);
      assert.equal(cleanups, 0);
      await runtime.query("BEGIN");
      await runtime.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
        [target, fixture.workspaceId],
      );
      // Original proof is checked before the held canonical fence.
      assert.equal((await rawClaim(claimToken, randomUUID())).rows[0].claim_status, "stale");
      assert.equal((await rawHandoff({ ...writer, userId: target })).rows[0].attempt_status, "ownership_mismatch");
      assert.equal((await runtime.query<{ status: string }>(
        "SELECT content.release_media_upload_session_creation_claim_with_owner($1,$2,$3,$4,$5) AS status",
        [fixture.userId, fixture.workspaceId, randomUUID(), fixture.replicaId, boundaryToken],
      )).rows[0].status, "claim_lost");
      assert.equal((await runtime.query<{ status: string }>(
        "SELECT content.finalize_media_upload_session_creation_claim_with_owner($1,$2,$3,$4,$5,$6) AS status",
        [fixture.userId, fixture.workspaceId, randomUUID(), fixture.replicaId, boundaryToken, boundary.sessionId],
      )).rows[0].status, "claim_lost");
      await assert.rejects(rawClaim(boundaryToken, boundary.mediaAssetId), { code: "P0A01" });
      await runtime.query("ROLLBACK");
      await assert.rejects(
        handoffMediaAssetUploadSessionCompletionAttempt(writer),
        { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 },
      );
      await contender.query("ROLLBACK");
      assert.equal((await fixture.ownerPool.query(
        "SELECT state FROM content.media_upload_session_creation_claims WHERE claim_token=$1", [boundaryToken],
      )).rows[0].state, "leased");
      assert.equal((await fixture.ownerPool.query(
        "SELECT count(*)::int AS count FROM content.media_upload_sessions WHERE media_upload_session_id=$1",
        [boundary.sessionId],
      )).rows[0].count, 0);
      assert.equal((await fixture.ownerPool.query(
        "SELECT count(*)::int AS count FROM org.workspace_memberships WHERE user_id=$1", [fixture.userId],
      )).rows[0].count, 0);
    } finally {
      await contender.query("ROLLBACK");
      contender.release();
      await runtime.query("ROLLBACK");
      runtime.release();
      await fixture.ownerPool.query(
        "DELETE FROM auth.account_retirements WHERE retired_user_id=$1", [fixture.userId],
      );
      await fixture.ownerPool.query(
        "UPDATE sync.workspace_replicas SET user_id=$2 WHERE replica_id=$1", [fixture.replicaId, fixture.userId],
      );
      await fixture.ownerPool.query(
        "UPDATE org.workspace_memberships SET user_id=$2 WHERE workspace_id=$1 AND user_id=$3",
        [fixture.workspaceId, fixture.userId, target],
      );
      await fixture.ownerPool.query(
        "DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [[target, foreign, later]],
      );
    }
  });
});
