import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type pg from "pg";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import { buildMediaBlobStorageKey } from "../../storageKeys";

type MultipartPayload = Readonly<{
  userId: string;
  workspaceId: string;
  sessionId: string;
  mediaAssetId: string;
  replicaId: string;
  lastOperationId: string;
  sha256: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  s3UploadId: string;
  mimeType: string;
  sizeBytes: number;
  partSizeBytes: number;
  partCount: number;
  sourceUrl: string | null;
  assetCreatedAt: string;
  clientUpdatedAt: string;
  sessionExpiresAt: string;
  normalizationVersion: string;
  partsFingerprint: string;
}>;

type ClaimRow = Readonly<{
  claim_status: string;
  lease_expires_at: string | Date | null;
  media_upload_session_id: string | null;
}>;
type BeginRow = Readonly<{
  attempt_status: string;
  reservation_token: string | null;
  normalization_version: string | null;
  lease_expires_at: string | Date | null;
}>;
type StatusRow = Readonly<{ status: string }>;
type PidRow = Readonly<{ pid: number }>;
type CountRow = Readonly<{ count: number }>;
type QueryExecutor = Pick<pg.Pool | pg.PoolClient, "query">;
type SqlValue = string | number | null;

const multipartRow = `ROW(
  $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
)::content.multipart_media_blob_writer_attempt_payload`;
const acquireSignature =
  "content.acquire_media_upload_session_creation_claim_with_owner(text,uuid,uuid,uuid,uuid,integer)";
const finalizeSignature =
  "content.finalize_media_upload_session_creation_claim_with_owner(text,uuid,uuid,uuid,uuid,uuid)";
const releaseSignature =
  "content.release_media_upload_session_creation_claim_with_owner(text,uuid,uuid,uuid,uuid)";
const beginSignature =
  "content.begin_media_upload_session_completion_attempt_with_owner(uuid,integer,content.multipart_media_blob_writer_attempt_payload)";
const internalBeginSignature =
  "content.begin_media_upload_session_completion_attempt_0099_internal(uuid,integer,content.multipart_media_blob_writer_attempt_payload)";
const handoffSignature =
  "content.handoff_media_upload_session_completion_attempt(uuid,uuid,content.multipart_media_blob_writer_attempt_payload)";
const internalHandoffSignature =
  "content.handoff_media_upload_session_completion_attempt_0099_internal(uuid,uuid,content.multipart_media_blob_writer_attempt_payload)";

function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function createPayload(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): MultipartPayload {
  const sessionId = randomUUID();
  const sha256 = digest();
  return {
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    sessionId,
    mediaAssetId,
    replicaId: fixture.replicaId,
    lastOperationId: randomUUID(),
    sha256,
    stagingStorageKey:
      `media/uploads/workspaces/${fixture.workspaceId}/assets/${mediaAssetId}/sessions/${sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    s3UploadId: `upload-${randomUUID()}`,
    mimeType: "application/octet-stream",
    sizeBytes: 42,
    partSizeBytes: 42,
    partCount: 1,
    sourceUrl: null,
    assetCreatedAt: fixture.createdAt,
    clientUpdatedAt: fixture.createdAt,
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    normalizationVersion: "passthrough-v1",
    partsFingerprint: digest(),
  };
}

function payloadValues(payload: MultipartPayload): ReadonlyArray<SqlValue> {
  return [
    payload.userId,
    payload.workspaceId,
    payload.sessionId,
    payload.mediaAssetId,
    payload.replicaId,
    payload.lastOperationId,
    payload.sha256,
    payload.stagingStorageKey,
    payload.blobStorageKey,
    payload.s3UploadId,
    payload.mimeType,
    payload.sizeBytes,
    payload.partSizeBytes,
    payload.partCount,
    payload.sourceUrl,
    payload.assetCreatedAt,
    payload.clientUpdatedAt,
    payload.sessionExpiresAt,
    payload.normalizationVersion,
    payload.partsFingerprint,
  ];
}

async function beginScopedTransaction(
  client: pg.PoolClient,
  fixture: PostgresIntegrationFixture,
): Promise<void> {
  await client.query("BEGIN");
  await client.query(
    `SELECT
       set_config('app.user_id',$1,true),
       set_config('app.workspace_id',$2,true)`,
    [fixture.userId, fixture.workspaceId],
  );
}

async function scoped<Result>(
  fixture: PostgresIntegrationFixture,
  callback: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await fixture.runtimePool.connect();
  try {
    await beginScopedTransaction(client, fixture);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertSession(
  executor: QueryExecutor,
  payload: MultipartPayload,
  state: "active" | "aborted",
): Promise<void> {
  await executor.query(
    `INSERT INTO content.media_upload_sessions (
       media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,
       staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,
       part_size_bytes,part_count,state,source_url,asset_created_at,
       client_updated_at,last_modified_by_replica_id,last_operation_id,
       expires_at,aborted_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       CASE WHEN $12 = 'aborted' THEN pg_catalog.clock_timestamp() END
     )`,
    [
      payload.sessionId,
      payload.workspaceId,
      payload.mediaAssetId,
      payload.sha256,
      payload.stagingStorageKey,
      payload.blobStorageKey,
      payload.s3UploadId,
      payload.mimeType,
      payload.sizeBytes,
      payload.partSizeBytes,
      payload.partCount,
      state,
      payload.sourceUrl,
      payload.assetCreatedAt,
      payload.clientUpdatedAt,
      payload.replicaId,
      payload.lastOperationId,
      payload.sessionExpiresAt,
    ],
  );
}

async function insertAsset(
  executor: QueryExecutor,
  payload: MultipartPayload,
): Promise<void> {
  const mediaBlobId = randomUUID();
  await executor.query(
    `WITH blob AS (
       INSERT INTO content.media_blobs (
         media_blob_id,sha256,mime_type,size_bytes,storage_key,
         normalization_version
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING media_blob_id
     )
     INSERT INTO content.media_assets (
       media_asset_id,workspace_id,media_blob_id,source_url,created_at,
       client_updated_at,last_modified_by_replica_id,last_operation_id
     )
     SELECT $7,$8,media_blob_id,$9,$10,$11,$12,$13
     FROM blob`,
    [
      mediaBlobId,
      payload.sha256,
      payload.mimeType,
      payload.sizeBytes,
      payload.blobStorageKey,
      payload.normalizationVersion,
      payload.mediaAssetId,
      payload.workspaceId,
      payload.sourceUrl,
      payload.assetCreatedAt,
      payload.clientUpdatedAt,
      payload.replicaId,
      payload.lastOperationId,
    ],
  );
}

async function acquireClaim(
  executor: QueryExecutor,
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
  claimToken: string,
  leaseDurationMs: number,
): Promise<ClaimRow> {
  return (await executor.query<ClaimRow>(
    `SELECT *
     FROM content.acquire_media_upload_session_creation_claim_with_owner(
       $1,$2,$3,$4,$5,$6
     )`,
    [
      fixture.userId,
      fixture.workspaceId,
      mediaAssetId,
      fixture.replicaId,
      claimToken,
      leaseDurationMs,
    ],
  )).rows[0];
}

async function finalizeClaim(
  executor: QueryExecutor,
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
  claimToken: string,
  sessionId: string,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.finalize_media_upload_session_creation_claim_with_owner(
       $1,$2,$3,$4,$5,$6
     ) AS status`,
    [
      fixture.userId,
      fixture.workspaceId,
      mediaAssetId,
      fixture.replicaId,
      claimToken,
      sessionId,
    ],
  )).rows[0].status;
}

async function releaseClaim(
  executor: QueryExecutor,
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
  claimToken: string,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.release_media_upload_session_creation_claim_with_owner(
       $1,$2,$3,$4,$5
     ) AS status`,
    [
      fixture.userId,
      fixture.workspaceId,
      mediaAssetId,
      fixture.replicaId,
      claimToken,
    ],
  )).rows[0].status;
}

async function beginCompletion(
  executor: QueryExecutor,
  attemptToken: string,
  payload: MultipartPayload,
): Promise<BeginRow> {
  return (await executor.query<BeginRow>(
    `SELECT *
     FROM content.begin_media_upload_session_completion_attempt_with_owner(
       $1,$2,${multipartRow}
     )`,
    [attemptToken, 60_000, ...payloadValues(payload)],
  )).rows[0];
}

async function handoffCompletion(
  executor: QueryExecutor,
  attemptToken: string,
  reservationToken: string,
  payload: MultipartPayload,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.handoff_media_upload_session_completion_attempt(
       $1,$2,${multipartRow}
     ) AS status`,
    [attemptToken, reservationToken, ...payloadValues(payload)],
  )).rows[0].status;
}

async function backendPid(client: pg.PoolClient): Promise<number> {
  return (await client.query<PidRow>(
    "SELECT pg_catalog.pg_backend_pid() AS pid",
  )).rows[0].pid;
}

async function waitUntilBlockedBy(
  observer: QueryExecutor,
  waitingPid: number,
  blockingPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = (await observer.query<Readonly<{
      blocked: boolean;
    }>>(
      `SELECT $2::INTEGER = ANY(
         pg_catalog.pg_blocking_pids($1::INTEGER)
       ) AS blocked`,
      [waitingPid, blockingPid],
    )).rows[0]?.blocked;
    if (blocked === true) return;
    await delay(10);
  }
  throw new Error(
    `PostgreSQL transaction did not reach the expected lock wait. waitingPid=${waitingPid} blockingPid=${blockingPid}`,
  );
}

async function lockMediaAsset(
  client: pg.PoolClient,
  workspaceId: string,
  mediaAssetId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended(
         'multipart-asset:' || $1::TEXT || ':' || $2::TEXT,
         4::BIGINT
       )
     )`,
    [workspaceId, mediaAssetId],
  );
}

async function releaseClients(
  clients: ReadonlyArray<pg.PoolClient>,
  raceError: Error | null,
): Promise<void> {
  const rollbackResults = await Promise.allSettled(
    clients.map((client) => client.query("ROLLBACK")),
  );
  for (const client of clients) client.release();
  const errors = rollbackResults.flatMap((result) => (
    result.status === "rejected" ? [result.reason as unknown] : []
  ));
  if (errors.length > 0) {
    throw new AggregateError(
      raceError === null ? errors : [raceError, ...errors],
      "PostgreSQL race transaction cleanup failed.",
    );
  }
}

async function runClaimWinningRace(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<Readonly<{
  claimToken: string;
  claim: ClaimRow;
  completion: BeginRow;
}>> {
  const blocker = await fixture.ownerPool.connect();
  const claiming = await fixture.runtimePool.connect();
  const completing = await fixture.runtimePool.connect();
  const clients = [blocker, claiming, completing];
  let raceError: Error | null = null;
  try {
    await blocker.query("BEGIN");
    await lockMediaAsset(blocker, payload.workspaceId, payload.mediaAssetId);
    await beginScopedTransaction(claiming, fixture);
    await beginScopedTransaction(completing, fixture);
    const blockerPid = await backendPid(blocker);
    const claimingPid = await backendPid(claiming);
    const completingPid = await backendPid(completing);
    const claimToken = randomUUID();
    const claimPromise = acquireClaim(
      claiming,
      fixture,
      payload.mediaAssetId,
      claimToken,
      60_000,
    );
    await waitUntilBlockedBy(blocker, claimingPid, blockerPid);
    const completionPromise = beginCompletion(
      completing,
      randomUUID(),
      payload,
    );
    await waitUntilBlockedBy(blocker, completingPid, claimingPid);
    await blocker.query("COMMIT");
    const claim = await claimPromise;
    await claiming.query("COMMIT");
    const completion = await completionPromise;
    await completing.query("COMMIT");
    return { claimToken, claim, completion };
  } catch (error) {
    raceError = error instanceof Error ? error : new Error(String(error));
    throw raceError;
  } finally {
    await releaseClients(clients, raceError);
  }
}

async function runCompletionWinningRace(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<Readonly<{
  attemptToken: string;
  claim: ClaimRow;
  completion: BeginRow;
}>> {
  const blocker = await fixture.ownerPool.connect();
  const claiming = await fixture.runtimePool.connect();
  const completing = await fixture.runtimePool.connect();
  const clients = [blocker, claiming, completing];
  let raceError: Error | null = null;
  try {
    await blocker.query("BEGIN");
    await lockMediaAsset(blocker, payload.workspaceId, payload.mediaAssetId);
    await beginScopedTransaction(completing, fixture);
    await beginScopedTransaction(claiming, fixture);
    const blockerPid = await backendPid(blocker);
    const claimingPid = await backendPid(claiming);
    const completingPid = await backendPid(completing);
    const attemptToken = randomUUID();
    const completionPromise = beginCompletion(
      completing,
      attemptToken,
      payload,
    );
    await waitUntilBlockedBy(blocker, completingPid, blockerPid);
    const claimPromise = acquireClaim(
      claiming,
      fixture,
      payload.mediaAssetId,
      randomUUID(),
      60_000,
    );
    await waitUntilBlockedBy(blocker, claimingPid, completingPid);
    await blocker.query("COMMIT");
    const completion = await completionPromise;
    await completing.query("COMMIT");
    const claim = await claimPromise;
    await claiming.query("COMMIT");
    return { attemptToken, claim, completion };
  } catch (error) {
    raceError = error instanceof Error ? error : new Error(String(error));
    throw raceError;
  } finally {
    await releaseClients(clients, raceError);
  }
}

test("migration 0100 exposes only the exact replacement-creation claim contract", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const contract = (await fixture.ownerPool.query<Readonly<{
      major: number;
      migrations: number;
      latest: string;
      acquire_backend: boolean;
      finalize_backend: boolean;
      release_backend: boolean;
      begin_backend: boolean;
      internal_backend: boolean;
      handoff_backend: boolean;
      internal_handoff_backend: boolean;
      table_backend: boolean;
      table_auth: boolean;
      table_reporting: boolean;
      begin_result: string;
      handoff_result: string;
      hardened: boolean;
    }>>(
      `SELECT
         current_setting('server_version_num')::int / 10000 AS major,
         count(*)::int AS migrations,
         max(filename) AS latest,
         has_function_privilege('backend_app',$1,'EXECUTE') AS acquire_backend,
         has_function_privilege('backend_app',$2,'EXECUTE') AS finalize_backend,
         has_function_privilege('backend_app',$3,'EXECUTE') AS release_backend,
         has_function_privilege('backend_app',$4,'EXECUTE') AS begin_backend,
         has_function_privilege('backend_app',$5,'EXECUTE') AS internal_backend,
         has_function_privilege('backend_app',$6,'EXECUTE') AS handoff_backend,
         has_function_privilege(
           'backend_app',
           $7,
           'EXECUTE'
         ) AS internal_handoff_backend,
         has_table_privilege(
           'backend_app',
           'content.media_upload_session_creation_claims',
           'SELECT,INSERT,UPDATE,DELETE'
         ) AS table_backend,
         has_table_privilege(
           'auth_app',
           'content.media_upload_session_creation_claims',
           'SELECT,INSERT,UPDATE,DELETE'
         ) AS table_auth,
         has_table_privilege(
           'reporting_readonly',
           'content.media_upload_session_creation_claims',
           'SELECT'
         ) AS table_reporting,
         pg_catalog.pg_get_function_result($4::regprocedure) AS begin_result,
         pg_catalog.pg_get_function_result($6::regprocedure) AS handoff_result,
         (
           SELECT pg_catalog.bool_and(
             functions.prosecdef
             AND functions.proconfig = ARRAY['search_path=pg_catalog']
           )
           FROM pg_catalog.pg_proc AS functions
           WHERE functions.oid = ANY(ARRAY[
             $1::regprocedure,
             $2::regprocedure,
             $3::regprocedure,
             $4::regprocedure,
             $5::regprocedure,
             $6::regprocedure,
             $7::regprocedure
           ])
         ) AS hardened
       FROM public.schema_migrations`,
      [
        acquireSignature,
        finalizeSignature,
        releaseSignature,
        beginSignature,
        internalBeginSignature,
        handoffSignature,
        internalHandoffSignature,
      ],
    )).rows[0];
    assert.deepEqual(
      {
        major: contract.major,
        migrations: contract.migrations,
        latest: contract.latest,
      },
      {
        major: 18,
        migrations: 102,
        latest: "0100_multipart_replacement_creation_claim.sql",
      },
    );
    assert.equal(contract.acquire_backend, true);
    assert.equal(contract.finalize_backend, true);
    assert.equal(contract.release_backend, true);
    assert.equal(contract.begin_backend, true);
    assert.equal(contract.internal_backend, false);
    assert.equal(contract.handoff_backend, true);
    assert.equal(contract.internal_handoff_backend, false);
    assert.equal(contract.table_backend, false);
    assert.equal(contract.table_auth, false);
    assert.equal(contract.table_reporting, false);
    assert.equal(
      contract.begin_result,
      "TABLE(attempt_status text, reservation_token uuid, normalization_version text, lease_expires_at timestamp with time zone)",
    );
    assert.equal(contract.handoff_result, "text");
    assert.equal(contract.hardened, true);
  });
});

test("migration 0100 preserves exact terminal retries outside creation locks", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, payload, "active");
    await insertAsset(fixture.ownerPool, payload);
    const terminalAttemptToken = randomUUID();
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => beginCompletion(client, terminalAttemptToken, payload),
        )
      ).attempt_status,
      "already_applied",
    );

    const blocker = await fixture.ownerPool.connect();
    const contender = await fixture.runtimePool.connect();
    const clients = [blocker, contender];
    let testError: Error | null = null;
    try {
      await blocker.query("BEGIN");
      await lockMediaAsset(
        blocker,
        payload.workspaceId,
        payload.mediaAssetId,
      );
      const blockerPid = await backendPid(blocker);

      await beginScopedTransaction(contender, fixture);
      await contender.query("SET LOCAL statement_timeout = '1s'");
      assert.equal(
        (
          await beginCompletion(contender, terminalAttemptToken, payload)
        ).attempt_status,
        "already_applied",
      );
      assert.equal(
        (
          await beginCompletion(
            contender,
            terminalAttemptToken,
            { ...payload, partsFingerprint: digest() },
          )
        ).attempt_status,
        "stale_attempt",
      );
      const otherSessionId = randomUUID();
      assert.equal(
        (
          await beginCompletion(
            contender,
            terminalAttemptToken,
            {
              ...payload,
              sessionId: otherSessionId,
              stagingStorageKey:
                `media/uploads/workspaces/${payload.workspaceId}/assets/${payload.mediaAssetId}/sessions/${otherSessionId}`,
            },
          )
        ).attempt_status,
        "stale_attempt",
      );
      await contender.query("COMMIT");

      await beginScopedTransaction(contender, fixture);
      await contender.query("SET LOCAL statement_timeout = '5s'");
      const contenderPid = await backendPid(contender);
      const nonterminalPromise = beginCompletion(
        contender,
        randomUUID(),
        payload,
      );
      await waitUntilBlockedBy(blocker, contenderPid, blockerPid);
      await blocker.query("COMMIT");
      assert.equal(
        (await nonterminalPromise).attempt_status,
        "already_applied",
      );
      await contender.query("COMMIT");
    } catch (error) {
      testError = error instanceof Error ? error : new Error(String(error));
      throw testError;
    } finally {
      await releaseClients(clients, testError);
    }
  });
});

test("migration 0100 serializes exact handed-off retries under the asset lock", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, payload, "active");
    const attemptToken = randomUUID();
    const begun = await scoped(
      fixture,
      (client) => beginCompletion(client, attemptToken, payload),
    );
    assert.equal(begun.attempt_status, "acquired");
    assert.notEqual(begun.reservation_token, null);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffCompletion(
          client,
          attemptToken,
          begun.reservation_token as string,
          payload,
        ),
      ),
      "handed_off",
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffCompletion(
          client,
          attemptToken,
          begun.reservation_token as string,
          payload,
        ),
      ),
      "already_pending",
    );
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => acquireClaim(
            client,
            fixture,
            payload.mediaAssetId,
            randomUUID(),
            60_000,
          ),
        )
      ).claim_status,
      "completion_pending",
    );

    const blocker = await fixture.ownerPool.connect();
    const contender = await fixture.runtimePool.connect();
    const clients = [blocker, contender];
    let testError: Error | null = null;
    try {
      await blocker.query("BEGIN");
      await lockMediaAsset(
        blocker,
        payload.workspaceId,
        payload.mediaAssetId,
      );
      await beginScopedTransaction(contender, fixture);
      await contender.query("SET LOCAL statement_timeout = '5s'");
      const blockerPid = await backendPid(blocker);
      const contenderPid = await backendPid(contender);
      const retryPromise = beginCompletion(
        contender,
        attemptToken,
        payload,
      );
      await waitUntilBlockedBy(blocker, contenderPid, blockerPid);
      await blocker.query("COMMIT");
      assert.equal((await retryPromise).attempt_status, "stale_attempt");
      await contender.query("COMMIT");
    } catch (error) {
      testError = error instanceof Error ? error : new Error(String(error));
      throw testError;
    } finally {
      await releaseClients(clients, testError);
    }
  });
});

test("migration 0100 serializes replacement creation and completion in both lock orders", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const claimWinningPayload = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, claimWinningPayload, "active");
    const claimWinner = await runClaimWinningRace(
      fixture,
      claimWinningPayload,
    );
    assert.equal(claimWinner.claim.claim_status, "acquired");
    assert.notEqual(claimWinner.claim.lease_expires_at, null);
    assert.equal(claimWinner.completion.attempt_status, "busy");
    assert.equal(
      new Date(
        claimWinner.completion.lease_expires_at as string | Date,
      ).getTime(),
      new Date(
        claimWinner.claim.lease_expires_at as string | Date,
      ).getTime(),
    );
    assert.equal(
      (await fixture.ownerPool.query<CountRow>(
        `SELECT count(*)::int AS count
         FROM content.media_upload_session_creation_claims
         WHERE workspace_id=$1
           AND media_asset_id=$2
           AND state='leased'`,
        [fixture.workspaceId, claimWinningPayload.mediaAssetId],
      )).rows[0].count,
      1,
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => releaseClaim(
          client,
          fixture,
          claimWinningPayload.mediaAssetId,
          claimWinner.claimToken,
        ),
      ),
      "released",
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => releaseClaim(
          client,
          fixture,
          claimWinningPayload.mediaAssetId,
          claimWinner.claimToken,
        ),
      ),
      "released",
    );
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => beginCompletion(
            client,
            randomUUID(),
            claimWinningPayload,
          ),
        )
      ).attempt_status,
      "acquired",
    );

    const completionWinningPayload = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, completionWinningPayload, "active");
    const completionWinner = await runCompletionWinningRace(
      fixture,
      completionWinningPayload,
    );
    assert.equal(completionWinner.completion.attempt_status, "acquired");
    assert.equal(completionWinner.claim.claim_status, "completion_pending");
    assert.equal(
      (await fixture.ownerPool.query<CountRow>(
        `SELECT count(*)::int AS count
         FROM content.media_upload_session_creation_claims
         WHERE workspace_id=$1
           AND media_asset_id=$2
           AND state='leased'`,
        [fixture.workspaceId, completionWinningPayload.mediaAssetId],
      )).rows[0].count,
      0,
    );
    const expiredAttempt = await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE media_upload_session_id=$1
         AND state='leased'
         AND reconciliation_state IS NULL`,
      [completionWinningPayload.sessionId],
    );
    assert.equal(expiredAttempt.rowCount, 1);
    const forwardProgressClaimToken = randomUUID();
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => acquireClaim(
            client,
            fixture,
            completionWinningPayload.mediaAssetId,
            forwardProgressClaimToken,
            60_000,
          ),
        )
      ).claim_status,
      "acquired",
    );
    assert.notEqual(completionWinner.completion.reservation_token, null);
    const handoffBlocker = await fixture.ownerPool.connect();
    const staleWorker = await fixture.runtimePool.connect();
    const handoffClients = [handoffBlocker, staleWorker];
    let handoffError: Error | null = null;
    try {
      await handoffBlocker.query("BEGIN");
      await lockMediaAsset(
        handoffBlocker,
        completionWinningPayload.workspaceId,
        completionWinningPayload.mediaAssetId,
      );
      await beginScopedTransaction(staleWorker, fixture);
      await staleWorker.query("SET LOCAL statement_timeout = '5s'");
      const blockerPid = await backendPid(handoffBlocker);
      const staleWorkerPid = await backendPid(staleWorker);
      const handoffPromise = handoffCompletion(
        staleWorker,
        completionWinner.attemptToken,
        completionWinner.completion.reservation_token as string,
        completionWinningPayload,
      );
      await waitUntilBlockedBy(
        handoffBlocker,
        staleWorkerPid,
        blockerPid,
      );
      await handoffBlocker.query("COMMIT");
      assert.equal(await handoffPromise, "stale_attempt");
      await staleWorker.query("COMMIT");
    } catch (error) {
      handoffError = error instanceof Error ? error : new Error(String(error));
      throw handoffError;
    } finally {
      await releaseClients(handoffClients, handoffError);
    }
    assert.deepEqual(
      (await fixture.ownerPool.query<Readonly<{
        reconciliation_state: string | null;
        state: string;
      }>>(
        `SELECT state,reconciliation_state
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1`,
        [completionWinner.attemptToken],
      )).rows[0],
      {
        state: "leased",
        reconciliation_state: null,
      },
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => releaseClaim(
          client,
          fixture,
          completionWinningPayload.mediaAssetId,
          forwardProgressClaimToken,
        ),
      ),
      "released",
    );
  });
});

test("migration 0100 finalizes, replays, expires, and reclaims exact claims", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const oldCompletion = createPayload(fixture, randomUUID());
    const leasedPeer = createPayload(fixture, oldCompletion.mediaAssetId);
    const replacement = createPayload(fixture, oldCompletion.mediaAssetId);
    await insertSession(fixture.ownerPool, oldCompletion, "active");
    await insertSession(fixture.ownerPool, leasedPeer, "active");
    const claimToken = randomUUID();
    const acquired = await scoped(
      fixture,
      (client) => acquireClaim(
        client,
        fixture,
        oldCompletion.mediaAssetId,
        claimToken,
        60_000,
      ),
    );
    const replayed = await scoped(
      fixture,
      (client) => acquireClaim(
        client,
        fixture,
        oldCompletion.mediaAssetId,
        claimToken,
        60_000,
      ),
    );
    assert.equal(acquired.claim_status, "acquired");
    assert.deepEqual(replayed, acquired);
    for (const payload of [oldCompletion, leasedPeer]) {
      assert.equal(
        (
          await scoped(
            fixture,
            (client) => beginCompletion(client, randomUUID(), payload),
          )
        ).attempt_status,
        "busy",
      );
    }
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => beginCompletion(
            client,
            randomUUID(),
            { ...oldCompletion, replicaId: randomUUID() },
          ),
        )
      ).attempt_status,
      "replica_mismatch",
    );

    assert.equal(
      await scoped(fixture, async (client) => {
        await insertSession(client, replacement, "active");
        return finalizeClaim(
          client,
          fixture,
          replacement.mediaAssetId,
          claimToken,
          replacement.sessionId,
        );
      }),
      "finalized",
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => finalizeClaim(
          client,
          fixture,
          replacement.mediaAssetId,
          claimToken,
          replacement.sessionId,
        ),
      ),
      "finalized",
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => releaseClaim(
          client,
          fixture,
          replacement.mediaAssetId,
          claimToken,
        ),
      ),
      "finalized",
    );
    const duplicateClaim = await scoped(
      fixture,
      (client) => acquireClaim(
        client,
        fixture,
        replacement.mediaAssetId,
        randomUUID(),
        60_000,
      ),
    );
    assert.equal(duplicateClaim.claim_status, "creation_pending");
    assert.equal(
      duplicateClaim.media_upload_session_id,
      replacement.sessionId,
    );
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => beginCompletion(
            client,
            randomUUID(),
            oldCompletion,
          ),
        )
      ).attempt_status,
      "busy",
    );
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => beginCompletion(
            client,
            randomUUID(),
            replacement,
          ),
        )
      ).attempt_status,
      "acquired",
    );

    const expiringOldCompletion = createPayload(fixture, randomUUID());
    const expiringReplacement = createPayload(
      fixture,
      expiringOldCompletion.mediaAssetId,
    );
    await insertSession(fixture.ownerPool, expiringOldCompletion, "active");
    const expiringFinalizedClaimToken = randomUUID();
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => acquireClaim(
            client,
            fixture,
            expiringOldCompletion.mediaAssetId,
            expiringFinalizedClaimToken,
            60_000,
          ),
        )
      ).claim_status,
      "acquired",
    );
    assert.equal(
      await scoped(fixture, async (client) => {
        await insertSession(client, expiringReplacement, "active");
        return finalizeClaim(
          client,
          fixture,
          expiringReplacement.mediaAssetId,
          expiringFinalizedClaimToken,
          expiringReplacement.sessionId,
        );
      }),
      "finalized",
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE media_upload_session_id=$1
         AND state='active'`,
      [expiringReplacement.sessionId],
    );
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => beginCompletion(
            client,
            randomUUID(),
            expiringOldCompletion,
          ),
        )
      ).attempt_status,
      "acquired",
    );

    const recoverableOldCompletion = createPayload(fixture, randomUUID());
    const expiredBeforeFinalization = createPayload(
      fixture,
      recoverableOldCompletion.mediaAssetId,
    );
    const recoveredReplacement = createPayload(
      fixture,
      recoverableOldCompletion.mediaAssetId,
    );
    await insertSession(
      fixture.ownerPool,
      recoverableOldCompletion,
      "active",
    );
    const recoverableClaimToken = randomUUID();
    const recoverableClaim = await scoped(
      fixture,
      (client) => acquireClaim(
        client,
        fixture,
        recoverableOldCompletion.mediaAssetId,
        recoverableClaimToken,
        60_000,
      ),
    );
    assert.equal(recoverableClaim.claim_status, "acquired");
    assert.equal(
      await scoped(fixture, async (client) => {
        await insertSession(client, expiredBeforeFinalization, "active");
        await client.query(
          `UPDATE content.media_upload_sessions
           SET expires_at=pg_catalog.clock_timestamp() - interval '1 second'
           WHERE media_upload_session_id=$1`,
          [expiredBeforeFinalization.sessionId],
        );
        return finalizeClaim(
          client,
          fixture,
          expiredBeforeFinalization.mediaAssetId,
          recoverableClaimToken,
          expiredBeforeFinalization.sessionId,
        );
      }),
      "session_mismatch",
    );
    assert.deepEqual(
      await scoped(
        fixture,
        (client) => acquireClaim(
          client,
          fixture,
          recoverableOldCompletion.mediaAssetId,
          recoverableClaimToken,
          60_000,
        ),
      ),
      recoverableClaim,
    );
    assert.deepEqual(
      (await fixture.ownerPool.query<Readonly<{
        media_upload_session_id: string | null;
        state: string;
      }>>(
        `SELECT state,media_upload_session_id
         FROM content.media_upload_session_creation_claims
         WHERE claim_token=$1`,
        [recoverableClaimToken],
      )).rows[0],
      {
        state: "leased",
        media_upload_session_id: null,
      },
    );
    assert.equal(
      await scoped(fixture, async (client) => {
        await insertSession(client, recoveredReplacement, "active");
        return finalizeClaim(
          client,
          fixture,
          recoveredReplacement.mediaAssetId,
          recoverableClaimToken,
          recoveredReplacement.sessionId,
        );
      }),
      "finalized",
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => finalizeClaim(
          client,
          fixture,
          recoveredReplacement.mediaAssetId,
          recoverableClaimToken,
          recoveredReplacement.sessionId,
        ),
      ),
      "finalized",
    );

    const expiringAssetId = randomUUID();
    const expiredClaimToken = randomUUID();
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => acquireClaim(
            client,
            fixture,
            expiringAssetId,
            expiredClaimToken,
            60_000,
          ),
        )
      ).claim_status,
      "acquired",
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_session_creation_claims
       SET
         created_at=pg_catalog.clock_timestamp() - interval '3 seconds',
         updated_at=pg_catalog.clock_timestamp() - interval '2 seconds',
         lease_expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE claim_token=$1`,
      [expiredClaimToken],
    );
    const replacementClaimToken = randomUUID();
    assert.equal(
      (
        await scoped(
          fixture,
          (client) => acquireClaim(
            client,
            fixture,
            expiringAssetId,
            replacementClaimToken,
            60_000,
          ),
        )
      ).claim_status,
      "acquired",
    );
    assert.deepEqual(
      (
        await fixture.ownerPool.query<Readonly<{
          expired_state: string;
          leased_count: number;
        }>>(
          `SELECT
             max(state) FILTER (WHERE claim_token=$1) AS expired_state,
             count(*) FILTER (WHERE state='leased')::int AS leased_count
           FROM content.media_upload_session_creation_claims
           WHERE workspace_id=$2
             AND media_asset_id=$3`,
          [
            expiredClaimToken,
            fixture.workspaceId,
            expiringAssetId,
          ],
        )
      ).rows[0],
      {
        expired_state: "released",
        leased_count: 1,
      },
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => releaseClaim(
          client,
          fixture,
          expiringAssetId,
          replacementClaimToken,
        ),
      ),
      "released",
    );
  });
});
