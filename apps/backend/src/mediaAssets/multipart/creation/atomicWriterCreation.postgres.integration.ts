import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { unsafeTransaction } from "../../../database/unsafe";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import {
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionWithOwner,
  beginMediaAssetUploadSessionCompletionWithOwnerAndParts,
  beginMediaAssetUploadSessionCompletionWithOwnerInExecutor,
  resolveMediaAssetUploadSessionCompletionAfterAccessRevocation,
} from "../../uploadSessions";
import {
  close,
  completeLegacyMultipartSession,
  insertSession,
  session,
} from "../atomicWriterPostgresTestSupport";

const migration0094 = readFileSync(resolve(
  __dirname, "../../../../../../db/migrations/0094_direct_multipart_writer_abandonment.sql",
), "utf8");
const migration0095 = readFileSync(resolve(
  __dirname, "../../../../../../db/migrations/0095_atomic_multipart_writer_completion.sql",
), "utf8");
const closerStart = migration0094.indexOf(
  "CREATE FUNCTION content.close_media_upload_session_blob_writer(",
);
const closerEnd = migration0094.indexOf(
  "CREATE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete()",
  closerStart,
);
const previousCloserSql = migration0094.slice(closerStart, closerEnd);
const beginSignature = "content.begin_media_upload_session_completion_with_owner(text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)";
const closeSignature = "content.close_media_upload_session_blob_writer(text,uuid,uuid,uuid,uuid,text,text,text,text,bigint,timestamp with time zone,integer)";

async function assertUpgradeAndSecurity(fixture: PostgresIntegrationFixture): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP FUNCTION ${beginSignature}; DROP FUNCTION ${closeSignature}`);
    await client.query(previousCloserSql);
    await client.query(migration0095);
    const row = (await client.query(
      `SELECT has_function_privilege('backend_app',$1,'EXECUTE') AS backend_begin,
        has_function_privilege('auth_app',$1,'EXECUTE') AS auth_begin,
        has_function_privilege('reporting_readonly',$2,'EXECUTE') AS reporting_close,
        has_table_privilege('backend_app','content.media_blob_writer_reservations','SELECT') AS direct_table,
        bool_and(prosecdef AND proconfig = ARRAY['search_path=pg_catalog']) AS hardened
       FROM pg_proc WHERE oid IN ($1::regprocedure,$2::regprocedure)`,
      [beginSignature, closeSignature],
    )).rows[0];
    assert.deepEqual(row, {
      backend_begin: true, auth_begin: false, reporting_close: false,
      direct_table: false, hardened: true,
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


test("atomic multipart writer start and no-writer closure are exact, replayable, and fenced", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertUpgradeAndSecurity(fixture);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const expired = new Date(Date.now() - 3_600_000).toISOString();
    const aborting = session(fixture, "active", future);
    const expiredSession = session(fixture, "active", expired);
    const live = session(fixture, "active", future);
    await insertSession(fixture, aborting, "active");
    await insertSession(fixture, expiredSession, "active");
    await insertSession(fixture, live, "active");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(aborting), "access_active");
    assert.equal((await beginMediaAssetUploadSessionAbortForWorkspace(
      aborting.userId, aborting.workspaceId, aborting.sessionId)).status, "abort_required");
    assert.equal((await beginMediaAssetUploadSessionAbortForWorkspace(
      expiredSession.userId, expiredSession.workspaceId, expiredSession.sessionId)).status,
    "abort_required");
    assert.equal(await close(aborting, aborting.sizeBytes), "no_writer_closed");
    assert.equal(await close(aborting, aborting.sizeBytes), "already_closed");
    assert.equal(await close(expiredSession, expiredSession.sizeBytes), "no_writer_closed");
    assert.equal(await close(live, live.sizeBytes), "stale");
    const noWriter = (await fixture.ownerPool.query(
      `SELECT count(*) FILTER (WHERE source='lifecycle')::int AS lifecycles,
        count(*) FILTER (WHERE source='reservation')::int AS reservations,
        count(*) FILTER (WHERE source='snapshot')::int AS snapshots,
        count(*) FILTER (WHERE source='blob')::int AS blobs
       FROM (
         SELECT 'lifecycle' AS source FROM content.media_blob_lifecycles WHERE sha256=ANY($1)
         UNION ALL SELECT 'reservation' FROM content.media_blob_writer_reservations WHERE sha256=ANY($1)
         UNION ALL SELECT 'snapshot' FROM content.media_blob_writer_owner_snapshots WHERE sha256=ANY($1)
         UNION ALL SELECT 'blob' FROM content.media_blobs WHERE sha256=ANY($1)
       ) AS rows`,
      [[aborting.sha256, expiredSession.sha256]],
    )).rows[0];
    assert.deepEqual(noWriter, { lifecycles: 0, reservations: 0, snapshots: 0, blobs: 0 });
    assert.deepEqual((await fixture.ownerPool.query(
      "SELECT state FROM content.media_upload_sessions WHERE media_upload_session_id=ANY($1) ORDER BY state",
      [[aborting.sessionId, expiredSession.sessionId, live.sessionId]],
    )).rows, [{ state: "aborted" }, { state: "aborted" }, { state: "active" }]);

    const exact = session(fixture, "active", future);
    await insertSession(fixture, exact, "active");
    const started = await beginMediaAssetUploadSessionCompletionWithOwner(exact);
    assert.equal(started.status, "started");
    assert.ok("reservation" in started);
    const replayed = await beginMediaAssetUploadSessionCompletionWithOwner(exact);
    assert.equal(replayed.status, "replayed");
    assert.ok("reservation" in replayed);
    assert.equal(replayed.reservation.reservationToken, started.reservation.reservationToken);
    assert.equal(replayed.reservation.normalizationVersion, started.reservation.normalizationVersion);

    const expiringReplay = session(
      fixture, "active", new Date(Date.now() + 1_000).toISOString(),
    );
    await insertSession(fixture, expiringReplay, "active");
    const expiringStarted = await beginMediaAssetUploadSessionCompletionWithOwner(expiringReplay);
    assert.equal(expiringStarted.status, "started");
    assert.ok("reservation" in expiringStarted);
    await fixture.ownerPool.query(
      "SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM $1::timestamptz - clock_timestamp()) + 0.05, 0.05))",
      [expiringReplay.expiresAt],
    );
    const afterExpiry = await beginMediaAssetUploadSessionCompletionWithOwner(expiringReplay);
    assert.equal(afterExpiry.status, "replayed");
    assert.ok("reservation" in afterExpiry);
    assert.deepEqual(afterExpiry.reservation, expiringStarted.reservation);
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwner({
      ...expiringReplay, sizeBytes: expiringReplay.sizeBytes + 1,
    })).status, "payload_mismatch");

    await fixture.ownerPool.query(
      "UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1",
      [exact.sessionId],
    );
    assert.equal(await close(exact, exact.sizeBytes + 1), "stale");
    assert.deepEqual((await fixture.ownerPool.query(
      `SELECT sessions.state, reservations.state AS reservation_state
       FROM content.media_upload_sessions AS sessions
       INNER JOIN content.media_blob_writer_reservations AS reservations
         ON reservations.operation_id=sessions.media_upload_session_id::text
       WHERE sessions.media_upload_session_id=$1`,
      [exact.sessionId],
    )).rows[0], { state: "aborting", reservation_state: "active" });

    const concurrent = session(fixture, "active", future);
    await insertSession(fixture, concurrent, "active");
    const concurrentResults = await Promise.all([
      beginMediaAssetUploadSessionCompletionWithOwner(concurrent),
      beginMediaAssetUploadSessionCompletionWithOwner(concurrent),
    ]);
    assert.deepEqual(concurrentResults.map((result) => result.status).sort(), ["replayed", "started"]);
    const concurrentTokens = concurrentResults.flatMap((result) =>
      "reservation" in result ? [result.reservation.reservationToken] : []);
    assert.equal(concurrentTokens.length, 2);
    assert.equal(concurrentTokens[0], concurrentTokens[1]);

    const legacy = session(fixture, "completing", future);
    const rejectedAbort = session(fixture, "aborting", future);
    const rejectedExpiry = session(fixture, "active", expired);
    await insertSession(fixture, legacy, "completing");
    await insertSession(fixture, rejectedAbort, "aborting");
    await insertSession(fixture, rejectedExpiry, "active");
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwner(legacy)).status, "legacy_unbound");
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwnerAndParts(
      rejectedAbort, [])).status, "aborting");
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwnerAndParts(
      rejectedExpiry, [])).status, "expired");
    await assert.rejects(
      beginMediaAssetUploadSessionCompletionWithOwnerAndParts(live, []),
      /parts must contain exactly 1 completed parts/,
    );
    assert.equal((await unsafeTransaction(
      (executor) => beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(executor, live),
    )).status, "access_denied");
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwner({
      ...live, sizeBytes: live.sizeBytes + 1,
    })).status, "payload_mismatch");
    const otherUserId = `multipart-owner-${randomUUID()}`;
    await fixture.ownerPool.query(
      `WITH inserted AS (INSERT INTO org.user_settings(user_id) VALUES ($1) RETURNING 1)
       UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2`,
      [otherUserId, fixture.replicaId],
    );
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwner(live)).status, "replica_mismatch");
    await fixture.ownerPool.query(
      `WITH restored AS (UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2 RETURNING 1)
       DELETE FROM org.user_settings WHERE user_id=$3`, [fixture.userId, fixture.replicaId, otherUserId]);

    const peer = session(fixture, "active", future);
    await insertSession(fixture, peer, "active");
    const peerStart = await beginMediaAssetUploadSessionCompletionWithOwner(peer);
    assert.ok("reservation" in peerStart);
    await completeLegacyMultipartSession(
      fixture,
      peer,
      peerStart.reservation.reservationToken,
      peerStart.reservation.normalizationVersion,
    );
    const completed = await beginMediaAssetUploadSessionCompletionWithOwnerAndParts(peer, []);
    assert.equal(completed.status, "already_completed");
    await fixture.ownerPool.query(
      "UPDATE content.media_assets SET last_operation_id=$1 WHERE media_asset_id=$2",
      [randomUUID(), peer.mediaAssetId],
    );
    assert.equal((await beginMediaAssetUploadSessionCompletionWithOwner(peer)).status, "completed_mismatch");

    const abortRace = session(fixture, "active", future);
    await insertSession(fixture, abortRace, "active");
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT 1 FROM content.media_upload_sessions WHERE media_upload_session_id=$1 FOR UPDATE",
        [abortRace.sessionId],
      );
      const startPromise = beginMediaAssetUploadSessionCompletionWithOwner(abortRace);
      await blocker.query(
        "UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1",
        [abortRace.sessionId],
      );
      await blocker.query("COMMIT");
      assert.equal((await startPromise).status, "aborting");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    const deleteRace = session(fixture, "active", future);
    await insertSession(fixture, deleteRace, "active");
    const deletion = await fixture.ownerPool.connect();
    try {
      await deletion.query("BEGIN");
      await deletion.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0::bigint))",
        [fixture.userId, fixture.workspaceId],
      );
      const startPromise = beginMediaAssetUploadSessionCompletionWithOwner(deleteRace);
      await deletion.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [fixture.workspaceId]);
      await deletion.query("COMMIT");
      assert.equal((await startPromise).status, "access_denied");
    } finally {
      await deletion.query("ROLLBACK");
      deletion.release();
    }
  });
});

