import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { HttpError } from "../../shared/errors";
import {
  assertMediaBlobWriterReservationToken,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
  type MediaBlobWriterReservation,
} from "../blobLifecycle";
import {
  assertMediaBlobMatchesInput,
  findMediaAssetRowForUpdateInExecutor,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
  normalizeMediaAssetMutationMetadata,
  normalizeMediaAssetSnapshotInput,
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
  upsertMediaAssetSnapshotInExecutor,
} from "../persistence";
import type {
  MediaAsset,
  MediaAssetMutationMetadata,
  MediaAssetMutationResult,
  MediaAssetSnapshotInput,
  MediaAssetUploadSession,
  MediaAssetUploadSessionAbortStartResult,
  MediaAssetUploadSessionCompletionStartResult,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadSessionRow,
  MediaAssetUploadSessionState,
  MediaBlobNormalizationVersion,
  MediaBlobRow,
} from "../types";
import {
  mediaBlobNormalizationVersions,
  passthroughMediaBlobNormalizationVersion,
} from "../types";
import { isValidMediaAssetLastOperationId } from "../lastOperationId";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../workspaceReplicas";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../storageKeys";

export type MediaAssetUploadSessionWriterClosure =
  | "absent"
  | "referenced"
  | "unreferenced"
  | "no_writer_closed"
  | "access_active"
  | "already_closed"
  | "stale";

export type MediaAssetUploadSessionWriterClosureInput = Readonly<{
  userId: string; workspaceId: string; sessionId: string; mediaAssetId: string;
  lastModifiedByReplicaId: string; lastOperationId: string; sha256: string;
  storageKey: string; mimeType: string; sizeBytes: number; expiresAt: string;
}>;

type MediaAssetUploadSessionWriterClosureRow = Readonly<{ closure_status: string }>;
export type MediaAssetUploadSessionCompletionWithOwnerInput = Readonly<{
  userId: string; workspaceId: string; sessionId: string; mediaAssetId: string;
  lastModifiedByReplicaId: string; lastOperationId: string; sha256: string;
  stagingStorageKey: string; blobStorageKey: string; s3UploadId: string;
  mimeType: string; sizeBytes: number; partSizeBytes: number; partCount: number;
  sourceUrl: string | null; assetCreatedAt: string; clientUpdatedAt: string;
  expiresAt: string; normalizationVersion: typeof passthroughMediaBlobNormalizationVersion;
}>;
export type MediaAssetUploadSessionCompletionWithOwnerRejection =
  | "access_denied"
  | "session_not_found"
  | "payload_mismatch"
  | "replica_mismatch"
  | "expired"
  | "aborting"
  | "aborted"
  | "state_conflict"
  | "legacy_unbound"
  | "ownership_mismatch"
  | "writer_conflict"
  | "cleanup_claimed"
  | "completed_mismatch";
export type MediaAssetUploadSessionCompletionWithOwnerResult =
  | Readonly<{
    status: "started" | "replayed" | "already_completed";
    reservation: MediaBlobWriterReservation;
  }>
  | Readonly<{ status: MediaAssetUploadSessionCompletionWithOwnerRejection }>;
export type MediaAssetUploadSessionCompletionResolutionInput =
  Omit<MediaAssetUploadSessionCompletionWithOwnerInput, "normalizationVersion">
  & Readonly<{ normalizationVersion: MediaBlobNormalizationVersion; reservationToken: string }>;
export type MediaAssetUploadSessionCompletionApplyFence =
  | "ready" | "already_applied" | "peer_conflict" | "access_denied"
  | "aborting" | "aborted" | "stale";
export type MediaAssetUploadSessionCompletionFailureResolution =
  | "referenced" | "unreferenced_restored" | "peer_conflict"
  | "already_closed" | "access_denied" | "stale";
export type MediaAssetUploadSessionCompletionRevocationInput =
  Omit<MediaAssetUploadSessionCompletionWithOwnerInput, "normalizationVersion">;
export type MediaAssetUploadSessionCompletionRevocationResolution =
  | "referenced" | "unreferenced_closed" | "absent_closed" | "peer_conflict"
  | "already_closed" | "access_active" | "stale";
type MediaAssetUploadSessionCompletionWithOwnerRow = Readonly<{
  completion_status: string; reservation_token: string | null;
  reservation_state: string | null; normalization_version: string | null;
}>;
type MediaAssetUploadSessionCompletionResolutionRow = Readonly<{
  resolution_status: string;
}>;
type OwnedMultipartReservationRow = Readonly<{
  reservation_token: string | null; reservation_state: string | null;
  reservation_status: string; normalization_version: string;
}>;
type MediaAssetUploadSessionCompletionStartTransition =
  | MediaAssetUploadSessionCompletionStartResult
  | Readonly<{
    status: "legacy_operation_id_restart_required";
    sessionId: string;
  }>;
type MediaAssetUploadSessionCreationClaimRow = Readonly<{
  claim_status: string;
  lease_expires_at: string | Date | null;
  media_upload_session_id: string | null;
}>;
type MediaAssetUploadSessionCreationClaimStatusRow = Readonly<{
  claim_status: string;
}>;

export type MediaAssetUploadSessionCreationClaimResult =
  | Readonly<{
    status: "acquired";
    leaseExpiresAt: string;
  }>
  | Readonly<{
    status: "completion_pending";
    retryAt: string;
  }>
  | Readonly<{
    status: "creation_pending";
    retryAt: string;
    uploadSessionId: string | null;
  }>
  | Readonly<{
    status: "finalized";
    uploadSessionId: string;
  }>
  | Readonly<{
    status:
      | "access_denied"
      | "replica_mismatch"
      | "released"
      | "stale";
  }>;

export type MediaAssetUploadSessionCreationClaimReleaseResult =
  | "released"
  | "finalized";

export type MediaAssetUploadSessionCreationReplayResult = Readonly<{
  state: "active" | "completing" | "aborting";
  uploadSession: MediaAssetUploadSession;
}>;

const MEDIA_UPLOAD_SESSION_COLUMNS = [
  "media_upload_session_id",
  "workspace_id",
  "media_asset_id",
  "media_blob_sha256",
  "staging_storage_key",
  "blob_storage_key",
  "s3_upload_id",
  "mime_type",
  "size_bytes",
  "part_size_bytes",
  "part_count",
  "state",
  "source_url",
  "asset_created_at",
  "client_updated_at",
  "last_modified_by_replica_id",
  "last_operation_id",
  "expires_at",
  "created_at",
  "completed_at",
  "aborted_at",
].join(", ");

export function mapMediaAssetUploadSessionRow(row: MediaAssetUploadSessionRow): MediaAssetUploadSession {
  return {
    sessionId: row.media_upload_session_id,
    workspaceId: row.workspace_id,
    mediaAssetId: row.media_asset_id,
    mediaBlobSha256: row.media_blob_sha256,
    stagingStorageKey: row.staging_storage_key,
    blobStorageKey: row.blob_storage_key,
    s3UploadId: row.s3_upload_id,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    partSizeBytes: toSafeNumber(row.part_size_bytes, "part_size_bytes"),
    partCount: toSafeNumber(row.part_count, "part_count"),
    state: row.state,
    sourceUrl: row.source_url,
    assetCreatedAt: toIsoString(row.asset_created_at),
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    completedAt: toOptionalIsoString(row.completed_at),
    abortedAt: toOptionalIsoString(row.aborted_at),
  };
}

function toMediaAssetSnapshotInputFromUploadSessionCreate(
  input: MediaAssetUploadSessionCreateInput,
): MediaAssetSnapshotInput {
  return {
    mediaAssetId: input.mediaAssetId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    sourceUrl: input.sourceUrl,
    createdAt: input.createdAt,
    deletedAt: null,
  };
}

function toMediaAssetSnapshotInputFromUploadSession(
  session: MediaAssetUploadSession,
): MediaAssetSnapshotInput {
  return {
    mediaAssetId: session.mediaAssetId,
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
    sha256: session.mediaBlobSha256,
    sourceUrl: session.sourceUrl,
    createdAt: session.assetCreatedAt,
    deletedAt: null,
  };
}

function toMediaAssetMutationMetadataFromUploadSessionCreate(
  input: MediaAssetUploadSessionCreateInput,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}

function toMediaAssetMutationMetadataFromUploadSession(
  session: MediaAssetUploadSession,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: session.clientUpdatedAt,
    lastModifiedByReplicaId: session.lastModifiedByReplicaId,
    lastOperationId: session.lastOperationId,
  };
}

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

async function findMediaAssetUploadSessionRowForUpdateInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionRow | null> {
  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "SELECT",
      MEDIA_UPLOAD_SESSION_COLUMNS,
      "FROM content.media_upload_sessions",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, sessionId],
  );

  return result.rows[0] ?? null;
}

function createMediaAssetUploadSessionNotFoundError(sessionId: string): HttpError {
  return new HttpError(
    404,
    `Media asset upload session not found. sessionId=${sessionId}`,
    "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
  );
}

function createMediaAssetUploadSessionRestartRequiredError(
  sessionId: string,
): HttpError {
  return new HttpError(
    409,
    [
      "Media asset upload session uses a legacy operation identifier.",
      "Abort this upload session and create a new upload session before retrying completion.",
      `sessionId=${sessionId}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
  );
}

function assertMediaAssetUploadSessionActive(session: MediaAssetUploadSession): void {
  assertMediaAssetUploadSessionState(session, "active");

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(
      409,
      `Media asset upload session is expired. sessionId=${session.sessionId} expiresAt=${session.expiresAt}`,
      "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
    );
  }
}

function assertMediaAssetUploadSessionState(
  session: MediaAssetUploadSession,
  expectedState: MediaAssetUploadSessionState,
): void {
  if (session.state === expectedState) {
    return;
  }

  if (session.state === "completed") {
    throw new HttpError(
      409,
      `Media asset upload session is already completed. sessionId=${session.sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    );
  }

  if (session.state === "aborted") {
    throw new HttpError(
      409,
      `Media asset upload session is already aborted. sessionId=${session.sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_ABORTED",
    );
  }

  throw new HttpError(
    409,
    `Media asset upload session is ${session.state}; expected ${expectedState}. sessionId=${session.sessionId}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

function assertMediaAssetUploadSessionCanComplete(session: MediaAssetUploadSession): void {
  if (session.state === "completing") {
    return;
  }

  if (session.state === "active") {
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(
        409,
        `Media asset upload session is expired. sessionId=${session.sessionId} expiresAt=${session.expiresAt}`,
        "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
      );
    }

    return;
  }

  assertMediaAssetUploadSessionState(session, "completing");
}

function assertMediaAssetUploadSessionCanAbort(session: MediaAssetUploadSession): void {
  if (session.state === "active" || session.state === "aborting") {
    return;
  }

  assertMediaAssetUploadSessionState(session, "aborting");
}

export function assertMediaAssetUploadSessionPartNumbersInRange(
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): void {
  for (const part of parts) {
    if (part.partNumber > session.partCount) {
      throw new HttpError(
        400,
        `partNumber must be between 1 and ${session.partCount} for this upload session`,
        "MEDIA_ASSET_PART_NUMBER_OUT_OF_RANGE",
      );
    }
  }
}

export function assertMediaAssetUploadSessionCompletionPartsMatch(
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): void {
  if (parts.length !== session.partCount) {
    throw new HttpError(
      400,
      `parts must contain exactly ${session.partCount} completed parts for this upload session`,
      "MEDIA_ASSET_PART_COUNT_MISMATCH",
    );
  }

  const sortedPartNumbers = parts.map((part) => part.partNumber).sort((left, right) => left - right);
  for (let index = 0; index < sortedPartNumbers.length; index += 1) {
    const expectedPartNumber = index + 1;
    if (sortedPartNumbers[index] !== expectedPartNumber) {
      throw new HttpError(
        400,
        "parts must contain every partNumber from 1 through the upload session partCount",
        "MEDIA_ASSET_PART_SEQUENCE_INVALID",
      );
    }
  }
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

export async function loadMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
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
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  assertMediaAssetUploadSessionActive(session);
  return session;
}

async function findMediaAssetFromSessionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  session: MediaAssetUploadSession,
): Promise<MediaAsset> {
  const row = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, session.mediaAssetId);
  if (row === null) {
    throw new Error(`Completed media asset upload session has no media asset row. sessionId=${session.sessionId}`);
  }

  return mapMediaAssetRow(row);
}

export async function beginMediaAssetUploadSessionCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionStartResult> {
  const transition = await transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) =>
      beginMediaAssetUploadSessionCompletionInExecutor(
        executor,
        workspaceId,
        sessionId,
        parts,
      ),
  );
  if (transition.status === "legacy_operation_id_restart_required") {
    throw createMediaAssetUploadSessionRestartRequiredError(
      transition.sessionId,
    );
  }
  return transition;
}

export async function beginMediaAssetUploadSessionCompletionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionStartTransition> {
  const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
  if (row === null) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  if (session.state === "completed") {
    return {
      status: "already_completed",
      mediaAsset: await findMediaAssetFromSessionInExecutor(executor, workspaceId, session),
      applied: false,
    };
  }

  assertMediaAssetUploadSessionCanComplete(session);
  if (isValidMediaAssetLastOperationId(session.lastOperationId) === false) {
    if (session.state === "completing") {
      const result = await executor.query<Readonly<{ state: string }>>(
        `UPDATE content.media_upload_sessions
         SET state = 'active'
         WHERE workspace_id = $1
           AND media_upload_session_id = $2
           AND state = 'completing'
         RETURNING state`,
        [workspaceId, sessionId],
      );
      if (result.rows[0]?.state !== "active") {
        throw new Error(
          `Legacy media asset upload session recovery did not return an active row. sessionId=${sessionId}`,
        );
      }
    }
    return {
      status: "legacy_operation_id_restart_required",
      sessionId,
    };
  }
  assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
  if (session.state === "completing") {
    return {
      status: "complete_required",
      uploadSession: session,
    };
  }

  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "UPDATE content.media_upload_sessions",
      "SET state = 'completing'",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "AND state = 'active'",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [workspaceId, sessionId],
  );
  const updatedRow = result.rows[0];
  if (updatedRow === undefined) {
    throw new Error(`Media asset upload session completing update did not return a row. sessionId=${sessionId}`);
  }

  return {
    status: "complete_required",
    uploadSession: mapMediaAssetUploadSessionRow(updatedRow),
  };
}

export async function recoverMediaAssetUploadSessionCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    recoverMediaAssetUploadSessionCompletionInExecutor(executor, workspaceId, sessionId));
}

export async function recoverMediaAssetUploadSessionCompletionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
  if (row === null) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  if (session.state === "active" || session.state === "completed") {
    return session;
  }

  assertMediaAssetUploadSessionState(session, "completing");
  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "UPDATE content.media_upload_sessions",
      "SET state = 'active'",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "AND state = 'completing'",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [workspaceId, sessionId],
  );

  const updatedRow = result.rows[0];
  if (updatedRow === undefined) {
    throw new Error(`Media asset upload session completion recovery did not return a row. sessionId=${sessionId}`);
  }

  return mapMediaAssetUploadSessionRow(updatedRow);
}

export async function completeMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "completed") {
      return {
        mediaAsset: await findMediaAssetFromSessionInExecutor(executor, workspaceId, session),
        applied: false,
      };
    }

    assertMediaAssetUploadSessionState(session, "completing");
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, session.lastModifiedByReplicaId);
    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      toMediaAssetSnapshotInputFromUploadSession(session),
      toMediaAssetMutationMetadataFromUploadSession(session),
    );
    await executor.query(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'completed', completed_at = now()",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'completing'",
      ].join(" "),
      [workspaceId, sessionId],
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

export async function beginMediaAssetUploadSessionAbortForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionAbortStartResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "aborted") {
      return {
        status: "already_aborted",
        uploadSession: session,
      };
    }

    assertMediaAssetUploadSessionCanAbort(session);
    if (session.state === "aborting") {
      return {
        status: "abort_required",
        uploadSession: session,
      };
    }

    const result = await executor.query<MediaAssetUploadSessionRow>(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'aborting'",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'active'",
        "RETURNING",
        MEDIA_UPLOAD_SESSION_COLUMNS,
      ].join(" "),
      [workspaceId, sessionId],
    );

    const updatedRow = result.rows[0];
    if (updatedRow === undefined) {
      throw new Error(`Media asset upload session aborting update did not return a row. sessionId=${sessionId}`);
    }

    return {
      status: "abort_required",
      uploadSession: mapMediaAssetUploadSessionRow(updatedRow),
    };
  });
}

export async function markMediaAssetUploadSessionAbortedForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "aborted") {
      return session;
    }

    assertMediaAssetUploadSessionState(session, "aborting");
    const result = await executor.query<MediaAssetUploadSessionRow>(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'aborted', aborted_at = now()",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'aborting'",
        "RETURNING",
        MEDIA_UPLOAD_SESSION_COLUMNS,
      ].join(" "),
      [workspaceId, sessionId],
    );

    const updatedRow = result.rows[0];
    if (updatedRow === undefined) {
      throw new Error(`Media asset upload session aborted update did not return a row. sessionId=${sessionId}`);
    }

    return mapMediaAssetUploadSessionRow(updatedRow);
  });
}

export async function closeMediaAssetUploadSessionBlobWriterInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionWriterClosure> {
  const result = await executor.query<MediaAssetUploadSessionWriterClosureRow>(
    `SELECT content.close_media_upload_session_blob_writer(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     ) AS closure_status`,
    [
      input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
      input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
      input.storageKey, input.mimeType, input.sizeBytes, input.expiresAt,
      mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.closure_status;
  if (
    status === "absent" || status === "referenced" || status === "unreferenced"
    || status === "no_writer_closed"
    || status === "access_active" || status === "already_closed" || status === "stale"
  ) return status;
  throw new TypeError("PostgreSQL returned an invalid media upload session writer closure.");
}

export async function closeMediaAssetUploadSessionBlobWriter(
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionWriterClosure> {
  return unsafeTransaction(
    (executor) => closeMediaAssetUploadSessionBlobWriterInExecutor(executor, input),
  );
}

export async function beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
): Promise<MediaAssetUploadSessionCompletionWithOwnerResult> {
  const result = await executor.query<MediaAssetUploadSessionCompletionWithOwnerRow>(
    `SELECT completion_status, reservation_token, reservation_state, normalization_version
     FROM content.begin_media_upload_session_completion_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     )`,
    [
      input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
      input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
      input.stagingStorageKey, input.blobStorageKey, input.s3UploadId, input.mimeType,
      input.sizeBytes, input.partSizeBytes, input.partCount, input.sourceUrl,
      input.assetCreatedAt, input.clientUpdatedAt, input.expiresAt,
      input.normalizationVersion,
    ],
  );
  const row = result.rows[0];
  if (
    row?.completion_status === "started" || row?.completion_status === "replayed"
    || row?.completion_status === "already_completed"
  ) {
    const normalizationVersion = mediaBlobNormalizationVersions.find(
      (candidate) => candidate === row.normalization_version,
    );
    if (row.reservation_token === null || normalizationVersion === undefined
      || (row.reservation_state !== "active" && row.reservation_state !== "ambiguous"
        && row.reservation_state !== "finalized")
    ) throw new TypeError("PostgreSQL returned an invalid atomic multipart completion start.");
    assertMediaBlobWriterReservationToken(row.reservation_token);
    return {
      status: row.completion_status,
      reservation: {
        reservationToken: row.reservation_token,
        state: row.reservation_state,
        normalizationVersion,
      },
    };
  }
  const rejectionStatuses: ReadonlyArray<MediaAssetUploadSessionCompletionWithOwnerRejection> = [
    "access_denied", "session_not_found", "payload_mismatch", "replica_mismatch",
    "expired", "aborting", "aborted", "state_conflict", "legacy_unbound",
    "ownership_mismatch", "writer_conflict", "cleanup_claimed", "completed_mismatch",
  ];
  const rejection = rejectionStatuses.find(
    (candidate) => candidate === row?.completion_status,
  );
  if (rejection !== undefined && row?.reservation_token === null
    && row.reservation_state === null) return { status: rejection };
  throw new TypeError("PostgreSQL returned an invalid atomic multipart completion rejection.");
}

export async function beginMediaAssetUploadSessionCompletionWithOwner(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
): Promise<MediaAssetUploadSessionCompletionWithOwnerResult> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(executor, input),
  );
}

function toMediaAssetUploadSessionCompletionResolutionParams(
  input: MediaAssetUploadSessionCompletionRevocationInput,
): ReadonlyArray<string | number | null> {
  return [
    input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
    input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
    input.stagingStorageKey, input.blobStorageKey, input.s3UploadId, input.mimeType,
    input.sizeBytes, input.partSizeBytes, input.partCount, input.sourceUrl,
    input.assetCreatedAt, input.clientUpdatedAt, input.expiresAt,
  ];
}

export async function fenceMediaAssetUploadSessionCompletionApplyWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionApplyFence> {
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<MediaAssetUploadSessionCompletionResolutionRow>(
    `SELECT content.fence_media_upload_session_completion_apply_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     ) AS resolution_status`,
    [
      ...toMediaAssetUploadSessionCompletionResolutionParams(input),
      input.reservationToken, input.normalizationVersion, mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (status === "ready" || status === "already_applied" || status === "peer_conflict"
    || status === "access_denied" || status === "aborting" || status === "aborted"
    || status === "stale") return status;
  throw new TypeError("PostgreSQL returned an invalid multipart completion apply fence.");
}

export async function fenceMediaAssetUploadSessionCompletionApplyWithOwner(
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionApplyFence> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => fenceMediaAssetUploadSessionCompletionApplyWithOwnerInExecutor(executor, input),
  );
}

export async function resolveMediaAssetUploadSessionCompletionFailureWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionFailureResolution> {
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<MediaAssetUploadSessionCompletionResolutionRow>(
    `SELECT content.resolve_media_upload_session_completion_failure_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     ) AS resolution_status`,
    [
      ...toMediaAssetUploadSessionCompletionResolutionParams(input),
      input.reservationToken, input.normalizationVersion, mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (status === "referenced" || status === "unreferenced_restored"
    || status === "peer_conflict" || status === "already_closed"
    || status === "access_denied" || status === "stale") return status;
  throw new TypeError("PostgreSQL returned an invalid multipart completion failure resolution.");
}

export async function resolveMediaAssetUploadSessionCompletionFailureWithOwner(
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionFailureResolution> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => resolveMediaAssetUploadSessionCompletionFailureWithOwnerInExecutor(executor, input),
  );
}

export async function resolveMediaAssetUploadSessionCompletionAfterAccessRevocationInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionRevocationInput,
): Promise<MediaAssetUploadSessionCompletionRevocationResolution> {
  const result = await executor.query<MediaAssetUploadSessionCompletionResolutionRow>(
    `SELECT content.resolve_media_upload_session_completion_after_access_revocation(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     ) AS resolution_status`,
    [
      ...toMediaAssetUploadSessionCompletionResolutionParams(input),
      mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (status === "referenced" || status === "unreferenced_closed"
    || status === "absent_closed" || status === "peer_conflict"
    || status === "already_closed" || status === "access_active"
    || status === "stale") return status;
  throw new TypeError("PostgreSQL returned an invalid multipart completion revocation resolution.");
}

export async function resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(
  input: MediaAssetUploadSessionCompletionRevocationInput,
): Promise<MediaAssetUploadSessionCompletionRevocationResolution> {
  return unsafeTransaction(
    (executor) => resolveMediaAssetUploadSessionCompletionAfterAccessRevocationInExecutor(
      executor,
      input,
    ),
  );
}

export async function reserveMediaAssetUploadSessionBlobWriterWithOwner(
  userId: string, workspaceId: string, sessionId: string,
): Promise<MediaBlobWriterReservation> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const result = await executor.query<OwnedMultipartReservationRow>(
      `SELECT reservation_token, reservation_state, reservation_status, normalization_version FROM content.reserve_media_upload_session_blob_writer_with_owner($1,$2,$3,$4)`,
      [userId, workspaceId, sessionId, passthroughMediaBlobNormalizationVersion],
    );
    const row = result.rows[0];
    if (row?.reservation_status === "cleanup_claimed") throw new MediaBlobLifecycleBusyError();
    const normalizationVersion = mediaBlobNormalizationVersions.find(
      (candidate) => candidate === row?.normalization_version,
    );
    if (row?.reservation_status !== "reserved" || row.reservation_token === null
      || (row.reservation_state !== "active" && row.reservation_state !== "ambiguous"
        && row.reservation_state !== "finalized") || normalizationVersion === undefined
    ) throw new MediaBlobWriterFenceError("reserve_multipart_owner");
    assertMediaBlobWriterReservationToken(row.reservation_token);
    return { reservationToken: row.reservation_token, state: row.reservation_state,
      normalizationVersion };
  });
}
