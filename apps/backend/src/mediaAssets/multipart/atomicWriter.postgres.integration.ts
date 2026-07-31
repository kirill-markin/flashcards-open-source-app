import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { unsafeTransaction } from "../../database/unsafe";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../database/transient";
import { createBackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../storageKeys";
import {
  acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  beginMediaAssetUploadSessionCompletionAttemptWithOwner,
  beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled,
  beginMediaAssetUploadSessionCompletionWithOwner,
  beginMediaAssetUploadSessionCompletionWithOwnerAndParts,
  beginMediaAssetUploadSessionCompletionWithOwnerInExecutor,
  checkMediaAssetCompletionPendingForWorkspace,
  closeMediaAssetUploadSessionCurrentBlobWriter,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetFromAvailableBlobForWorkspace,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  handoffMediaAssetUploadSessionCompletionAttempt,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetUploadSessionCreationReplayForWorkspace,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  releaseMediaAssetUploadSessionCreationClaimForWorkspace,
  resolveMediaAssetUploadSessionCompletionAfterAccessRevocation,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptInput,
  type MediaAssetUploadSessionCompletionWithOwnerInput,
} from "../uploadSessions";
import {
  passthroughMediaBlobNormalizationVersion,
  type MediaBlobNormalizationVersion,
} from "../types";
import type { CompleteMediaAssetUploadPartInput } from "../types";
import {
  completeMultipartMediaAssetUploadWithDependencies,
} from "../storage/multipart";
import {
  applyMultipartCompletionReconciliation,
  claimMultipartCompletionReconciliations,
  renewMultipartCompletionReconciliationLease,
  type ClaimedMultipartCompletionReconciliation,
} from "./completionReconciliation";
import {
  reconcileMultipartMediaAssetUploadWithDependencies,
} from "../storage/multipartReconciliation";
import {
  createS3Error,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
} from "../storage/testHelpers";
import {
  abortMultipartUploadSessionAtApplicationBoundary,
  completeMultipartUploadSessionAtApplicationBoundary,
  createMultipartCompletionRequestDeadline,
  createMultipartUploadSessionAtApplicationBoundary,
  createMultipartWriterHeartbeat,
  isExpiredMultipartCompletionCleanupRequired,
} from "../../routes/mediaAssets";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
} from "../../server/multipartCompletionRequestTiming";

const migration0094 = readFileSync(resolve(
  __dirname, "../../../../../db/migrations/0094_direct_multipart_writer_abandonment.sql",
), "utf8");
const migration0095 = readFileSync(resolve(
  __dirname, "../../../../../db/migrations/0095_atomic_multipart_writer_completion.sql",
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

function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function transientDatabaseUnavailable(message: string): TransientDatabaseHttpError {
  return new TransientDatabaseHttpError(
    Object.assign(new Error(message), { code: "08006" }),
  );
}

function session(
  fixture: PostgresIntegrationFixture,
  state: "active" | "completing" | "aborting",
  expiresAt: string,
): MediaAssetUploadSessionCompletionWithOwnerInput {
  const sessionId = randomUUID();
  const mediaAssetId = randomUUID();
  const sha256 = digest();
  return {
    userId: fixture.userId, workspaceId: fixture.workspaceId, sessionId, mediaAssetId,
    lastModifiedByReplicaId: fixture.replicaId, lastOperationId: randomUUID(), sha256,
    stagingStorageKey: `media/uploads/workspaces/${fixture.workspaceId}/assets/${mediaAssetId}/sessions/${sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(sha256), s3UploadId: `upload-${randomUUID()}`,
    mimeType: "application/octet-stream", sizeBytes: 42, partSizeBytes: 42, partCount: 1,
    sourceUrl: null, assetCreatedAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt,
    expiresAt, normalizationVersion: passthroughMediaBlobNormalizationVersion,
  };
}

async function insertSession(
  fixture: PostgresIntegrationFixture,
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  state: "active" | "completing" | "aborting",
): Promise<void> {
  await fixture.ownerPool.query(
    `INSERT INTO content.media_upload_sessions
       (media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,
        staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,
        part_size_bytes,part_count,state,source_url,asset_created_at,client_updated_at,
        last_modified_by_replica_id,last_operation_id,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [input.sessionId, input.workspaceId, input.mediaAssetId, input.sha256,
      input.stagingStorageKey, input.blobStorageKey, input.s3UploadId, input.mimeType,
      input.sizeBytes, input.partSizeBytes, input.partCount, state, input.sourceUrl,
      input.assetCreatedAt, input.clientUpdatedAt, input.lastModifiedByReplicaId,
      input.lastOperationId, input.expiresAt],
  );
}

async function close(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  sizeBytes: number,
): Promise<string> {
  return closeMediaAssetUploadSessionCurrentBlobWriter({
    userId: input.userId, workspaceId: input.workspaceId, sessionId: input.sessionId,
    mediaAssetId: input.mediaAssetId, lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId, sha256: input.sha256,
    storageKey: input.blobStorageKey, mimeType: input.mimeType, sizeBytes,
    expiresAt: input.expiresAt,
  });
}

function completionParts(): ReadonlyArray<CompleteMediaAssetUploadPartInput> {
  return [{
    partNumber: 1,
    eTag: "\"part-etag\"",
    sha256: digest(),
  }];
}

function applicationObservationScope(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
) {
  return createBackendObservationScope(
    "backend-api",
    randomUUID(),
    "/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete",
    "POST",
    input.userId,
    input.workspaceId,
    null,
    null,
    null,
    null,
    null,
  );
}

function createApplicationDeadlines(
  operationBudgetMs: number,
  requestBudgetMs: number,
) {
  const observedAtMs = Date.now();
  const operationDeadlineAtMs = observedAtMs + operationBudgetMs;
  const requestDeadlineAtMs = observedAtMs + requestBudgetMs;
  return {
    operation: createMultipartCompletionRequestDeadline(
      operationDeadlineAtMs,
    ),
    request: createMultipartCompletionRequestDeadline(
      requestDeadlineAtMs,
    ),
    writerLeaseTargetAtMs:
      createMultipartCompletionWriterLeaseTargetAtMs(
        operationDeadlineAtMs,
        requestDeadlineAtMs,
      ),
  };
}

const applicationAttemptResolutionDependencies = Object.freeze({
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  handoffCompletionAttemptAfterAccessRevocationFn:
    handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn:
    loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  resolveCompletionAttemptFailureWithOwnerFn:
    resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
});

function createMultipartHeadResponse(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  checksumType: "COMPOSITE" | "FULL_OBJECT",
  checksumSha256: string,
  eTag: string,
) {
  return {
    ContentLength: input.sizeBytes,
    ContentType: input.mimeType,
    ETag: eTag,
    ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
    ChecksumType: checksumType,
    Metadata: {
      "flashcards-workspace-id": input.workspaceId,
      "flashcards-media-asset-id": input.mediaAssetId,
      "flashcards-last-operation-id-sha256":
        createHash("sha256").update(input.lastOperationId).digest("hex"),
      "flashcards-sha256": input.sha256,
    },
  };
}

type ForegroundCompletionDeadlinePhase =
  | "complete"
  | "normalize"
  | "promote"
  | "database";

type DurableMultipartStorageFixture = Readonly<{
  client: S3Client;
  mutationStarted: Promise<void>;
  markMutationStarted: () => void;
  releaseMutation: () => void;
  getMutationPhases: () => ReadonlyArray<
    Exclude<ForegroundCompletionDeadlinePhase, "database">
  >;
}>;

function createDurableMultipartStorageFixture(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>,
  blockedPhase: ForegroundCompletionDeadlinePhase,
): DurableMultipartStorageFixture {
  let stagingState: "missing" | "composite" | "full" = "missing";
  let blobAvailable = false;
  let foregroundMutationBlocked = false;
  const mutationPhases: Array<
    Exclude<ForegroundCompletionDeadlinePhase, "database">
  > = [];
  let resolveMutationStarted!: () => void;
  const mutationStarted = new Promise<void>((resolveStarted) => {
    resolveMutationStarted = resolveStarted;
  });
  let resolveMutationRelease!: () => void;
  const mutationRelease = new Promise<void>((resolveRelease) => {
    resolveMutationRelease = resolveRelease;
  });
  const markMutationStarted = (): void => resolveMutationStarted();
  const waitForForegroundDeadline = async (
    phase: Exclude<ForegroundCompletionDeadlinePhase, "database">,
    signal: AbortSignal,
    commitPossibleMutation: () => void,
  ): Promise<void> => {
    if (phase !== blockedPhase || foregroundMutationBlocked) return;
    foregroundMutationBlocked = true;
    commitPossibleMutation();
    markMutationStarted();
    await new Promise<void>((resolveMutation, reject) => {
      const rejectWithAbortReason = (): void => {
        reject(signal.reason);
      };
      signal.addEventListener("abort", rejectWithAbortReason, { once: true });
      void mutationRelease.then(() => {
        signal.removeEventListener("abort", rejectWithAbortReason);
        resolveMutation();
      });
      if (signal.aborted) {
        signal.removeEventListener("abort", rejectWithAbortReason);
        rejectWithAbortReason();
      }
    });
  };
  const client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  client.send = (async (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    const signal = options?.abortSignal;
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === input.blobStorageKey) {
        if (!blobAvailable) {
          throw createS3Error(404, "NoSuchKey", "Blob is not available yet.");
        }
        return {
          ...createMultipartHeadResponse(
            input,
            "FULL_OBJECT",
            input.sha256,
            "\"blob-etag\"",
          ),
          Metadata: {
            "flashcards-sha256": input.sha256,
          },
        };
      }
      if (command.input.Key === input.stagingStorageKey) {
        if (stagingState === "missing") {
          throw createS3Error(
            404,
            "NoSuchKey",
            "Multipart staging object is not available yet.",
          );
        }
        return createMultipartHeadResponse(
          input,
          stagingState === "full" ? "FULL_OBJECT" : "COMPOSITE",
          stagingState === "full" ? input.sha256 : parts[0]?.sha256 ?? digest(),
          stagingState === "full"
            ? "\"normalized-etag\""
            : "\"multipart-etag\"",
        );
      }
    }
    if (command instanceof ListPartsCommand) {
      return {
        IsTruncated: false,
        Parts: parts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.eTag,
          ChecksumSHA256: Buffer.from(part.sha256, "hex").toString("base64"),
        })),
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      if (signal === undefined) {
        throw new TypeError(
          "Multipart completion must propagate its abort signal.",
        );
      }
      mutationPhases.push("complete");
      await waitForForegroundDeadline(
        "complete",
        signal,
        () => {
          stagingState = "composite";
        },
      );
      stagingState = "composite";
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      if (signal === undefined) {
        throw new TypeError("Multipart copy must propagate its abort signal.");
      }
      if (command.input.Key === input.stagingStorageKey) {
        mutationPhases.push("normalize");
        await waitForForegroundDeadline(
          "normalize",
          signal,
          () => {
            stagingState = "full";
          },
        );
        stagingState = "full";
        return {};
      }
      if (command.input.Key === input.blobStorageKey) {
        mutationPhases.push("promote");
        await waitForForegroundDeadline(
          "promote",
          signal,
          () => {
            blobAvailable = true;
          },
        );
        blobAvailable = true;
        return {};
      }
    }
    throw new Error(
      `Unexpected S3 command ${getUnexpectedS3CommandName(command)}`,
    );
  }) as S3Client["send"];
  return {
    client,
    mutationStarted,
    markMutationStarted,
    releaseMutation: resolveMutationRelease,
    getMutationPhases: () => [...mutationPhases],
  };
}

async function applyHandedOffMultipartWithWorkerStorage(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  storage: DurableMultipartStorageFixture,
): Promise<void> {
  const deadlineAtMs = Date.now() + 30_000;
  const jobs = await claimMultipartCompletionReconciliations({
    leaseOwner: `application-phase-handoff-${randomUUID()}`,
    leaseDurationMs: 60_000,
    limit: 1,
    deadlineAtMs,
  });
  const job = jobs[0];
  assert.ok(job !== undefined);
  await applyClaimedMultipartWithWorkerStorage(input, storage, job);
}

async function applyClaimedMultipartWithWorkerStorage(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  storage: DurableMultipartStorageFixture,
  job: ClaimedMultipartCompletionReconciliation,
): Promise<void> {
  const deadlineAtMs = Date.now() + 30_000;
  await reconcileMultipartMediaAssetUploadWithDependencies(
    {
      workspaceId: job.workspaceId,
      mediaAssetId: job.mediaAssetId,
      stagingStorageKey: job.stagingStorageKey,
      blobStorageKey: job.blobStorageKey,
      s3UploadId: job.s3UploadId,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      sha256: job.sha256,
      lastOperationId: job.lastOperationId,
      partCount: job.partCount,
      completedPartsFingerprint: job.completedPartsFingerprint,
      renewLease: () =>
        renewMultipartCompletionReconciliationLease(
          job,
          60_000,
          deadlineAtMs,
        ),
      signal: new AbortController().signal,
      observationScope: applicationObservationScope(input),
    },
    {
      s3Client: storage.client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );
  assert.equal(
    await applyMultipartCompletionReconciliation(job, deadlineAtMs),
    "applied",
  );
}

async function completeLegacyMultipartSession(
  fixture: PostgresIntegrationFixture,
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  reservationToken: string,
  normalizationVersion: MediaBlobNormalizationVersion,
): Promise<void> {
  const blobId = randomUUID();
  await fixture.ownerPool.query(
    `WITH inserted_blob AS (
       INSERT INTO content.media_blobs
       (media_blob_id,sha256,mime_type,size_bytes,storage_key,normalization_version)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING media_blob_id
     ), inserted_asset AS (
       INSERT INTO content.media_assets
       (media_asset_id,workspace_id,media_blob_id,source_url,created_at,client_updated_at,
        last_modified_by_replica_id,last_operation_id)
       SELECT $7,$8,media_blob_id,$9,$10,$10,$11,$12 FROM inserted_blob RETURNING 1
     ), finalized AS (
       UPDATE content.media_blob_writer_reservations SET state='finalized'
       WHERE reservation_token=$13 RETURNING 1
     )
     UPDATE content.media_upload_sessions SET state='completed',completed_at=now()
     WHERE media_upload_session_id=$14
       AND EXISTS (SELECT 1 FROM inserted_asset) AND EXISTS (SELECT 1 FROM finalized)`,
    [
      blobId, input.sha256, input.mimeType, input.sizeBytes,
      input.blobStorageKey, normalizationVersion, input.mediaAssetId,
      input.workspaceId, input.sourceUrl, input.assetCreatedAt,
      input.lastModifiedByReplicaId, input.lastOperationId,
      reservationToken, input.sessionId,
    ],
  );
}

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

test("multipart completion application boundary resolves durable storage and database races", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const legacyReplayInput = session(fixture, "active", future);
    await insertSession(fixture, legacyReplayInput, "active");
    const legacyStart =
      await beginMediaAssetUploadSessionCompletionWithOwner(
        legacyReplayInput,
      );
    assert.equal(legacyStart.status, "started");
    assert.ok("reservation" in legacyStart);
    await completeLegacyMultipartSession(
      fixture,
      legacyReplayInput,
      legacyStart.reservation.reservationToken,
      legacyStart.reservation.normalizationVersion,
    );
    const legacyReplaySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        legacyReplayInput.userId,
        legacyReplayInput.workspaceId,
        legacyReplayInput.sessionId,
      );
    const legacyReplayDeadlines = createApplicationDeadlines(5_000, 10_000);
    let legacyStorageCalls = 0;
    let legacyApplyCalls = 0;
    try {
      const legacyReplay =
        await completeMultipartUploadSessionAtApplicationBoundary(
          legacyReplayInput.userId,
          legacyReplaySession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(legacyReplayInput),
          legacyReplayDeadlines.operation,
          legacyReplayDeadlines.writerLeaseTargetAtMs,
          legacyReplayDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {
              throw new Error(
                "Legacy completed replay must not abort multipart storage.",
              );
            },
            completeMultipartMediaAssetUploadFn: async () => {
              legacyStorageCalls += 1;
            },
            completeMediaAssetUploadSessionForWorkspaceFn: async () => {
              legacyApplyCalls += 1;
              throw new Error(
                "Legacy completed replay must not apply the asset again.",
              );
            },
          },
        );
      assert.equal(legacyReplay.applied, false);
      assert.equal(
        legacyReplay.mediaAsset.mediaAssetId,
        legacyReplayInput.mediaAssetId,
      );
    } finally {
      legacyReplayDeadlines.operation.dispose();
      legacyReplayDeadlines.request.dispose();
    }
    assert.equal(legacyStorageCalls, 0);
    assert.equal(legacyApplyCalls, 0);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_blob_writer_attempts
         WHERE media_upload_session_id=$1`,
        [legacyReplayInput.sessionId],
      )).rows[0].count,
      0,
    );

    let completedAbortStorageCalls = 0;
    await assert.rejects(
      async () => {
        const abortStart =
          await beginMediaAssetUploadSessionAbortForWorkspace(
            legacyReplayInput.userId,
            legacyReplayInput.workspaceId,
            legacyReplayInput.sessionId,
          );
        await abortMultipartUploadSessionAtApplicationBoundary(
          legacyReplayInput.userId,
          abortStart,
          applicationObservationScope(legacyReplayInput),
          new AbortController().signal,
          <Result>(operation: () => Promise<Result>): Promise<Result> =>
            operation(),
          async () => {
            completedAbortStorageCalls += 1;
          },
        );
      },
      (error: unknown) =>
        error instanceof HttpError
        && error.statusCode === 409
        && error.code === "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    );
    assert.equal(completedAbortStorageCalls, 0);

    const alreadyAbortedInput = session(fixture, "active", future);
    await insertSession(fixture, alreadyAbortedInput, "active");
    assert.equal(
      (await beginMediaAssetUploadSessionAbortForWorkspace(
        alreadyAbortedInput.userId,
        alreadyAbortedInput.workspaceId,
        alreadyAbortedInput.sessionId,
      )).status,
      "abort_required",
    );
    assert.equal(
      await close(alreadyAbortedInput, alreadyAbortedInput.sizeBytes),
      "no_writer_closed",
    );
    const alreadyAbortedStart =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        alreadyAbortedInput.userId,
        alreadyAbortedInput.workspaceId,
        alreadyAbortedInput.sessionId,
      );
    assert.equal(alreadyAbortedStart.status, "already_aborted");
    let replayedAbortStorageCalls = 0;
    const replayedAbort =
      await abortMultipartUploadSessionAtApplicationBoundary(
        alreadyAbortedInput.userId,
        alreadyAbortedStart,
        applicationObservationScope(alreadyAbortedInput),
        new AbortController().signal,
        <Result>(operation: () => Promise<Result>): Promise<Result> =>
          operation(),
        async () => {
          replayedAbortStorageCalls += 1;
        },
      );
    assert.equal(replayedAbort.state, "aborted");
    assert.equal(
      replayedAbort.abortedAt,
      alreadyAbortedStart.uploadSession.abortedAt,
    );
    assert.equal(replayedAbortStorageCalls, 0);

    const copyRetryInput = session(fixture, "active", future);
    await insertSession(fixture, copyRetryInput, "active");
    const copyRetrySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        copyRetryInput.userId,
        copyRetryInput.workspaceId,
        copyRetryInput.sessionId,
      );
    const copyRetryParts = completionParts();
    let stagingNormalized = false;
    let copyAttempts = 0;
    const client = new S3Client({
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
      region: "us-east-1",
    });
    client.send = (async (command: unknown) => {
      if (command instanceof CompleteMultipartUploadCommand) return {};
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === copyRetryInput.blobStorageKey) {
          return createMultipartHeadResponse(
            copyRetryInput,
            "FULL_OBJECT",
            copyRetryInput.sha256,
            "\"blob-etag\"",
          );
        }
        return createMultipartHeadResponse(
          copyRetryInput,
          stagingNormalized ? "FULL_OBJECT" : "COMPOSITE",
          stagingNormalized ? copyRetryInput.sha256 : digest(),
          stagingNormalized ? "\"normalized-etag\"" : "\"multipart-etag\"",
        );
      }
      if (command instanceof CopyObjectCommand) {
        copyAttempts += 1;
        stagingNormalized = true;
        throw createS3Error(
          500,
          "InternalError",
          "Copy committed but its response was lost.",
        );
      }
      throw new Error(
        `Unexpected S3 command ${getUnexpectedS3CommandName(command)}`,
      );
    }) as S3Client["send"];
    let applyCalls = 0;
    const copyRetryDeadlines = createApplicationDeadlines(5_000, 10_000);
    try {
      const result =
        await completeMultipartUploadSessionAtApplicationBoundary(
          copyRetryInput.userId,
          copyRetrySession,
          copyRetryParts,
          randomUUID(),
          applicationObservationScope(copyRetryInput),
          copyRetryDeadlines.operation,
          copyRetryDeadlines.writerLeaseTargetAtMs,
          copyRetryDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: (input) =>
              completeMultipartMediaAssetUploadWithDependencies(input, {
                s3Client: client,
                getMediaAssetsStorageConfigFn:
                  getTestMediaAssetsStorageConfig,
              }),
            completeMediaAssetUploadSessionForWorkspaceFn:
              async (userId, workspaceId, sessionId, writer) => {
                applyCalls += 1;
                const applied =
                  await completeMediaAssetUploadSessionForWorkspace(
                    userId,
                    workspaceId,
                    sessionId,
                    writer,
                  );
                if (applyCalls === 1) {
                  throw new DatabaseCommitOutcomeUnknownError(
                    new Error("Commit response was lost."),
                  );
                }
                return applied;
              },
          },
        );
      assert.equal(result.applied, false);
    } finally {
      copyRetryDeadlines.operation.dispose();
      copyRetryDeadlines.request.dispose();
    }
    assert.equal(copyAttempts, 1);
    assert.equal(applyCalls, 2);
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        copyRetryInput.userId,
        copyRetryInput.workspaceId,
        copyRetryInput.sessionId,
      )).state,
      "completed",
    );

    const deadlineInput = session(fixture, "active", future);
    await insertSession(fixture, deadlineInput, "active");
    const deadlineSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
    );
    const deadlineParts = completionParts();
    const deadlineStorage = createDurableMultipartStorageFixture(
      deadlineInput,
      deadlineParts,
      "complete",
    );
    const deadlineBoundaries = createApplicationDeadlines(1_500, 6_000);
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          deadlineInput.userId,
          deadlineSession,
          deadlineParts,
          randomUUID(),
          applicationObservationScope(deadlineInput),
          deadlineBoundaries.operation,
          deadlineBoundaries.writerLeaseTargetAtMs,
          deadlineBoundaries.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: (storageInput) =>
              completeMultipartMediaAssetUploadWithDependencies(
                storageInput,
                {
                  s3Client: deadlineStorage.client,
                  getMediaAssetsStorageConfigFn:
                    getTestMediaAssetsStorageConfig,
                },
              ),
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          assert.equal(error.statusCode, 503);
          return true;
        },
      );
      await deadlineStorage.mutationStarted;
    } finally {
      deadlineBoundaries.operation.dispose();
      deadlineBoundaries.request.dispose();
    }
    assert.equal(
      await checkMediaAssetCompletionPendingForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.mediaAssetId,
      ),
      true,
    );
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
      )).state,
      "completing",
    );
    const pendingAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
      );
    assert.equal(pendingAbort.status, "completion_pending");
    let pendingAbortStorageCalls = 0;
    await assert.rejects(
      abortMultipartUploadSessionAtApplicationBoundary(
        deadlineInput.userId,
        pendingAbort,
        applicationObservationScope(deadlineInput),
        new AbortController().signal,
        <Result>(operation: () => Promise<Result>): Promise<Result> =>
          operation(),
        async () => {
          pendingAbortStorageCalls += 1;
        },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        assert.equal(error.statusCode, 409);
        return true;
      },
    );
    assert.equal(pendingAbortStorageCalls, 0);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_upload_sessions
         WHERE workspace_id=$1 AND media_asset_id=$2`,
        [deadlineInput.workspaceId, deadlineInput.mediaAssetId],
      )).rows[0].count,
      1,
    );
    const replacementCreateInput = {
      mediaAssetId: deadlineInput.mediaAssetId,
      mimeType: deadlineInput.mimeType,
      sizeBytes: deadlineInput.sizeBytes,
      sha256: deadlineInput.sha256,
      partSizeBytes: deadlineInput.partSizeBytes,
      partCount: deadlineInput.partCount,
      sourceUrl: deadlineInput.sourceUrl,
      createdAt: deadlineInput.assetCreatedAt,
      clientUpdatedAt: deadlineInput.clientUpdatedAt,
      lastModifiedByReplicaId: deadlineInput.lastModifiedByReplicaId,
      lastOperationId: deadlineInput.lastOperationId,
    };
    let replacementMultipartCreateCalls = 0;
    let replacementMultipartAbortCalls = 0;
    const replacementCreationDependencies = {
      abortMultipartMediaAssetUploadUntilDeadlineFn: async () => {
        replacementMultipartAbortCalls += 1;
      },
      acquireCreationClaimFn:
        acquireMediaAssetUploadSessionCreationClaimForWorkspace,
      createMediaAssetFromAvailableBlobForWorkspaceFn:
        createMediaAssetFromAvailableBlobForWorkspace,
      createMultipartMediaAssetUploadFn: async (): Promise<never> => {
        replacementMultipartCreateCalls += 1;
        throw new Error(
          "Released-client replacement create must not start multipart storage.",
        );
      },
      loadCreationReplayFn:
        loadMediaAssetUploadSessionCreationReplayForWorkspace,
      recordUploadSessionWithCreationClaimFn:
        recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
      releaseCreationClaimFn:
        releaseMediaAssetUploadSessionCreationClaimForWorkspace,
    };
    const createReplacement = () => {
      const replacementSessionId = randomUUID();
      return createMultipartUploadSessionAtApplicationBoundary(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        replacementSessionId,
        randomUUID(),
        replacementCreateInput,
        buildMediaMultipartUploadStagingStorageKey(
          deadlineInput.workspaceId,
          deadlineInput.mediaAssetId,
          replacementSessionId,
        ),
        deadlineInput.blobStorageKey,
        applicationObservationScope(deadlineInput),
        new AbortController().signal,
        60_000,
        replacementCreationDependencies,
      );
    };
    await assert.rejects(
      createReplacement(),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        return true;
      },
    );
    assert.equal(replacementMultipartCreateCalls, 0);
    assert.equal(replacementMultipartAbortCalls, 0);
    const reconciliationJobs =
      await claimMultipartCompletionReconciliations({
        leaseOwner: `application-handoff-${randomUUID()}`,
        leaseDurationMs: 60_000,
        limit: 1,
        deadlineAtMs: Date.now() + 30_000,
      });
    assert.equal(reconciliationJobs.length, 1);
    const reconciliationJob = reconciliationJobs[0];
    assert.ok(reconciliationJob !== undefined);
    const leasedAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
      );
    assert.equal(leasedAbort.status, "completion_pending");
    let leasedAbortStorageCalls = 0;
    await assert.rejects(
      abortMultipartUploadSessionAtApplicationBoundary(
        deadlineInput.userId,
        leasedAbort,
        applicationObservationScope(deadlineInput),
        new AbortController().signal,
        <Result>(operation: () => Promise<Result>): Promise<Result> =>
          operation(),
        async () => {
          leasedAbortStorageCalls += 1;
        },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        return true;
      },
    );
    assert.equal(leasedAbortStorageCalls, 0);
    const pendingReplayDeadlines = createApplicationDeadlines(5_000, 10_000);
    let pendingReplayStorageCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          deadlineInput.userId,
          deadlineSession,
          deadlineParts,
          randomUUID(),
          applicationObservationScope(deadlineInput),
          pendingReplayDeadlines.operation,
          pendingReplayDeadlines.writerLeaseTargetAtMs,
          pendingReplayDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              pendingReplayStorageCalls += 1;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          assert.equal(error.statusCode, 503);
          return true;
        },
      );
    } finally {
      pendingReplayDeadlines.operation.dispose();
      pendingReplayDeadlines.request.dispose();
    }
    assert.equal(pendingReplayStorageCalls, 0);
    await applyClaimedMultipartWithWorkerStorage(
      deadlineInput,
      deadlineStorage,
      reconciliationJob,
    );
    assert.equal(
      await checkMediaAssetCompletionPendingForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.mediaAssetId,
      ),
      false,
    );
    const replacementCreateReplay = await createReplacement();
    assert.equal(
      replacementCreateReplay.sessionResult.status,
      "already_available",
    );
    assert.equal(replacementCreateReplay.multipartUploadCreated, false);
    assert.equal(replacementMultipartCreateCalls, 0);
    assert.equal(replacementMultipartAbortCalls, 0);

    const durableReplayDeadlines = createApplicationDeadlines(5_000, 10_000);
    let durableReplayStorageCalls = 0;
    try {
      const durableReplay =
        await completeMultipartUploadSessionAtApplicationBoundary(
          deadlineInput.userId,
          deadlineSession,
          deadlineParts,
          randomUUID(),
          applicationObservationScope(deadlineInput),
          durableReplayDeadlines.operation,
          durableReplayDeadlines.writerLeaseTargetAtMs,
          durableReplayDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              durableReplayStorageCalls += 1;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        );
      assert.equal(durableReplay.applied, false);
    } finally {
      durableReplayDeadlines.operation.dispose();
      durableReplayDeadlines.request.dispose();
    }
    assert.equal(durableReplayStorageCalls, 0);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_upload_sessions
         WHERE workspace_id=$1 AND media_asset_id=$2`,
        [deadlineInput.workspaceId, deadlineInput.mediaAssetId],
      )).rows[0].count,
      1,
    );

    const busyInput = session(fixture, "active", future);
    await insertSession(fixture, busyInput, "active");
    const busySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        busyInput.userId,
        busyInput.workspaceId,
        busyInput.sessionId,
      );
    const busyParts = completionParts();
    let releaseStorage!: () => void;
    const storageRelease = new Promise<void>((resolveStorage) => {
      releaseStorage = resolveStorage;
    });
    let signalStorageStarted!: () => void;
    const storageStarted = new Promise<void>((resolveStarted) => {
      signalStorageStarted = resolveStarted;
    });
    let storageCalls = 0;
    const busyDependencies = {
      ...applicationAttemptResolutionDependencies,
      abortMultipartMediaAssetUploadFn: async () => {},
      completeMultipartMediaAssetUploadFn: async () => {
        storageCalls += 1;
        signalStorageStarted();
        await storageRelease;
      },
      completeMediaAssetUploadSessionForWorkspaceFn:
        completeMediaAssetUploadSessionForWorkspace,
    };
    const firstBusyDeadlines = createApplicationDeadlines(5_000, 10_000);
    const secondBusyDeadlines = createApplicationDeadlines(5_000, 10_000);
    try {
      const firstCompletion =
        completeMultipartUploadSessionAtApplicationBoundary(
          busyInput.userId,
          busySession,
          busyParts,
          randomUUID(),
          applicationObservationScope(busyInput),
          firstBusyDeadlines.operation,
          firstBusyDeadlines.writerLeaseTargetAtMs,
          firstBusyDeadlines.request,
          busyDependencies,
        );
      await storageStarted;
      const secondCompletion =
        completeMultipartUploadSessionAtApplicationBoundary(
          busyInput.userId,
          busySession,
          busyParts,
          randomUUID(),
          applicationObservationScope(busyInput),
          secondBusyDeadlines.operation,
          secondBusyDeadlines.writerLeaseTargetAtMs,
          secondBusyDeadlines.request,
          busyDependencies,
        );
      await wait(50);
      releaseStorage();
      const [firstResult, secondResult] = await Promise.all([
        firstCompletion,
        secondCompletion,
      ]);
      assert.equal(firstResult.applied, true);
      assert.equal(secondResult.applied, false);
    } finally {
      firstBusyDeadlines.operation.dispose();
      firstBusyDeadlines.request.dispose();
      secondBusyDeadlines.operation.dispose();
      secondBusyDeadlines.request.dispose();
    }
    assert.equal(storageCalls, 1);

    const takeoverInput = session(fixture, "active", future);
    await insertSession(fixture, takeoverInput, "active");
    const takeoverParts = completionParts();
    const orphanAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner({
        ...takeoverInput,
        attemptToken: randomUUID(),
        completedPartsFingerprint:
          createMediaAssetUploadSessionCompletedPartsFingerprint(
            takeoverParts,
          ),
      }, 150);
    assert.equal(orphanAttempt.status, "acquired");
    const takeoverSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        takeoverInput.userId,
        takeoverInput.workspaceId,
        takeoverInput.sessionId,
      );
    const takeoverDeadlines = createApplicationDeadlines(3_000, 5_000);
    try {
      const takeoverResult =
        await completeMultipartUploadSessionAtApplicationBoundary(
          takeoverInput.userId,
          takeoverSession,
          takeoverParts,
          randomUUID(),
          applicationObservationScope(takeoverInput),
          takeoverDeadlines.operation,
          takeoverDeadlines.writerLeaseTargetAtMs,
          takeoverDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {},
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        );
      assert.equal(takeoverResult.applied, true);
    } finally {
      takeoverDeadlines.operation.dispose();
      takeoverDeadlines.request.dispose();
    }

    const abortRaceInput = session(fixture, "active", future);
    await insertSession(fixture, abortRaceInput, "active");
    const abortRaceSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        abortRaceInput.userId,
        abortRaceInput.workspaceId,
        abortRaceInput.sessionId,
      );
    let releaseAbortRaceStorage!: () => void;
    const abortRaceStorageRelease = new Promise<void>((resolveStorage) => {
      releaseAbortRaceStorage = resolveStorage;
    });
    let signalAbortRaceStorageStarted!: () => void;
    const abortRaceStorageStarted = new Promise<void>((resolveStarted) => {
      signalAbortRaceStorageStarted = resolveStarted;
    });
    const abortRaceDeadlines = createApplicationDeadlines(3_000, 5_000);
    try {
      const completion =
        completeMultipartUploadSessionAtApplicationBoundary(
          abortRaceInput.userId,
          abortRaceSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(abortRaceInput),
          abortRaceDeadlines.operation,
          abortRaceDeadlines.writerLeaseTargetAtMs,
          abortRaceDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              signalAbortRaceStorageStarted();
              await abortRaceStorageRelease;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        );
      await abortRaceStorageStarted;
      const abortStart =
        await beginMediaAssetUploadSessionAbortForWorkspace(
          abortRaceInput.userId,
          abortRaceInput.workspaceId,
          abortRaceInput.sessionId,
        );
      assert.equal(abortStart.status, "completion_in_progress");
      let abortStorageCalls = 0;
      await assert.rejects(
        abortMultipartUploadSessionAtApplicationBoundary(
          abortRaceInput.userId,
          abortStart,
          applicationObservationScope(abortRaceInput),
          new AbortController().signal,
          <Result>(operation: () => Promise<Result>): Promise<Result> =>
            operation(),
          async () => {
            abortStorageCalls += 1;
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 503);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          assert.equal(error.details?.retryAfterSeconds, 1);
          return true;
        },
      );
      assert.equal(abortStorageCalls, 0);
      assert.deepEqual(
        (await fixture.ownerPool.query<Readonly<{
          session_state: string;
          attempt_state: string;
          reservation_state: string;
        }>>(
          `SELECT sessions.state AS session_state,
             attempts.state AS attempt_state,
             reservations.state AS reservation_state
           FROM content.media_upload_sessions AS sessions
           INNER JOIN content.media_blob_writer_attempts AS attempts
             ON attempts.media_upload_session_id=sessions.media_upload_session_id
           INNER JOIN content.media_blob_writer_reservations AS reservations
             ON reservations.reservation_token=attempts.reservation_token
           WHERE sessions.media_upload_session_id=$1`,
          [abortRaceInput.sessionId],
        )).rows[0],
        {
          session_state: "completing",
          attempt_state: "leased",
          reservation_state: "active",
        },
      );
      releaseAbortRaceStorage();
      assert.equal((await completion).applied, true);
    } finally {
      releaseAbortRaceStorage();
      abortRaceDeadlines.operation.dispose();
      abortRaceDeadlines.request.dispose();
    }
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        abortRaceInput.userId,
        abortRaceInput.workspaceId,
        abortRaceInput.sessionId,
      )).state,
      "completed",
    );
  });
});

test("legacy noncanonical completion settles only after exact quiescence", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const legacyLastOperationId = "legacy\u00a0operation";
    const legacyInput = {
      ...session(fixture, "completing", future),
      lastOperationId: legacyLastOperationId,
    };
    await insertSession(fixture, legacyInput, "completing");
    const legacySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        legacyInput.userId,
        legacyInput.workspaceId,
        legacyInput.sessionId,
      );
    const legacyDeadlines = createApplicationDeadlines(5_000, 10_000);
    let legacyAbortStorageCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          legacyInput.userId,
          legacySession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(legacyInput),
          legacyDeadlines.operation,
          legacyDeadlines.writerLeaseTargetAtMs,
          legacyDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {
              legacyAbortStorageCalls += 1;
            },
            completeMultipartMediaAssetUploadFn: async () => {
              throw new Error(
                "Legacy restart settlement must not complete storage.",
              );
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
          );
          return true;
        },
      );
    } finally {
      legacyDeadlines.operation.dispose();
      legacyDeadlines.request.dispose();
    }
    assert.equal(legacyAbortStorageCalls, 1);
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        legacyInput.userId,
        legacyInput.workspaceId,
        legacyInput.sessionId,
      )).state,
      "aborted",
    );

    const legacyAbortReplay =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        legacyInput.userId,
        legacyInput.workspaceId,
        legacyInput.sessionId,
      );
    assert.equal(legacyAbortReplay.status, "already_aborted");
    await abortMultipartUploadSessionAtApplicationBoundary(
      legacyInput.userId,
      legacyAbortReplay,
      applicationObservationScope(legacyInput),
      new AbortController().signal,
      <Result>(operation: () => Promise<Result>): Promise<Result> =>
        operation(),
      async () => {
        throw new Error(
          "Already-aborted legacy replay must not call storage.",
        );
      },
    );

    const replacementSessionId = randomUUID();
    const replacementLastOperationId = randomUUID();
    const replacement = await createMultipartUploadSessionAtApplicationBoundary(
      legacyInput.userId,
      legacyInput.workspaceId,
      replacementSessionId,
      randomUUID(),
      {
        mediaAssetId: legacyInput.mediaAssetId,
        mimeType: legacyInput.mimeType,
        sizeBytes: legacyInput.sizeBytes,
        sha256: legacyInput.sha256,
        partSizeBytes: legacyInput.partSizeBytes,
        partCount: legacyInput.partCount,
        sourceUrl: legacyInput.sourceUrl,
        createdAt: legacyInput.assetCreatedAt,
        clientUpdatedAt: legacyInput.clientUpdatedAt,
        lastModifiedByReplicaId: legacyInput.lastModifiedByReplicaId,
        lastOperationId: replacementLastOperationId,
      },
      buildMediaMultipartUploadStagingStorageKey(
        legacyInput.workspaceId,
        legacyInput.mediaAssetId,
        replacementSessionId,
      ),
      legacyInput.blobStorageKey,
      applicationObservationScope(legacyInput),
      new AbortController().signal,
      60_000,
      {
        abortMultipartMediaAssetUploadUntilDeadlineFn: async () => {},
        acquireCreationClaimFn:
          acquireMediaAssetUploadSessionCreationClaimForWorkspace,
        createMediaAssetFromAvailableBlobForWorkspaceFn:
          createMediaAssetFromAvailableBlobForWorkspace,
        createMultipartMediaAssetUploadFn: async (input) => ({
          storageKey: input.stagingStorageKey,
          s3UploadId: `replacement-${randomUUID()}`,
          expiresAt: future,
        }),
        loadCreationReplayFn:
          loadMediaAssetUploadSessionCreationReplayForWorkspace,
        recordUploadSessionWithCreationClaimFn:
          recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
        releaseCreationClaimFn:
          releaseMediaAssetUploadSessionCreationClaimForWorkspace,
      },
    );
    assert.equal(replacement.multipartUploadCreated, true);
    assert.equal(replacement.sessionResult.status, "upload_required");

    const assertProtectedLegacyState = async (
      input: MediaAssetUploadSessionCompletionWithOwnerInput,
      expectedStatusCode: number,
      expectedAttemptState: string,
      expectedReconciliationState: string | null,
    ): Promise<void> => {
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const deadlines = createApplicationDeadlines(5_000, 10_000);
      let storageCalls = 0;
      try {
        await assert.rejects(
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            completionParts(),
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {
                storageCalls += 1;
              },
              completeMultipartMediaAssetUploadFn: async () => {
                storageCalls += 1;
              },
              completeMediaAssetUploadSessionForWorkspaceFn:
                completeMediaAssetUploadSessionForWorkspace,
            },
          ),
          (error: unknown): boolean => {
            assert.ok(error instanceof HttpError);
            assert.equal(error.statusCode, expectedStatusCode);
            assert.equal(
              error.code,
              "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
            );
            return true;
          },
        );
      } finally {
        deadlines.operation.dispose();
        deadlines.request.dispose();
      }
      assert.equal(storageCalls, 0);
      assert.deepEqual(
        (await fixture.ownerPool.query<Readonly<{
          session_state: string;
          attempt_state: string;
          reconciliation_state: string | null;
        }>>(
          `SELECT
             sessions.state AS session_state,
             attempts.state AS attempt_state,
             attempts.reconciliation_state
           FROM content.media_upload_sessions AS sessions
           INNER JOIN content.media_blob_writer_attempts AS attempts
             ON attempts.media_upload_session_id =
               sessions.media_upload_session_id
           WHERE sessions.media_upload_session_id=$1`,
          [input.sessionId],
        )).rows[0],
        {
          session_state: "completing",
          attempt_state: expectedAttemptState,
          reconciliation_state: expectedReconciliationState,
        },
      );
    };

    const liveInput = session(fixture, "active", future);
    await insertSession(fixture, liveInput, "active");
    const liveParts = completionParts();
    const liveAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...liveInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(liveParts),
    };
    const liveAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        liveAttemptInput,
        60_000,
      );
    assert.equal(liveAttempt.status, "acquired");
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET last_operation_id=$2
       WHERE media_upload_session_id=$1`,
      [liveInput.sessionId, legacyLastOperationId],
    );
    await assertProtectedLegacyState(
      { ...liveInput, lastOperationId: legacyLastOperationId },
      503,
      "leased",
      null,
    );

    const pendingInput = session(fixture, "active", future);
    await insertSession(fixture, pendingInput, "active");
    const pendingParts = completionParts();
    const pendingAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...pendingInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(
          pendingParts,
        ),
    };
    const pendingAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        pendingAttemptInput,
        60_000,
      );
    assert.equal(pendingAttempt.status, "acquired");
    assert.ok("reservationToken" in pendingAttempt);
    assert.equal(
      await handoffMediaAssetUploadSessionCompletionAttempt({
        ...pendingAttemptInput,
        reservationToken: pendingAttempt.reservationToken,
        normalizationVersion: pendingAttempt.normalizationVersion,
      }),
      "handed_off",
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET last_operation_id=$2
       WHERE media_upload_session_id=$1`,
      [pendingInput.sessionId, legacyLastOperationId],
    );
    await assertProtectedLegacyState(
      { ...pendingInput, lastOperationId: legacyLastOperationId },
      409,
      "expired",
      "pending",
    );
  });
});

test("foreground completion deadlines hand every mutation phase to the durable worker", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const assertCompletionInProgress = (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(
        error.code,
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
      );
      assert.equal(error.details?.retryAfterSeconds, 1);
      return true;
    };
    const assertPendingHandoff = async (sessionId: string): Promise<void> => {
      const state = (await fixture.ownerPool.query<Readonly<{
        live_foreground_attempts: number;
        pending_reconciliations: number;
        session_state: string;
      }>>(
        `SELECT
           count(*) FILTER (
             WHERE attempts.state='leased'
               AND attempts.reconciliation_state IS NULL
           )::int AS live_foreground_attempts,
           count(*) FILTER (
             WHERE attempts.reconciliation_state='pending'
           )::int AS pending_reconciliations,
           min(sessions.state)::text AS session_state
         FROM content.media_upload_sessions AS sessions
         INNER JOIN content.media_blob_writer_attempts AS attempts
           ON attempts.media_upload_session_id=sessions.media_upload_session_id
         WHERE sessions.media_upload_session_id=$1`,
        [sessionId],
      )).rows[0];
      assert.deepEqual(state, {
        live_foreground_attempts: 0,
        pending_reconciliations: 1,
        session_state: "completing",
      });
    };

    const immediateInput = session(fixture, "active", future);
    await insertSession(fixture, immediateInput, "active");
    const immediateParts = completionParts();
    const immediateAttemptToken = randomUUID();
    const immediateAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        {
          ...immediateInput,
          attemptToken: immediateAttemptToken,
          completedPartsFingerprint:
            createMediaAssetUploadSessionCompletedPartsFingerprint(
              immediateParts,
            ),
        },
        60_000,
      );
    assert.equal(immediateAttempt.status, "acquired");
    const immediateSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        immediateInput.userId,
        immediateInput.workspaceId,
        immediateInput.sessionId,
      );
    const immediateStorage = createDurableMultipartStorageFixture(
      immediateInput,
      immediateParts,
      "complete",
    );
    const immediateObservedAtMs = Date.now();
    const immediateOperationDeadlineAtMs = immediateObservedAtMs - 1;
    const immediateRequestDeadlineAtMs = immediateObservedAtMs + 6_000;
    const immediateOperationDeadline =
      createMultipartCompletionRequestDeadline(
        immediateOperationDeadlineAtMs,
      );
    const immediateRequestDeadline =
      createMultipartCompletionRequestDeadline(
        immediateRequestDeadlineAtMs,
      );
    const immediateWriterLeaseTargetAtMs =
      createMultipartCompletionWriterLeaseTargetAtMs(
        immediateOperationDeadlineAtMs,
        immediateRequestDeadlineAtMs,
      );
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          immediateInput.userId,
          immediateSession,
          immediateParts,
          immediateAttemptToken,
          applicationObservationScope(immediateInput),
          immediateOperationDeadline,
          immediateWriterLeaseTargetAtMs,
          immediateRequestDeadline,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: (storageInput) =>
              completeMultipartMediaAssetUploadWithDependencies(
                storageInput,
                {
                  s3Client: immediateStorage.client,
                  getMediaAssetsStorageConfigFn:
                    getTestMediaAssetsStorageConfig,
                },
              ),
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        assertCompletionInProgress,
      );
    } finally {
      immediateOperationDeadline.dispose();
      immediateRequestDeadline.dispose();
    }
    await assertPendingHandoff(immediateInput.sessionId);
    immediateStorage.releaseMutation();
    await applyHandedOffMultipartWithWorkerStorage(
      immediateInput,
      immediateStorage,
    );

    for (const phase of [
      "complete",
      "normalize",
      "promote",
      "database",
    ] as const) {
      const input = session(fixture, "active", future);
      await insertSession(fixture, input, "active");
      const parts = completionParts();
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const storage = createDurableMultipartStorageFixture(
        input,
        parts,
        phase,
      );
      const deadlines = createApplicationDeadlines(1_500, 6_000);
      const databaseApplication = phase === "database"
        ? async (): Promise<never> => {
          storage.markMutationStarted();
          return new Promise<never>((_resolve, reject) => {
            const rejectWithAbortReason = (): void =>
              reject(deadlines.operation.signal.reason);
            deadlines.operation.signal.addEventListener(
              "abort",
              rejectWithAbortReason,
              { once: true },
            );
            if (deadlines.operation.signal.aborted) {
              rejectWithAbortReason();
            }
          });
        }
        : completeMediaAssetUploadSessionForWorkspace;
      try {
        await assert.rejects(
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            parts,
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {},
              completeMultipartMediaAssetUploadFn: (storageInput) =>
                completeMultipartMediaAssetUploadWithDependencies(
                  storageInput,
                  {
                    s3Client: storage.client,
                    getMediaAssetsStorageConfigFn:
                      getTestMediaAssetsStorageConfig,
                  },
                ),
              completeMediaAssetUploadSessionForWorkspaceFn:
                databaseApplication,
            },
          ),
          assertCompletionInProgress,
        );
        await storage.mutationStarted;
      } finally {
        deadlines.operation.dispose();
        deadlines.request.dispose();
      }
      await assertPendingHandoff(input.sessionId);
      await applyHandedOffMultipartWithWorkerStorage(input, storage);
      assert.equal(
        (await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        )).state,
        "completed",
      );
    }

    const cutoffAuthorizationCall = {
      complete: 1,
      normalize: 2,
      promote: 3,
    } as const;
    const completedBeforeCutoff = {
      complete: [],
      normalize: ["complete"],
      promote: ["complete", "normalize"],
    } as const;
    for (const phase of [
      "complete",
      "normalize",
      "promote",
    ] as const) {
      const input = session(fixture, "active", future);
      await insertSession(fixture, input, "active");
      const parts = completionParts();
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const storage = createDurableMultipartStorageFixture(
        input,
        parts,
        "database",
      );
      const deadlines = createApplicationDeadlines(2_000, 7_000);
      let authorizationCalls = 0;
      let observedDelayedTimer = false;
      try {
        await assert.rejects(
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            parts,
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {},
              completeMultipartMediaAssetUploadFn: (storageInput) =>
                completeMultipartMediaAssetUploadWithDependencies(
                  {
                    ...storageInput,
                    assertStorageMutationAuthorized: () => {
                      authorizationCalls += 1;
                      if (
                        authorizationCalls
                          === cutoffAuthorizationCall[phase]
                      ) {
                        while (
                          Date.now()
                            < deadlines.operation.deadlineAtMs
                        ) {
                          // Keep the event loop occupied past the absolute cutoff.
                        }
                        assert.equal(
                          deadlines.operation.signal.aborted,
                          false,
                        );
                        observedDelayedTimer = true;
                      }
                      storageInput.assertStorageMutationAuthorized();
                    },
                  },
                  {
                    s3Client: storage.client,
                    getMediaAssetsStorageConfigFn:
                      getTestMediaAssetsStorageConfig,
                  },
                ),
              completeMediaAssetUploadSessionForWorkspaceFn:
                completeMediaAssetUploadSessionForWorkspace,
            },
          ),
          assertCompletionInProgress,
        );
      } finally {
        deadlines.operation.dispose();
        deadlines.request.dispose();
      }
      assert.equal(observedDelayedTimer, true, phase);
      assert.deepEqual(
        storage.getMutationPhases(),
        completedBeforeCutoff[phase],
        phase,
      );
      await assertPendingHandoff(input.sessionId);
      await applyHandedOffMultipartWithWorkerStorage(input, storage);
      assert.equal(
        (await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        )).state,
        "completed",
      );
    }
  });
});

test("foreground completion preserves exact durable handoff after access revocation", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const replicaOwnerUserId = `revoked-replica-owner-${randomUUID()}`;
    const accessChanges = [
      {
        name: "membership",
        revoke: () => fixture.ownerPool.query(
          `DELETE FROM org.workspace_memberships
           WHERE workspace_id=$1 AND user_id=$2`,
          [fixture.workspaceId, fixture.userId],
        ),
        restore: () => fixture.ownerPool.query(
          `INSERT INTO org.workspace_memberships(workspace_id,user_id,role)
           VALUES ($1,$2,'owner')`,
          [fixture.workspaceId, fixture.userId],
        ),
      },
      {
        name: "replica",
        revoke: () => fixture.ownerPool.query(
          `WITH inserted_user AS (
             INSERT INTO org.user_settings(user_id) VALUES ($1)
             RETURNING 1
           )
           UPDATE sync.workspace_replicas
           SET user_id=$1
           WHERE replica_id=$2
             AND EXISTS (SELECT 1 FROM inserted_user)`,
          [replicaOwnerUserId, fixture.replicaId],
        ),
        restore: () => fixture.ownerPool.query(
          `WITH restored_replica AS (
             UPDATE sync.workspace_replicas
             SET user_id=$1
             WHERE replica_id=$2
             RETURNING 1
           )
           DELETE FROM org.user_settings
           WHERE user_id=$3
             AND EXISTS (SELECT 1 FROM restored_replica)`,
          [fixture.userId, fixture.replicaId, replicaOwnerUserId],
        ),
      },
    ] as const;

    for (const accessChange of accessChanges) {
      const input = session(
        fixture,
        "active",
        new Date(Date.now() + 3_600_000).toISOString(),
      );
      await insertSession(fixture, input, "active");
      const parts = completionParts();
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const storage = createDurableMultipartStorageFixture(
        input,
        parts,
        "promote",
      );
      const deadlines = createApplicationDeadlines(5_000, 8_000);
      let accessRevoked = false;
      try {
        const completion =
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            parts,
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {},
              completeMultipartMediaAssetUploadFn: (storageInput) =>
                completeMultipartMediaAssetUploadWithDependencies(
                  storageInput,
                  {
                    s3Client: storage.client,
                    getMediaAssetsStorageConfigFn:
                      getTestMediaAssetsStorageConfig,
                  },
                ),
              completeMediaAssetUploadSessionForWorkspaceFn:
                completeMediaAssetUploadSessionForWorkspace,
            },
          );
        await storage.mutationStarted;
        await accessChange.revoke();
        accessRevoked = true;
        storage.releaseMutation();
        await assert.rejects(
          completion,
          (error: unknown): boolean => {
            assert.ok(error instanceof HttpError);
            assert.equal(error.statusCode, 503, accessChange.name);
            assert.equal(
              error.code,
              "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
              accessChange.name,
            );
            return true;
          },
        );
        const handoff = (await fixture.ownerPool.query<Readonly<{
          attempt_state: string;
          reconciliation_state: string;
          reservation_state: string;
          completed_parts_fingerprint: string;
        }>>(
          `SELECT attempts.state AS attempt_state,
             attempts.reconciliation_state,
             reservations.state AS reservation_state,
             attempts.completed_parts_fingerprint
           FROM content.media_blob_writer_attempts AS attempts
           INNER JOIN content.media_blob_writer_reservations AS reservations
             ON reservations.reservation_token=attempts.reservation_token
           WHERE attempts.media_upload_session_id=$1`,
          [input.sessionId],
        )).rows[0];
        assert.deepEqual(
          handoff,
          {
            attempt_state: "expired",
            reconciliation_state: "pending",
            reservation_state: "active",
            completed_parts_fingerprint:
              createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
          },
          accessChange.name,
        );
        await accessChange.restore();
        accessRevoked = false;
        await applyHandedOffMultipartWithWorkerStorage(input, storage);
        assert.equal(
          (await loadMediaAssetUploadSessionForCompletionForWorkspace(
            input.userId,
            input.workspaceId,
            input.sessionId,
          )).state,
          "completed",
        );
      } finally {
        storage.releaseMutation();
        deadlines.operation.dispose();
        deadlines.request.dispose();
        if (accessRevoked) await accessChange.restore();
      }
    }
  });
});

test("absolute foreground writer leases remain between operation abort and exact resolution", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, input, "active");
    const attemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...input,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const observedAtMs = Date.now();
    const operationDeadlineAtMs = observedAtMs + 1_000;
    const requestDeadlineAtMs = observedAtMs + 3_000;
    const writerLeaseTargetAtMs =
      createMultipartCompletionWriterLeaseTargetAtMs(
        operationDeadlineAtMs,
        requestDeadlineAtMs,
      );
    const acquired =
      await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        attemptInput,
        writerLeaseTargetAtMs,
      );
    assert.equal(acquired.status, "acquired");
    assert.ok("reservationToken" in acquired);
    const acquiredLeaseExpiresAtMs = Date.parse(acquired.leaseExpiresAt);
    assert.ok(operationDeadlineAtMs < acquiredLeaseExpiresAtMs);
    assert.ok(acquiredLeaseExpiresAtMs < writerLeaseTargetAtMs);
    assert.ok(writerLeaseTargetAtMs < requestDeadlineAtMs);

    await wait(50);
    const renewed =
      await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        attemptInput,
        writerLeaseTargetAtMs,
      );
    assert.equal(renewed.status, "replayed");
    assert.ok("reservationToken" in renewed);
    const renewedLeaseExpiresAtMs = Date.parse(renewed.leaseExpiresAt);
    assert.ok(operationDeadlineAtMs < renewedLeaseExpiresAtMs);
    assert.ok(renewedLeaseExpiresAtMs < writerLeaseTargetAtMs);
    assert.equal(
      renewed.reservationToken,
      acquired.reservationToken,
    );
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
        ...attemptInput,
        reservationToken: acquired.reservationToken,
        normalizationVersion: acquired.normalizationVersion,
      }),
      "unreferenced_restored",
    );
  });
});

test("stalled foreground heartbeat stops storage before abort admission can fence the lease", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, input, "active");
    const attemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...input,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const writerLeaseTargetAtMs = Date.now() + 1_000;
    const acquired =
      await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        attemptInput,
        writerLeaseTargetAtMs,
      );
    assert.equal(acquired.status, "acquired");
    assert.ok("reservationToken" in acquired);
    const confirmedLeaseExpiresAtMs = Date.parse(acquired.leaseExpiresAt);
    const operationDeadlineAtMs = writerLeaseTargetAtMs - 300;
    let releaseRenewal!: () => void;
    const renewalRelease = new Promise<void>((resolveRelease) => {
      releaseRenewal = resolveRelease;
    });
    let signalRenewalStarted!: () => void;
    const renewalStarted = new Promise<void>((resolveStarted) => {
      signalRenewalStarted = resolveStarted;
    });
    const heartbeat = createMultipartWriterHeartbeat(
      {
        storageCapability: acquired.storageCapability,
        leaseExpiresAt: acquired.leaseExpiresAt,
      },
      new AbortController().signal,
      operationDeadlineAtMs,
      writerLeaseTargetAtMs,
      200,
      25,
      async () => {
        signalRenewalStarted();
        await renewalRelease;
        throw transientDatabaseUnavailable(
          "Foreground heartbeat remained unavailable.",
        );
      },
    );
    let storageMutationLive = true;
    let storageStoppedAtMs: number | null = null;
    const blockedStorage = new Promise<void>((_resolve, reject) => {
      const stopStorage = (): void => {
        storageMutationLive = false;
        storageStoppedAtMs = Date.now();
        reject(heartbeat.signal.reason);
      };
      heartbeat.signal.addEventListener(
        "abort",
        stopStorage,
        { once: true },
      );
    });

    await renewalStarted;
    const liveAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        input.userId,
        input.workspaceId,
        input.sessionId,
      );
    assert.equal(liveAbort.status, "completion_in_progress");
    assert.equal(storageMutationLive, true);

    await assert.rejects(blockedStorage);
    assert.equal(storageMutationLive, false);
    assert.ok(storageStoppedAtMs !== null);
    assert.ok(storageStoppedAtMs < confirmedLeaseExpiresAtMs);
    releaseRenewal();
    await heartbeat.stop();
    const waitUntilSafeExpiryMs =
      confirmedLeaseExpiresAtMs + 110 - Date.now();
    if (waitUntilSafeExpiryMs > 0) await wait(waitUntilSafeExpiryMs);

    const admittedAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        input.userId,
        input.workspaceId,
        input.sessionId,
      );
    assert.equal(storageMutationLive, false);
    assert.equal(admittedAbort.status, "abort_required");
    assert.equal(await close(input, input.sizeBytes), "aborted");
  });
});

test("foreground exact cleanup retries transient and unknown outcomes and waits out persistent failure safely", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const handoffInput = session(fixture, "active", future);
    await insertSession(fixture, handoffInput, "active");
    const handoffSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        handoffInput.userId,
        handoffInput.workspaceId,
        handoffInput.sessionId,
      );
    const handoffDeadlines = createApplicationDeadlines(1_500, 3_500);
    let handoffCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          handoffInput.userId,
          handoffSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(handoffInput),
          handoffDeadlines.operation,
          handoffDeadlines.writerLeaseTargetAtMs,
          handoffDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async (storageInput) => {
              await new Promise<void>((_resolve, reject) => {
                const rejectWithAbortReason = (): void =>
                  reject(storageInput.signal.reason);
                storageInput.signal.addEventListener(
                  "abort",
                  rejectWithAbortReason,
                  { once: true },
                );
              });
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            handoffCompletionAttemptAfterAccessRevocationFn:
              async (writer) => {
                handoffCalls += 1;
                if (handoffCalls < 3) {
                  throw transientDatabaseUnavailable(
                    "Durable handoff is temporarily unavailable.",
                  );
                }
                return handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
                  writer,
                );
              },
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          return true;
        },
      );
    } finally {
      handoffDeadlines.operation.dispose();
      handoffDeadlines.request.dispose();
    }
    assert.equal(handoffCalls, 3);

    const failureInput = session(fixture, "active", future);
    await insertSession(fixture, failureInput, "active");
    const failureSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        failureInput.userId,
        failureInput.workspaceId,
        failureInput.sessionId,
      );
    const failureDeadlines = createApplicationDeadlines(2_000, 4_000);
    const storageFailure = new Error("Foreground storage failed.");
    let failureResolutionCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          failureInput.userId,
          failureSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(failureInput),
          failureDeadlines.operation,
          failureDeadlines.writerLeaseTargetAtMs,
          failureDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              throw storageFailure;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            resolveCompletionAttemptFailureWithOwnerFn:
              async (writer) => {
                failureResolutionCalls += 1;
                if (failureResolutionCalls < 3) {
                  throw transientDatabaseUnavailable(
                    "Failure resolution is temporarily unavailable.",
                  );
                }
                return resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(
                  writer,
                );
              },
          },
        ),
        (error: unknown): boolean => error === storageFailure,
      );
    } finally {
      failureDeadlines.operation.dispose();
      failureDeadlines.request.dispose();
    }
    assert.equal(failureResolutionCalls, 3);

    const unknownInput = session(fixture, "active", future);
    await insertSession(fixture, unknownInput, "active");
    const unknownSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        unknownInput.userId,
        unknownInput.workspaceId,
        unknownInput.sessionId,
      );
    const unknownDeadlines = createApplicationDeadlines(1_500, 3_500);
    let unknownHandoffCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          unknownInput.userId,
          unknownSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(unknownInput),
          unknownDeadlines.operation,
          unknownDeadlines.writerLeaseTargetAtMs,
          unknownDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async (storageInput) => {
              await new Promise<void>((_resolve, reject) => {
                const rejectWithAbortReason = (): void =>
                  reject(storageInput.signal.reason);
                storageInput.signal.addEventListener(
                  "abort",
                  rejectWithAbortReason,
                  { once: true },
                );
              });
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            handoffCompletionAttemptAfterAccessRevocationFn:
              async (writer) => {
                unknownHandoffCalls += 1;
                const status =
                  await handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
                    writer,
                  );
                if (unknownHandoffCalls === 1) {
                  throw new DatabaseCommitOutcomeUnknownError(
                    new Error("Handoff commit response was lost."),
                  );
                }
                return status;
              },
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          return true;
        },
      );
    } finally {
      unknownDeadlines.operation.dispose();
      unknownDeadlines.request.dispose();
    }
    assert.equal(unknownHandoffCalls, 2);

    const persistentInput = session(fixture, "active", future);
    await insertSession(fixture, persistentInput, "active");
    const persistentSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        persistentInput.userId,
        persistentInput.workspaceId,
        persistentInput.sessionId,
      );
    const persistentDeadlines = createApplicationDeadlines(1_200, 2_400);
    const persistentStorageFailure =
      new Error("Persistent foreground storage failure.");
    let persistentResolutionCalls = 0;
    let persistentStorageMutationLive = false;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          persistentInput.userId,
          persistentSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(persistentInput),
          persistentDeadlines.operation,
          persistentDeadlines.writerLeaseTargetAtMs,
          persistentDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              persistentStorageMutationLive = true;
              persistentStorageMutationLive = false;
              throw persistentStorageFailure;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            resolveCompletionAttemptFailureWithOwnerFn: async () => {
              persistentResolutionCalls += 1;
              throw transientDatabaseUnavailable(
                "Exact failure resolution remains unavailable.",
              );
            },
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.code, "SERVICE_UNAVAILABLE");
          assert.ok(error.cause instanceof AggregateError);
          assert.deepEqual(
            error.cause.errors[0],
            persistentStorageFailure,
          );
          assert.ok(
            error.cause.errors[1] instanceof TransientDatabaseHttpError,
          );
          return true;
        },
      );
    } finally {
      persistentDeadlines.operation.dispose();
      persistentDeadlines.request.dispose();
    }
    assert.equal(persistentStorageMutationLive, false);
    assert.ok(persistentResolutionCalls >= 1);
    const persistentAttempt =
      (await fixture.ownerPool.query<Readonly<{
        live_attempts: number;
        reconciliation_state: string | null;
      }>>(
        `SELECT
           count(*) FILTER (
             WHERE attempts.state='leased'
               AND attempts.lease_expires_at > clock_timestamp()
           )::int AS live_attempts,
           min(attempts.reconciliation_state)::text AS reconciliation_state
         FROM content.media_blob_writer_attempts AS attempts
         WHERE attempts.media_upload_session_id=$1`,
        [persistentInput.sessionId],
      )).rows[0];
    assert.deepEqual(persistentAttempt, {
      live_attempts: 0,
      reconciliation_state: null,
    });
    const persistentAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        persistentInput.userId,
        persistentInput.workspaceId,
        persistentInput.sessionId,
      );
    assert.equal(persistentAbort.status, "abort_required");
    assert.equal(
      await close(persistentInput, persistentInput.sizeBytes),
      "aborted",
    );
  });
});

test("multipart attempt wrappers reuse exact tokens and reject stale workers after takeover", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const appliedInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, appliedInput, "active");
    const appliedParts = [{
      partNumber: 1,
      eTag: "\"applied-etag\"",
      sha256: digest(),
    }];
    const appliedAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...appliedInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(appliedParts),
    };
    const appliedAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        appliedAttemptInput,
        60_000,
      );
    assert.equal(appliedAttempt.status, "acquired");
    assert.ok("reservationToken" in appliedAttempt);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_assets
         WHERE media_asset_id=$1`,
        [appliedInput.mediaAssetId],
      )).rows[0].count,
      0,
    );
    const appliedWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...appliedAttemptInput,
      reservationToken: appliedAttempt.reservationToken,
      normalizationVersion: appliedAttempt.normalizationVersion,
    };
    const applied = await completeMediaAssetUploadSessionForWorkspace(
      appliedInput.userId,
      appliedInput.workspaceId,
      appliedInput.sessionId,
      appliedWriter,
    );
    const appliedState = (await fixture.ownerPool.query<Readonly<{
      asset_count: number;
      attempt_state: string;
      attempt_outcome: string;
    }>>(
      `SELECT
         (SELECT count(*)::int FROM content.media_assets
          WHERE media_asset_id=$1) AS asset_count,
         state AS attempt_state,
         outcome AS attempt_outcome
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$2`,
      [appliedInput.mediaAssetId, appliedAttemptInput.attemptToken],
    )).rows[0];
    assert.deepEqual(
      {
        applied: applied.applied,
        ...appliedState,
      },
      {
        applied: true,
        asset_count: 1,
        attempt_state: "applied",
        attempt_outcome: "live_applied",
      },
    );
    const exactReplay = await completeMediaAssetUploadSessionForWorkspace(
      appliedInput.userId,
      appliedInput.workspaceId,
      appliedInput.sessionId,
      appliedWriter,
    );
    assert.equal(exactReplay.applied, false);
    const terminalReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        appliedAttemptInput,
        60_000,
      );
    assert.equal(terminalReplay.status, "live_applied");
    const freshTerminalReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        { ...appliedAttemptInput, attemptToken: randomUUID() },
        60_000,
      );
    assert.equal(freshTerminalReplay.status, "live_applied");
    const mismatchedPartsReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        {
          ...appliedAttemptInput,
          attemptToken: randomUUID(),
          completedPartsFingerprint: digest(),
        },
        60_000,
      );
    assert.equal(mismatchedPartsReplay.status, "stale_attempt");

    const laterOperationId = randomUUID();
    const laterClientUpdatedAt = new Date(
      Date.parse(appliedInput.clientUpdatedAt) + 60_000,
    ).toISOString();
    await fixture.ownerPool.query(
      `UPDATE content.media_assets
       SET source_url=$1,client_updated_at=$2,last_operation_id=$3
       WHERE media_asset_id=$4`,
      [
        "https://example.com/later-metadata",
        laterClientUpdatedAt,
        laterOperationId,
        appliedInput.mediaAssetId,
      ],
    );
    const replayAfterMetadataMutation =
      await completeMediaAssetUploadSessionForWorkspace(
        appliedInput.userId,
        appliedInput.workspaceId,
        appliedInput.sessionId,
        appliedWriter,
      );
    assert.deepEqual(
      {
        applied: replayAfterMetadataMutation.applied,
        sourceUrl: replayAfterMetadataMutation.mediaAsset.sourceUrl,
        clientUpdatedAt:
          replayAfterMetadataMutation.mediaAsset.clientUpdatedAt,
        lastOperationId:
          replayAfterMetadataMutation.mediaAsset.lastOperationId,
      },
      {
        applied: false,
        sourceUrl: "https://example.com/later-metadata",
        clientUpdatedAt: laterClientUpdatedAt,
        lastOperationId: laterOperationId,
      },
    );
    const laterDeletedAt = new Date(
      Date.parse(laterClientUpdatedAt) + 60_000,
    ).toISOString();
    await fixture.ownerPool.query(
      `UPDATE content.media_assets
       SET deleted_at=$1,client_updated_at=$1,last_operation_id=$2
       WHERE media_asset_id=$3`,
      [laterDeletedAt, randomUUID(), appliedInput.mediaAssetId],
    );
    const freshReplayAfterDeletion =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        { ...appliedAttemptInput, attemptToken: randomUUID() },
        60_000,
      );
    assert.equal(freshReplayAfterDeletion.status, "live_applied");
    const completedSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        appliedInput.userId,
        appliedInput.workspaceId,
        appliedInput.sessionId,
      );
    const tombstonedReplay =
      await loadMediaAssetForCompletedUploadSessionReplayForWorkspace(
        appliedInput.userId,
        completedSession,
      );
    assert.equal(tombstonedReplay.deletedAt, laterDeletedAt);

    const input = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, input, "active");
    const parts = [{
      partNumber: 1,
      eTag: "\"etag-1\"",
      sha256: digest(),
    }];
    const attemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...input,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
    };
    const acquired =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        attemptInput,
        60_000,
      );
    assert.equal(acquired.status, "acquired");
    assert.ok("reservationToken" in acquired);
    const replayed =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        attemptInput,
        60_000,
      );
    assert.equal(replayed.status, "replayed");
    assert.ok("reservationToken" in replayed);
    assert.equal(replayed.reservationToken, acquired.reservationToken);

    const busy = await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
      { ...attemptInput, attemptToken: randomUUID() },
      60_000,
    );
    assert.equal(busy.status, "busy");
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=clock_timestamp()-interval '1 second'
       WHERE attempt_token=$1`,
      [attemptInput.attemptToken],
    );
    const takeoverInput = { ...attemptInput, attemptToken: randomUUID() };
    const takeover =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        takeoverInput,
        60_000,
      );
    assert.equal(takeover.status, "expired_takeover");
    assert.ok("reservationToken" in takeover);
    const staleWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...attemptInput,
      reservationToken: acquired.reservationToken,
      normalizationVersion: acquired.normalizationVersion,
    };
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(
        staleWriter,
      ),
      "stale_attempt",
    );
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
        ...takeoverInput,
        reservationToken: takeover.reservationToken,
        normalizationVersion: takeover.normalizationVersion,
      }),
      "unreferenced_restored",
    );

    const renewedInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, renewedInput, "active");
    const renewedAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...renewedInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const shortLease =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        renewedAttemptInput,
        400,
      );
    assert.equal(shortLease.status, "acquired");
    assert.ok("reservationToken" in shortLease);
    let heartbeatRenewals = 0;
    const heartbeatLeaseTargetAtMs = Date.now() + 5_000;
    const heartbeatOperationDeadlineAtMs =
      heartbeatLeaseTargetAtMs - 1_000;
    const heartbeat = createMultipartWriterHeartbeat(
      {
        storageCapability: shortLease.storageCapability,
        leaseExpiresAt: shortLease.leaseExpiresAt,
      },
      new AbortController().signal,
      heartbeatOperationDeadlineAtMs,
      heartbeatLeaseTargetAtMs,
      50,
      75,
      async () => {
        heartbeatRenewals += 1;
        const renewedLease =
          await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
            renewedAttemptInput,
            400,
          );
        assert.equal(renewedLease.status, "replayed");
        assert.ok("reservationToken" in renewedLease);
        assert.equal(
          renewedLease.reservationToken,
          shortLease.reservationToken,
        );
        return {
          storageCapability: renewedLease.storageCapability,
          leaseExpiresAt: renewedLease.leaseExpiresAt,
        };
      },
    );
    await heartbeat.renewNow();
    await wait(800);
    await heartbeat.stopAndRenewForFinalization();
    heartbeat.throwIfFailed();
    assert.ok(heartbeatRenewals >= 3);
    const renewedApply = await completeMediaAssetUploadSessionForWorkspace(
      renewedInput.userId,
      renewedInput.workspaceId,
      renewedInput.sessionId,
      {
        ...renewedAttemptInput,
        reservationToken: shortLease.reservationToken,
        normalizationVersion: shortLease.normalizationVersion,
      },
    );
    assert.equal(renewedApply.applied, true);

    const peerCompletionInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, peerCompletionInput, "active");
    const peerAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...peerCompletionInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const peerAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        peerAttemptInput,
        1_000,
      );
    assert.equal(peerAttempt.status, "acquired");
    assert.ok("reservationToken" in peerAttempt);
    const peerWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...peerAttemptInput,
      reservationToken: peerAttempt.reservationToken,
      normalizationVersion: peerAttempt.normalizationVersion,
    };
    const peerApply = wait(50).then(
      () => completeMediaAssetUploadSessionForWorkspace(
        peerCompletionInput.userId,
        peerCompletionInput.workspaceId,
        peerCompletionInput.sessionId,
        peerWriter,
      ),
    );
    const peerWaitStartedAtMs = Date.now();
    const waitedReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
        { ...peerAttemptInput, attemptToken: randomUUID() },
        1_000,
        Date.now() + 3_000,
        new AbortController().signal,
      );
    assert.equal((await peerApply).applied, true);
    assert.equal(waitedReplay.status, "live_applied");
    assert.ok(Date.now() - peerWaitStartedAtMs < 800);

    const expiredTakeoverInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, expiredTakeoverInput, "active");
    const expiredOwnerInput: MultipartMediaBlobWriterAttemptInput = {
      ...expiredTakeoverInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const expiredOwner =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        expiredOwnerInput,
        150,
      );
    assert.equal(expiredOwner.status, "acquired");
    const takeoverAfterWaitInput = {
      ...expiredOwnerInput,
      attemptToken: randomUUID(),
    };
    const takeoverAfterWait =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
        takeoverAfterWaitInput,
        1_000,
        Date.now() + 3_000,
        new AbortController().signal,
      );
    assert.equal(takeoverAfterWait.status, "expired_takeover");
    assert.ok("reservationToken" in takeoverAfterWait);
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
        ...takeoverAfterWaitInput,
        reservationToken: takeoverAfterWait.reservationToken,
        normalizationVersion: takeoverAfterWait.normalizationVersion,
      }),
      "unreferenced_restored",
    );

    const deadlineInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, deadlineInput, "active");
    const deadlineOwnerInput: MultipartMediaBlobWriterAttemptInput = {
      ...deadlineInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const deadlineOwner =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        deadlineOwnerInput,
        5_000,
      );
    assert.equal(deadlineOwner.status, "acquired");
    await assert.rejects(
      beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
        { ...deadlineOwnerInput, attemptToken: randomUUID() },
        1_000,
        Date.now() + 500,
        new AbortController().signal,
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
        );
        assert.match(error.message, /Retry the same completion request/);
        return true;
      },
    );

    const interruptedExpiredAbort = session(
      fixture,
      "active",
      new Date(Date.now() - 3_600_000).toISOString(),
    );
    await insertSession(fixture, interruptedExpiredAbort, "active");
    assert.equal(
      (await beginMediaAssetUploadSessionAbortForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      )).status,
      "abort_required",
    );
    const interruptedSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      );
    assert.equal(interruptedSession.state, "aborting");
    assert.equal(
      isExpiredMultipartCompletionCleanupRequired(interruptedSession),
      true,
    );
    const resumedAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      );
    assert.equal(resumedAbort.status, "abort_required");
    assert.equal(
      await close(
        interruptedExpiredAbort,
        interruptedExpiredAbort.sizeBytes,
      ),
      "no_writer_closed",
    );
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      )).state,
      "aborted",
    );

    const abortInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, abortInput, "active");
    const abortAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...abortInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const abortAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        abortAttemptInput,
        60_000,
      );
    assert.equal(abortAttempt.status, "acquired");
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=clock_timestamp()-interval '1 second'
       WHERE attempt_token=$1`,
      [abortAttemptInput.attemptToken],
    );
    assert.equal(
      (await beginMediaAssetUploadSessionAbortForWorkspace(
        abortInput.userId,
        abortInput.workspaceId,
        abortInput.sessionId,
      )).status,
      "abort_required",
    );
    assert.equal(await close(abortInput, abortInput.sizeBytes), "aborted");
    assert.deepEqual(
      (await fixture.ownerPool.query<Readonly<{
        session_state: string;
        attempt_state: string;
        reservation_state: string;
      }>>(
        `SELECT sessions.state AS session_state,
           attempts.state AS attempt_state,
           reservations.state AS reservation_state
         FROM content.media_upload_sessions AS sessions
         INNER JOIN content.media_blob_writer_attempts AS attempts
           ON attempts.media_upload_session_id=sessions.media_upload_session_id
         INNER JOIN content.media_blob_writer_reservations AS reservations
           ON reservations.reservation_token=attempts.reservation_token
         WHERE sessions.media_upload_session_id=$1`,
        [abortInput.sessionId],
      )).rows[0],
      {
        session_state: "aborted",
        attempt_state: "expired",
        reservation_state: "unreferenced",
      },
    );
  });
});
