import type { AgentSqlSurface } from "../../../aiTools/agentSql/shared";
import type { EventByAction } from "./common";

export type AdminQueryDetails = Readonly<{
  adminEmail: string;
  statementCount: number;
  durationMs: number;
  success: boolean;
  sqlFingerprint: string;
}>;

/**
 * One record per agent SQL execution, emitted on success and on failure by
 * every surface (`chat-tool`, `agent-rest`, `mcp`). `succeeded` is the
 * denominator the failure ratio is computed from, and `errorCode` /
 * `dialectReason` are the aggregable causes. `dialectReason` is the first
 * validation-issue code carried by the failure, recorded as an opaque value:
 * the dialect owns that vocabulary and may change it.
 *
 * `resultChars` and `rowsOmitted` describe the emitted result: the size the
 * result-size budget measured for the payload the surface really sent, and
 * whether that payload is a committed write whose rows the budget dropped. Both
 * are null on failure, and `resultChars` is null on the `chat-tool` surface,
 * which builds no agent envelope to measure.
 *
 * Raw SQL text is deliberately absent; `sqlFingerprint` plus `sqlLength` are
 * what make repeated failures groupable, matching `AdminQueryDetails`.
 *
 * The error message is deliberately absent too: dialect errors quote the
 * offending SQL fragment verbatim, so the message carries flashcard content that
 * no delimiter heuristic can strip reliably. Unexpected failures still reach
 * Sentry with their full message and stack through `captureBackendException`.
 */
export type AgentSqlDetails = Readonly<{
  surface: AgentSqlSurface;
  caller: string | null;
  connectionId: string;
  succeeded: boolean;
  statementType: string | null;
  resource: string | null;
  statementCount: number | null;
  rowOrAffectedCount: number | null;
  resultChars: number | null;
  rowsOmitted: boolean | null;
  durationMs: number;
  sqlLength: number;
  sqlFingerprint: string;
  errorCode: string | null;
  dialectReason: string | null;
  errorClass: string | null;
}>;

export type GlobalMetricsSnapshotGeneratedDetails = Readonly<{
  bucketName: string;
  objectKey: string;
  generatedAtUtc: string;
  asOfUtc: string;
  from: string;
  to: string;
  uniqueReviewingUsers: number;
  reviewEvents: number;
}>;

export type GlobalMetricsSnapshotFailureDetails = Readonly<{
  bucketName: string | null;
  objectKey: string | null;
  message: string;
}>;

export type CommunityLeaderboardSnapshotGeneratedDetails = Readonly<{
  metricVersion: string;
  generatedAtUtc: string;
  asOfServerHourUtc: string;
  windowCount: number;
}>;

export type CommunityLeaderboardSnapshotFailureDetails = Readonly<{
  metricVersion: string;
  message: string;
}>;

export type StreakLeaderboardSnapshotGeneratedDetails = Readonly<{
  metricVersion: string;
  generatedAtUtc: string;
  asOfUtcDate: string;
  snapshotId: string;
  pagesScanned: number;
  participantsScanned: number;
  entryCount: number;
}>;

export type StreakLeaderboardSnapshotFailureDetails = Readonly<{
  metricVersion: string;
  message: string;
}>;

export type ProgressActiveDaysBackfillCompletedDetails = Readonly<{
  batchSize: number;
  maxPages: number;
  pagesScanned: number;
  usersScanned: number;
  usersMaterialized: number;
  reviewEventsMaterialized: number;
  activeReviewDaysUpserted: number;
  skippedUsers: number;
  errors: number;
  finished: boolean;
}>;

export type ProgressActiveDaysBackfillCandidateFailureDetails = Readonly<{
  userId: string;
  workspaceId: string;
  progressTimeZone: string;
  missingReviewLocalDateCount: number;
  missingActiveReviewDayCount: number;
  errorClass: string;
  errorMessage: string;
}>;

export type ProgressActiveDaysBackfillFailureDetails = Readonly<{
  batchSize: number | null;
  maxPages: number | null;
  message: string;
}>;

export type GeneratedMediaPromotionBatchDetails = Readonly<{
  maximumJobs: number; claimed: number; applied: number; ambiguous: number;
  failed: number; interrupted: number; leaseLost: number; rescheduled: number;
  results: ReadonlyArray<Readonly<{
    jobId: string; outcome: string; retryCount: number; errorCode: string | null;
  }>>;
}>;

export type MediaBlobCleanupBatchDetails = Readonly<{
  maximumCandidates: number;
  claimed: number;
  deleted: number;
  notFound: number;
  blocked: number;
  stale: number;
  alreadyCompleted: number;
  retryScheduled: number;
  reconciliationRequired: number;
  interrupted: number;
  results: ReadonlyArray<Readonly<{
    sha256: string;
    cleanupGeneration: number;
    outcome: string;
  }>>;
}>;

export type MediaBlobCleanupRetryDetails = Readonly<{
  phase:
    | "claim"
    | "authorize"
    | "renew"
    | "head_object"
    | "delete_object"
    | "complete"
    | "record_failure";
  attempt: number;
  maxAttempts: number;
  sha256: string | null;
  cleanupGeneration: number | null;
  statusCode: number | null;
  errorCode: string | null;
  errorClass: string;
}>;

export type MediaBlobCleanupFailureRecordedDetails = Readonly<{
  phase: "authorize" | "renew" | "head_object" | "delete_object" | "complete";
  disposition: "retry" | "terminal";
  status: "retry_scheduled" | "reconciliation_required" | "completed" | "stale";
  sha256: string;
  cleanupGeneration: number;
  failureCount: number;
  nextAttemptAt: string | null;
  errorCode: string;
  errorClass: string;
}>;

export type MultipartCompletionFailureReportBatchDetails = Readonly<{
  maximumReports: number;
  claimed: number;
  ambiguous: number;
  leaseLost: number;
  reported: number;
  results: ReadonlyArray<Readonly<{
    failureEventId: string;
    outcome: string;
  }>>;
}>;

export type MultipartCompletionReconciliationBatchDetails = Readonly<{
  maximumJobs: number; claimed: number; applied: number; ambiguous: number;
  failed: number; interrupted: number; leaseLost: number; rescheduled: number;
  results: ReadonlyArray<Readonly<{
    attemptToken: string; outcome: string; retryCount: number;
    errorCode: string | null;
  }>>;
  failureReports: MultipartCompletionFailureReportBatchDetails;
}>;

export type MultipartCompletionReconciliationTerminalFailureDetails =
  Readonly<{
    failureEventId: string;
    attemptToken: string;
    workspaceId: string;
    retryCount: number;
    errorCode: string;
    deliveryAttempt: number;
  }>;

export type DatabaseTransientRetryDetails = Readonly<{
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  sqlState: string | null;
  errorCode: string | null;
  errorClass: string;
  errorMessage: string;
}>;

export type DatabasePoolErrorDetails = Readonly<{
  poolName: string;
  sqlState: string | null;
  errorCode: string | null;
  errorClass: string;
  errorMessage: string;
}>;

export type DatabaseRollbackFailureDetails = Readonly<{
  originalSqlState: string | null;
  originalErrorCode: string | null;
  originalErrorClass: string;
  originalErrorMessage: string;
  rollbackSqlState: string | null;
  rollbackErrorCode: string | null;
  rollbackErrorClass: string;
  rollbackErrorMessage: string;
}>;

export type GlobalMetricsS3RetryDetails = Readonly<{
  operation: "get_object" | "put_object";
  attempt: number;
  maxAttempts: number;
  bucketName: string;
  objectKey: string;
  statusCode: number | null;
  errorClass: string;
  errorMessage: string;
}>;

export type MediaAssetStorageRetryDetails = Readonly<{
  operation:
    | "create_presigned_upload"
    | "create_presigned_download"
    | "create_multipart_upload"
    | "create_presigned_part_upload"
    | "complete_multipart_upload"
    | "abort_multipart_upload"
    | "list_multipart_upload_parts"
    | "head_object"
    | "get_object"
    | "copy_object"
    | "put_object";
  attempt: number;
  maxAttempts: number;
  workspaceId: string | null;
  mediaAssetId: string | null;
  statusCode: number | null;
  errorClass: string;
}>;

export type MediaAssetStorageTerminalDetails = Readonly<{
  operation: MediaAssetStorageRetryDetails["operation"];
  workspaceId: string;
  mediaAssetId: string;
  statusCode: number | null;
  errorClass: string;
  awsRequestId: string | null;
  awsExtendedRequestId: string | null;
}>;

export type FeedbackEmailRetryDetails = Readonly<{
  feedbackSubmissionId: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorClass: string;
  errorMessage: string;
  statusCode: number | null;
  responseBody: string | null;
}>;

export type FeedbackEmailFailureDetails = Readonly<{
  feedbackSubmissionId: string;
  errorClass: string;
  errorMessage: string;
}>;

export type MigrationFailureDetails = Readonly<{
  migrationSurface: "lambda";
  operation: "run_migrations";
  message: string;
}>;

export type OperationsBreadcrumbEvent =
  | EventByAction<"admin_query", AdminQueryDetails>
  | EventByAction<"agent_sql", AgentSqlDetails>
  | EventByAction<"global_metrics_snapshot_generated", GlobalMetricsSnapshotGeneratedDetails>
  | EventByAction<"community_leaderboard_snapshot_generated", CommunityLeaderboardSnapshotGeneratedDetails>
  | EventByAction<"streak_leaderboard_snapshot_generated", StreakLeaderboardSnapshotGeneratedDetails>
  | EventByAction<"progress_active_days_backfill_completed", ProgressActiveDaysBackfillCompletedDetails>
  | EventByAction<"generated_media_promotion_batch_completed", GeneratedMediaPromotionBatchDetails>
  | EventByAction<"media_blob_cleanup_batch_completed", MediaBlobCleanupBatchDetails>
  | EventByAction<"media_blob_cleanup_retry", MediaBlobCleanupRetryDetails>
  | EventByAction<"media_blob_cleanup_failure_recorded", MediaBlobCleanupFailureRecordedDetails>
  | EventByAction<"multipart_completion_reconciliation_batch_completed", MultipartCompletionReconciliationBatchDetails>
  | EventByAction<"multipart_completion_reconciliation_job_terminally_failed", MultipartCompletionReconciliationTerminalFailureDetails>
  | EventByAction<"database_transient_retry", DatabaseTransientRetryDetails>
  | EventByAction<"global_metrics_s3_retry", GlobalMetricsS3RetryDetails>
  | EventByAction<"media_asset_storage_retry", MediaAssetStorageRetryDetails>
  | EventByAction<"media_asset_storage_terminal", MediaAssetStorageTerminalDetails>;

export type OperationsWarningEvent =
  | (EventByAction<"global_snapshot_error", Readonly<{
    statusCode: number;
    code: string | null;
    storageErrorMessage: string;
  }>> & Readonly<{ message: string }>)
  | EventByAction<"unsafe_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | EventByAction<"database_pool_error", DatabasePoolErrorDetails>
  | EventByAction<"feedback_notification_email_retry", FeedbackEmailRetryDetails>
  | EventByAction<"feedback_notification_email_failed", FeedbackEmailFailureDetails>
  | EventByAction<"reporting_read_only_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | (EventByAction<
    "progress_active_days_backfill_candidate_failed",
    ProgressActiveDaysBackfillCandidateFailureDetails
  > & Readonly<{ message: string }>);

export type OperationsExceptionEvent =
  | (EventByAction<"global_metrics_snapshot_failed", GlobalMetricsSnapshotFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"community_leaderboard_snapshot_failed", CommunityLeaderboardSnapshotFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"streak_leaderboard_snapshot_failed", StreakLeaderboardSnapshotFailureDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"progress_active_days_backfill_failed", ProgressActiveDaysBackfillFailureDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"generated_media_promotion_batch_failed", GeneratedMediaPromotionBatchDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"media_blob_cleanup_batch_failed", MediaBlobCleanupBatchDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"multipart_completion_reconciliation_batch_failed", MultipartCompletionReconciliationBatchDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"migration_failed", MigrationFailureDetails> & Readonly<{ error: Error }>);
