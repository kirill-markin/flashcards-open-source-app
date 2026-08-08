import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { TransientDatabaseHttpError } from "../../database/transient";
import { createBackendObservationScope } from "../../observability/sentry";
import type { PostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { buildMediaBlobStorageKey } from "../storageKeys";
import {
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  closeMediaAssetUploadSessionCurrentBlobWriter,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MediaAssetUploadSessionCompletionWithOwnerInput,
} from "../uploadSessions";
import {
  passthroughMediaBlobNormalizationVersion,
  type CompleteMediaAssetUploadPartInput,
  type MediaBlobNormalizationVersion,
} from "../types";
import {
  applyMultipartCompletionReconciliation,
  claimMultipartCompletionReconciliations,
  renewMultipartCompletionReconciliationLease,
  type ClaimedMultipartCompletionReconciliation,
} from "./completion/completionReconciliation";
import {
  reconcileMultipartMediaAssetUploadWithDependencies,
} from "../storage/multipart/reconciliation";
import {
  createS3Error,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
} from "../storage/testHelpers";
import {
  createMultipartCompletionRequestDeadline,
} from "./requestBoundary";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
} from "../../server/mediaRequests/multipartCompletionRequestTiming";

export function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

export function transientDatabaseUnavailable(message: string): TransientDatabaseHttpError {
  return new TransientDatabaseHttpError(
    Object.assign(new Error(message), { code: "08006" }),
  );
}

export function session(
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

export async function insertSession(
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

export async function close(
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

export function completionParts(): ReadonlyArray<CompleteMediaAssetUploadPartInput> {
  return [{
    partNumber: 1,
    eTag: "\"part-etag\"",
    sha256: digest(),
  }];
}

export function applicationObservationScope(
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

export function createApplicationDeadlines(
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

export const applicationAttemptResolutionDependencies = Object.freeze({
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  handoffCompletionAttemptAfterAccessRevocationFn:
    handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn:
    loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  resolveCompletionAttemptFailureWithOwnerFn:
    resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
});

export function createMultipartHeadResponse(
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

export type ForegroundCompletionDeadlinePhase =
  | "complete"
  | "normalize"
  | "promote"
  | "database";

export type DurableMultipartStorageFixture = Readonly<{
  client: S3Client;
  mutationStarted: Promise<void>;
  markMutationStarted: () => void;
  releaseMutation: () => void;
  getMutationPhases: () => ReadonlyArray<
    Exclude<ForegroundCompletionDeadlinePhase, "database">
  >;
}>;

export function createDurableMultipartStorageFixture(
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

export async function applyHandedOffMultipartWithWorkerStorage(
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

export async function applyClaimedMultipartWithWorkerStorage(
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

export async function completeLegacyMultipartSession(
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

