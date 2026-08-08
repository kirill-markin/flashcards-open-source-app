import {
  DatabaseDeadlineExceededError,
  type DatabaseExecutor,
} from "../../../database";
import {
  unsafeQueryWithDeadline,
  unsafeTransactionWithDeadline,
} from "../../../database/unsafe";
import {
  DatabaseCommitOutcomeUnknownError,
  isTransientDatabaseError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import type {
  BackendObservationScope,
  MultipartCompletionReconciliationTerminalFailureDetails,
} from "../../../observability/sentry";
import { isLowercaseWorkspaceId } from "../../../workspaces/identity";
import { mediaBlobCleanupDelayMs } from "../../blobLifecycle";
import { isValidMediaAssetLastOperationId } from "../../lastOperationId";
import {
  upsertMediaAssetSnapshotWithBlobNormalizationInExecutor,
} from "../../persistence";
import {
  MultipartCompletionReconciliationStorageTerminalError,
  MultipartCompletionReconciliationStorageTransientError,
  reconcileMultipartMediaAssetUpload,
} from "../../storage";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../../storageKeys";
import {
  mediaBlobNormalizationVersions,
  type MediaAsset,
  type MediaBlobNormalizationVersion,
} from "../../types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const mimeTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const maximumJobAttempts = 5;
const retryBaseDelayMs = 30_000;
const retryMaximumDelayMs = 15 * 60_000;
const minimumNewJobBudgetMs = 1_000;

export type ClaimedMultipartCompletionReconciliation = Readonly<{
  attemptToken: string;
  reservationToken: string;
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
  normalizationVersion: MediaBlobNormalizationVersion;
  completedPartsFingerprint: string;
  retryCount: number;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  handedOffAt: string;
  updatedAt: string;
}>;

export type MultipartCompletionReconciliationSafeError = Readonly<{
  code: string;
  message: string;
}>;

export type MultipartCompletionReconciliationJobOutcome =
  | "applied"
  | "ambiguous"
  | "failed"
  | "interrupted"
  | "lease_lost"
  | "rescheduled";

export type MultipartCompletionReconciliationJobResult = Readonly<{
  attemptToken: string;
  workspaceId: string;
  outcome: MultipartCompletionReconciliationJobOutcome;
  retryCount: number;
  errorCode: string | null;
}>;

export type MultipartCompletionReconciliationBatchInput = Readonly<{
  leaseOwner: string;
  leaseDurationMs: number;
  maximumJobs: number;
  deadlineAtMs: number;
  observationScope: BackendObservationScope;
  signal: AbortSignal;
}>;

export type MultipartCompletionReconciliationBatchResult = Readonly<{
  claimed: number;
  applied: number;
  ambiguous: number;
  failed: number;
  interrupted: number;
  leaseLost: number;
  rescheduled: number;
  results: ReadonlyArray<MultipartCompletionReconciliationJobResult>;
}>;

export type MultipartCompletionReconciliationDurableOutcome = Readonly<{
  status: "active" | "applied" | "failed" | "missing";
  errorCode: string | null;
}>;

export type ClaimedMultipartCompletionFailureReport = Readonly<{
  failureEventId: string;
  attemptToken: string;
  workspaceId: string;
  retryCount: number;
  errorCode: string;
  deliveryAttempt: number;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
}>;

export type MultipartCompletionFailureReportBatchInput = Readonly<{
  leaseOwner: string;
  leaseDurationMs: number;
  maximumReports: number;
  deadlineAtMs: number;
  reportTerminalFailure: (
    details: MultipartCompletionReconciliationTerminalFailureDetails,
  ) => void;
  signal: AbortSignal;
}>;

export type MultipartCompletionFailureReportOutcome =
  | "ambiguous"
  | "lease_lost"
  | "reported";

export type MultipartCompletionFailureReportResult = Readonly<{
  failureEventId: string;
  outcome: MultipartCompletionFailureReportOutcome;
}>;

export type MultipartCompletionFailureReportBatchResult = Readonly<{
  claimed: number;
  ambiguous: number;
  leaseLost: number;
  reported: number;
  results: ReadonlyArray<MultipartCompletionFailureReportResult>;
}>;

type ClaimedRow = Readonly<{
  attempt_token: string;
  reservation_token: string;
  writer_kind: string;
  state: string;
  outcome: string | null;
  user_id: string;
  workspace_id: string;
  media_upload_session_id: string | null;
  media_asset_id: string;
  replica_id: string;
  last_operation_id: string | null;
  sha256: string;
  staging_storage_key: string | null;
  blob_storage_key: string;
  s3_upload_id: string | null;
  mime_type: string;
  size_bytes: string | number;
  part_size_bytes: string | number | null;
  part_count: number | null;
  source_url: string | null;
  asset_created_at: Date;
  client_updated_at: Date;
  session_expires_at: Date | null;
  normalization_version: string;
  completed_parts_fingerprint: string | null;
  reconciliation_retry_count: number;
  reconciliation_state: string | null;
  reconciliation_lease_token: string | null;
  reconciliation_lease_owner: string | null;
  reconciliation_lease_expires_at: Date | null;
  reconciliation_handed_off_at: Date | null;
  reconciliation_updated_at: Date | null;
}>;

type StatusRow = Readonly<{ status: string }>;
type RenewalRow = Readonly<{
  renewal_status: string;
  lease_expires_at: Date | null;
}>;
type DurableOutcomeRow = Readonly<{
  reconciliation_status: string;
  reconciliation_error_code: string | null;
}>;
type ClaimedFailureReportRow = Readonly<{
  failure_event_id: string;
  attempt_token: string;
  workspace_id: string;
  reconciliation_retry_count: number;
  reconciliation_last_error_code: string;
  failure_report_delivery_count: number;
  failure_report_lease_token: string;
  failure_report_lease_owner: string;
  failure_report_lease_expires_at: Date;
}>;

export class MultipartCompletionReconciliationLeaseLostError extends Error {
  readonly code = "MULTIPART_COMPLETION_RECONCILIATION_LEASE_LOST";

  constructor(attemptToken: string) {
    super(
      `Multipart completion reconciliation lease is no longer active. attemptToken=${attemptToken}`,
    );
    this.name = "MultipartCompletionReconciliationLeaseLostError";
  }
}

export class MultipartCompletionFailureReportLeaseLostError extends Error {
  readonly code = "MULTIPART_COMPLETION_FAILURE_REPORT_LEASE_LOST";

  constructor(failureEventId: string) {
    super(
      `Multipart completion failure-report lease is no longer active. failureEventId=${failureEventId}`,
    );
    this.name = "MultipartCompletionFailureReportLeaseLostError";
  }
}

export class MultipartCompletionReconciliationAccessRevokedError extends Error {
  readonly code = "WORKSPACE_ACCESS_REVOKED";

  constructor(attemptToken: string) {
    super(
      `Multipart completion reconciliation workspace access was revoked. attemptToken=${attemptToken}`,
    );
    this.name = "MultipartCompletionReconciliationAccessRevokedError";
  }
}

export class MultipartCompletionReconciliationStateConflictError extends Error {
  readonly code = "DURABLE_STATE_CONFLICT";

  constructor(attemptToken: string, status: string) {
    super(
      `Multipart completion reconciliation conflicts with durable state. attemptToken=${attemptToken}; status=${status}`,
    );
    this.name = "MultipartCompletionReconciliationStateConflictError";
  }
}

function toSafeInteger(
  value: string | number,
  fieldName: string,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isSafeInteger(parsed) === false) {
    throw new TypeError(`PostgreSQL returned an invalid ${fieldName}.`);
  }
  return parsed;
}

function toIsoString(value: Date | null, fieldName: string): string {
  if (
    value === null
    || value instanceof Date === false
    || Number.isFinite(value.getTime()) === false
  ) {
    throw new TypeError(`PostgreSQL returned an invalid ${fieldName}.`);
  }
  return value.toISOString();
}

function requireUuid(value: string, fieldName: string): void {
  if (uuidPattern.test(value) === false) {
    throw new TypeError(`${fieldName} must be a lowercase UUID.`);
  }
}

function requireWorkspaceId(value: string): void {
  if (isLowercaseWorkspaceId(value) === false) {
    throw new TypeError("workspaceId must be a lowercase UUID.");
  }
}

function requireClaimedJob(
  job: ClaimedMultipartCompletionReconciliation,
): void {
  requireUuid(job.attemptToken, "attemptToken");
  requireUuid(job.reservationToken, "reservationToken");
  requireWorkspaceId(job.workspaceId);
  requireUuid(job.sessionId, "sessionId");
  requireUuid(job.mediaAssetId, "mediaAssetId");
  requireUuid(job.replicaId, "replicaId");
  requireUuid(job.leaseToken, "leaseToken");
  if (
    job.userId !== job.userId.trim()
    || job.userId === ""
    || controlCharacterPattern.test(job.userId)
  ) {
    throw new TypeError(
      "userId must be non-empty, trimmed, and contain no control characters.",
    );
  }
  if (
    job.leaseOwner !== job.leaseOwner.trim()
    || job.leaseOwner.length < 1
    || job.leaseOwner.length > 200
    || controlCharacterPattern.test(job.leaseOwner)
  ) {
    throw new TypeError("leaseOwner is invalid.");
  }
  if (
    isValidMediaAssetLastOperationId(job.lastOperationId) === false
  ) {
    throw new TypeError("lastOperationId is invalid.");
  }
  if (sha256Pattern.test(job.sha256) === false) {
    throw new TypeError("sha256 must be a normalized lowercase SHA-256 digest.");
  }
  if (sha256Pattern.test(job.completedPartsFingerprint) === false) {
    throw new TypeError(
      "completedPartsFingerprint must be a normalized lowercase SHA-256 digest.",
    );
  }
  if (mimeTypePattern.test(job.mimeType) === false) {
    throw new TypeError("mimeType must be a normalized lowercase MIME type.");
  }
  if (
    Number.isSafeInteger(job.sizeBytes) === false
    || job.sizeBytes < 1
    || Number.isSafeInteger(job.partSizeBytes) === false
    || job.partSizeBytes < 1
    || Number.isSafeInteger(job.partCount) === false
    || job.partCount < 1
    || job.partCount > 10_000
    || Number.isSafeInteger(job.retryCount) === false
    || job.retryCount < 0
  ) {
    throw new RangeError("Durable multipart size, part, or retry fields are invalid.");
  }
  if (
    job.stagingStorageKey !== buildMediaMultipartUploadStagingStorageKey(
      job.workspaceId,
      job.mediaAssetId,
      job.sessionId,
    )
    || job.blobStorageKey !== buildMediaBlobStorageKey(job.sha256)
  ) {
    throw new TypeError("Durable multipart storage keys are not deterministic.");
  }
  if (
    job.s3UploadId !== job.s3UploadId.trim()
    || job.s3UploadId === ""
    || controlCharacterPattern.test(job.s3UploadId)
  ) {
    throw new TypeError("s3UploadId is invalid.");
  }
}

function requireClaimedFailureReport(
  report: ClaimedMultipartCompletionFailureReport,
): void {
  requireUuid(report.failureEventId, "failureEventId");
  requireUuid(report.attemptToken, "attemptToken");
  requireWorkspaceId(report.workspaceId);
  requireUuid(report.leaseToken, "leaseToken");
  if (
    report.leaseOwner !== report.leaseOwner.trim()
    || report.leaseOwner.length < 1
    || report.leaseOwner.length > 200
    || controlCharacterPattern.test(report.leaseOwner)
  ) {
    throw new TypeError("failure report leaseOwner is invalid.");
  }
  if (
    Number.isSafeInteger(report.retryCount) === false
    || report.retryCount < 0
    || Number.isSafeInteger(report.deliveryAttempt) === false
    || report.deliveryAttempt < 1
  ) {
    throw new RangeError(
      "Failure report retry and delivery counts must be non-negative safe integers.",
    );
  }
  if (safeErrorCodePattern.test(report.errorCode) === false) {
    throw new TypeError("Failure report errorCode is invalid.");
  }
}

function toClaimedJob(row: ClaimedRow): ClaimedMultipartCompletionReconciliation {
  const normalizationVersion = mediaBlobNormalizationVersions.find(
    (candidate) => candidate === row.normalization_version,
  );
  if (
    row.writer_kind !== "multipart_completion"
    || row.state !== "expired"
    || row.outcome !== "stale_attempt"
    || row.reconciliation_state !== "leased"
    ||
    row.media_upload_session_id === null
    || row.last_operation_id === null
    || row.staging_storage_key === null
    || row.s3_upload_id === null
    || row.part_size_bytes === null
    || row.part_count === null
    || row.completed_parts_fingerprint === null
    || row.reconciliation_lease_token === null
    || row.reconciliation_lease_owner === null
    || normalizationVersion === undefined
  ) {
    throw new TypeError(
      `PostgreSQL returned an incomplete claimed multipart reconciliation. attemptToken=${row.attempt_token}`,
    );
  }
  const job: ClaimedMultipartCompletionReconciliation = {
    attemptToken: row.attempt_token,
    reservationToken: row.reservation_token,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    sessionId: row.media_upload_session_id,
    mediaAssetId: row.media_asset_id,
    replicaId: row.replica_id,
    lastOperationId: row.last_operation_id,
    sha256: row.sha256,
    stagingStorageKey: row.staging_storage_key,
    blobStorageKey: row.blob_storage_key,
    s3UploadId: row.s3_upload_id,
    mimeType: row.mime_type,
    sizeBytes: toSafeInteger(row.size_bytes, "size_bytes"),
    partSizeBytes: toSafeInteger(row.part_size_bytes, "part_size_bytes"),
    partCount: row.part_count,
    sourceUrl: row.source_url,
    assetCreatedAt: toIsoString(row.asset_created_at, "asset_created_at"),
    clientUpdatedAt: toIsoString(row.client_updated_at, "client_updated_at"),
    sessionExpiresAt: toIsoString(
      row.session_expires_at,
      "session_expires_at",
    ),
    normalizationVersion,
    completedPartsFingerprint: row.completed_parts_fingerprint,
    retryCount: row.reconciliation_retry_count,
    leaseToken: row.reconciliation_lease_token,
    leaseOwner: row.reconciliation_lease_owner,
    leaseExpiresAt: toIsoString(
      row.reconciliation_lease_expires_at,
      "reconciliation_lease_expires_at",
    ),
    handedOffAt: toIsoString(
      row.reconciliation_handed_off_at,
      "reconciliation_handed_off_at",
    ),
    updatedAt: toIsoString(
      row.reconciliation_updated_at,
      "reconciliation_updated_at",
    ),
  };
  requireClaimedJob(job);
  return job;
}

function toClaimedFailureReport(
  row: ClaimedFailureReportRow,
): ClaimedMultipartCompletionFailureReport {
  const report: ClaimedMultipartCompletionFailureReport = {
    failureEventId: row.failure_event_id,
    attemptToken: row.attempt_token,
    workspaceId: row.workspace_id,
    retryCount: row.reconciliation_retry_count,
    errorCode: row.reconciliation_last_error_code,
    deliveryAttempt: row.failure_report_delivery_count,
    leaseToken: row.failure_report_lease_token,
    leaseOwner: row.failure_report_lease_owner,
    leaseExpiresAt: toIsoString(
      row.failure_report_lease_expires_at,
      "failure_report_lease_expires_at",
    ),
  };
  requireClaimedFailureReport(report);
  return report;
}

function validateClaimInput(
  input: Readonly<{
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
  }>,
): void {
  if (
    input.leaseOwner !== input.leaseOwner.trim()
    || input.leaseOwner.length < 1
    || input.leaseOwner.length > 200
    || controlCharacterPattern.test(input.leaseOwner)
  ) {
    throw new TypeError(
      "leaseOwner must be 1 to 200 trimmed characters without control characters.",
    );
  }
  if (
    Number.isSafeInteger(input.leaseDurationMs) === false
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 3_600_000
  ) {
    throw new RangeError("leaseDurationMs must be between 1 and 3600000.");
  }
  if (
    Number.isSafeInteger(input.limit) === false
    || input.limit < 1
    || input.limit > 100
  ) {
    throw new RangeError("limit must be between 1 and 100.");
  }
}

export async function claimMultipartCompletionReconciliations(
  input: Readonly<{
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
    deadlineAtMs: number;
  }>,
): Promise<ReadonlyArray<ClaimedMultipartCompletionReconciliation>> {
  validateClaimInput(input);
  const result = await unsafeQueryWithDeadline<ClaimedRow>(
    input.deadlineAtMs,
    "SELECT * FROM content.claim_media_upload_session_completion_reconciliations($1, $2, $3)",
    [input.leaseOwner, input.leaseDurationMs, input.limit],
  );
  return result.rows.map(toClaimedJob);
}

export async function claimMultipartCompletionFailureReports(
  input: Readonly<{
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
    deadlineAtMs: number;
  }>,
): Promise<ReadonlyArray<ClaimedMultipartCompletionFailureReport>> {
  validateClaimInput(input);
  const result = await unsafeQueryWithDeadline<ClaimedFailureReportRow>(
    input.deadlineAtMs,
    "SELECT * FROM content.claim_media_upload_session_completion_failure_reports($1, $2, $3)",
    [input.leaseOwner, input.leaseDurationMs, input.limit],
  );
  return result.rows.map(toClaimedFailureReport);
}

export async function renewMultipartCompletionReconciliationLease(
  job: ClaimedMultipartCompletionReconciliation,
  leaseDurationMs: number,
  deadlineAtMs: number,
): Promise<void> {
  requireClaimedJob(job);
  const result = await unsafeQueryWithDeadline<RenewalRow>(
    deadlineAtMs,
    `SELECT renewal_status, lease_expires_at
     FROM content.renew_media_upload_session_completion_reconciliation($1, $2, $3)`,
    [job.attemptToken, job.leaseToken, leaseDurationMs],
  );
  if (result.rows[0]?.renewal_status !== "renewed") {
    throw new MultipartCompletionReconciliationLeaseLostError(job.attemptToken);
  }
}

async function readStatus(
  deadlineAtMs: number,
  text: string,
  params: ReadonlyArray<string | number | Date>,
): Promise<string> {
  const result = await unsafeQueryWithDeadline<StatusRow>(
    deadlineAtMs,
    text,
    params,
  );
  const status = result.rows[0]?.status;
  if (typeof status !== "string" || status === "") {
    throw new TypeError("PostgreSQL returned an invalid reconciliation status.");
  }
  return status;
}

export async function readMultipartCompletionReconciliationOutcome(
  attemptToken: string,
  deadlineAtMs: number,
): Promise<MultipartCompletionReconciliationDurableOutcome> {
  requireUuid(attemptToken, "attemptToken");
  const result = await unsafeQueryWithDeadline<DurableOutcomeRow>(
    deadlineAtMs,
    `SELECT reconciliation_status, reconciliation_error_code
     FROM content.get_media_upload_session_completion_reconciliation_outcome($1)`,
    [attemptToken],
  );
  const row = result.rows[0];
  if (
    row === undefined
    || (
      row.reconciliation_status !== "active"
      && row.reconciliation_status !== "applied"
      && row.reconciliation_status !== "failed"
      && row.reconciliation_status !== "missing"
    )
    || (
      row.reconciliation_status === "failed"
      && (
        row.reconciliation_error_code === null
        || safeErrorCodePattern.test(row.reconciliation_error_code) === false
      )
    )
    || (
      row.reconciliation_status !== "failed"
      && row.reconciliation_error_code !== null
    )
  ) {
    throw new TypeError(
      "PostgreSQL returned an invalid durable reconciliation outcome.",
    );
  }
  return {
    status: row.reconciliation_status,
    errorCode: row.reconciliation_error_code,
  };
}

export async function finishMultipartCompletionFailureReport(
  report: ClaimedMultipartCompletionFailureReport,
  deadlineAtMs: number,
): Promise<void> {
  requireClaimedFailureReport(report);
  const status = await readStatus(
    deadlineAtMs,
    `SELECT content.finish_media_upload_session_completion_failure_report(
       $1, $2, $3
     ) AS status`,
    [report.failureEventId, report.attemptToken, report.leaseToken],
  );
  if (status === "reported" || status === "already_reported") return;
  throw new MultipartCompletionFailureReportLeaseLostError(
    report.failureEventId,
  );
}

function toTerminalFailureDetails(
  report: ClaimedMultipartCompletionFailureReport,
): MultipartCompletionReconciliationTerminalFailureDetails {
  return {
    failureEventId: report.failureEventId,
    attemptToken: report.attemptToken,
    workspaceId: report.workspaceId,
    retryCount: report.retryCount,
    errorCode: report.errorCode,
    deliveryAttempt: report.deliveryAttempt,
  };
}

export async function deliverMultipartCompletionFailureReport(
  report: ClaimedMultipartCompletionFailureReport,
  deadlineAtMs: number,
  reportTerminalFailure:
    MultipartCompletionFailureReportBatchInput["reportTerminalFailure"],
): Promise<void> {
  requireClaimedFailureReport(report);
  await unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    const lockResult = await executor.query<StatusRow>(
      `SELECT content.lock_media_upload_session_completion_failure_report_delivery(
         $1, $2, $3
       ) AS status`,
      [report.failureEventId, report.attemptToken, report.leaseToken],
    );
    const lockStatus = lockResult.rows[0]?.status;
    if (lockStatus === "already_reported") return;
    if (lockStatus !== "ready") {
      throw new MultipartCompletionFailureReportLeaseLostError(
        report.failureEventId,
      );
    }

    reportTerminalFailure(toTerminalFailureDetails(report));
    const finishResult = await executor.query<StatusRow>(
      `SELECT content.finish_media_upload_session_completion_failure_report(
         $1, $2, $3
       ) AS status`,
      [report.failureEventId, report.attemptToken, report.leaseToken],
    );
    const finishStatus = finishResult.rows[0]?.status;
    if (finishStatus === "reported" || finishStatus === "already_reported") {
      return;
    }
    throw new MultipartCompletionFailureReportLeaseLostError(
      report.failureEventId,
    );
  });
}

export async function rescheduleMultipartCompletionReconciliation(
  job: ClaimedMultipartCompletionReconciliation,
  deadlineAtMs: number,
  nextAttemptAt: Date,
  error: MultipartCompletionReconciliationSafeError,
): Promise<void> {
  const status = await readStatus(
    deadlineAtMs,
    `SELECT content.reschedule_media_upload_session_completion_reconciliation(
       $1, $2, $3, $4, $5
     ) AS status`,
    [
      job.attemptToken,
      job.leaseToken,
      nextAttemptAt,
      error.code,
      error.message,
    ],
  );
  if (status === "rescheduled") return;
  throw new MultipartCompletionReconciliationLeaseLostError(job.attemptToken);
}

export async function failMultipartCompletionReconciliation(
  job: ClaimedMultipartCompletionReconciliation,
  deadlineAtMs: number,
  error: MultipartCompletionReconciliationSafeError,
): Promise<"applied" | "failed"> {
  const status = await readStatus(
    deadlineAtMs,
    `SELECT content.fail_media_upload_session_completion_reconciliation(
       $1, $2, $3, $4, $5
     ) AS status`,
    [
      job.attemptToken,
      job.leaseToken,
      error.code,
      error.message,
      mediaBlobCleanupDelayMs,
    ],
  );
  if (status === "applied" || status === "failed") return status;
  throw new MultipartCompletionReconciliationLeaseLostError(job.attemptToken);
}

function assertPersistedMediaIdentity(
  mediaAsset: MediaAsset,
  job: ClaimedMultipartCompletionReconciliation,
): void {
  if (
    mediaAsset.mediaAssetId !== job.mediaAssetId
    || mediaAsset.workspaceId !== job.workspaceId
    || mediaAsset.mimeType !== job.mimeType
    || mediaAsset.sizeBytes !== job.sizeBytes
    || mediaAsset.sha256 !== job.sha256
    || mediaAsset.sourceUrl !== job.sourceUrl
    || mediaAsset.createdAt !== job.assetCreatedAt
    || mediaAsset.clientUpdatedAt !== job.clientUpdatedAt
    || mediaAsset.lastModifiedByReplicaId !== job.replicaId
    || mediaAsset.lastOperationId !== job.lastOperationId
    || mediaAsset.deletedAt !== null
  ) {
    throw new MultipartCompletionReconciliationStateConflictError(
      job.attemptToken,
      "media_asset_identity_conflict",
    );
  }
}

async function applyMultipartCompletionReconciliationInExecutor(
  executor: DatabaseExecutor,
  job: ClaimedMultipartCompletionReconciliation,
): Promise<"applied" | "already_applied"> {
  const scopeResult = await executor.query<StatusRow>(
    `SELECT content.apply_media_upload_session_completion_reconciliation_scope(
       $1, $2
     ) AS status`,
    [job.attemptToken, job.leaseToken],
  );
  const scopeStatus = scopeResult.rows[0]?.status;
  if (scopeStatus === "applied") return "already_applied";
  if (scopeStatus === "access_revoked" || scopeStatus === "replica_revoked") {
    throw new MultipartCompletionReconciliationAccessRevokedError(
      job.attemptToken,
    );
  }
  if (scopeStatus === "lease_lost" || scopeStatus === "failed") {
    throw new MultipartCompletionReconciliationLeaseLostError(job.attemptToken);
  }
  if (scopeStatus !== "scoped") {
    throw new MultipartCompletionReconciliationStateConflictError(
      job.attemptToken,
      scopeStatus ?? "missing",
    );
  }

  const result = await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
    executor,
    job.workspaceId,
    {
      mediaAssetId: job.mediaAssetId,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      sha256: job.sha256,
      sourceUrl: job.sourceUrl,
      createdAt: job.assetCreatedAt,
      deletedAt: null,
    },
    {
      clientUpdatedAt: job.clientUpdatedAt,
      lastModifiedByReplicaId: job.replicaId,
      lastOperationId: job.lastOperationId,
    },
    job.normalizationVersion,
  );
  assertPersistedMediaIdentity(result.mediaAsset, job);

  const finishResult = await executor.query<StatusRow>(
    `SELECT content.finish_media_upload_session_completion_reconciliation(
       $1, $2, $3
     ) AS status`,
    [job.attemptToken, job.leaseToken, mediaBlobCleanupDelayMs],
  );
  const finishStatus = finishResult.rows[0]?.status;
  if (finishStatus === "applied" || finishStatus === "already_applied") {
    return finishStatus;
  }
  if (finishStatus === "lease_lost" || finishStatus === "failed") {
    throw new MultipartCompletionReconciliationLeaseLostError(job.attemptToken);
  }
  if (finishStatus === "access_revoked") {
    throw new MultipartCompletionReconciliationAccessRevokedError(
      job.attemptToken,
    );
  }
  throw new MultipartCompletionReconciliationStateConflictError(
    job.attemptToken,
    finishStatus ?? "missing",
  );
}

export async function applyMultipartCompletionReconciliation(
  job: ClaimedMultipartCompletionReconciliation,
  deadlineAtMs: number,
): Promise<"applied" | "already_applied"> {
  requireClaimedJob(job);
  return unsafeTransactionWithDeadline(
    deadlineAtMs,
    async (executor) => applyMultipartCompletionReconciliationInExecutor(
      executor,
      job,
    ),
  );
}

export type MultipartCompletionReconciliationProcessorDependencies = Readonly<{
  claimJobsFn: typeof claimMultipartCompletionReconciliations;
  reconcileStorageFn: typeof reconcileMultipartMediaAssetUpload;
  renewLeaseFn: typeof renewMultipartCompletionReconciliationLease;
  applyJobFn: typeof applyMultipartCompletionReconciliation;
  rescheduleJobFn: typeof rescheduleMultipartCompletionReconciliation;
  failJobFn: typeof failMultipartCompletionReconciliation;
  readJobOutcomeFn: typeof readMultipartCompletionReconciliationOutcome;
  nowFn: () => number;
}>;

function result(
  job: ClaimedMultipartCompletionReconciliation,
  outcome: MultipartCompletionReconciliationJobOutcome,
  errorCode: string | null,
): MultipartCompletionReconciliationJobResult {
  return {
    attemptToken: job.attemptToken,
    workspaceId: job.workspaceId,
    outcome,
    retryCount: job.retryCount,
    errorCode,
  };
}

function terminalError(
  error: unknown,
): MultipartCompletionReconciliationSafeError | null {
  if (error instanceof MultipartCompletionReconciliationStorageTerminalError) {
    return { code: error.code, message: error.safeMessage };
  }
  if (error instanceof MultipartCompletionReconciliationAccessRevokedError) {
    return {
      code: error.code,
      message: "Workspace or replica access was revoked before multipart completion finished.",
    };
  }
  if (error instanceof MultipartCompletionReconciliationStateConflictError) {
    return {
      code: "DURABLE_STATE_CONFLICT",
      message: "Durable multipart completion conflicts with current media state.",
    };
  }
  return null;
}

function isTransientFailure(error: unknown): boolean {
  return error instanceof MultipartCompletionReconciliationStorageTransientError
    || error instanceof TransientDatabaseHttpError
    || isTransientDatabaseError(error);
}

function retryError(
  error: unknown,
): MultipartCompletionReconciliationSafeError {
  if (error instanceof MultipartCompletionReconciliationStorageTransientError) {
    return { code: error.code, message: error.safeMessage };
  }
  return {
    code: "DATABASE_TRANSIENT",
    message: "PostgreSQL is temporarily unavailable.",
  };
}

function calculateRetryAt(
  job: ClaimedMultipartCompletionReconciliation,
  nowMs: number,
): Date {
  const delayMs = Math.min(
    retryBaseDelayMs * (2 ** job.retryCount),
    retryMaximumDelayMs,
  );
  return new Date(nowMs + delayMs);
}

async function resolveUnknownFailureTransition(
  job: ClaimedMultipartCompletionReconciliation,
  input: MultipartCompletionReconciliationBatchInput,
  dependencies: MultipartCompletionReconciliationProcessorDependencies,
): Promise<MultipartCompletionReconciliationJobResult> {
  try {
    const durableOutcome = await dependencies.readJobOutcomeFn(
      job.attemptToken,
      input.deadlineAtMs,
    );
    if (durableOutcome.status === "applied") {
      return result(job, "applied", null);
    }
    if (durableOutcome.status === "failed") {
      return result(job, "failed", durableOutcome.errorCode);
    }
    return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
  } catch (resolutionError) {
    if (
      input.signal.aborted
      || resolutionError instanceof DatabaseDeadlineExceededError
    ) {
      return result(job, "interrupted", "WORKER_DEADLINE");
    }
    if (
      resolutionError instanceof DatabaseCommitOutcomeUnknownError
      || resolutionError instanceof TransientDatabaseHttpError
      || isTransientDatabaseError(resolutionError)
    ) {
      return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
    }
    throw resolutionError;
  }
}

function settledFailureResult(
  job: ClaimedMultipartCompletionReconciliation,
  failureOutcome: "applied" | "failed",
  error: MultipartCompletionReconciliationSafeError,
): MultipartCompletionReconciliationJobResult {
  return result(
    job,
    failureOutcome === "applied" ? "applied" : "failed",
    failureOutcome === "applied" ? null : error.code,
  );
}

function knownFailureTransitionErrorResult(
  job: ClaimedMultipartCompletionReconciliation,
  input: MultipartCompletionReconciliationBatchInput,
  transitionError: unknown,
): MultipartCompletionReconciliationJobResult | null {
  if (
    transitionError instanceof MultipartCompletionReconciliationLeaseLostError
  ) {
    return result(job, "lease_lost", null);
  }
  if (
    input.signal.aborted
    || transitionError instanceof DatabaseDeadlineExceededError
  ) {
    return result(job, "interrupted", "WORKER_DEADLINE");
  }
  return null;
}

async function settleTerminalFailure(
  job: ClaimedMultipartCompletionReconciliation,
  input: MultipartCompletionReconciliationBatchInput,
  dependencies: MultipartCompletionReconciliationProcessorDependencies,
  error: MultipartCompletionReconciliationSafeError,
): Promise<MultipartCompletionReconciliationJobResult> {
  try {
    const failureOutcome = await dependencies.failJobFn(
      job,
      input.deadlineAtMs,
      error,
    );
    return settledFailureResult(job, failureOutcome, error);
  } catch (transitionError) {
    const knownResult = knownFailureTransitionErrorResult(
      job,
      input,
      transitionError,
    );
    if (knownResult !== null) return knownResult;
    if (transitionError instanceof DatabaseCommitOutcomeUnknownError) {
      return resolveUnknownFailureTransition(
        job,
        input,
        dependencies,
      );
    }
    throw transitionError;
  }
}

async function settleTransientFailure(
  job: ClaimedMultipartCompletionReconciliation,
  input: MultipartCompletionReconciliationBatchInput,
  dependencies: MultipartCompletionReconciliationProcessorDependencies,
  error: MultipartCompletionReconciliationSafeError,
): Promise<MultipartCompletionReconciliationJobResult> {
  if (job.retryCount >= maximumJobAttempts - 1) {
    return settleTerminalFailure(
      job,
      input,
      dependencies,
      {
        code: "RETRY_EXHAUSTED",
        message:
          "Multipart completion reconciliation exhausted its transient retry budget.",
      },
    );
  }
  try {
    await dependencies.rescheduleJobFn(
      job,
      input.deadlineAtMs,
      calculateRetryAt(job, dependencies.nowFn()),
      error,
    );
    return result(job, "rescheduled", error.code);
  } catch (transitionError) {
    const knownResult = knownFailureTransitionErrorResult(
      job,
      input,
      transitionError,
    );
    if (knownResult !== null) return knownResult;
    if (transitionError instanceof DatabaseCommitOutcomeUnknownError) {
      return resolveUnknownFailureTransition(
        job,
        input,
        dependencies,
      );
    }
    throw transitionError;
  }
}

export async function processClaimedMultipartCompletionReconciliationWithDependencies(
  job: ClaimedMultipartCompletionReconciliation,
  input: MultipartCompletionReconciliationBatchInput,
  dependencies: MultipartCompletionReconciliationProcessorDependencies,
): Promise<MultipartCompletionReconciliationJobResult> {
  try {
    input.signal.throwIfAborted();
    await dependencies.reconcileStorageFn({
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
      renewLease: async () => dependencies.renewLeaseFn(
        job,
        input.leaseDurationMs,
        input.deadlineAtMs,
      ),
      signal: input.signal,
      observationScope: input.observationScope,
    });
    input.signal.throwIfAborted();
    await dependencies.applyJobFn(job, input.deadlineAtMs);
    return result(job, "applied", null);
  } catch (error) {
    if (error instanceof MultipartCompletionReconciliationLeaseLostError) {
      return result(job, "lease_lost", null);
    }
    if (error instanceof DatabaseCommitOutcomeUnknownError) {
      return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
    }
    if (input.signal.aborted || error instanceof DatabaseDeadlineExceededError) {
      return result(job, "interrupted", "WORKER_DEADLINE");
    }
    if (isTransientFailure(error)) {
      return settleTransientFailure(
        job,
        input,
        dependencies,
        retryError(error),
      );
    }
    const knownTerminalError = terminalError(error);
    if (knownTerminalError !== null) {
      return settleTerminalFailure(
        job,
        input,
        dependencies,
        knownTerminalError,
      );
    }
    throw error;
  }
}

function countOutcome(
  results: ReadonlyArray<MultipartCompletionReconciliationJobResult>,
  outcome: MultipartCompletionReconciliationJobOutcome,
): number {
  return results.filter((item) => item.outcome === outcome).length;
}

function toBatchResult(
  results: ReadonlyArray<MultipartCompletionReconciliationJobResult>,
): MultipartCompletionReconciliationBatchResult {
  return {
    claimed: results.length,
    applied: countOutcome(results, "applied"),
    ambiguous: countOutcome(results, "ambiguous"),
    failed: countOutcome(results, "failed"),
    interrupted: countOutcome(results, "interrupted"),
    leaseLost: countOutcome(results, "lease_lost"),
    rescheduled: countOutcome(results, "rescheduled"),
    results,
  };
}

export class MultipartCompletionReconciliationBatchError extends Error {
  constructor(
    readonly partialResult: MultipartCompletionReconciliationBatchResult,
    cause: unknown,
  ) {
    super(
      "Multipart completion reconciliation batch failed after processing one or more jobs.",
      { cause },
    );
    this.name = "MultipartCompletionReconciliationBatchError";
  }
}

export async function runMultipartCompletionReconciliationBatchWithDependencies(
  input: MultipartCompletionReconciliationBatchInput,
  dependencies: MultipartCompletionReconciliationProcessorDependencies,
): Promise<MultipartCompletionReconciliationBatchResult> {
  const results: Array<MultipartCompletionReconciliationJobResult> = [];
  try {
    while (
      results.length < input.maximumJobs
      && input.signal.aborted === false
      && dependencies.nowFn() + minimumNewJobBudgetMs < input.deadlineAtMs
    ) {
      const claimed = await dependencies.claimJobsFn({
        leaseOwner: input.leaseOwner,
        leaseDurationMs: input.leaseDurationMs,
        limit: 1,
        deadlineAtMs: input.deadlineAtMs,
      });
      const job = claimed[0];
      if (job === undefined) break;
      const jobResult =
        await processClaimedMultipartCompletionReconciliationWithDependencies(
          job,
          input,
          dependencies,
        );
      results.push(jobResult);
      if (jobResult.outcome === "interrupted") break;
    }
  } catch (error) {
    throw new MultipartCompletionReconciliationBatchError(
      toBatchResult(results),
      error,
    );
  }
  return toBatchResult(results);
}

const defaultDependencies: MultipartCompletionReconciliationProcessorDependencies = {
  claimJobsFn: claimMultipartCompletionReconciliations,
  reconcileStorageFn: reconcileMultipartMediaAssetUpload,
  renewLeaseFn: renewMultipartCompletionReconciliationLease,
  applyJobFn: applyMultipartCompletionReconciliation,
  rescheduleJobFn: rescheduleMultipartCompletionReconciliation,
  failJobFn: failMultipartCompletionReconciliation,
  readJobOutcomeFn: readMultipartCompletionReconciliationOutcome,
  nowFn: Date.now,
};

export async function runMultipartCompletionReconciliationBatch(
  input: MultipartCompletionReconciliationBatchInput,
): Promise<MultipartCompletionReconciliationBatchResult> {
  return runMultipartCompletionReconciliationBatchWithDependencies(
    input,
    defaultDependencies,
  );
}

export type MultipartCompletionFailureReportProcessorDependencies = Readonly<{
  claimReportsFn: typeof claimMultipartCompletionFailureReports;
  deliverReportFn: typeof deliverMultipartCompletionFailureReport;
  finishReportFn: typeof finishMultipartCompletionFailureReport;
  nowFn: () => number;
}>;

function failureReportResult(
  report: ClaimedMultipartCompletionFailureReport,
  outcome: MultipartCompletionFailureReportOutcome,
): MultipartCompletionFailureReportResult {
  return {
    failureEventId: report.failureEventId,
    outcome,
  };
}

async function deliverFailureReportWithConfirmation(
  report: ClaimedMultipartCompletionFailureReport,
  input: MultipartCompletionFailureReportBatchInput,
  dependencies: MultipartCompletionFailureReportProcessorDependencies,
): Promise<MultipartCompletionFailureReportResult> {
  try {
    await dependencies.deliverReportFn(
      report,
      input.deadlineAtMs,
      input.reportTerminalFailure,
    );
    return failureReportResult(report, "reported");
  } catch (error) {
    if (error instanceof MultipartCompletionFailureReportLeaseLostError) {
      return failureReportResult(report, "lease_lost");
    }
    if (error instanceof DatabaseCommitOutcomeUnknownError) {
      try {
        await dependencies.finishReportFn(report, input.deadlineAtMs);
        return failureReportResult(report, "reported");
      } catch (confirmationError) {
        if (
          confirmationError instanceof MultipartCompletionFailureReportLeaseLostError
        ) {
          return failureReportResult(report, "lease_lost");
        }
        if (
          input.signal.aborted
          || confirmationError instanceof DatabaseDeadlineExceededError
          || confirmationError instanceof DatabaseCommitOutcomeUnknownError
          || confirmationError instanceof TransientDatabaseHttpError
          || isTransientDatabaseError(confirmationError)
        ) {
          return failureReportResult(report, "ambiguous");
        }
        throw confirmationError;
      }
    }
    if (
      input.signal.aborted
      || error instanceof DatabaseDeadlineExceededError
      || error instanceof TransientDatabaseHttpError
      || isTransientDatabaseError(error)
    ) {
      return failureReportResult(report, "ambiguous");
    }
    throw error;
  }
}

export async function processClaimedMultipartCompletionFailureReportWithDependencies(
  report: ClaimedMultipartCompletionFailureReport,
  input: MultipartCompletionFailureReportBatchInput,
  dependencies: MultipartCompletionFailureReportProcessorDependencies,
): Promise<MultipartCompletionFailureReportResult> {
  requireClaimedFailureReport(report);
  input.signal.throwIfAborted();
  return deliverFailureReportWithConfirmation(
    report,
    input,
    dependencies,
  );
}

function countFailureReportOutcome(
  results: ReadonlyArray<MultipartCompletionFailureReportResult>,
  outcome: MultipartCompletionFailureReportOutcome,
): number {
  return results.filter((item) => item.outcome === outcome).length;
}

function toFailureReportBatchResult(
  results: ReadonlyArray<MultipartCompletionFailureReportResult>,
): MultipartCompletionFailureReportBatchResult {
  return {
    claimed: results.length,
    ambiguous: countFailureReportOutcome(results, "ambiguous"),
    leaseLost: countFailureReportOutcome(results, "lease_lost"),
    reported: countFailureReportOutcome(results, "reported"),
    results,
  };
}

export class MultipartCompletionFailureReportBatchError extends Error {
  constructor(
    readonly partialResult: MultipartCompletionFailureReportBatchResult,
    cause: unknown,
  ) {
    super(
      "Multipart completion failure-report batch failed after processing one or more reports.",
      { cause },
    );
    this.name = "MultipartCompletionFailureReportBatchError";
  }
}

export async function runMultipartCompletionFailureReportBatchWithDependencies(
  input: MultipartCompletionFailureReportBatchInput,
  dependencies: MultipartCompletionFailureReportProcessorDependencies,
): Promise<MultipartCompletionFailureReportBatchResult> {
  const results: Array<MultipartCompletionFailureReportResult> = [];
  try {
    while (
      results.length < input.maximumReports
      && input.signal.aborted === false
      && dependencies.nowFn() + minimumNewJobBudgetMs < input.deadlineAtMs
    ) {
      const claimed = await dependencies.claimReportsFn({
        leaseOwner: input.leaseOwner,
        leaseDurationMs: input.leaseDurationMs,
        limit: 1,
        deadlineAtMs: input.deadlineAtMs,
      });
      const report = claimed[0];
      if (report === undefined) break;
      results.push(
        await processClaimedMultipartCompletionFailureReportWithDependencies(
          report,
          input,
          dependencies,
        ),
      );
    }
  } catch (error) {
    throw new MultipartCompletionFailureReportBatchError(
      toFailureReportBatchResult(results),
      error,
    );
  }
  return toFailureReportBatchResult(results);
}

const defaultFailureReportDependencies:
MultipartCompletionFailureReportProcessorDependencies = {
  claimReportsFn: claimMultipartCompletionFailureReports,
  deliverReportFn: deliverMultipartCompletionFailureReport,
  finishReportFn: finishMultipartCompletionFailureReport,
  nowFn: Date.now,
};

export async function runMultipartCompletionFailureReportBatch(
  input: MultipartCompletionFailureReportBatchInput,
): Promise<MultipartCompletionFailureReportBatchResult> {
  return runMultipartCompletionFailureReportBatchWithDependencies(
    input,
    defaultFailureReportDependencies,
  );
}
