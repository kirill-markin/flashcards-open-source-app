import { transactionWithWorkspaceScopeDeadline, type DatabaseExecutor } from "../../database";
import { unsafeQueryWithDeadline } from "../../database/unsafe";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../mediaAssets/storageKeys";
import { assertActiveChatRunClaimWithExecutor, type ChatRunClaimFenceParams } from "../runs/claimFence";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const mimeTypePattern = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
export type GeneratedMediaPromotionJobPayload = Readonly<{
  jobId: string;
  operationId: string;
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
  Readonly<{ outcome: "created" | "existing"; jobId: string }>;
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
type StoredPayloadRow = Readonly<{
  job_id: string;
  operation_id: string;
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
type InsertedRow = Readonly<{ job_id: string }>;
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
  if (
    payload.altText !== payload.altText.trim()
    || payload.altText.length < 1
    || payload.altText.length > 2000
    || controlCharacterPattern.test(payload.altText)
  ) {
    throw new TypeError("altText must be 1 to 2000 trimmed characters without control characters.");
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
function toPayload(row: StoredPayloadRow): GeneratedMediaPromotionJobPayload {
  const sizeBytes = Number(row.size_bytes);
  const payload: GeneratedMediaPromotionJobPayload = {
    jobId: row.job_id,
    operationId: row.operation_id,
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
  job_id, operation_id, workspace_id, card_id, target_side, alt_text,
  media_asset_id, replica_id, staging_storage_key, blob_storage_key,
  sha256, mime_type, size_bytes
`;
export async function enqueueGeneratedMediaPromotionJob(
  input: EnqueueGeneratedMediaPromotionJobInput,
): Promise<EnqueueGeneratedMediaPromotionJobResult> {
  requirePayload(input);
  return transactionWithWorkspaceScopeDeadline(
    { userId: input.userId, workspaceId: input.workspaceId },
    input.deadlineAtMs,
    async (executor) => {
      await assertActiveChatRunClaimWithExecutor(executor, input);
      const inserted = await executor.query<InsertedRow>(
        `INSERT INTO content.generated_media_promotion_jobs (
           job_id, operation_id, workspace_id, card_id, target_side, alt_text,
           media_asset_id, replica_id, staging_storage_key, blob_storage_key,
           sha256, mime_type, size_bytes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT DO NOTHING
         RETURNING job_id`,
        [
          input.jobId, input.operationId, input.workspaceId, input.cardId,
          input.targetSide, input.altText, input.mediaAssetId, input.replicaId,
          input.stagingStorageKey, input.blobStorageKey, input.sha256,
          input.mimeType, input.sizeBytes,
        ],
      );
      if (inserted.rows[0]?.job_id === input.jobId) {
        return { outcome: "created", jobId: input.jobId };
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
      return { outcome: "existing", jobId: input.jobId };
    },
  );
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
    "SELECT * FROM content.claim_generated_media_promotion_jobs($1, $2, $3)",
    [input.leaseOwner, input.leaseDurationMs, input.limit],
  );
  return result.rows.map(toClaimedJob);
}
async function requireTransition(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<string | Date>,
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
