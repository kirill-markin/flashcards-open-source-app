import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import {
  assertMediaBlobMatchesInput,
  MEDIA_ASSET_JOIN_CLAUSE,
  normalizeMediaAssetMutationMetadata,
  normalizeMediaAssetSnapshotInput,
  upsertMediaAssetSnapshotInExecutor,
} from "../persistence";
import type {
  MediaAssetMutationResult,
  MediaAssetUploadSession,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadSessionRow,
  MediaBlobRow,
} from "../types";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../workspaceReplicas";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../storageKeys";
import {
  findMediaAssetUploadSessionRowForUpdateInExecutor,
  mapMediaAssetUploadSessionRow,
  MEDIA_UPLOAD_SESSION_COLUMNS,
  toMediaAssetMutationMetadataFromUploadSessionCreate,
  toMediaAssetSnapshotInputFromUploadSessionCreate,
  type MediaAssetUploadSessionCreationClaimReleaseResult,
  type MediaAssetUploadSessionCreationClaimResult,
  type MediaAssetUploadSessionCreationClaimRow,
  type MediaAssetUploadSessionCreationClaimStatusRow,
  type MediaAssetUploadSessionCreationReplayResult,
} from "./shared";

async function findReachableMediaBlobForUploadSessionCreateInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaBlobRow | null> {
  const normalizedInput = normalizeMediaAssetSnapshotInput(toMediaAssetSnapshotInputFromUploadSessionCreate(input));
  const result = await executor.query<MediaBlobRow>(
    [
      "SELECT",
      [
        "media_blobs.media_blob_id AS media_blob_id",
        "media_blobs.mime_type AS mime_type",
        "media_blobs.size_bytes AS size_bytes",
        "media_blobs.sha256 AS sha256",
        "media_blobs.storage_key AS storage_key",
        "media_blobs.normalization_version AS normalization_version",
        "media_blobs.created_at AS created_at",
        "media_blobs.updated_at AS updated_at",
      ].join(", "),
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.deleted_at IS NULL",
      "AND media_blobs.sha256 = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, normalizedInput.sha256],
  );
  const row = result.rows[0] ?? null;
  if (row === null) {
    return null;
  }

  assertMediaBlobMatchesInput(row, normalizedInput);
  return row;
}

export async function createMediaAssetFromReachableBlobForWorkspace(
  userId: string,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaAssetMutationResult | null> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const mediaBlobRow = await findReachableMediaBlobForUploadSessionCreateInExecutor(executor, workspaceId, input);
    if (mediaBlobRow === null) {
      return null;
    }

    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      toMediaAssetSnapshotInputFromUploadSessionCreate(input),
      toMediaAssetMutationMetadataFromUploadSessionCreate(input),
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

export async function createMediaAssetFromAvailableBlobForWorkspace(
  userId: string,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaAssetMutationResult | null> {
  return createMediaAssetFromReachableBlobForWorkspace(userId, workspaceId, input);
}

export async function recordMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  input: MediaAssetUploadSessionCreateInput,
  stagingStorageKey: string,
  blobStorageKey: string,
  s3UploadId: string,
  expiresAt: string,
): Promise<MediaAssetUploadSessionCreateResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    return recordMediaAssetUploadSessionInExecutor(
      executor,
      workspaceId,
      sessionId,
      input,
      stagingStorageKey,
      blobStorageKey,
      s3UploadId,
      expiresAt,
    );
  });
}

async function recordMediaAssetUploadSessionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
  input: MediaAssetUploadSessionCreateInput,
  stagingStorageKey: string,
  blobStorageKey: string,
  s3UploadId: string,
  expiresAt: string,
): Promise<MediaAssetUploadSessionCreateResult> {
  await assertReplicaBelongsToWorkspaceInExecutor(
    executor,
    workspaceId,
    input.lastModifiedByReplicaId,
  );
  const normalizedSnapshot = normalizeMediaAssetSnapshotInput(
    toMediaAssetSnapshotInputFromUploadSessionCreate(input),
  );
  const normalizedMetadata = normalizeMediaAssetMutationMetadata(
    toMediaAssetMutationMetadataFromUploadSessionCreate(input),
  );
  const normalizedExpiresAt = new Date(expiresAt).toISOString();
  const existingSessionRow =
    await findMediaAssetUploadSessionRowForUpdateInExecutor(
      executor,
      workspaceId,
      sessionId,
    );
  if (existingSessionRow !== null) {
    const existingSession = mapMediaAssetUploadSessionRow(existingSessionRow);
    if (
      existingSession.state !== "active"
      || existingSession.mediaAssetId !== normalizedSnapshot.mediaAssetId
      || existingSession.mediaBlobSha256 !== normalizedSnapshot.sha256
      || existingSession.stagingStorageKey !== stagingStorageKey
      || existingSession.blobStorageKey !== blobStorageKey
      || existingSession.s3UploadId !== s3UploadId
      || existingSession.mimeType !== normalizedSnapshot.mimeType
      || existingSession.sizeBytes !== normalizedSnapshot.sizeBytes
      || existingSession.partSizeBytes !== input.partSizeBytes
      || existingSession.partCount !== input.partCount
      || existingSession.sourceUrl !== normalizedSnapshot.sourceUrl
      || existingSession.assetCreatedAt !== normalizedSnapshot.createdAt
      || existingSession.clientUpdatedAt !== normalizedMetadata.clientUpdatedAt
      || existingSession.lastModifiedByReplicaId
        !== normalizedMetadata.lastModifiedByReplicaId
      || existingSession.lastOperationId !== normalizedMetadata.lastOperationId
      || existingSession.expiresAt !== normalizedExpiresAt
    ) {
      throw new HttpError(
        409,
        `Media asset upload session replay does not match the immutable persisted session. sessionId=${sessionId}`,
        "MEDIA_ASSET_UPLOAD_SESSION_CREATE_REPLAY_MISMATCH",
      );
    }

    return {
      status: "upload_required",
      uploadSession: existingSession,
    };
  }

  const existingMediaBlobRow =
    await findReachableMediaBlobForUploadSessionCreateInExecutor(
      executor,
      workspaceId,
      input,
    );
  if (existingMediaBlobRow !== null) {
    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      toMediaAssetSnapshotInputFromUploadSessionCreate(input),
      toMediaAssetMutationMetadataFromUploadSessionCreate(input),
    );

    return {
      status: "already_available",
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  }

  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "INSERT INTO content.media_upload_sessions",
      "(",
      "media_upload_session_id, workspace_id, media_asset_id, media_blob_sha256, staging_storage_key,",
      "blob_storage_key, s3_upload_id, mime_type, size_bytes, part_size_bytes, part_count, state, source_url,",
      "asset_created_at, client_updated_at, last_modified_by_replica_id, last_operation_id, expires_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $13, $14, $15, $16, $17)",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [
      sessionId,
      workspaceId,
      normalizedSnapshot.mediaAssetId,
      normalizedSnapshot.sha256,
      stagingStorageKey,
      blobStorageKey,
      s3UploadId,
      normalizedSnapshot.mimeType,
      normalizedSnapshot.sizeBytes,
      input.partSizeBytes,
      input.partCount,
      normalizedSnapshot.sourceUrl,
      normalizedSnapshot.createdAt,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByReplicaId,
      normalizedMetadata.lastOperationId,
      normalizedExpiresAt,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Media asset upload session insert did not return a row");
  }

  return {
    status: "upload_required",
    uploadSession: mapMediaAssetUploadSessionRow(row),
  };
}

function requireCreationClaimTimestamp(
  value: string | Date | null,
  status: string,
): string {
  if (value === null) {
    throw new TypeError(
      `PostgreSQL media upload session creation claim status omitted its required timestamp. status=${status}`,
    );
  }
  return new Date(value).toISOString();
}

export async function acquireMediaAssetUploadSessionCreationClaimForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
  replicaId: string,
  claimToken: string,
  leaseDurationMs: number,
): Promise<MediaAssetUploadSessionCreationClaimResult> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      const result =
        await executor.query<MediaAssetUploadSessionCreationClaimRow>(
          `SELECT *
           FROM content.acquire_media_upload_session_creation_claim_with_owner(
             $1, $2, $3, $4, $5, $6
           )`,
          [
            userId,
            workspaceId,
            mediaAssetId,
            replicaId,
            claimToken,
            leaseDurationMs,
          ],
        );
      const row = result.rows[0];
      if (row === undefined) {
        throw new TypeError(
          "PostgreSQL did not return a media upload session creation claim status.",
        );
      }

      switch (row.claim_status) {
        case "acquired":
          return {
            status: "acquired",
            leaseExpiresAt: requireCreationClaimTimestamp(
              row.lease_expires_at,
              row.claim_status,
            ),
          };
        case "completion_pending":
          return {
            status: "completion_pending",
            retryAt: requireCreationClaimTimestamp(
              row.lease_expires_at,
              row.claim_status,
            ),
          };
        case "creation_pending":
          return {
            status: "creation_pending",
            retryAt: requireCreationClaimTimestamp(
              row.lease_expires_at,
              row.claim_status,
            ),
            uploadSessionId: row.media_upload_session_id,
          };
        case "finalized":
          if (row.media_upload_session_id === null) {
            throw new TypeError(
              "PostgreSQL finalized media upload session creation claim omitted its upload session id.",
            );
          }
          return {
            status: "finalized",
            uploadSessionId: row.media_upload_session_id,
          };
        case "access_denied":
        case "replica_mismatch":
        case "released":
        case "stale":
          return { status: row.claim_status };
        default:
          throw new TypeError(
            `PostgreSQL returned an invalid media upload session creation claim status. status=${row.claim_status}`,
          );
      }
    },
  );
}

async function finalizeMediaAssetUploadSessionCreationClaimInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
  replicaId: string,
  claimToken: string,
  sessionId: string,
): Promise<void> {
  const result =
    await executor.query<MediaAssetUploadSessionCreationClaimStatusRow>(
      `SELECT
         content.finalize_media_upload_session_creation_claim_with_owner(
           $1, $2, $3, $4, $5, $6
         ) AS claim_status`,
      [
        userId,
        workspaceId,
        mediaAssetId,
        replicaId,
        claimToken,
        sessionId,
      ],
    );
  const status = result.rows[0]?.claim_status;
  if (status === "finalized") return;
  throw new HttpError(
    status === "access_denied" ? 403 : 503,
    `Media upload session creation claim could not be finalized with its exact upload session. status=${String(status)}`,
    status === "access_denied"
      ? "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED"
      : "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
    status === "access_denied" ? undefined : { retryAfterSeconds: 1 },
  );
}

async function releaseMediaAssetUploadSessionCreationClaimInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
  replicaId: string,
  claimToken: string,
): Promise<MediaAssetUploadSessionCreationClaimReleaseResult> {
  const result =
    await executor.query<MediaAssetUploadSessionCreationClaimStatusRow>(
      `SELECT
         content.release_media_upload_session_creation_claim_with_owner(
           $1, $2, $3, $4, $5
         ) AS claim_status`,
      [userId, workspaceId, mediaAssetId, replicaId, claimToken],
    );
  const status = result.rows[0]?.claim_status;
  if (status === "released" || status === "finalized") return status;
  throw new HttpError(
    status === "access_denied" ? 403 : 503,
    `Media upload session creation claim could not be released exactly. status=${String(status)}`,
    status === "access_denied"
      ? "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED"
      : "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
    status === "access_denied" ? undefined : { retryAfterSeconds: 1 },
  );
}

export async function releaseMediaAssetUploadSessionCreationClaimForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
  replicaId: string,
  claimToken: string,
): Promise<MediaAssetUploadSessionCreationClaimReleaseResult> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    (executor) => releaseMediaAssetUploadSessionCreationClaimInExecutor(
      executor,
      userId,
      workspaceId,
      mediaAssetId,
      replicaId,
      claimToken,
    ),
  );
}

export async function recordMediaAssetUploadSessionWithCreationClaimForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  claimToken: string,
  input: MediaAssetUploadSessionCreateInput,
  stagingStorageKey: string,
  blobStorageKey: string,
  s3UploadId: string,
  expiresAt: string,
): Promise<MediaAssetUploadSessionCreateResult> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      const result = await recordMediaAssetUploadSessionInExecutor(
        executor,
        workspaceId,
        sessionId,
        input,
        stagingStorageKey,
        blobStorageKey,
        s3UploadId,
        expiresAt,
      );
      if (result.status === "already_available") {
        const releaseStatus =
          await releaseMediaAssetUploadSessionCreationClaimInExecutor(
            executor,
            userId,
            workspaceId,
            input.mediaAssetId,
            input.lastModifiedByReplicaId,
            claimToken,
          );
        if (releaseStatus !== "released") {
          throw new HttpError(
            503,
            "Media upload session creation claim was already finalized while recording an available media asset.",
            "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
            { retryAfterSeconds: 1 },
          );
        }
        return result;
      }

      await finalizeMediaAssetUploadSessionCreationClaimInExecutor(
        executor,
        userId,
        workspaceId,
        input.mediaAssetId,
        input.lastModifiedByReplicaId,
        claimToken,
        result.uploadSession.sessionId,
      );
      return result;
    },
  );
}

function getMediaAssetUploadSessionCreationReplayConflicts(
  session: MediaAssetUploadSession,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): ReadonlyArray<string> {
  const snapshot = normalizeMediaAssetSnapshotInput(
    toMediaAssetSnapshotInputFromUploadSessionCreate(input),
  );
  const metadata = normalizeMediaAssetMutationMetadata(
    toMediaAssetMutationMetadataFromUploadSessionCreate(input),
  );
  return [
    ...(session.workspaceId === workspaceId ? [] : ["workspaceId"]),
    ...(session.mediaAssetId === snapshot.mediaAssetId ? [] : ["mediaAssetId"]),
    ...(session.mediaBlobSha256 === snapshot.sha256 ? [] : ["sha256"]),
    ...(session.stagingStorageKey === buildMediaMultipartUploadStagingStorageKey(
      workspaceId,
      snapshot.mediaAssetId,
      session.sessionId,
    ) ? [] : ["stagingStorageKey"]),
    ...(session.blobStorageKey === buildMediaBlobStorageKey(snapshot.sha256)
      ? []
      : ["blobStorageKey"]),
    ...(session.mimeType === snapshot.mimeType ? [] : ["mimeType"]),
    ...(session.sizeBytes === snapshot.sizeBytes ? [] : ["sizeBytes"]),
    ...(session.partSizeBytes === input.partSizeBytes ? [] : ["partSizeBytes"]),
    ...(session.partCount === input.partCount ? [] : ["partCount"]),
    ...(session.sourceUrl === snapshot.sourceUrl ? [] : ["sourceUrl"]),
    ...(session.assetCreatedAt === snapshot.createdAt ? [] : ["createdAt"]),
    ...(session.clientUpdatedAt === metadata.clientUpdatedAt
      ? []
      : ["clientUpdatedAt"]),
    ...(session.lastModifiedByReplicaId === metadata.lastModifiedByReplicaId
      ? []
      : ["lastModifiedByReplicaId"]),
    ...(session.lastOperationId === metadata.lastOperationId
      ? []
      : ["lastOperationId"]),
  ];
}

export async function loadMediaAssetUploadSessionCreationReplayForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaAssetUploadSessionCreationReplayResult> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetUploadSessionRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_UPLOAD_SESSION_COLUMNS,
      "FROM content.media_upload_sessions",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      409,
      `Committed media asset upload session replay was not found. sessionId=${sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }

  const session = mapMediaAssetUploadSessionRow(row);
  const conflictingFields =
    getMediaAssetUploadSessionCreationReplayConflicts(
      session,
      workspaceId,
      input,
    );
  if (conflictingFields.length > 0) {
    throw new HttpError(
      409,
      `Session creation retry does not match the committed immutable input. sessionId=${sessionId} conflictingFields=${conflictingFields.join(",")}`,
      "MEDIA_ASSET_UPLOAD_SESSION_CREATE_REPLAY_MISMATCH",
    );
  }

  if (session.state === "active") {
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(
        409,
        `Committed media asset upload session is expired. sessionId=${sessionId} expiresAt=${session.expiresAt}`,
        "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
      );
    }
    return { state: session.state, uploadSession: session };
  }
  if (session.state === "completing") {
    return { state: session.state, uploadSession: session };
  }
  if (session.state === "aborting") {
    return { state: session.state, uploadSession: session };
  }
  if (session.state === "completed") {
    throw new HttpError(
      409,
      `Committed media asset upload session is already completed. sessionId=${sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }
  if (session.state === "aborted") {
    throw new HttpError(
      409,
      `Committed media asset upload session is already aborted. sessionId=${sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }
  const unexpectedState: never = session.state;
  throw new TypeError(
    `Committed media asset upload session has an unexpected state. sessionId=${sessionId} state=${String(unexpectedState)}`,
  );
}
