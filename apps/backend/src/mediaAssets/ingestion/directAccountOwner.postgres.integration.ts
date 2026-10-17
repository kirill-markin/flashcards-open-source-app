import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type pg from "pg";
import { applyWorkspaceDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import { withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import {
  applyImageNormalizedMediaAssetWithDirectWriterForWorkspace,
  loadReusableImageMediaBlobForWorkspace,
  replayImageNormalizedMediaAssetForWorkspace,
} from "..";
import {
  beginDirectMediaBlobWriterAttemptWithOwner,
  reserveDirectMediaBlobWriterWithOwner,
  resolveDirectMediaBlobWriterAttemptFailureWithOwner,
  resolveDirectMediaBlobWriterAttemptAfterAccessRevocation,
  type DirectMediaBlobWriterAttemptInput,
  type DirectMediaBlobWriterAttemptExactInput,
} from "../blobLifecycle";
import { buildMediaBlobStorageKey } from "../storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion } from "../types";

function executorFor(client: pg.PoolClient): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

function exactParams(input: DirectMediaBlobWriterAttemptExactInput): ReadonlyArray<string | number | null> {
  return [
    input.attemptToken, input.reservationToken, input.userId, input.workspaceId,
    input.mediaAssetId, input.operationId, input.lastModifiedByReplicaId,
    input.sha256, input.storageKey, input.mimeType, input.sizeBytes,
    input.normalizationVersion, input.sourceUrl, input.assetCreatedAt, input.clientUpdatedAt,
  ];
}

const fenceExact = `SELECT content.fence_direct_media_blob_writer_attempt_apply_with_owner(
  $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ::content.direct_media_blob_writer_attempt_payload,3600000) AS status`;

async function scopedFence(
  client: pg.PoolClient,
  userId: string,
  writer: DirectMediaBlobWriterAttemptExactInput,
): Promise<string> {
  await client.query("BEGIN");
  try {
    await applyWorkspaceDatabaseScopeInExecutor(executorFor(client), {
      userId, workspaceId: writer.workspaceId,
    });
    const result = await client.query<{ status: string }>(fenceExact, [...exactParams(writer)]);
    await client.query("COMMIT");
    return result.rows[0]!.status;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

test("direct writer keeps original payload and terminal replay under canonical authorization and lifecycle contenders", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const canonical = randomUUID();
    const foreign = randomUUID();
    const later = randomUUID();
    const sha256 = createHash("sha256").update(randomUUID()).digest("hex");
    const request: DirectMediaBlobWriterAttemptInput = {
      attemptToken: randomUUID(), userId: fixture.userId,
      workspaceId: fixture.workspaceId, mediaAssetId: randomUUID(),
      operationId: randomUUID(), lastModifiedByReplicaId: fixture.replicaId,
      sha256, storageKey: buildMediaBlobStorageKey(sha256),
      mimeType: "image/jpeg", sizeBytes: 42,
      normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
      sourceUrl: null, assetCreatedAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt,
    };
    const lease = (): Readonly<{ leaseTargetAt: string; operationDeadlineAt: string }> => ({
      leaseTargetAt: new Date(Date.now() + 60_000).toISOString(),
      operationDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
    });
    const acquired = await beginDirectMediaBlobWriterAttemptWithOwner(request, lease());
    assert.ok("reservationToken" in acquired);
    const writer: DirectMediaBlobWriterAttemptExactInput = {
      ...request, reservationToken: acquired.reservationToken,
      normalizationVersion: acquired.normalizationVersion,
    };
    const runtime = await fixture.runtimePool.connect();
    const contender = await fixture.runtimePool.connect();
    const owner = await fixture.ownerPool.connect();
    try {
      for (const client of [runtime, contender, owner]) {
        await client.query("SET statement_timeout = '5s'");
      }
      await fixture.ownerPool.query(
        "INSERT INTO org.user_settings(user_id) VALUES ($1),($2),($3)",
        [canonical, foreign, later],
      );
      const original = (await owner.query(
        "SELECT to_jsonb(attempts) AS value FROM content.media_blob_writer_attempts AS attempts WHERE attempt_token = $1",
        [writer.attemptToken],
      )).rows[0]!.value;
      const originalReservation = (await owner.query(
        `SELECT to_jsonb(reservations) AS reservation, to_jsonb(snapshots) AS snapshot
         FROM content.media_blob_writer_reservations AS reservations
         JOIN content.media_blob_writer_owner_snapshots AS snapshots USING (reservation_token)
         WHERE reservation_token = $1`, [writer.reservationToken],
      )).rows[0];

      await owner.query("BEGIN");
      await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [fixture.userId, canonical, randomUUID()]);
      await owner.query("UPDATE org.workspace_memberships SET user_id = $2 WHERE user_id = $1", [fixture.userId, canonical]);
      await owner.query("UPDATE sync.workspace_replicas SET user_id = $2 WHERE user_id = $1", [fixture.userId, canonical]);
      await owner.query("COMMIT");

      const reserved = await reserveDirectMediaBlobWriterWithOwner(writer);
      assert.equal(reserved.reservationToken, writer.reservationToken);
      const replayed = await beginDirectMediaBlobWriterAttemptWithOwner(request, lease());
      assert.equal(replayed.status, "replayed");
      assert.ok("reservationToken" in replayed);
      assert.equal(replayed.reservationToken, writer.reservationToken);
      assert.equal(await scopedFence(runtime, canonical, writer), "ready");
      assert.equal(await resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
        writer, 3600000, lease().operationDeadlineAt,
      ), "access_active");
      assert.equal(await scopedFence(runtime, foreign, writer), "access_denied");
      assert.equal(await scopedFence(runtime, canonical, { ...writer, userId: canonical }), "ownership_mismatch");

      // A blocked direct writer holds the canonical writer fence while waiting for current access.
      await owner.query("BEGIN");
      await owner.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2::text,0::bigint))",
        [canonical, fixture.workspaceId],
      );
      const ownerPid = (await owner.query("SELECT pg_backend_pid() AS pid")).rows[0]!.pid as number;
      const runtimePid = (await runtime.query("SELECT pg_backend_pid() AS pid")).rows[0]!.pid as number;
      const pending = Promise.allSettled([scopedFence(runtime, canonical, writer)]);
      try {
        let blocked = false;
        for (let poll = 0; poll < 100; poll += 1) {
          blocked = (await contender.query(
            "SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [ownerPid, runtimePid],
          )).rows[0]!.blocked as boolean;
          if (blocked) break;
          await delay(10);
        }
        assert.equal(blocked, true);
        await assert.rejects(owner.query("SELECT auth.lock_account_retirement($1,$2)", [canonical, later]), { code: "P0A01" });
      } finally {
        await owner.query("ROLLBACK");
      }
      const [waiting] = await pending;
      assert.ok(waiting !== undefined);
      if (waiting.status === "rejected") throw waiting.reason;
      assert.equal(waiting.value, "ready");

      // An already-owned lifecycle fence refuses both ordinary adapters and exact SQL calls.
      await owner.query("BEGIN");
      await owner.query("SELECT auth.lock_account_retirement($1,$2)", [canonical, later]);
      try {
        await assert.rejects(
          beginDirectMediaBlobWriterAttemptWithOwner(request, lease()),
          { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 },
        );
        await assert.rejects(
          resolveDirectMediaBlobWriterAttemptFailureWithOwner(writer, 3600000, lease().operationDeadlineAt),
          { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 },
        );
      } finally {
        await owner.query("ROLLBACK");
      }
      const unchanged = (await owner.query(
        "SELECT to_jsonb(attempts) AS value FROM content.media_blob_writer_attempts AS attempts WHERE attempt_token = $1",
        [writer.attemptToken],
      )).rows[0]!.value;
      assert.deepEqual({ ...unchanged, lease_expires_at: original.lease_expires_at }, original);
      const currentReservation = (await owner.query(
        `SELECT to_jsonb(reservations) AS reservation, to_jsonb(snapshots) AS snapshot
         FROM content.media_blob_writer_reservations AS reservations
         JOIN content.media_blob_writer_owner_snapshots AS snapshots USING (reservation_token)
         WHERE reservation_token = $1`, [writer.reservationToken],
      )).rows[0];
      assert.deepEqual(currentReservation, originalReservation);

      const input = {
        mediaAssetId: writer.mediaAssetId, sha256, sizeBytes: writer.sizeBytes,
        sourceUrl: writer.sourceUrl, createdAt: writer.assetCreatedAt,
        clientUpdatedAt: writer.clientUpdatedAt,
        lastModifiedByReplicaId: writer.lastModifiedByReplicaId, lastOperationId: writer.operationId,
      };
      assert.equal((await applyImageNormalizedMediaAssetWithDirectWriterForWorkspace(
        canonical, fixture.workspaceId, input, writer, lease().operationDeadlineAt,
      )).applied, true);
      const terminal = (await owner.query(
        "SELECT to_jsonb(attempts) AS value FROM content.media_blob_writer_attempts AS attempts WHERE attempt_token = $1",
        [writer.attemptToken],
      )).rows[0]!.value;
      assert.equal(terminal.user_id, fixture.userId);
      assert.equal(terminal.state, "applied");
      assert.equal((await loadReusableImageMediaBlobForWorkspace(
        fixture.userId, fixture.workspaceId, input, Date.now() + 5_000,
      ))?.sha256, sha256);
      assert.equal((await replayImageNormalizedMediaAssetForWorkspace(
        fixture.userId, fixture.workspaceId, input, "live_applied", Date.now() + 5_000,
      )).mediaAsset.mediaAssetId, writer.mediaAssetId);
      assert.equal((await beginDirectMediaBlobWriterAttemptWithOwner(request, lease())).status, "live_applied");
      assert.equal(await scopedFence(runtime, canonical, writer), "live_applied");
      assert.equal(await scopedFence(runtime, foreign, writer), "access_denied");
      assert.equal(await scopedFence(runtime, canonical, { ...writer, operationId: randomUUID() }), "stale_attempt");
      assert.equal((await applyImageNormalizedMediaAssetWithDirectWriterForWorkspace(
        canonical, fixture.workspaceId, input, writer, lease().operationDeadlineAt,
      )).applied, false);
      assert.deepEqual((await owner.query(
        "SELECT to_jsonb(attempts) AS value FROM content.media_blob_writer_attempts AS attempts WHERE attempt_token = $1",
        [writer.attemptToken],
      )).rows[0]!.value, terminal);

      // Establish an old writable snapshot without acquiring a scope fence, then retire its owner.
      await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await runtime.query("SELECT user_id FROM org.user_settings WHERE user_id = $1", [canonical]);
      await runtime.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
        [canonical, fixture.workspaceId],
      );
      await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [canonical, later, randomUUID()]);
      await assert.rejects(runtime.query(fenceExact, [...exactParams(writer)]), { code: "P0A01" });
      await runtime.query("ROLLBACK");
      for (const role of ["backend_app", "auth_app"]) {
        assert.equal((await owner.query(
          "SELECT has_function_privilege($1,'auth.record_account_retirement(text,text,uuid)','EXECUTE') AS allowed", [role],
        )).rows[0]!.allowed, false);
      }
    } finally {
      await Promise.all([runtime.query("ROLLBACK"), contender.query("ROLLBACK"), owner.query("ROLLBACK")]);
      runtime.release();
      contender.release();
      owner.release();
      await fixture.ownerPool.query("DELETE FROM auth.account_retirements WHERE retired_user_id = ANY($1::text[])", [[fixture.userId, canonical]]);
      await fixture.ownerPool.query("UPDATE org.workspace_memberships SET user_id = $2 WHERE user_id = $1", [canonical, fixture.userId]);
      await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id = $2 WHERE user_id = $1", [canonical, fixture.userId]);
      await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[canonical, foreign, later]]);
    }
  });
});
