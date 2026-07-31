import {
  appendPendingManagedImageToCardSideInExecutor,
  hasPendingManagedImageOnCardSideInExecutor,
  ManagedImageMarkdownComplexitySettlementConflictError,
} from "../../../cards";
import {
  transactionWithWorkspaceScopeDeadline,
  type DatabaseExecutor,
  type SqlValue,
} from "../../../database";
import { unsafeQueryWithDeadline, unsafeTransactionWithDeadline } from "../../../database/unsafe";
import {
  getDatabaseErrorFields,
} from "../../../database/transient";
import {
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
  reserveMediaBlobWriterInExecutor,
  type MediaBlobWriterReservation,
  type MediaBlobWriterReservationInput,
} from "../../../mediaAssets/blobLifecycle";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../../mediaAssets/storageKeys";
import {
  imageJpegCardMediaBlobNormalizationVersion,
  mediaBlobNormalizationVersions,
  type MediaBlobNormalizationVersion,
} from "../../../mediaAssets/types";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../../mediaAssets/workspaceReplicas";
import { HttpError } from "../../../shared/errors";
import {
  isMarkdownComplexityLimitError,
  rewriteMarkdownImageDestinationUrl,
} from "../../../workspacePackages/markdownMedia";
import { assertActiveChatRunClaimWithExecutor, type ChatRunClaimFenceParams } from "../../runs/claimFence";
import {
  hasValidGeneratedImageAltTextCharactersAndLength,
  maximumGeneratedImageAltTextCodePoints,
} from "../contract";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const mimeTypePattern = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const cleanupAdmissionConstraint =
  "generated_media_promotion_cleanup_admission";
const generatedMediaPromotionLifecycleProtocolVersion = 2;
const generatedMediaPromotionLifecycleProtocolMarker =
  "content.generated_media_promotion_protocol_v2_active()";
export type GeneratedMediaPromotionProtocolVersion = 1 | 2;
export type GeneratedMediaPromotionJobPayload = Readonly<{
  jobId: string;
  operationId: string;
  userId: string;
  workspaceId: string;
  cardId: string;
  targetSide: "front" | "back";
  altText: string;
  mediaAssetId: string;
  replicaId: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
}>;
export type EnqueueGeneratedMediaPromotionJobInput = ChatRunClaimFenceParams
  & GeneratedMediaPromotionJobPayload & Readonly<{ deadlineAtMs: number }>;
export type EnqueueGeneratedMediaPromotionJobResult =
  Readonly<{
    outcome: "created" | "existing";
    jobId: string;
    placeholderApplied: boolean;
  }>;
export type ClaimedGeneratedMediaPromotionJob =
  GeneratedMediaPromotionJobPayload
  & Readonly<{
    state: "leased";
    retryCount: number; nextAttemptAt: string;
    leaseToken: string; leaseOwner: string; leaseExpiresAt: string;
    lastError: SafeGeneratedMediaPromotionJobError | null;
    createdAt: string; updatedAt: string;
  }>;
export type ClaimGeneratedMediaPromotionJobsInput = Readonly<{
  leaseOwner: string; leaseDurationMs: number;
  limit: number; deadlineAtMs: number;
}>;
export type GeneratedMediaPromotionJobLeaseInput =
  Readonly<{ jobId: string; leaseToken: string }>;
export type SafeGeneratedMediaPromotionJobError =
  Readonly<{ code: string; message: string }>;
export type RescheduleGeneratedMediaPromotionJobInput =
  GeneratedMediaPromotionJobLeaseInput
  & Readonly<{ nextAttemptAt: Date; error: SafeGeneratedMediaPromotionJobError }>;
export type FailGeneratedMediaPromotionJobInput =
  GeneratedMediaPromotionJobLeaseInput & Readonly<{ error: SafeGeneratedMediaPromotionJobError }>;
export type GeneratedMediaPromotionBlobWriterInput =
  ClaimedGeneratedMediaPromotionJob & Readonly<{
    reservationToken: string;
    normalizationVersion: MediaBlobNormalizationVersion;
  }>;
export type GeneratedMediaBlobWriterExactInput =
  GeneratedMediaPromotionBlobWriterInput & Readonly<{
    reservationState: MediaBlobWriterReservation["state"];
  }>;
declare const generatedMediaBlobStorageCapabilityType: unique symbol;
export type GeneratedMediaBlobStorageCapability = Readonly<{
  readonly [generatedMediaBlobStorageCapabilityType]: true;
}>;
export type GeneratedMediaBlobWriterReservation =
  MediaBlobWriterReservation & Readonly<{
    writer: GeneratedMediaBlobWriterExactInput;
    storageCapability: GeneratedMediaBlobStorageCapability;
  }>;
export type FailGeneratedMediaPromotionJobWithBlobWriterInput =
  GeneratedMediaPromotionBlobWriterInput & Readonly<{ error: SafeGeneratedMediaPromotionJobError }>;
export type GeneratedMediaPromotionAccessRevocationOutcome =
  "access_active" | "applied" | "failed" | "failed_markdown_complexity";

function isCleanupAdmissionFenceError(error: unknown): boolean {
  return getDatabaseErrorFields(error).sqlState === "55P03"
    && typeof error === "object"
    && error !== null
    && "constraint" in error
    && error.constraint === cleanupAdmissionConstraint;
}

type StoredPayloadRow = Readonly<{
  job_id: string;
  operation_id: string;
  user_id: string;
  workspace_id: string;
  card_id: string;
  target_side: "front" | "back";
  alt_text: string;
  media_asset_id: string;
  replica_id: string;
  staging_storage_key: string;
  blob_storage_key: string;
  sha256: string;
  mime_type: string;
  size_bytes: string;
}>;
type ClaimedJobRow = StoredPayloadRow & Readonly<{
  state: string;
  retry_count: number;
  next_attempt_at: Date;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date;
  updated_at: Date;
}>;
type TransitionRow = Readonly<{ transitioned: boolean }>;
type AppliedScopeRow = Readonly<{ scope_status: string }>;
type OperationAppliedRow = Readonly<{ applied: boolean }>;
type ProtocolActivationRow = Readonly<{ active: boolean }>;
type ProtocolVersionRow = Readonly<{ protocol_version: number }>;
type AccessRevocationLockRow = Readonly<{
  revocation_status: string;
  card_text: string | null;
}>;
type AccessRevocationRow = Readonly<{ revocation_status: string }>;
type InsertedRow = Readonly<{ job_id: string }>;
const generatedMediaBlobStorageCapabilityClaims =
  new WeakMap<GeneratedMediaBlobStorageCapability, GeneratedMediaBlobWriterExactInput>();

function accessRevocationPayloadParams(
  input: ClaimedGeneratedMediaPromotionJob,
): ReadonlyArray<SqlValue> {
  return [
    input.jobId, input.leaseToken, input.operationId, input.userId,
    input.workspaceId, input.cardId, input.targetSide, input.altText,
    input.mediaAssetId, input.replicaId, input.stagingStorageKey,
    input.blobStorageKey, input.sha256, input.mimeType, input.sizeBytes,
  ];
}

export class GeneratedMediaPromotionJobConflictError extends Error {
  readonly code = "GENERATED_MEDIA_PROMOTION_JOB_CONFLICT";
  constructor(jobId: string, operationId: string, fieldName: string) {
    super(
      `Generated-media promotion job identity already has a different immutable payload. jobId=${jobId}; operationId=${operationId}; field=${fieldName}`,
    );
    this.name = "GeneratedMediaPromotionJobConflictError";
  }
}
export class GeneratedMediaPromotionJobLeaseLostError extends Error {
  readonly code = "GENERATED_MEDIA_PROMOTION_JOB_LEASE_LOST";
  constructor(jobId: string) {
    super(`Generated-media promotion job lease is no longer active. jobId=${jobId}`);
    this.name = "GeneratedMediaPromotionJobLeaseLostError";
  }
}
export class GeneratedMediaPromotionJobAccessRevokedError extends Error {
  readonly code = "WORKSPACE_ACCESS_REVOKED";
  constructor(jobId: string) {
    super(`Generated-media promotion job workspace access was revoked. jobId=${jobId}`);
    this.name = "GeneratedMediaPromotionJobAccessRevokedError";
  }
}
export class GeneratedMediaPromotionProtocolInactiveError extends Error {
  readonly code = "GENERATED_MEDIA_PROMOTION_PROTOCOL_INACTIVE";
  constructor() {
    super(
      "Generated-media promotion protocol v2 is not active. "
        + "Complete migration 0104 before admitting lifecycle-marker jobs.",
    );
    this.name = "GeneratedMediaPromotionProtocolInactiveError";
  }
}
function requireUuid(value: string, fieldName: string): void {
  if (!uuidPattern.test(value)) {
    throw new TypeError(`${fieldName} must be a lowercase UUID.`);
  }
}
function requirePayload(payload: GeneratedMediaPromotionJobPayload): void {
  requireUuid(payload.jobId, "jobId");
  requireUuid(payload.operationId, "operationId");
  requireUuid(payload.workspaceId, "workspaceId");
  requireUuid(payload.cardId, "cardId");
  requireUuid(payload.mediaAssetId, "mediaAssetId");
  requireUuid(payload.replicaId, "replicaId");
  if (payload.userId !== payload.userId.trim() || payload.userId === ""
    || controlCharacterPattern.test(payload.userId)) {
    throw new TypeError("userId must be non-empty, trimmed, and contain no control characters.");
  }
  if (
    !hasValidGeneratedImageAltTextCharactersAndLength(payload.altText)
    || payload.altText !== payload.altText.trim()
    || payload.altText === ""
  ) {
    throw new TypeError(
      `altText must be 1 to ${maximumGeneratedImageAltTextCodePoints} trimmed Unicode code points without control characters.`,
    );
  }
  if (!sha256Pattern.test(payload.sha256)) {
    throw new TypeError("sha256 must be a normalized lowercase SHA-256 digest.");
  }
  if (!mimeTypePattern.test(payload.mimeType)) {
    throw new TypeError("mimeType must be a normalized lowercase MIME type.");
  }
  if (!Number.isSafeInteger(payload.sizeBytes) || payload.sizeBytes < 1) {
    throw new RangeError("sizeBytes must be a positive safe integer.");
  }
  if (
    payload.stagingStorageKey !== buildMediaUploadStagingStorageKey(
      payload.workspaceId,
      payload.mediaAssetId,
      payload.operationId,
    )
  ) {
    throw new TypeError("stagingStorageKey does not match the deterministic promotion payload.");
  }
  if (payload.blobStorageKey !== buildMediaBlobStorageKey(payload.sha256)) {
    throw new TypeError("blobStorageKey does not match sha256.");
  }
}
function requireSafeError(error: SafeGeneratedMediaPromotionJobError): void {
  if (!safeErrorCodePattern.test(error.code)) {
    throw new TypeError("error.code must be a safe uppercase identifier of at most 64 characters.");
  }
  if (
    error.message !== error.message.trim()
    || error.message.length < 1
    || error.message.length > 500
    || controlCharacterPattern.test(error.message)
  ) {
    throw new TypeError("error.message must be 1 to 500 trimmed characters without control characters.");
  }
}
function requireBlobWriterInput(input: GeneratedMediaPromotionBlobWriterInput): void {
  requirePayload(input);
  requireUuid(input.leaseToken, "leaseToken");
  requireUuid(input.reservationToken, "reservationToken");
  if (!mediaBlobNormalizationVersions.some((version) => version === input.normalizationVersion)) {
    throw new TypeError("normalizationVersion is unsupported.");
  }
}
function snapshotGeneratedMediaBlobWriterExactInput(
  input: GeneratedMediaBlobWriterExactInput,
): GeneratedMediaBlobWriterExactInput {
  const lastErrorInput = input.lastError;
  const lastError = lastErrorInput === null
    ? null
    : Object.freeze({
      code: lastErrorInput.code,
      message: lastErrorInput.message,
    });
  const snapshot: GeneratedMediaBlobWriterExactInput = {
    jobId: input.jobId,
    operationId: input.operationId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    cardId: input.cardId,
    targetSide: input.targetSide,
    altText: input.altText,
    mediaAssetId: input.mediaAssetId,
    replicaId: input.replicaId,
    stagingStorageKey: input.stagingStorageKey,
    blobStorageKey: input.blobStorageKey,
    sha256: input.sha256,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    state: input.state,
    retryCount: input.retryCount,
    nextAttemptAt: input.nextAttemptAt,
    leaseToken: input.leaseToken,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: input.leaseExpiresAt,
    lastError,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    reservationToken: input.reservationToken,
    normalizationVersion: input.normalizationVersion,
    reservationState: input.reservationState,
  };
  requireBlobWriterInput(snapshot);
  if (snapshot.state !== "leased") {
    throw new MediaBlobWriterFenceError("snapshot_generated_storage_writer_state");
  }
  if (
    snapshot.leaseOwner !== snapshot.leaseOwner.trim()
    || snapshot.leaseOwner.length < 1
    || snapshot.leaseOwner.length > 200
    || controlCharacterPattern.test(snapshot.leaseOwner)
  ) {
    throw new TypeError(
      "leaseOwner must be 1 to 200 trimmed characters without control characters.",
    );
  }
  const leaseExpiresAtMs = Date.parse(snapshot.leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) {
    throw new TypeError("leaseExpiresAt must be a valid timestamp.");
  }
  return Object.freeze(snapshot);
}
function hasExactGeneratedMediaBlobWriterInput(
  expected: GeneratedMediaBlobWriterExactInput,
  actual: GeneratedMediaBlobWriterExactInput,
): boolean {
  return expected.jobId === actual.jobId
    && expected.operationId === actual.operationId
    && expected.userId === actual.userId
    && expected.workspaceId === actual.workspaceId
    && expected.cardId === actual.cardId
    && expected.targetSide === actual.targetSide
    && expected.altText === actual.altText
    && expected.mediaAssetId === actual.mediaAssetId
    && expected.replicaId === actual.replicaId
    && expected.stagingStorageKey === actual.stagingStorageKey
    && expected.blobStorageKey === actual.blobStorageKey
    && expected.sha256 === actual.sha256
    && expected.mimeType === actual.mimeType
    && expected.sizeBytes === actual.sizeBytes
    && expected.state === actual.state
    && expected.retryCount === actual.retryCount
    && expected.nextAttemptAt === actual.nextAttemptAt
    && expected.leaseToken === actual.leaseToken
    && expected.leaseOwner === actual.leaseOwner
    && expected.leaseExpiresAt === actual.leaseExpiresAt
    && expected.lastError?.code === actual.lastError?.code
    && expected.lastError?.message === actual.lastError?.message
    && expected.createdAt === actual.createdAt
    && expected.updatedAt === actual.updatedAt
    && expected.reservationToken === actual.reservationToken
    && expected.normalizationVersion === actual.normalizationVersion
    && expected.reservationState === actual.reservationState;
}
function createGeneratedMediaBlobStorageCapability(
  input: GeneratedMediaBlobWriterExactInput,
): Readonly<{
  writer: GeneratedMediaBlobWriterExactInput;
  storageCapability: GeneratedMediaBlobStorageCapability;
}> {
  const writer = snapshotGeneratedMediaBlobWriterExactInput(input);
  if (Date.parse(writer.leaseExpiresAt) <= Date.now()) {
    throw new MediaBlobWriterFenceError("issue_generated_storage_capability_expired");
  }
  const storageCapability = Object.freeze({}) as GeneratedMediaBlobStorageCapability;
  generatedMediaBlobStorageCapabilityClaims.set(storageCapability, writer);
  return Object.freeze({ writer, storageCapability });
}
export function assertGeneratedMediaBlobStorageCapabilityForMutation(
  storageCapability: GeneratedMediaBlobStorageCapability,
  writer: GeneratedMediaBlobWriterExactInput,
): void {
  const exactWriter = snapshotGeneratedMediaBlobWriterExactInput(writer);
  const claim = typeof storageCapability === "object" && storageCapability !== null
    ? generatedMediaBlobStorageCapabilityClaims.get(storageCapability)
    : undefined;
  if (
    claim === undefined
    || !Object.isFrozen(storageCapability)
    || !Object.isFrozen(claim)
    || !hasExactGeneratedMediaBlobWriterInput(claim, exactWriter)
    || claim.reservationState !== "active"
  ) {
    throw new MediaBlobWriterFenceError("verify_generated_storage_capability");
  }
  if (Date.parse(claim.leaseExpiresAt) <= Date.now()) {
    throw new MediaBlobWriterFenceError("verify_generated_storage_capability_expired");
  }
}
function blobWriterTransitionParams(
  input: GeneratedMediaPromotionBlobWriterInput,
): ReadonlyArray<SqlValue> {
  return [
    input.jobId, input.leaseToken, input.reservationToken, input.operationId,
    input.userId, input.workspaceId, input.cardId, input.targetSide, input.altText,
    input.mediaAssetId, input.replicaId, input.stagingStorageKey, input.blobStorageKey,
    input.sha256, input.mimeType, input.sizeBytes, input.normalizationVersion,
  ];
}
function toPayload(row: StoredPayloadRow): GeneratedMediaPromotionJobPayload {
  const sizeBytes = Number(row.size_bytes);
  const payload: GeneratedMediaPromotionJobPayload = {
    jobId: row.job_id,
    operationId: row.operation_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    targetSide: row.target_side,
    altText: row.alt_text,
    mediaAssetId: row.media_asset_id,
    replicaId: row.replica_id,
    stagingStorageKey: row.staging_storage_key,
    blobStorageKey: row.blob_storage_key,
    sha256: row.sha256,
    mimeType: row.mime_type,
    sizeBytes,
  };
  requirePayload(payload);
  return payload;
}
function findPayloadMismatch(
  left: GeneratedMediaPromotionJobPayload,
  right: GeneratedMediaPromotionJobPayload,
): keyof GeneratedMediaPromotionJobPayload | null {
  for (const key of Object.keys(left) as Array<keyof GeneratedMediaPromotionJobPayload>) {
    if (left[key] !== right[key]) return key;
  }
  return null;
}
function toIsoString(value: Date, fieldName: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`PostgreSQL returned an invalid ${fieldName}.`);
  }
  return value.toISOString();
}
function parseGeneratedMediaPromotionProtocolVersion(
  value: number,
): GeneratedMediaPromotionProtocolVersion {
  if (value !== 1 && value !== 2) {
    throw new TypeError(
      `PostgreSQL returned an invalid generated-media promotion protocol version. protocolVersion=${value}`,
    );
  }
  return value;
}
async function assertGeneratedMediaPromotionLifecycleProtocolActiveInExecutor(
  executor: DatabaseExecutor,
): Promise<void> {
  const result = await executor.query<ProtocolActivationRow>(
    `SELECT COALESCE(
       has_function_privilege(
         current_user,
         to_regprocedure($1),
         'EXECUTE'
       ),
       FALSE
     ) AS active`,
    [generatedMediaPromotionLifecycleProtocolMarker],
  );
  const active = result.rows[0]?.active;
  if (typeof active !== "boolean") {
    throw new TypeError("PostgreSQL returned an invalid generated-media protocol activation state.");
  }
  if (!active) {
    throw new GeneratedMediaPromotionProtocolInactiveError();
  }
}
export async function loadGeneratedMediaPromotionProtocolVersionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  jobId: string,
): Promise<GeneratedMediaPromotionProtocolVersion> {
  requireUuid(workspaceId, "workspaceId");
  requireUuid(jobId, "jobId");
  const result = await executor.query<ProtocolVersionRow>(
    `SELECT protocol_version
     FROM content.generated_media_promotion_jobs
     WHERE workspace_id = $1 AND job_id = $2`,
    [workspaceId, jobId],
  );
  const protocolVersion = result.rows[0]?.protocol_version;
  if (protocolVersion === undefined) {
    throw new GeneratedMediaPromotionJobLeaseLostError(jobId);
  }
  return parseGeneratedMediaPromotionProtocolVersion(protocolVersion);
}
function toClaimedJob(row: ClaimedJobRow): ClaimedGeneratedMediaPromotionJob {
  if (
    row.state !== "leased"
    || row.lease_token === null
    || row.lease_owner === null
    || row.lease_expires_at === null
  ) {
    throw new TypeError(`PostgreSQL returned an invalid claimed job state. jobId=${row.job_id}`);
  }
  const lastError = row.last_error_code === null && row.last_error_message === null
    ? null
    : { code: row.last_error_code ?? "", message: row.last_error_message ?? "" };
  if (lastError !== null) requireSafeError(lastError);
  if (!Number.isSafeInteger(row.retry_count) || row.retry_count < 0) {
    throw new TypeError(`PostgreSQL returned an invalid retry count. jobId=${row.job_id}`);
  }
  return {
    ...toPayload(row),
    state: "leased",
    retryCount: row.retry_count,
    nextAttemptAt: toIsoString(row.next_attempt_at, "next_attempt_at"),
    leaseToken: row.lease_token,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: toIsoString(row.lease_expires_at, "lease_expires_at"),
    lastError,
    createdAt: toIsoString(row.created_at, "created_at"),
    updatedAt: toIsoString(row.updated_at, "updated_at"),
  };
}
const storedPayloadColumns = `
  job_id, operation_id, user_id, workspace_id, card_id, target_side, alt_text,
  media_asset_id, replica_id, staging_storage_key, blob_storage_key,
  sha256, mime_type, size_bytes
`;
export async function enqueueGeneratedMediaPromotionJob(
  input: EnqueueGeneratedMediaPromotionJobInput,
): Promise<EnqueueGeneratedMediaPromotionJobResult> {
  requirePayload(input);
  try {
    return await transactionWithWorkspaceScopeDeadline(
      { userId: input.userId, workspaceId: input.workspaceId },
      input.deadlineAtMs,
      async (executor) => {
        await assertActiveChatRunClaimWithExecutor(executor, input);
        await assertReplicaBelongsToWorkspaceInExecutor(executor, input.workspaceId, input.replicaId);
        await assertGeneratedMediaPromotionLifecycleProtocolActiveInExecutor(executor);
        const inserted = await executor.query<InsertedRow>(
          `INSERT INTO content.generated_media_promotion_jobs (
             job_id, operation_id, user_id, workspace_id, card_id, target_side, alt_text,
             media_asset_id, replica_id, staging_storage_key, blob_storage_key,
             sha256, mime_type, size_bytes, protocol_version
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
           )
           ON CONFLICT DO NOTHING
           RETURNING job_id`,
          [
            input.jobId, input.operationId, input.userId, input.workspaceId,
            input.cardId, input.targetSide, input.altText, input.mediaAssetId, input.replicaId,
            input.stagingStorageKey, input.blobStorageKey, input.sha256,
            input.mimeType, input.sizeBytes, generatedMediaPromotionLifecycleProtocolVersion,
          ],
        );
        const insertedRow = inserted.rows[0];
        if (insertedRow?.job_id === input.jobId) {
          const placeholder = await appendPendingManagedImageToCardSideInExecutor(
            executor,
            input.workspaceId,
            {
              cardId: input.cardId,
              targetSide: input.targetSide,
              mediaAssetId: input.mediaAssetId,
              altText: input.altText,
            },
            {
              clientUpdatedAt: new Date().toISOString(),
              lastModifiedByReplicaId: input.replicaId,
              lastOperationId: input.operationId,
            },
          );
          if (!placeholder.placeholderApplied) {
            throw new HttpError(
              409,
              "The generated-image placeholder conflicts with an existing managed image reference.",
              "GENERATED_IMAGE_PLACEHOLDER_CONFLICT",
            );
          }
          return {
            outcome: "created",
            jobId: input.jobId,
            placeholderApplied: true,
          };
        }
        const existing = await executor.query<StoredPayloadRow>(
          `SELECT ${storedPayloadColumns}
           FROM content.generated_media_promotion_jobs
           WHERE job_id = $1 OR operation_id = $2`,
          [input.jobId, input.operationId],
        );
        const mismatch = existing.rows.length === 1
          ? findPayloadMismatch(toPayload(existing.rows[0] as StoredPayloadRow), input)
          : "jobId";
        if (mismatch !== null) {
          throw new GeneratedMediaPromotionJobConflictError(
            input.jobId,
            input.operationId,
            mismatch,
          );
        }
        const placeholderApplied = await hasPendingManagedImageOnCardSideInExecutor(
          executor,
          input.workspaceId,
          {
            cardId: input.cardId,
            targetSide: input.targetSide,
            mediaAssetId: input.mediaAssetId,
            altText: input.altText,
          },
        );
        return {
          outcome: "existing",
          jobId: input.jobId,
          placeholderApplied,
        };
      },
    );
  } catch (error) {
    if (isCleanupAdmissionFenceError(error)) {
      throw new MediaBlobLifecycleBusyError();
    }
    throw error;
  }
}
export async function claimGeneratedMediaPromotionJobs(
  input: ClaimGeneratedMediaPromotionJobsInput,
): Promise<ReadonlyArray<ClaimedGeneratedMediaPromotionJob>> {
  if (
    input.leaseOwner !== input.leaseOwner.trim()
    || input.leaseOwner.length < 1
    || input.leaseOwner.length > 200
    || controlCharacterPattern.test(input.leaseOwner)
  ) {
    throw new TypeError("leaseOwner must be 1 to 200 trimmed characters without control characters.");
  }
  if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1
    || input.leaseDurationMs > 3_600_000) {
    throw new RangeError("leaseDurationMs must be between 1 and 3600000.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("limit must be between 1 and 100.");
  }
  const result = await unsafeQueryWithDeadline<ClaimedJobRow>(
    input.deadlineAtMs,
    "SELECT * FROM content.claim_generated_media_promotion_jobs($1, $2, $3, $4)",
    [
      input.leaseOwner,
      input.leaseDurationMs,
      input.limit,
      generatedMediaPromotionLifecycleProtocolVersion,
    ],
  );
  return result.rows.map(toClaimedJob);
}
async function requireTransition(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<SqlValue>,
  jobId: string,
): Promise<void> {
  const result = await executor.query<TransitionRow>(text, params);
  if (result.rows[0]?.transitioned !== true) {
    throw new GeneratedMediaPromotionJobLeaseLostError(jobId);
  }
}
export async function markGeneratedMediaPromotionJobAppliedWithExecutor(
  executor: DatabaseExecutor,
  input: GeneratedMediaPromotionJobLeaseInput,
): Promise<void> {
  requireUuid(input.jobId, "jobId");
  requireUuid(input.leaseToken, "leaseToken");
  await requireTransition(
    executor,
    "SELECT content.mark_generated_media_promotion_job_applied($1, $2) AS transitioned",
    [input.jobId, input.leaseToken],
    input.jobId,
  );
}
export async function isGeneratedMediaPromotionOperationAppliedWithExecutor(
  executor: DatabaseExecutor, jobId: string, operationId: string,
): Promise<boolean> {
  requireUuid(jobId, "jobId");
  requireUuid(operationId, "operationId");
  const result = await executor.query<OperationAppliedRow>(
    "SELECT content.generated_media_promotion_operation_applied($1, $2) AS applied",
    [jobId, operationId],
  );
  const applied = result.rows[0]?.applied;
  if (typeof applied !== "boolean") {
    throw new TypeError(`PostgreSQL returned an invalid promotion operation status. jobId=${jobId}`);
  }
  return applied;
}
export async function markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(
  executor: DatabaseExecutor, input: GeneratedMediaPromotionBlobWriterInput,
): Promise<void> {
  requireBlobWriterInput(input);
  await requireTransition(
    executor,
    `SELECT content.mark_generated_media_promotion_blob_writer_ambiguous(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17
     ) AS transitioned`,
    blobWriterTransitionParams(input),
    input.jobId,
  );
}
export async function failGeneratedMediaPromotionJobWithBlobWriterInExecutor(
  executor: DatabaseExecutor, input: FailGeneratedMediaPromotionJobWithBlobWriterInput,
): Promise<void> {
  requireBlobWriterInput(input);
  requireSafeError(input.error);
  await requireTransition(
    executor,
    `SELECT content.fail_generated_media_promotion_job_with_blob_writer(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20
     ) AS transitioned`,
    [
      ...blobWriterTransitionParams(input), input.error.code, input.error.message,
      3_600_000,
    ],
    input.jobId,
  );
}
async function lockGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
  executor: DatabaseExecutor,
  input: ClaimedGeneratedMediaPromotionJob,
): Promise<AccessRevocationLockRow> {
  requirePayload(input);
  requireUuid(input.leaseToken, "leaseToken");
  const payloadParams = accessRevocationPayloadParams(input);
  const lockResult = await executor.query<AccessRevocationLockRow>(
    `SELECT revocation_status, card_text
     FROM content.lock_generated_media_promotion_job_after_access_revocation(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
     )`,
    payloadParams,
  );
  const lockRow = lockResult.rows[0];
  const lockStatus = lockRow?.revocation_status;
  if (lockStatus === "stale") {
    throw new GeneratedMediaPromotionJobLeaseLostError(input.jobId);
  }
  if (
    lockRow === undefined
    || (
      lockStatus !== "access_active"
      && lockStatus !== "access_revoked"
      && lockStatus !== "applied"
    )
  ) {
    throw new TypeError(
      `PostgreSQL returned an invalid promotion access-revocation lock status. jobId=${input.jobId}`,
    );
  }
  return lockRow;
}

export async function failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
  executor: DatabaseExecutor,
  input: ClaimedGeneratedMediaPromotionJob,
): Promise<GeneratedMediaPromotionAccessRevocationOutcome> {
  const lockRow = await lockGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
    executor,
    input,
  );
  const lockStatus = lockRow.revocation_status;
  if (lockStatus === "access_active" || lockStatus === "applied") return lockStatus;
  const pendingUrl = `fcasset:${input.mediaAssetId}?state=pending`;
  const failedUrl = `fcasset:${input.mediaAssetId}?state=failed`;
  let settlementConflict:
    ManagedImageMarkdownComplexitySettlementConflictError | null = null;
  let failedCardText = lockRow.card_text;
  if (lockRow.card_text !== null) {
    try {
      failedCardText = rewriteMarkdownImageDestinationUrl(
        lockRow.card_text,
        pendingUrl,
        failedUrl,
      );
    } catch (error) {
      if (!isMarkdownComplexityLimitError(error)) throw error;
      settlementConflict =
        new ManagedImageMarkdownComplexitySettlementConflictError(input.targetSide);
    }
  }
  const failureError: SafeGeneratedMediaPromotionJobError =
    settlementConflict === null
      ? {
        code: "WORKSPACE_ACCESS_REVOKED",
        message: "Workspace access was revoked before generated-media promotion completed.",
      }
      : {
        code: settlementConflict.conflictCode,
        message: settlementConflict.message,
      };
  requireSafeError(failureError);
  const result = await executor.query<AccessRevocationRow>(
    `SELECT content.fail_generated_media_promotion_job_after_access_revocation(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19
     ) AS revocation_status`,
    [
      ...accessRevocationPayloadParams(input),
      lockRow.card_text,
      failedCardText,
      failureError.code,
      3_600_000,
    ],
  );
  const status = result.rows[0]?.revocation_status;
  if (status === "access_active" || status === "applied") return status;
  if (status === "failed") {
    return settlementConflict === null
      ? "failed"
      : "failed_markdown_complexity";
  }
  if (status === "stale") {
    throw new GeneratedMediaPromotionJobLeaseLostError(input.jobId);
  }
  throw new TypeError(
    `PostgreSQL returned an invalid promotion access-revocation status. jobId=${input.jobId}`,
  );
}

export async function failGeneratedMediaPromotionJobAfterAccessRevocation(
  job: ClaimedGeneratedMediaPromotionJob,
  deadlineAtMs: number,
): Promise<GeneratedMediaPromotionAccessRevocationOutcome> {
  return unsafeTransactionWithDeadline(deadlineAtMs, (executor) =>
    failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(executor, job));
}

export async function applyGeneratedMediaPromotionJobScopeWithExecutor(
  executor: DatabaseExecutor,
  input: GeneratedMediaPromotionJobLeaseInput,
): Promise<void> {
  requireUuid(input.jobId, "jobId");
  requireUuid(input.leaseToken, "leaseToken");
  const result = await executor.query<AppliedScopeRow>(
    "SELECT content.apply_generated_media_promotion_job_scope($1, $2) AS scope_status",
    [input.jobId, input.leaseToken],
  );
  const status = result.rows[0]?.scope_status;
  if (status === "scoped") return;
  if (status === "access_revoked") {
    throw new GeneratedMediaPromotionJobAccessRevokedError(input.jobId);
  }
  if (status === "lease_lost") {
    throw new GeneratedMediaPromotionJobLeaseLostError(input.jobId);
  }
  throw new TypeError(`PostgreSQL returned an invalid promotion scope status. jobId=${input.jobId}`);
}
export async function rescheduleGeneratedMediaPromotionJobWithExecutor(
  executor: DatabaseExecutor,
  input: RescheduleGeneratedMediaPromotionJobInput,
): Promise<void> {
  requireUuid(input.jobId, "jobId");
  requireUuid(input.leaseToken, "leaseToken");
  requireSafeError(input.error);
  if (!(input.nextAttemptAt instanceof Date) || !Number.isFinite(input.nextAttemptAt.getTime())) {
    throw new TypeError("nextAttemptAt must be a valid Date.");
  }
  await requireTransition(
    executor,
    `SELECT content.reschedule_generated_media_promotion_job(
       $1, $2, $3, $4, $5
     ) AS transitioned`,
    [
      input.jobId, input.leaseToken, input.nextAttemptAt,
      input.error.code, input.error.message,
    ],
    input.jobId,
  );
}
export async function failGeneratedMediaPromotionJobWithExecutor(
  executor: DatabaseExecutor,
  input: FailGeneratedMediaPromotionJobInput,
): Promise<void> {
  requireUuid(input.jobId, "jobId");
  requireUuid(input.leaseToken, "leaseToken");
  requireSafeError(input.error);
  await requireTransition(
    executor,
    "SELECT content.fail_generated_media_promotion_job($1, $2, $3, $4) AS transitioned",
    [input.jobId, input.leaseToken, input.error.code, input.error.message],
    input.jobId,
  );
}

function toBlobWriterInput(job: ClaimedGeneratedMediaPromotionJob): MediaBlobWriterReservationInput {
  return {
    writerKind: "generated_promotion",
    workspaceId: job.workspaceId,
    mediaAssetId: job.mediaAssetId,
    operationId: job.operationId,
    sha256: job.sha256,
    storageKey: job.blobStorageKey,
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
  };
}

function toGeneratedMediaPromotionBlobWriterInput(
  job: ClaimedGeneratedMediaPromotionJob,
  reservation: MediaBlobWriterReservation,
): GeneratedMediaPromotionBlobWriterInput {
  return {
    ...job,
    reservationToken: reservation.reservationToken,
    normalizationVersion: reservation.normalizationVersion,
  };
}

async function lockExactGeneratedMediaPromotionJobForWriterReservation(
  executor: DatabaseExecutor,
  job: ClaimedGeneratedMediaPromotionJob,
): Promise<void> {
  const lock = await lockGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
    executor,
    job,
  );
  if (lock.revocation_status === "access_active") {
    return;
  }
  if (lock.revocation_status === "access_revoked") {
    throw new GeneratedMediaPromotionJobAccessRevokedError(job.jobId);
  }
  throw new GeneratedMediaPromotionJobLeaseLostError(job.jobId);
}

export async function reserveGeneratedMediaBlobWriter(
  job: ClaimedGeneratedMediaPromotionJob,
  deadlineAtMs: number,
): Promise<GeneratedMediaBlobWriterReservation> {
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    await applyGeneratedMediaPromotionJobScopeWithExecutor(executor, job);
    await lockExactGeneratedMediaPromotionJobForWriterReservation(executor, job);
    const reservation = await reserveMediaBlobWriterInExecutor(
      executor,
      toBlobWriterInput(job),
    );
    const capability = createGeneratedMediaBlobStorageCapability({
      ...toGeneratedMediaPromotionBlobWriterInput(job, reservation),
      reservationState: reservation.state,
    });
    return Object.freeze({ ...reservation, ...capability });
  });
}

export async function markGeneratedMediaBlobWriterAmbiguous(
  reservation: GeneratedMediaBlobWriterReservation,
  deadlineAtMs: number,
): Promise<void> {
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    await markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(
      executor,
      reservation.writer,
    );
  });
}
