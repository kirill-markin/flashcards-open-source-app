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

/**
 * One record per authenticated `/mcp` request, emitted whatever the request
 * turned out to be -- a transport response, a transport fault, or the 405 that
 * rejects a non-POST request -- so protocol traffic (`initialize`,
 * `tools/list`), non-SQL tools, and requests that never reach the transport are
 * visible instead of being invisible between the `agent_sql` records. The scope
 * `requestId` is what joins this record to the `agent_sql` records the SQL tools
 * emit underneath it.
 *
 * `protocolVersion` and `jsonRpcMethod` come from the `MCP-Protocol-Version`
 * and `Mcp-Method` request headers, so both are null when the client sends
 * them empty or not at all (`Mcp-Method` is only REQUIRED from MCP revision
 * 2026-07-28). `toolName` is observed in process from the tool handler, so it
 * is present for a tool call regardless of the client's protocol revision, and
 * falls back to the client's unvalidated `Mcp-Name` header when no handler ran.
 *
 * No body content is carried: the transport owns the body, and tool arguments
 * and results carry flashcard content. `responseChars` is a length measured off
 * the response and never any of what it contains.
 */
export type McpRequestDetails = Readonly<{
  protocolVersion: string | null;
  jsonRpcMethod: string | null;
  toolName: string | null;
  caller: string | null;
  connectionId: string;
  statusCode: number;
  durationMs: number;
  responseChars: number | null;
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

export type CatalogDumpGeneratedDetails = Readonly<{
  bucketName: string;
  objectKey: string;
  sha256: string;
  generatedAt: string;
  byteLength: number;
  /** Admin route that triggered the rebuild, or `null` for a deploy-time seed. */
  triggerRoute: string | null;
}>;

export type CatalogDumpFailureDetails = Readonly<{
  bucketName: string | null;
  triggerRoute: string | null;
  message: string;
}>;

export type CatalogDumpRefreshFailureDetails = Readonly<{
  functionName: string | null;
  route: string;
  message: string;
}>;

/**
 * Emitted when `GET /v1/catalog` cannot read the pointer naming the current
 * immutable artifact and answers 503 instead of redirecting. Distinct from
 * `catalog_dump_failed`: that one is the builder failing to publish an
 * artifact, this one is the public route failing to serve the published one.
 */
export type CatalogSnapshotPointerErrorDetails = Readonly<{
  statusCode: number;
  code: string | null;
  storageErrorMessage: string;
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

/**
 * The one record the web guest reaper emits per run. `candidatesExamined` is the denominator the
 * other counters are read against: `deleted` plus `skipped` plus `failed` equals it, while
 * `interrupted` counts the candidates the run loaded but could not settle before its deadline,
 * including one whose own transaction ran out of time and rolled back. The `skipped*` counters are
 * the reasons, and each skipped guest also carries its own `web_guest_reaper_candidate_skipped`
 * record with its id, because most skips mean the invariant that a web guest workspace stays empty
 * broke somewhere else.
 *
 * `finished` is the saturation signal and the one field to alert on: `false` means the run stopped
 * on `maxPages` or on its deadline with candidates still waiting, so web guest rows are being
 * minted faster than this schedule reaps them and the accumulation the job exists to stop is still
 * running. No count on its own can distinguish that from a run that simply had a busy day, and such
 * a run is a successful invocation with no errors, so neither Lambda alarm sees it:
 * `WebGuestReaperSaturatedAlarm` in `infra/aws/lib/monitoring.ts` is the metric filter that does.
 *
 * `scanFailed` separates the two ways a run can end with `finished: false`. It means the run
 * stopped because a candidate scan threw, so the counters above cover only the pages it got
 * through, and its own `web_guest_reaper_scan_failed` record carries the error. Such a run reports
 * `finished: false` as well, because candidates really were left behind, so it raises the
 * saturation alarm too; it is also an errored invocation, because the entrypoint throws on this
 * flag after emitting this record.
 */
export type WebGuestReaperCompletedDetails = Readonly<{
  batchSize: number;
  maxPages: number;
  inactivityThresholdDays: number;
  inactiveBeforeUtc: string;
  pagesScanned: number;
  candidatesExamined: number;
  deleted: number;
  skipped: number;
  skippedWorkspaceHasContent: number;
  skippedWorkspaceNotSoleOwned: number;
  skippedWorkspaceMissing: number;
  skippedNoLongerCandidate: number;
  interrupted: number;
  failed: number;
  scanFailed: boolean;
  finished: boolean;
}>;

export type WebGuestReaperCandidateSkippedDetails = Readonly<{
  guestUserId: string;
  workspaceId: string | null;
  reason:
    | "workspace_has_content"
    | "workspace_not_sole_owned"
    | "workspace_missing"
    | "no_longer_a_candidate";
  lastActiveAtUtc: string;
}>;

export type WebGuestReaperCandidateFailureDetails = Readonly<{
  guestUserId: string;
  lastActiveAtUtc: string;
  errorClass: string;
  errorMessage: string;
}>;

/**
 * Why a run ended early with `scanFailed: true`. It is a warning rather than an exception because
 * the run itself continues to its completion record, which reports what it already deleted; the
 * entrypoint's `web_guest_reaper_failed` exception follows immediately after and is what the Lambda
 * error alarm sees.
 */
export type WebGuestReaperScanFailureDetails = Readonly<{
  pagesScanned: number;
  errorClass: string;
  errorMessage: string;
}>;

export type WebGuestReaperFailureDetails = Readonly<{
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

export type CatalogDumpS3RetryDetails = Readonly<{
  /** The retry helper is shared by the artifact write and the pointer read. */
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

// errorClass and errorMessage describe the database failure the analytics writer wrapped, not the
// wrapper: its own message is a fixed public string that would name every refused write the same.
// eventName is the first event of the batch that was refused, and eventCount is how many events went
// down with it, because the writer stores a batch or nothing. A producer that chunks an unbounded
// number of facts raises this for the chunk that was refused, so the count is what that chunk lost
// rather than everything the producer emitted; what the producer then did with the chunks it had not
// reached yet is reported separately below.
export type ProductAnalyticsServerEventWriteFailureDetails = Readonly<{
  eventName: string;
  eventCount: number;
  sqlState: string | null;
  errorClass: string;
  errorMessage: string;
}>;

// Raised when a chunking producer stopped a drain with chunks left that it chose not to attempt. It
// is a separate action from the write failure above because it means something the failure does not:
// those events were never handed to the writer at all, so no
// product_analytics_server_event_write_failed row accounts for them.
//
// The three counts partition everything the drain held, so a reader can see how much survived and
// how much did not without reconstructing it from chunk sizes.
export type ProductAnalyticsContentCreationDrainAbortedDetails = Readonly<{
  // Which stop rule fired, because the two ask for opposite responses. "writer_refused" means the
  // analytics writer turned a chunk down, so it is degraded or down and the failure below is the
  // thing to read. "budget_exhausted" means every chunk it was handed was stored and the drain ran
  // out of the wall clock its request could spare, so analytics is healthy and the drain was simply
  // too large for one request - the answer there is a smaller transaction or a queue, not a writer
  // fix.
  reason: "writer_refused" | "budget_exhausted";
  // Stored by the chunks that succeeded before the stop. Already committed and not at risk.
  storedEventCount: number;
  // The refused chunk itself, reported with its error by the write failure above. Always zero on a
  // "budget_exhausted" stop, which has no failed chunk and therefore no paired write failure: the
  // scope's workspace there names the first creation the drain did not reach.
  failedEventCount: number;
  // Never attempted. The drain stopped instead of paying the analytics timeouts once per remaining
  // chunk, because that cost lands after the product transaction committed and can push the request
  // past the API Gateway integration timeout.
  skippedEventCount: number;
}>;

export type ProductAnalyticsIdentityLinkWriteFailureDetails = Readonly<{
  source: string;
  sqlState: string | null;
  errorClass: string;
  errorMessage: string;
}>;

// A deliberate skip, not a dropped write: the install committed and no catalog_deck_installed row
// was attempted, because the package slug the event has to carry could not be read. It is reported
// under its own action so it never looks like product_analytics_server_event_write_failed, which
// means the opposite - a row that was attempted and rejected.
export type CatalogDeckInstalledAnalyticsSkippedDetails = Readonly<{
  packageId: string;
  installId: string;
  reason: "catalog_package_row_missing" | "catalog_package_slug_read_failed";
  errorClass: string | null;
  errorMessage: string | null;
}>;

// A deliberate skip, not a dropped write: the acceptance committed and neither friendship_created
// row was attempted, because the directed community.friendships row both events are derived from
// could not be read. Reported under its own action so it never looks like
// product_analytics_server_event_write_failed, which means the opposite - a row that was attempted
// and rejected. friendship_row_read_failed is the savepoint-guarded read failing; the error fields
// are null for friendship_row_missing, where the read succeeded and returned nothing.
export type FriendshipCreatedAnalyticsSkippedDetails = Readonly<{
  reason: "friendship_row_missing" | "friendship_row_read_failed";
  sqlState: string | null;
  errorClass: string | null;
  errorMessage: string | null;
}>;

export type MigrationFailureDetails = Readonly<{
  migrationSurface: "lambda";
  operation: "run_migrations";
  message: string;
}>;

export type OperationsBreadcrumbEvent =
  | EventByAction<"admin_query", AdminQueryDetails>
  | EventByAction<"agent_sql", AgentSqlDetails>
  | EventByAction<"mcp_request", McpRequestDetails>
  | EventByAction<"global_metrics_snapshot_generated", GlobalMetricsSnapshotGeneratedDetails>
  | EventByAction<"catalog_dump_generated", CatalogDumpGeneratedDetails>
  | EventByAction<"community_leaderboard_snapshot_generated", CommunityLeaderboardSnapshotGeneratedDetails>
  | EventByAction<"streak_leaderboard_snapshot_generated", StreakLeaderboardSnapshotGeneratedDetails>
  | EventByAction<"progress_active_days_backfill_completed", ProgressActiveDaysBackfillCompletedDetails>
  | EventByAction<"web_guest_reaper_completed", WebGuestReaperCompletedDetails>
  | EventByAction<"generated_media_promotion_batch_completed", GeneratedMediaPromotionBatchDetails>
  | EventByAction<"media_blob_cleanup_batch_completed", MediaBlobCleanupBatchDetails>
  | EventByAction<"media_blob_cleanup_retry", MediaBlobCleanupRetryDetails>
  | EventByAction<"media_blob_cleanup_failure_recorded", MediaBlobCleanupFailureRecordedDetails>
  | EventByAction<"multipart_completion_reconciliation_batch_completed", MultipartCompletionReconciliationBatchDetails>
  | EventByAction<"multipart_completion_reconciliation_job_terminally_failed", MultipartCompletionReconciliationTerminalFailureDetails>
  | EventByAction<"database_transient_retry", DatabaseTransientRetryDetails>
  | EventByAction<"global_metrics_s3_retry", GlobalMetricsS3RetryDetails>
  | EventByAction<"catalog_dump_s3_retry", CatalogDumpS3RetryDetails>
  | EventByAction<"media_asset_storage_retry", MediaAssetStorageRetryDetails>
  | EventByAction<"media_asset_storage_terminal", MediaAssetStorageTerminalDetails>;

export type OperationsWarningEvent =
  | (EventByAction<"global_snapshot_error", Readonly<{
    statusCode: number;
    code: string | null;
    storageErrorMessage: string;
  }>> & Readonly<{ message: string }>)
  | (EventByAction<"catalog_snapshot_pointer_error", CatalogSnapshotPointerErrorDetails>
    & Readonly<{ message: string }>)
  | EventByAction<"unsafe_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | EventByAction<"database_pool_error", DatabasePoolErrorDetails>
  | EventByAction<"feedback_notification_email_retry", FeedbackEmailRetryDetails>
  | EventByAction<"feedback_notification_email_failed", FeedbackEmailFailureDetails>
  | EventByAction<"reporting_read_only_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | EventByAction<"product_analytics_server_event_write_failed", ProductAnalyticsServerEventWriteFailureDetails>
  | EventByAction<"product_analytics_content_creation_drain_aborted", ProductAnalyticsContentCreationDrainAbortedDetails>
  | EventByAction<"product_analytics_identity_link_write_failed", ProductAnalyticsIdentityLinkWriteFailureDetails>
  | EventByAction<"catalog_deck_installed_analytics_skipped", CatalogDeckInstalledAnalyticsSkippedDetails>
  | EventByAction<"friendship_created_analytics_skipped", FriendshipCreatedAnalyticsSkippedDetails>
  | (EventByAction<
    "progress_active_days_backfill_candidate_failed",
    ProgressActiveDaysBackfillCandidateFailureDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "web_guest_reaper_candidate_skipped",
    WebGuestReaperCandidateSkippedDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "web_guest_reaper_candidate_failed",
    WebGuestReaperCandidateFailureDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "web_guest_reaper_scan_failed",
    WebGuestReaperScanFailureDetails
  > & Readonly<{ message: string }>);

export type OperationsExceptionEvent =
  | (EventByAction<"global_metrics_snapshot_failed", GlobalMetricsSnapshotFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"catalog_dump_failed", CatalogDumpFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"catalog_dump_refresh_failed", CatalogDumpRefreshFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"community_leaderboard_snapshot_failed", CommunityLeaderboardSnapshotFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"streak_leaderboard_snapshot_failed", StreakLeaderboardSnapshotFailureDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"progress_active_days_backfill_failed", ProgressActiveDaysBackfillFailureDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"web_guest_reaper_failed", WebGuestReaperFailureDetails> & Readonly<{
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
