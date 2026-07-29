import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { HttpError } from "../../shared/errors";
import {
  assertMediaBlobWriterAttemptToken,
  assertMediaBlobWriterReservationToken,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
  type MediaBlobWriterReservation,
} from "../blobLifecycle";
import {
  assertMediaBlobMatchesInput,
  findMediaAssetRowForUpdateInExecutor,
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
  normalizeMediaAssetMutationMetadata,
  normalizeMediaAssetSnapshotInput,
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
  upsertMediaAssetSnapshotInExecutor,
  upsertMediaAssetSnapshotWithBlobNormalizationInExecutor,
} from "../persistence";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAsset,
  MediaAssetMutationMetadata,
  MediaAssetMutationResult,
  MediaAssetRow,
  MediaAssetSnapshotInput,
  MediaAssetUploadSession,
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
export type MediaAssetUploadSessionCurrentWriterClosure =
  | MediaAssetUploadSessionWriterClosure
  | "access_denied"
  | "replica_mismatch"
  | "ownership_mismatch"
  | "writer_conflict"
  | "cleanup_claimed"
  | "busy"
  | "already_applied"
  | "live_applied"
  | "peer_conflict"
  | "unreferenced_restored"
  | "aborted"
  | "stale_attempt";

export type MediaAssetUploadSessionWriterClosureInput = Readonly<{
  userId: string; workspaceId: string; sessionId: string; mediaAssetId: string;
  lastModifiedByReplicaId: string; lastOperationId: string; sha256: string;
  storageKey: string; mimeType: string; sizeBytes: number; expiresAt: string;
}>;
export type MediaAssetUploadSessionAbortStartWithWriterResult =
  | Readonly<{
    status: "already_aborted";
    uploadSession: MediaAssetUploadSession;
    completionAttemptMayExist: true;
  }>
  | Readonly<{
    status: "abort_required";
    uploadSession: MediaAssetUploadSession;
    completionAttemptMayExist: boolean;
  }>
  | Readonly<{
    status: "completion_in_progress";
    uploadSession: MediaAssetUploadSession;
  }>
  | Readonly<{
    status: "completion_pending";
    uploadSession: MediaAssetUploadSession;
  }>;

type MediaAssetUploadSessionAbortStartRow =
  Readonly<{ abort_status: string }>;
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
export type MultipartMediaBlobWriterAttemptInput =
  Omit<MediaAssetUploadSessionCompletionWithOwnerInput, "normalizationVersion">
  & Readonly<{
    attemptToken: string;
    normalizationVersion: typeof passthroughMediaBlobNormalizationVersion;
    completedPartsFingerprint: string;
  }>;
export type MultipartMediaBlobWriterAttemptExactInput =
  Omit<MultipartMediaBlobWriterAttemptInput, "normalizationVersion">
  & Readonly<{
    reservationToken: string;
    normalizationVersion: MediaBlobNormalizationVersion;
  }>;
declare const multipartMediaBlobStorageCapabilityType: unique symbol;
export type MultipartMediaBlobStorageCapability = Readonly<{
  readonly [multipartMediaBlobStorageCapabilityType]: true;
}>;
type MultipartMediaBlobStorageCapabilityPayload = Readonly<{
  writer: MultipartMediaBlobWriterAttemptExactInput;
  leaseExpiresAt: string;
}>;
const multipartAttemptTerminalStatuses = [
  "already_applied", "live_applied", "peer_conflict", "referenced",
  "unreferenced", "unreferenced_restored", "already_closed", "aborted",
  "stale_attempt",
] as const;
const multipartAttemptRejectionStatuses = [
  "access_denied", "replica_mismatch", "ownership_mismatch", "writer_conflict",
  "cleanup_claimed", "stale",
] as const;
const multipartAttemptBeginStatuses = [
  ...multipartAttemptTerminalStatuses,
  ...multipartAttemptRejectionStatuses,
  "busy", "aborting",
] as const;
const multipartAttemptFenceStatuses = [
  ...multipartAttemptTerminalStatuses,
  ...multipartAttemptRejectionStatuses,
  "ready", "aborting",
] as const;
const multipartAttemptFailureStatuses = [
  ...multipartAttemptTerminalStatuses,
  ...multipartAttemptRejectionStatuses,
  "aborting",
] as const;
const multipartAttemptRevocationStatuses = [
  ...multipartAttemptFailureStatuses,
  "access_active", "busy",
] as const;
const multipartAttemptClosureStatuses = [
  ...multipartAttemptRevocationStatuses,
] as const;
export type MultipartMediaBlobWriterAttemptBeginStatus =
  typeof multipartAttemptBeginStatuses[number];
export type MultipartMediaBlobWriterAttemptFenceStatus =
  typeof multipartAttemptFenceStatuses[number];
export type MultipartMediaBlobWriterAttemptFailureStatus =
  typeof multipartAttemptFailureStatuses[number];
export type MultipartMediaBlobWriterAttemptRevocationStatus =
  typeof multipartAttemptRevocationStatuses[number];
export type MultipartMediaBlobWriterAttemptClosureStatus =
  typeof multipartAttemptClosureStatuses[number];
const multipartAttemptHandoffStatuses = [
  ...multipartAttemptFailureStatuses,
  "handed_off", "already_pending", "failed",
] as const;
export type MultipartMediaBlobWriterAttemptHandoffStatus =
  typeof multipartAttemptHandoffStatuses[number];
export type MultipartMediaBlobWriterAttemptResult =
  | Readonly<{
    status: "acquired" | "replayed" | "expired_takeover";
    reservationToken: string;
    normalizationVersion: MediaBlobNormalizationVersion;
    leaseExpiresAt: string;
    storageCapability: MultipartMediaBlobStorageCapability;
  }>
  | Readonly<{ status: "busy"; leaseExpiresAt: string }>
  | Readonly<{ status: "completion_pending" }>
  | Readonly<{
    status: Exclude<MultipartMediaBlobWriterAttemptBeginStatus, "busy">;
  }>;
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
type MultipartAttemptBeginRow = Readonly<{
  attempt_status: string;
  reservation_token: string | null;
  normalization_version: string | null;
  lease_expires_at: string | Date | null;
}>;
type MultipartAttemptStatusRow = Readonly<{ attempt_status: string }>;
type MultipartCompletionPendingRow = Readonly<{ completion_status: string }>;
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const maximumMultipartAttemptLeaseDurationMs = 3_600_000;
const multipartAttemptAbsoluteLeaseGrantPaddingMs = 25;
const multipartAttemptLeaseExpiryPaddingMs = 100;
const multipartAttemptMinimumSettlementBudgetMs = 1_000;
const multipartAttemptSettlementPollIntervalMs = 100;
const multipartMediaBlobStorageCapabilityClaims =
  new WeakMap<MultipartMediaBlobStorageCapability, MultipartMediaBlobStorageCapabilityPayload>();

function requireIsoTimestamp(value: string | Date, fieldName: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function requireMediaBlobNormalizationVersion(
  value: string,
): MediaBlobNormalizationVersion {
  const version = mediaBlobNormalizationVersions.find(
    (candidate) => candidate === value,
  );
  if (version === undefined) {
    throw new TypeError(
      "PostgreSQL returned an invalid multipart writer normalization version.",
    );
  }
  return version;
}

export function createMediaAssetUploadSessionCompletedPartsFingerprint(
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>,
): string {
  const canonicalParts = [...parts]
    .sort((left, right) => left.partNumber - right.partNumber)
    .map((part) => [part.partNumber, part.eTag, part.sha256] as const);
  return createHash("sha256")
    .update(JSON.stringify(canonicalParts), "utf8")
    .digest("hex");
}

function snapshotMultipartAttemptInput(
  input: MultipartMediaBlobWriterAttemptInput,
): MultipartMediaBlobWriterAttemptInput {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Multipart writer attempt input must be an object.");
  }
  const snapshot = {
    attemptToken: input.attemptToken,
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    mediaAssetId: input.mediaAssetId,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
    sha256: input.sha256,
    stagingStorageKey: input.stagingStorageKey,
    blobStorageKey: input.blobStorageKey,
    s3UploadId: input.s3UploadId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    partSizeBytes: input.partSizeBytes,
    partCount: input.partCount,
    sourceUrl: input.sourceUrl,
    assetCreatedAt: input.assetCreatedAt,
    clientUpdatedAt: input.clientUpdatedAt,
    expiresAt: input.expiresAt,
    normalizationVersion: input.normalizationVersion,
    completedPartsFingerprint: input.completedPartsFingerprint,
  };
  if ([
    snapshot.attemptToken, snapshot.userId, snapshot.workspaceId,
    snapshot.sessionId, snapshot.mediaAssetId,
    snapshot.lastModifiedByReplicaId, snapshot.lastOperationId,
    snapshot.sha256, snapshot.stagingStorageKey, snapshot.blobStorageKey,
    snapshot.s3UploadId, snapshot.mimeType, snapshot.assetCreatedAt,
    snapshot.clientUpdatedAt, snapshot.expiresAt,
    snapshot.completedPartsFingerprint,
  ].some((value) => typeof value !== "string")) {
    throw new TypeError("Multipart writer attempt string fields must be strings.");
  }
  if (snapshot.sourceUrl !== null && typeof snapshot.sourceUrl !== "string") {
    throw new TypeError("sourceUrl must be a string or null.");
  }
  assertMediaBlobWriterAttemptToken(snapshot.attemptToken);
  if (
    snapshot.userId !== snapshot.userId.trim()
    || snapshot.userId.length === 0
    || !uuidPattern.test(snapshot.workspaceId)
    || !uuidPattern.test(snapshot.sessionId)
    || !uuidPattern.test(snapshot.mediaAssetId)
    || !uuidPattern.test(snapshot.lastModifiedByReplicaId)
    || isValidMediaAssetLastOperationId(snapshot.lastOperationId) === false
    || controlCharacterPattern.test(snapshot.userId)
    || !sha256Pattern.test(snapshot.sha256)
    || snapshot.stagingStorageKey !== buildMediaMultipartUploadStagingStorageKey(
      snapshot.workspaceId,
      snapshot.mediaAssetId,
      snapshot.sessionId,
    )
    || snapshot.blobStorageKey !== buildMediaBlobStorageKey(snapshot.sha256)
    || snapshot.s3UploadId !== snapshot.s3UploadId.trim()
    || snapshot.s3UploadId.length === 0
    || controlCharacterPattern.test(snapshot.s3UploadId)
    || !mimeTypePattern.test(snapshot.mimeType)
    || !Number.isSafeInteger(snapshot.sizeBytes)
    || snapshot.sizeBytes < 1
    || !Number.isSafeInteger(snapshot.partSizeBytes)
    || snapshot.partSizeBytes < 1
    || !Number.isSafeInteger(snapshot.partCount)
    || snapshot.partCount < 1
    || snapshot.partCount > 10_000
    || snapshot.normalizationVersion
      !== passthroughMediaBlobNormalizationVersion
    || !sha256Pattern.test(snapshot.completedPartsFingerprint)
  ) {
    throw new TypeError("Multipart writer attempt identity is invalid.");
  }
  return Object.freeze({
    ...snapshot,
    assetCreatedAt: requireIsoTimestamp(
      snapshot.assetCreatedAt,
      "assetCreatedAt",
    ),
    clientUpdatedAt: requireIsoTimestamp(
      snapshot.clientUpdatedAt,
      "clientUpdatedAt",
    ),
    expiresAt: requireIsoTimestamp(snapshot.expiresAt, "expiresAt"),
  });
}

function snapshotMultipartAttemptExactInput(
  input: MultipartMediaBlobWriterAttemptExactInput,
): MultipartMediaBlobWriterAttemptExactInput {
  const reservationToken = input.reservationToken;
  const normalizationVersion = input.normalizationVersion;
  const snapshot = snapshotMultipartAttemptInput({
    ...input,
    normalizationVersion: passthroughMediaBlobNormalizationVersion,
  });
  if (typeof reservationToken !== "string") {
    throw new TypeError("reservationToken must be a string.");
  }
  assertMediaBlobWriterReservationToken(reservationToken);
  return Object.freeze({
    ...snapshot,
    reservationToken,
    normalizationVersion: requireMediaBlobNormalizationVersion(
      normalizationVersion,
    ),
  });
}

function hasExactMultipartAttemptInput(
  expected: MultipartMediaBlobWriterAttemptExactInput,
  actual: MultipartMediaBlobWriterAttemptExactInput,
): boolean {
  return expected.attemptToken === actual.attemptToken
    && expected.reservationToken === actual.reservationToken
    && expected.userId === actual.userId
    && expected.workspaceId === actual.workspaceId
    && expected.sessionId === actual.sessionId
    && expected.mediaAssetId === actual.mediaAssetId
    && expected.lastModifiedByReplicaId === actual.lastModifiedByReplicaId
    && expected.lastOperationId === actual.lastOperationId
    && expected.sha256 === actual.sha256
    && expected.stagingStorageKey === actual.stagingStorageKey
    && expected.blobStorageKey === actual.blobStorageKey
    && expected.s3UploadId === actual.s3UploadId
    && expected.mimeType === actual.mimeType
    && expected.sizeBytes === actual.sizeBytes
    && expected.partSizeBytes === actual.partSizeBytes
    && expected.partCount === actual.partCount
    && expected.sourceUrl === actual.sourceUrl
    && expected.assetCreatedAt === actual.assetCreatedAt
    && expected.clientUpdatedAt === actual.clientUpdatedAt
    && expected.expiresAt === actual.expiresAt
    && expected.normalizationVersion === actual.normalizationVersion
    && expected.completedPartsFingerprint === actual.completedPartsFingerprint;
}

function createMultipartMediaBlobStorageCapability(
  writer: MultipartMediaBlobWriterAttemptExactInput,
  leaseExpiresAt: string,
): MultipartMediaBlobStorageCapability {
  const capability = Object.freeze({}) as MultipartMediaBlobStorageCapability;
  multipartMediaBlobStorageCapabilityClaims.set(capability, Object.freeze({
    writer,
    leaseExpiresAt,
  }));
  return capability;
}

export function assertMultipartMediaBlobStorageCapabilityForMutation(
  capability: MultipartMediaBlobStorageCapability,
  writer: MultipartMediaBlobWriterAttemptExactInput,
): void {
  const exactWriter = snapshotMultipartAttemptExactInput(writer);
  const claim = typeof capability === "object" && capability !== null
    ? multipartMediaBlobStorageCapabilityClaims.get(capability)
    : undefined;
  if (
    claim === undefined
    || !Object.isFrozen(capability)
    || !Object.isFrozen(claim)
    || !hasExactMultipartAttemptInput(claim.writer, exactWriter)
  ) {
    throw new MediaBlobWriterFenceError(
      "verify_multipart_storage_capability",
    );
  }
  if (Date.parse(claim.leaseExpiresAt) <= Date.now()) {
    throw new MediaBlobWriterFenceError(
      "verify_multipart_storage_capability_expired",
    );
  }
}

function toMultipartAttemptParams(
  input:
    | MultipartMediaBlobWriterAttemptInput
    | MultipartMediaBlobWriterAttemptExactInput,
): ReadonlyArray<string | number | null> {
  return [
    input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
    input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
    input.stagingStorageKey, input.blobStorageKey, input.s3UploadId,
    input.mimeType, input.sizeBytes, input.partSizeBytes, input.partCount,
    input.sourceUrl, input.assetCreatedAt, input.clientUpdatedAt,
    input.expiresAt, input.normalizationVersion,
    input.completedPartsFingerprint,
  ];
}

function requireMultipartAttemptStatus<Status extends string>(
  value: string | undefined,
  statuses: ReadonlyArray<Status>,
  operation: string,
): Status {
  const status = statuses.find((candidate) => candidate === value);
  if (status === undefined) {
    throw new TypeError(
      `PostgreSQL returned an invalid multipart writer attempt status. operation=${operation}`,
    );
  }
  return status;
}

function createMultipartAttemptSettlementDeadlineError(): HttpError {
  return new HttpError(
    503,
    "Multipart completion could not safely wait for the current writer before the request deadline. Retry the same completion request without aborting the upload session.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
}

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
}

export function isMediaAssetUploadSessionExpired(
  session: MediaAssetUploadSession,
): boolean {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

export function assertMediaAssetUploadSessionSupportsDurableCompletion(
  session: MediaAssetUploadSession,
): void {
  if (isValidMediaAssetLastOperationId(session.lastOperationId)) return;
  throw createMediaAssetUploadSessionRestartRequiredError(session.sessionId);
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
    return;
  }

  assertMediaAssetUploadSessionState(session, "completing");
}

function assertMediaAssetUploadSessionCanAbort(session: MediaAssetUploadSession): void {
  if (
    session.state === "active"
    || session.state === "completing"
    || session.state === "aborting"
  ) {
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
  const session = await loadMediaAssetUploadSessionForCompletionForWorkspace(
    userId,
    workspaceId,
    sessionId,
  );
  assertMediaAssetUploadSessionActive(session);
  return session;
}

export async function loadMediaAssetUploadSessionForCompletionForWorkspace(
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

  return mapMediaAssetUploadSessionRow(row);
}

function assertMediaAssetMatchesUploadSessionImmutableBlob(
  mediaAsset: MediaAsset,
  session: MediaAssetUploadSession,
): void {
  if (
    mediaAsset.workspaceId !== session.workspaceId
    || mediaAsset.mediaAssetId !== session.mediaAssetId
    || mediaAsset.mimeType !== session.mimeType
    || mediaAsset.sizeBytes !== session.sizeBytes
    || mediaAsset.sha256 !== session.mediaBlobSha256
  ) {
    throw new HttpError(
      409,
      `Completed media asset upload session conflicts with current immutable blob identity. sessionId=${session.sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }
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

  const mediaAsset = mapMediaAssetRow(row);
  assertMediaAssetMatchesUploadSessionImmutableBlob(mediaAsset, session);
  return mediaAsset;
}

export async function loadMediaAssetForCompletedUploadSessionReplayForWorkspace(
  userId: string,
  session: MediaAssetUploadSession,
): Promise<MediaAsset> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId: session.workspaceId },
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "LIMIT 1",
    ].join(" "),
    [session.workspaceId, session.mediaAssetId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `Completed media asset upload session has no media asset row. sessionId=${session.sessionId}`,
    );
  }
  const mediaAsset = mapMediaAssetRow(row);
  assertMediaAssetMatchesUploadSessionImmutableBlob(mediaAsset, session);
  return mediaAsset;
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
  writer: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MediaAssetMutationResult> {
  if (
    userId !== writer.userId
    || workspaceId !== writer.workspaceId
    || sessionId !== writer.sessionId
  ) {
    throw new MediaBlobWriterFenceError("multipart_apply_scope");
  }
  const exactWriter = snapshotMultipartAttemptExactInput(writer);
  const outcome = await transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      const fence =
        await fenceMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
          executor,
          exactWriter,
        );
      if (fence === "peer_conflict") return fence;
      if (
        fence === "already_applied"
        || fence === "live_applied"
        || fence === "referenced"
      ) {
        const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(
          executor,
          workspaceId,
          sessionId,
        );
        if (row === null) {
          throw new MediaBlobWriterFenceError(
            "multipart_terminal_session",
          );
        }
        const session = mapMediaAssetUploadSessionRow(row);
        return {
          mediaAsset: await findMediaAssetFromSessionInExecutor(
            executor,
            workspaceId,
            session,
          ),
          applied: false,
        };
      }
      if (fence !== "ready") {
        throwMultipartAttemptStatus(fence, null);
      }

      const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(
        executor,
        workspaceId,
        sessionId,
      );
      if (row === null) {
        throw createMediaAssetUploadSessionNotFoundError(sessionId);
      }

      const session = mapMediaAssetUploadSessionRow(row);
      assertMediaAssetUploadSessionState(session, "completing");
      await assertReplicaBelongsToWorkspaceInExecutor(
        executor,
        workspaceId,
        session.lastModifiedByReplicaId,
      );
      const result =
        await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
          executor,
          workspaceId,
          toMediaAssetSnapshotInputFromUploadSession(session),
          toMediaAssetMutationMetadataFromUploadSession(session),
          exactWriter.normalizationVersion,
        );
      const finish =
        await finishMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
          executor,
          exactWriter,
        );
      if (finish === "peer_conflict") return finish;
      if (
        finish === "already_applied"
        || finish === "referenced"
      ) {
        return {
          mediaAsset: await findMediaAssetFromSessionInExecutor(
            executor,
            workspaceId,
            session,
          ),
          applied: false,
        };
      }
      if (finish !== "live_applied") {
        throwMultipartAttemptStatus(finish, null);
      }

      return {
        mediaAsset: result.mediaAsset,
        applied: true,
      };
    },
  );
  if (outcome === "peer_conflict") {
    throw new HttpError(
      409,
      `Media asset upload session conflicts with newer media asset state. sessionId=${sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }
  return outcome;
}

async function checkMediaAssetUploadSessionCompletionPendingInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  sessionId: string,
  mediaAssetId: string,
): Promise<boolean> {
  const result = await executor.query<MultipartCompletionPendingRow>(
    `SELECT content.check_media_upload_session_completion_pending_with_owner(
       $1, $2, $3, $4
     ) AS completion_status`,
    [userId, workspaceId, sessionId, mediaAssetId],
  );
  const status = result.rows[0]?.completion_status;
  if (status === "pending") return true;
  if (status === "not_pending") return false;
  if (status === "access_denied") {
    throwMultipartAttemptStatus("access_denied", null);
  }
  if (status === "session_not_found") {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }
  throw new TypeError(
    `PostgreSQL returned an invalid upload-session completion pending status. status=${String(status)}`,
  );
}

export async function checkMediaAssetUploadSessionCompletionPendingForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  mediaAssetId: string,
): Promise<boolean> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    (executor) => checkMediaAssetUploadSessionCompletionPendingInExecutor(
      executor,
      userId,
      workspaceId,
      sessionId,
      mediaAssetId,
    ),
  );
}

export async function checkMediaAssetCompletionPendingForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<boolean> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      const result = await executor.query<MultipartCompletionPendingRow>(
        `SELECT content.check_media_asset_completion_pending_with_owner(
           $1, $2, $3
         ) AS completion_status`,
        [userId, workspaceId, mediaAssetId],
      );
      const status = result.rows[0]?.completion_status;
      if (status === "pending") return true;
      if (status === "not_pending") return false;
      if (status === "access_denied") {
        throwMultipartAttemptStatus("access_denied", null);
      }
      throw new TypeError(
        `PostgreSQL returned an invalid media-asset completion pending status. status=${String(status)}`,
      );
    },
  );
}

export async function beginMediaAssetUploadSessionAbortForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionAbortStartWithWriterResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const initialResult = await executor.query<MediaAssetUploadSessionRow>(
      `SELECT ${MEDIA_UPLOAD_SESSION_COLUMNS}
       FROM content.media_upload_sessions
       WHERE workspace_id = $1
         AND media_upload_session_id = $2`,
      [workspaceId, sessionId],
    );
    const initialRow = initialResult.rows[0];
    if (initialRow === undefined) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }
    const initialSession = mapMediaAssetUploadSessionRow(initialRow);
    const beginAbort = async (): Promise<string> => {
      const result =
        await executor.query<MediaAssetUploadSessionAbortStartRow>(
          `SELECT content.begin_media_upload_session_abort_with_owner(
             $1, $2, $3, $4
           ) AS abort_status`,
          [userId, workspaceId, sessionId, initialSession.mediaAssetId],
        );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart abort admission row count.",
        );
      }
      const abortStatus = result.rows[0]?.abort_status;
      if (typeof abortStatus !== "string") {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart abort admission status.",
        );
      }
      return abortStatus;
    };
    let status = await beginAbort();
    if (status === "access_denied") {
      throw new HttpError(
        403,
        "Workspace access is required.",
        "WORKSPACE_ACCESS_DENIED",
      );
    }
    if (status === "not_found") {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    let finalRow = await findMediaAssetUploadSessionRowForUpdateInExecutor(
      executor,
      workspaceId,
      sessionId,
    );
    if (finalRow === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }
    let session = mapMediaAssetUploadSessionRow(finalRow);
    if (
      status === "stale"
      && initialSession.state === "completing"
      && isValidMediaAssetLastOperationId(initialSession.lastOperationId)
        === false
      && session.state === "completing"
      && session.lastOperationId === initialSession.lastOperationId
    ) {
      const recovery =
        await executor.query<MediaAssetUploadSessionRow>(
          [
            "UPDATE content.media_upload_sessions",
            "SET state = 'active'",
            "WHERE workspace_id = $1",
            "AND media_upload_session_id = $2",
            "AND state = 'completing'",
            "AND last_operation_id = $3",
            "RETURNING",
            MEDIA_UPLOAD_SESSION_COLUMNS,
          ].join(" "),
          [workspaceId, sessionId, initialSession.lastOperationId],
        );
      if (recovery.rows.length !== 1) {
        throw new Error(
          `Quiescent legacy media upload session recovery did not return one active row. sessionId=${sessionId}`,
        );
      }
      status = await beginAbort();
      if (status !== "abort_required") {
        throw new Error(
          `Quiescent legacy media upload session recovery was not admitted for abort. sessionId=${sessionId} status=${status}`,
        );
      }
      finalRow = await findMediaAssetUploadSessionRowForUpdateInExecutor(
        executor,
        workspaceId,
        sessionId,
      );
      if (finalRow === null) {
        throw createMediaAssetUploadSessionNotFoundError(sessionId);
      }
      session = mapMediaAssetUploadSessionRow(finalRow);
    }
    if (status === "already_aborted") {
      return {
        status,
        uploadSession: session,
        completionAttemptMayExist: true,
      };
    }
    if (status === "completion_in_progress") {
      return { status, uploadSession: session };
    }
    if (status === "completion_pending") {
      return { status, uploadSession: session };
    }
    if (status === "abort_required") {
      return {
        status,
        uploadSession: session,
        completionAttemptMayExist: initialSession.state === "completing",
      };
    }
    if (status === "stale") {
      assertMediaAssetUploadSessionCanAbort(session);
      throw new HttpError(
        409,
        `Multipart abort admission became stale. sessionId=${sessionId}`,
        "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
      );
    }
    throw new TypeError(
      `PostgreSQL returned an invalid multipart abort admission status. status=${String(status)}`,
    );
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

export async function closeMediaAssetUploadSessionCurrentBlobWriterInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionCurrentWriterClosure> {
  const result = await executor.query<MediaAssetUploadSessionWriterClosureRow>(
    `SELECT content.close_media_upload_session_current_blob_writer_with_owner(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     ) AS closure_status`,
    [
      input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
      input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
      input.storageKey, input.mimeType, input.sizeBytes, input.expiresAt,
      mediaBlobCleanupDelayMs,
    ],
  );
  const statuses: ReadonlyArray<MediaAssetUploadSessionCurrentWriterClosure> = [
    "absent", "referenced", "unreferenced", "no_writer_closed",
    "access_active", "already_closed", "stale", "access_denied",
    "replica_mismatch", "ownership_mismatch", "writer_conflict",
    "cleanup_claimed", "busy", "already_applied", "live_applied",
    "peer_conflict", "unreferenced_restored", "aborted", "stale_attempt",
  ];
  const status = statuses.find(
    (candidate) => candidate === result.rows[0]?.closure_status,
  );
  if (status === undefined) {
    throw new TypeError(
      "PostgreSQL returned an invalid current media upload session writer closure.",
    );
  }
  return status;
}

export function closeMediaAssetUploadSessionCurrentBlobWriter(
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionCurrentWriterClosure> {
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: input.userId, workspaceId: input.workspaceId },
    );
    return closeMediaAssetUploadSessionCurrentBlobWriterInExecutor(
      executor,
      input,
    );
  });
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

export async function beginMediaAssetUploadSessionCompletionWithOwnerAndParts(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionWithOwnerResult> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    async (executor) => {
      const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(
        executor,
        input.workspaceId,
        input.sessionId,
      );
      if (row === null) {
        return { status: "session_not_found" };
      }
      const session = mapMediaAssetUploadSessionRow(row);
      if (session.state === "active") {
        const expiryResult = await executor.query<Readonly<{ value: boolean }>>(
          "SELECT $1::timestamptz <= clock_timestamp() AS value",
          [session.expiresAt],
        );
        const expired = expiryResult.rows[0]?.value;
        if (typeof expired !== "boolean") {
          throw new TypeError(
            "PostgreSQL did not return multipart completion expiry state.",
          );
        }
        if (expired) {
          return beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(
            executor,
            input,
          );
        }
      }
      if (session.state === "active" || session.state === "completing") {
        assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
      }
      return beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(
        executor,
        input,
      );
    },
  );
}

function mapMultipartAttemptBeginRow(
  row: MultipartAttemptBeginRow,
  snapshot: MultipartMediaBlobWriterAttemptInput,
): MultipartMediaBlobWriterAttemptResult {
  if (
    row.attempt_status === "acquired"
    || row.attempt_status === "replayed"
    || row.attempt_status === "expired_takeover"
  ) {
    if (
      row.reservation_token === null
      || row.normalization_version === null
      || row.lease_expires_at === null
    ) {
      throw new TypeError(
        "PostgreSQL returned an incomplete multipart writer attempt acquisition.",
      );
    }
    assertMediaBlobWriterReservationToken(row.reservation_token);
    const normalizationVersion = requireMediaBlobNormalizationVersion(
      row.normalization_version,
    );
    const leaseExpiresAt = requireIsoTimestamp(
      row.lease_expires_at,
      "leaseExpiresAt",
    );
    if (Date.parse(leaseExpiresAt) <= Date.now()) {
      throw new TypeError(
        "PostgreSQL returned an expired multipart writer lease.",
      );
    }
    const exactWriter = snapshotMultipartAttemptExactInput({
      ...snapshot,
      reservationToken: row.reservation_token,
      normalizationVersion,
    });
    return {
      status: row.attempt_status,
      reservationToken: row.reservation_token,
      normalizationVersion,
      leaseExpiresAt,
      storageCapability: createMultipartMediaBlobStorageCapability(
        exactWriter,
        leaseExpiresAt,
      ),
    };
  }
  const status = requireMultipartAttemptStatus(
    row.attempt_status,
    multipartAttemptBeginStatuses,
    "begin_multipart_writer_attempt",
  );
  if (row.reservation_token !== null) {
    throw new TypeError(
      "PostgreSQL returned an invalid multipart writer attempt rejection.",
    );
  }
  if (status === "cleanup_claimed") {
    if (
      row.normalization_version === null
      || row.lease_expires_at !== null
    ) {
      throw new TypeError(
        "PostgreSQL returned an invalid cleanup-claimed multipart writer result.",
      );
    }
    requireMediaBlobNormalizationVersion(row.normalization_version);
    return { status };
  }
  if (row.normalization_version !== null) {
    throw new TypeError(
      "PostgreSQL returned an unexpected multipart writer normalization version.",
    );
  }
  if (status === "busy") {
    if (row.lease_expires_at === null) {
      return { status: "completion_pending" };
    }
    return {
      status,
      leaseExpiresAt: requireIsoTimestamp(
        row.lease_expires_at,
        "leaseExpiresAt",
      ),
    };
  }
  if (row.lease_expires_at !== null) {
    throw new TypeError(
      "PostgreSQL returned an unexpected multipart writer lease.",
    );
  }
  return { status };
}

export async function beginMediaAssetUploadSessionCompletionAttemptWithOwner(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseDurationMs: number,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  if (
    !Number.isSafeInteger(leaseDurationMs)
    || leaseDurationMs < 1
    || leaseDurationMs > maximumMultipartAttemptLeaseDurationMs
  ) {
    throw new RangeError(
      `leaseDurationMs must be an integer between 1 and ${maximumMultipartAttemptLeaseDurationMs}.`,
    );
  }
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    async (executor) => {
      const result = await executor.query<MultipartAttemptBeginRow>(
        `SELECT attempt_status, reservation_token, normalization_version, lease_expires_at
         FROM content.begin_media_upload_session_completion_attempt_with_owner(
           $1,$2,ROW(
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )::content.multipart_media_blob_writer_attempt_payload
         )`,
        [snapshot.attemptToken, leaseDurationMs, ...toMultipartAttemptParams(snapshot)],
      );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart writer attempt row count.",
        );
      }
      return mapMultipartAttemptBeginRow(result.rows[0], snapshot);
    },
  );
}

export async function beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseTargetAtMs: number,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  const nowMs = Date.now();
  if (
    !Number.isSafeInteger(leaseTargetAtMs)
    || leaseTargetAtMs
      <= nowMs + multipartAttemptAbsoluteLeaseGrantPaddingMs
    || leaseTargetAtMs - nowMs > maximumMultipartAttemptLeaseDurationMs
  ) {
    throw new RangeError(
      `leaseTargetAtMs must be more than ${multipartAttemptAbsoluteLeaseGrantPaddingMs}ms and at most ${maximumMultipartAttemptLeaseDurationMs}ms in the future.`,
    );
  }
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    async (executor) => {
      await executor.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             $1 || ':' || $2::TEXT,
             0::BIGINT
           )
         )`,
        [snapshot.userId, snapshot.workspaceId],
      );
      const result = await executor.query<MultipartAttemptBeginRow>(
        `WITH lease AS MATERIALIZED (
           SELECT
             $2::BIGINT
               - pg_catalog.floor(
                   EXTRACT(
                     EPOCH FROM pg_catalog.clock_timestamp()
                   ) * 1000
                 )::BIGINT
               - $3::BIGINT AS duration_ms
         )
         SELECT
           attempt.attempt_status,
           attempt.reservation_token,
           attempt.normalization_version,
           attempt.lease_expires_at
         FROM lease
         CROSS JOIN LATERAL
           content.begin_media_upload_session_completion_attempt_with_owner(
             $1,
             lease.duration_ms::INTEGER,
             ROW(
               $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               $20,$21,$22,$23
             )::content.multipart_media_blob_writer_attempt_payload
           ) AS attempt
         WHERE lease.duration_ms BETWEEN 1 AND $24`,
        [
          snapshot.attemptToken,
          leaseTargetAtMs,
          multipartAttemptAbsoluteLeaseGrantPaddingMs,
          ...toMultipartAttemptParams(snapshot),
          maximumMultipartAttemptLeaseDurationMs,
        ],
      );
      if (result.rows.length === 0) {
        throw createMultipartAttemptSettlementDeadlineError();
      }
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid absolute-target multipart writer attempt row count.",
        );
      }
      const mapped = mapMultipartAttemptBeginRow(result.rows[0], snapshot);
      if (
        "reservationToken" in mapped
        && Date.parse(mapped.leaseExpiresAt) >= leaseTargetAtMs
      ) {
        throw new MediaBlobWriterFenceError(
          "multipart_attempt_absolute_lease_target",
        );
      }
      return mapped;
    },
  );
}

async function beginMediaAssetUploadSessionCompletionAttemptUntilSettled(
  input: MultipartMediaBlobWriterAttemptInput,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
  beginAttempt: () => Promise<MultipartMediaBlobWriterAttemptResult>,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  signal.throwIfAborted();
  if (
    !Number.isSafeInteger(requestDeadlineAtMs)
    || requestDeadlineAtMs <= Date.now()
  ) {
    throw createMultipartAttemptSettlementDeadlineError();
  }
  for (;;) {
    signal.throwIfAborted();
    if (
      requestDeadlineAtMs - Date.now()
      <= multipartAttemptMinimumSettlementBudgetMs
    ) {
      throw createMultipartAttemptSettlementDeadlineError();
    }
    const result = await beginAttempt();
    if (result.status !== "busy") return result;
    if (
      await checkMediaAssetUploadSessionCompletionPendingForWorkspace(
        snapshot.userId,
        snapshot.workspaceId,
        snapshot.sessionId,
        snapshot.mediaAssetId,
      )
    ) {
      return { status: "completion_pending" };
    }

    const leaseExpiresAtMs = Date.parse(result.leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAtMs)) {
      throw new MediaBlobWriterFenceError(
        "multipart_attempt_busy_lease_expiry",
      );
    }
    const nowMs = Date.now();
    const waitUntilTakeoverMs = Math.max(
      1,
      leaseExpiresAtMs - nowMs + multipartAttemptLeaseExpiryPaddingMs,
    );
    const waitMs = Math.min(
      multipartAttemptSettlementPollIntervalMs,
      waitUntilTakeoverMs,
    );
    if (
      nowMs + waitMs + multipartAttemptMinimumSettlementBudgetMs
      > requestDeadlineAtMs
    ) {
      throw createMultipartAttemptSettlementDeadlineError();
    }
    try {
      await wait(waitMs, undefined, { signal });
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      throw error;
    }
  }
}

export async function beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseDurationMs: number,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  return beginMediaAssetUploadSessionCompletionAttemptUntilSettled(
    snapshot,
    requestDeadlineAtMs,
    signal,
    () => beginMediaAssetUploadSessionCompletionAttemptWithOwner(
      snapshot,
      leaseDurationMs,
    ),
  );
}

export async function beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseTargetAtMs: number,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  return beginMediaAssetUploadSessionCompletionAttemptUntilSettled(
    snapshot,
    requestDeadlineAtMs,
    signal,
    () => beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
      snapshot,
      leaseTargetAtMs,
    ),
  );
}

async function queryMultipartAttemptStatus<Status extends string>(
  executor: DatabaseExecutor,
  functionName: string,
  input: MultipartMediaBlobWriterAttemptExactInput,
  statuses: ReadonlyArray<Status>,
): Promise<Status> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  const result = await executor.query<MultipartAttemptStatusRow>(
    `SELECT content.${functionName}(
       $1,$2,ROW(
         $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       )::content.multipart_media_blob_writer_attempt_payload,$23
     ) AS attempt_status`,
    [
      snapshot.attemptToken,
      snapshot.reservationToken,
      ...toMultipartAttemptParams(snapshot),
      mediaBlobCleanupDelayMs,
    ],
  );
  if (result.rows.length !== 1) {
    throw new TypeError(
      `PostgreSQL returned an invalid multipart writer status row count. operation=${functionName}`,
    );
  }
  return requireMultipartAttemptStatus(
    result.rows[0]?.attempt_status,
    statuses,
    functionName,
  );
}

export function fenceMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptFenceStatus> {
  return queryMultipartAttemptStatus(
    executor,
    "fence_media_upload_session_completion_attempt_apply_with_owner",
    input,
    multipartAttemptFenceStatuses,
  );
}

export function finishMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptFailureStatus> {
  return queryMultipartAttemptStatus(
    executor,
    "finish_media_upload_session_completion_attempt_apply_with_owner",
    input,
    multipartAttemptFailureStatuses,
  );
}

export function resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptFailureStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    (executor) => queryMultipartAttemptStatus(
      executor,
      "resolve_media_upload_session_completion_attempt_failure_with_owner",
      snapshot,
      multipartAttemptFailureStatuses,
    ),
  );
}

export function resolveMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptRevocationStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    );
    return queryMultipartAttemptStatus(
      executor,
      "resolve_media_upload_session_completion_attempt_after_access_revocation",
      snapshot,
      multipartAttemptRevocationStatuses,
    );
  });
}

export function closeMediaAssetUploadSessionBlobWriterAttempt(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptClosureStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    );
    return queryMultipartAttemptStatus(
      executor,
      "close_media_upload_session_blob_writer_attempts",
      snapshot,
      multipartAttemptClosureStatuses,
    );
  });
}

export function handoffMediaAssetUploadSessionCompletionAttempt(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptHandoffStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    async (executor) => {
      const result = await executor.query<MultipartAttemptStatusRow>(
        `SELECT content.handoff_media_upload_session_completion_attempt(
           $1,$2,ROW(
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )::content.multipart_media_blob_writer_attempt_payload
         ) AS attempt_status`,
        [
          snapshot.attemptToken,
          snapshot.reservationToken,
          ...toMultipartAttemptParams(snapshot),
        ],
      );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart handoff row count.",
        );
      }
      return requireMultipartAttemptStatus(
        result.rows[0]?.attempt_status,
        multipartAttemptHandoffStatuses,
        "handoff_media_upload_session_completion_attempt",
      );
    },
  );
}

export function handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptHandoffStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return unsafeTransaction(async (executor) => {
    const result = await executor.query<MultipartAttemptStatusRow>(
      `SELECT content.handoff_media_upload_session_completion_attempt_after_access_revocation(
         $1,$2,ROW(
           $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
         )::content.multipart_media_blob_writer_attempt_payload
       ) AS attempt_status`,
      [
        snapshot.attemptToken,
        snapshot.reservationToken,
        ...toMultipartAttemptParams(snapshot),
      ],
    );
    if (result.rows.length !== 1) {
      throw new TypeError(
        "PostgreSQL returned an invalid access-revoked multipart handoff row count.",
      );
    }
    return requireMultipartAttemptStatus(
      result.rows[0]?.attempt_status,
      multipartAttemptHandoffStatuses,
      "handoff_media_upload_session_completion_attempt_after_access_revocation",
    );
  });
}

function throwMultipartAttemptStatus(
  status:
    | MultipartMediaBlobWriterAttemptBeginStatus
    | MultipartMediaBlobWriterAttemptFenceStatus
    | MultipartMediaBlobWriterAttemptFailureStatus
    | MultipartMediaBlobWriterAttemptRevocationStatus,
  leaseExpiresAt: string | null,
): never {
  if (status === "cleanup_claimed") {
    throw new MediaBlobLifecycleBusyError();
  }
  if (status === "access_denied") {
    throw new HttpError(
      403,
      "Workspace access changed during multipart completion.",
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    );
  }
  if (status === "replica_mismatch") {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
  if (status === "busy") {
    const leaseExpiresAtMs = leaseExpiresAt === null
      ? Number.NaN
      : Date.parse(leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAtMs)) {
      throw new TypeError(
        "Multipart writer busy status did not include a valid lease expiry.",
      );
    }
    throw new HttpError(
      409,
      "Multipart completion is already in progress. Retry after the active writer lease expires.",
      "MEDIA_ASSET_WRITER_BUSY",
      {
        retryAfterSeconds: Math.max(
          1,
          Math.min(60, Math.ceil((leaseExpiresAtMs - Date.now()) / 1_000)),
        ),
      },
    );
  }
  if (status === "ready" || status === "access_active") {
    throw new TypeError(
      `Multipart writer returned an impossible terminal status. status=${status}`,
    );
  }
  throw new HttpError(
    409,
    `Multipart completion conflicts with its current writer state. status=${status}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
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
