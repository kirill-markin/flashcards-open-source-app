import { createHash } from "node:crypto";
import type { DatabaseExecutor } from "../../database";
import { HttpError } from "../../shared/errors";
import { isLowercaseWorkspaceId } from "../../workspaces/identity";
import {
  assertMediaBlobWriterAttemptToken,
  assertMediaBlobWriterReservationToken,
  mediaBlobCleanupDelayMs,
  MediaBlobWriterFenceError,
  type MediaBlobWriterReservation,
} from "../blobLifecycle";
import {
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
} from "../persistence";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAssetMutationMetadata,
  MediaAssetSnapshotInput,
  MediaAssetUploadSession,
  MediaAssetUploadSessionCompletionStartResult,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionRow,
  MediaAssetUploadSessionState,
  MediaBlobNormalizationVersion,
} from "../types";
import {
  mediaBlobNormalizationVersions,
  passthroughMediaBlobNormalizationVersion,
} from "../types";
import { isValidMediaAssetLastOperationId } from "../lastOperationId";
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

export type MediaAssetUploadSessionAbortStartRow =
  Readonly<{ abort_status: string }>;
export type MediaAssetUploadSessionWriterClosureRow = Readonly<{ closure_status: string }>;
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
export const multipartAttemptBeginStatuses = [
  ...multipartAttemptTerminalStatuses,
  ...multipartAttemptRejectionStatuses,
  "busy", "aborting",
] as const;
export const multipartAttemptFenceStatuses = [
  ...multipartAttemptTerminalStatuses,
  ...multipartAttemptRejectionStatuses,
  "ready", "aborting",
] as const;
export const multipartAttemptFailureStatuses = [
  ...multipartAttemptTerminalStatuses,
  ...multipartAttemptRejectionStatuses,
  "aborting",
] as const;
export const multipartAttemptRevocationStatuses = [
  ...multipartAttemptFailureStatuses,
  "access_active", "busy",
] as const;
export const multipartAttemptClosureStatuses = [
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
export const multipartAttemptHandoffStatuses = [
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
export type MediaAssetUploadSessionCompletionWithOwnerRow = Readonly<{
  completion_status: string; reservation_token: string | null;
  reservation_state: string | null; normalization_version: string | null;
}>;
export type MediaAssetUploadSessionCompletionResolutionRow = Readonly<{
  resolution_status: string;
}>;
export type OwnedMultipartReservationRow = Readonly<{
  reservation_token: string | null; reservation_state: string | null;
  reservation_status: string; normalization_version: string;
}>;
export type MediaAssetUploadSessionCompletionStartTransition =
  | MediaAssetUploadSessionCompletionStartResult
  | Readonly<{
    status: "legacy_operation_id_restart_required";
    sessionId: string;
  }>;
export type MultipartAttemptBeginRow = Readonly<{
  attempt_status: string;
  reservation_token: string | null;
  normalization_version: string | null;
  lease_expires_at: string | Date | null;
}>;
export type MultipartAttemptStatusRow = Readonly<{ attempt_status: string }>;
export type MultipartCompletionPendingRow = Readonly<{ completion_status: string }>;
export type MediaAssetUploadSessionCreationClaimRow = Readonly<{
  claim_status: string;
  lease_expires_at: string | Date | null;
  media_upload_session_id: string | null;
}>;
export type MediaAssetUploadSessionCreationClaimStatusRow = Readonly<{
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
export const maximumMultipartAttemptLeaseDurationMs = 3_600_000;
export const multipartAttemptAbsoluteLeaseGrantPaddingMs = 25;
export const multipartAttemptLeaseExpiryPaddingMs = 100;
export const multipartAttemptMinimumSettlementBudgetMs = 1_000;
export const multipartAttemptSettlementPollIntervalMs = 100;
const multipartMediaBlobStorageCapabilityClaims =
  new WeakMap<MultipartMediaBlobStorageCapability, MultipartMediaBlobStorageCapabilityPayload>();

export function requireIsoTimestamp(value: string | Date, fieldName: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid timestamp.`);
  }
  return date.toISOString();
}

export function requireMediaBlobNormalizationVersion(
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

export function snapshotMultipartAttemptInput(
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
  if (!isLowercaseWorkspaceId(snapshot.workspaceId)) {
    throw new TypeError("Multipart writer attempt identity is invalid.");
  }
  if (
    snapshot.userId !== snapshot.userId.trim()
    || snapshot.userId.length === 0
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

export function snapshotMultipartAttemptExactInput(
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

export function createMultipartMediaBlobStorageCapability(
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

export function toMultipartAttemptParams(
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

export function requireMultipartAttemptStatus<Status extends string>(
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

export function createMultipartAttemptSettlementDeadlineError(): HttpError {
  return new HttpError(
    503,
    "Multipart completion could not safely wait for the current writer before the request deadline. Retry the same completion request without aborting the upload session.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
}

export const MEDIA_UPLOAD_SESSION_COLUMNS = [
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

export function toMediaAssetSnapshotInputFromUploadSessionCreate(
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

export function toMediaAssetSnapshotInputFromUploadSession(
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

export function toMediaAssetMutationMetadataFromUploadSessionCreate(
  input: MediaAssetUploadSessionCreateInput,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}

export function toMediaAssetMutationMetadataFromUploadSession(
  session: MediaAssetUploadSession,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: session.clientUpdatedAt,
    lastModifiedByReplicaId: session.lastModifiedByReplicaId,
    lastOperationId: session.lastOperationId,
  };
}

export async function findMediaAssetUploadSessionRowForUpdateInExecutor(
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

export function createMediaAssetUploadSessionNotFoundError(sessionId: string): HttpError {
  return new HttpError(
    404,
    `Media asset upload session not found. sessionId=${sessionId}`,
    "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
  );
}

export function createMediaAssetUploadSessionRestartRequiredError(
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

export function assertMediaAssetUploadSessionActive(session: MediaAssetUploadSession): void {
  assertMediaAssetUploadSessionState(session, "active");
}

export function assertMediaAssetUploadSessionSupportsDurableCompletion(
  session: MediaAssetUploadSession,
): void {
  if (isValidMediaAssetLastOperationId(session.lastOperationId)) return;
  throw createMediaAssetUploadSessionRestartRequiredError(session.sessionId);
}

export function assertMediaAssetUploadSessionState(
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

export function assertMediaAssetUploadSessionCanComplete(session: MediaAssetUploadSession): void {
  if (session.state === "completing") {
    return;
  }

  if (session.state === "active") {
    return;
  }

  assertMediaAssetUploadSessionState(session, "completing");
}

export function assertMediaAssetUploadSessionCanAbort(session: MediaAssetUploadSession): void {
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

export async function queryMultipartAttemptStatus<Status extends string>(
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
