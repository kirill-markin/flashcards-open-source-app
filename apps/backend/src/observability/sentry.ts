import type { Handler, StreamifyHandler } from "aws-lambda";
import * as Sentry from "@sentry/aws-serverless";
import {
  sanitizeBackendTelemetryValue,
  type SanitizedTelemetryValue,
} from "./sanitizer";

export type BackendService =
  | "backend-api"
  | "chat-worker"
  | "chat-live"
  | "global-metrics-snapshot"
  | "migration";

export type BackendObservationScope = Readonly<{
  service: BackendService;
  requestId: string | null;
  route: string | null;
  method: string | null;
  userId: string | null;
  workspaceId: string | null;
  chatRequestId: string | null;
  runId: string | null;
  sessionId: string | null;
}>;

export type BackendTraceCarrier = Readonly<{
  sentryTrace: string | null;
  baggage: string | null;
}>;

export type BackendValidationIssueDetail = Readonly<{
  path: string;
  code: string;
}>;

export type BackendErrorLogDetails = Readonly<{
  errorClass: string;
  errorMessage: string;
  errorStack: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
}>;

export type BackendFailureDetails = Readonly<{
  statusCode: number;
  code: string | null;
  message: string | null;
  validationIssues: ReadonlyArray<BackendValidationIssueDetail>;
}>;

export type RequestErrorDetails = BackendFailureDetails & BackendErrorLogDetails & Readonly<{
  sqlState: string | null;
}>;

export type BackendDatabaseDetails = Readonly<{
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  detail: string | null;
}>;

export type BackendSyncConflictDetails = Readonly<{
  syncConflictPhase: string | null;
  syncConflictEntityType: "card" | "deck" | "review_event" | null;
  syncConflictEntityId: string | null;
  conflictingWorkspaceId: string | null;
  constraint: string | null;
  sqlState: string | null;
  table: string | null;
  entryIndex: number | null;
  reviewEventIndex: number | null;
  syncConflictRecoverable: boolean | null;
}>;

export type EmptyDetails = Readonly<{
  ok: true;
}>;

export type AdminQueryDetails = Readonly<{
  adminEmail: string;
  statementCount: number;
  durationMs: number;
  success: boolean;
  sqlFingerprint: string;
}>;

export type SyncPushDetails = Readonly<{
  statusCode: number;
  installationId: string;
  platform: string;
  appVersion: string | null;
  operationsCount: number;
  entityTypes: ReadonlyArray<string>;
}>;

export type SyncPullDetails = Readonly<{
  statusCode: number;
  installationId: string | null;
  platform: string | null;
  appVersion: string | null;
  afterHotChangeId: number | null;
  nextHotChangeId: number | null;
  changesCount: number | null;
}>;

export type SyncBootstrapDetails = Readonly<{
  statusCode: number;
  installationId: string;
  platform: string;
  appVersion: string | null;
  mode: string;
}>;

export type SyncReviewHistoryPullDetails = Readonly<{
  statusCode: number;
  installationId: string | null;
  platform: string | null;
  appVersion: string | null;
  afterReviewSequenceId: number | null;
  nextReviewSequenceId: number | null;
  reviewEventsCount: number | null;
}>;

export type SyncReviewHistoryImportDetails = Readonly<{
  statusCode: number;
  installationId: string;
  platform: string;
  appVersion: string | null;
  reviewEventsCount: number;
  importedCount: number | null;
  duplicateCount: number | null;
}>;

export type ProgressSummaryDetails = Readonly<{
  statusCode: number;
  authTransport: string;
  timeZone: string | null;
  currentStreakDays: number | null;
  hasReviewedToday: boolean | null;
  lastReviewedOn: string | null;
  activeReviewDays: number | null;
  generatedAt: string | null;
}>;

export type ProgressReviewScheduleDetails = Readonly<{
  statusCode: number;
  authTransport: string;
  timeZone: string | null;
  bucketCount: number | null;
  totalCards: number | null;
  generatedAt: string | null;
}>;

export type ProgressSeriesDetails = Readonly<{
  statusCode: number;
  authTransport: string;
  timeZone: string | null;
  from: string | null;
  to: string | null;
  returnedDayCount: number | null;
  hasNonZeroReviewDays: boolean | null;
  generatedAt: string | null;
}>;

export type AccountDeleteDetails = Readonly<{
  statusCode: number;
  transport: string;
}>;

export type WorkspaceTagsListDetails = Readonly<{
  statusCode: number;
  tagsCount: number | null;
  totalCards: number | null;
}>;

export type CardsQueryDetails = Readonly<{
  statusCode: number;
  limit: number;
  sortsCount: number;
  hasSearch: boolean;
  hasFilter: boolean;
  resultsCount: number | null;
  totalCount: number | null;
  hasMore: boolean | null;
}>;

export type GuestUpgradeCompleteDetails = Readonly<{
  statusCode: number;
  selectionType: string;
  guestWorkspaceSyncedAndOutboxDrained: boolean;
  requiresGuestWorkspaceSyncedAndOutboxDrained: boolean;
  supportsDroppedEntities: boolean;
  targetSubjectUserId: string;
  guestSessionId: string | null;
  targetUserId: string | null;
  targetWorkspaceId: string | null;
  completionKind: string | null;
}>;

export type ResetInvalidFsrsStateDetails = Readonly<{
  workspaceId: string;
  cardId: string;
  reason: string;
  repair: "reset";
}>;

export type GuestMergeDropThirdWorkspaceConflictDetails = Readonly<{
  entityType: "card" | "deck" | "review_event";
  entityId: string;
  sourceGuestWorkspaceId: string;
  targetWorkspaceId: string;
  conflictingWorkspaceId: string;
  resolution: "drop_guest_entity";
}>;

export type GuestMergeDropReviewEventMissingTargetCardDetails = Readonly<{
  reviewEventId: string;
  cardId: string;
  sourceGuestWorkspaceId: string;
  targetWorkspaceId: string;
  resolution: "drop_guest_entity";
}>;

export type GuestUpgradeCompleteSuspiciousDetails = Readonly<{
  reason:
    | "deleted_session_subject_mismatch"
    | "revoked_session_without_history"
    | "revoked_session_subject_mismatch";
  guestSessionId: string | null;
  targetSubjectUserId: string;
  historyTargetSubjectUserId: string | null;
}>;

export type WorkspacesListDetails = Readonly<{
  statusCode: number;
  selectedWorkspaceId: string | null;
  workspacesCount: number | null;
  limit: number | null;
  hasNextCursor: boolean | null;
}>;

export type WorkspaceIdDetails = Readonly<{
  statusCode: number;
}>;

export type WorkspaceDeletePreviewDetails = Readonly<{
  statusCode: number;
  cardsCount: number | null;
}>;

export type WorkspaceDeleteDetails = Readonly<{
  statusCode: number;
  deletedCardsCount: number | null;
  nextWorkspaceId: string | null;
}>;

export type WorkspaceResetProgressPreviewDetails = Readonly<{
  statusCode: number;
  cardsCount: number | null;
}>;

export type WorkspaceResetProgressDetails = Readonly<{
  statusCode: number;
  cardsResetCount: number | null;
}>;

export type WorkspaceTransactionDetails = Readonly<{
  userId: string;
  workspaceId: string;
  stage: string | null;
  code: string | null;
  cardsResetCount: number | null;
  memberCount: number | null;
  selectedWorkspaceIdBeforeDelete: string | null;
  selectedWorkspaceIdAfterPreparation: string | null;
  deletedCardsCount: number | null;
}> & BackendDatabaseDetails;

export type ChatLiveRequestDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string | null;
  runId: string | null;
  afterCursor: string | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  code: string | null;
  message: string | null;
}>;

export type ChatLiveAttachDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string;
  runId: string;
  afterCursor: number | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
}>;

export type ChatLiveStreamCrashDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string;
  runId: string;
  afterCursor: number | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
}>;

export type ChatLiveBootstrapFailureDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string | null;
  runId: string | null;
  afterCursor: string | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  code: string;
  message: string;
}>;

export type ChatLiveLifecycleDetails = Readonly<{
  afterCursor: number | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  connectionDurationMs: number | null;
  terminationReason: string | null;
  closeReason: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
}>;

export type ChatWorkerLifecycleDetails = Readonly<{
  lambdaRequestId: string | null;
  abortReason: string | null;
  signalAborted: boolean;
  cancellationRequested: boolean;
  ownershipLost: boolean;
  runStatus: string | null;
  sessionState: string | null;
  providerErrorClass: string | null;
  providerErrorMessage: null;
  providerErrorStatus?: number | null;
  providerErrorCode?: string | null;
  providerErrorCategory?: string | null;
  providerRequestId: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: string | null;
}>;

export type ChatWorkerDispatchFailureDetails = Readonly<{
  message: string;
}>;

export type ChatWorkerFailureDetails = Readonly<{
  lambdaRequestId: string | null;
  routeRequestId: string | null;
  chatRequestId: string | null;
  runId: string;
  sessionId: string | null;
  userId: string;
  workspaceId: string;
  statusCode: number | null;
  code: string | null;
  message: string;
}>;

export type ChatTranscriptionFailureDetails = Readonly<{
  requestId: string;
  sessionId: string;
  source: "android" | "ios" | "web";
  provider: "openai";
  fileSize: number;
  fileExtension: string | null;
  mediaType: string;
  upstreamStatus: number | null;
  upstreamRequestId: string | null;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseTelemetryFlushFailureDetails = Readonly<{
  errorClass: string;
  errorMessage: string;
  telemetryStarted: boolean;
  hasTracerProvider: boolean;
}>;

export type LangfuseChatTurnExportFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  turnIndex: number;
  runState: string;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseChatTurnStartFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  turnIndex: number;
  runState: string;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseChatTranscriptionExportFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  sessionId: string;
  source: string;
  fileExtension: string | null;
  mediaType: string;
  fileSize: number;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseChatTranscriptionStartFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  sessionId: string;
  source: string;
  fileExtension: string | null;
  mediaType: string;
  fileSize: number;
  errorClass: string;
  errorMessage: string;
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

export type MigrationFailureDetails = Readonly<{
  migrationSurface: "lambda";
  operation: "run_migrations";
  message: string;
}>;

type EventByAction<Action extends string, Details> = Readonly<{
  action: Action;
  scope: BackendObservationScope;
  details: Details;
}>;

type FailureDetailsFor<Details> = Details & BackendFailureDetails;
type SyncConflictFailureDetailsFor<Details> = FailureDetailsFor<Details> & BackendSyncConflictDetails;

export type BackendBreadcrumbEvent =
  | EventByAction<"admin_query", AdminQueryDetails>
  | EventByAction<"request_error", RequestErrorDetails>
  | EventByAction<"global_metrics_snapshot_generated", GlobalMetricsSnapshotGeneratedDetails>
  | EventByAction<"database_transient_retry", DatabaseTransientRetryDetails>
  | EventByAction<"global_metrics_s3_retry", GlobalMetricsS3RetryDetails>
  | EventByAction<"sync_push", SyncPushDetails>
  | EventByAction<"sync_push_error", SyncConflictFailureDetailsFor<SyncPushDetails>>
  | EventByAction<"sync_pull", SyncPullDetails>
  | EventByAction<"sync_pull_error", FailureDetailsFor<SyncPullDetails>>
  | EventByAction<"sync_bootstrap", SyncBootstrapDetails>
  | EventByAction<"sync_bootstrap_error", SyncConflictFailureDetailsFor<SyncBootstrapDetails>>
  | EventByAction<"sync_review_history_pull", SyncReviewHistoryPullDetails>
  | EventByAction<"sync_review_history_pull_error", FailureDetailsFor<SyncReviewHistoryPullDetails>>
  | EventByAction<"sync_review_history_import", SyncReviewHistoryImportDetails>
  | EventByAction<"sync_review_history_import_error", SyncConflictFailureDetailsFor<SyncReviewHistoryImportDetails>>
  | EventByAction<"me_progress_summary", ProgressSummaryDetails>
  | EventByAction<"me_progress_summary_error", FailureDetailsFor<ProgressSummaryDetails>>
  | EventByAction<"me_progress_review_schedule", ProgressReviewScheduleDetails>
  | EventByAction<"me_progress_review_schedule_error", FailureDetailsFor<ProgressReviewScheduleDetails>>
  | EventByAction<"me_progress_series", ProgressSeriesDetails>
  | EventByAction<"me_progress_series_error", FailureDetailsFor<ProgressSeriesDetails>>
  | EventByAction<"account_delete", AccountDeleteDetails>
  | EventByAction<"account_delete_error", FailureDetailsFor<AccountDeleteDetails>>
  | EventByAction<"workspace_tags_list", WorkspaceTagsListDetails>
  | EventByAction<"workspace_tags_list_error", FailureDetailsFor<WorkspaceTagsListDetails>>
  | EventByAction<"cards_query", CardsQueryDetails>
  | EventByAction<"cards_query_error", FailureDetailsFor<CardsQueryDetails>>
  | EventByAction<"guest_upgrade_complete", GuestUpgradeCompleteDetails>
  | EventByAction<"guest_upgrade_complete_error", FailureDetailsFor<GuestUpgradeCompleteDetails>>
  | EventByAction<"workspaces_list", WorkspacesListDetails>
  | EventByAction<"workspaces_list_error", FailureDetailsFor<WorkspacesListDetails>>
  | EventByAction<"workspace_create", WorkspaceIdDetails>
  | EventByAction<"workspace_create_error", FailureDetailsFor<WorkspaceIdDetails>>
  | EventByAction<"workspace_select", WorkspaceIdDetails>
  | EventByAction<"workspace_select_error", FailureDetailsFor<WorkspaceIdDetails>>
  | EventByAction<"workspace_rename", WorkspaceIdDetails>
  | EventByAction<"workspace_rename_error", FailureDetailsFor<WorkspaceIdDetails>>
  | EventByAction<"workspace_delete_preview", WorkspaceDeletePreviewDetails>
  | EventByAction<"workspace_delete_preview_error", FailureDetailsFor<WorkspaceDeletePreviewDetails>>
  | EventByAction<"workspace_delete", WorkspaceDeleteDetails>
  | EventByAction<"workspace_delete_error", FailureDetailsFor<WorkspaceDeleteDetails>>
  | EventByAction<"workspace_reset_progress_preview", WorkspaceResetProgressPreviewDetails>
  | EventByAction<"workspace_reset_progress_preview_error", FailureDetailsFor<WorkspaceResetProgressPreviewDetails>>
  | EventByAction<"workspace_reset_progress", WorkspaceResetProgressDetails>
  | EventByAction<"workspace_reset_progress_error", FailureDetailsFor<WorkspaceResetProgressDetails>>
  | EventByAction<"workspace_create_transaction_error", WorkspaceTransactionDetails>
  | EventByAction<"workspace_delete_preview_transaction_error", WorkspaceTransactionDetails>
  | EventByAction<"workspace_reset_progress_preview_transaction_error", WorkspaceTransactionDetails>
  | EventByAction<"workspace_reset_progress_transaction_error", WorkspaceTransactionDetails>
  | EventByAction<"workspace_delete_transaction_error", WorkspaceTransactionDetails>
  | EventByAction<"chat_live_attach_start", ChatLiveAttachDetails>
  | EventByAction<"chat_live_request_error", ChatLiveRequestDetails>
  | EventByAction<"chat_live_client_disconnected", ChatLiveLifecycleDetails>
  | EventByAction<"chat_live_stream_closed", ChatLiveLifecycleDetails>
  | EventByAction<"chat_worker_skip", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_claimed", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_finish", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_abort_requested", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_provider_call_started", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_provider_call_aborted", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_transcription_invalid_audio", ChatTranscriptionFailureDetails>;

export type BackendWarningEvent =
  | (EventByAction<"global_snapshot_error", Readonly<{
    statusCode: number;
    code: string | null;
    storageErrorMessage: string;
  }>> & Readonly<{ message: string }>)
  | EventByAction<"unsafe_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | EventByAction<"database_pool_error", DatabasePoolErrorDetails>
  | EventByAction<"reporting_read_only_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | (EventByAction<"chat_live_backlog_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_live_write_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_transcription_failed", ChatTranscriptionFailureDetails> & Readonly<{ message: string }>)
  | EventByAction<"langfuse_telemetry_flush_failed", LangfuseTelemetryFlushFailureDetails>
  | EventByAction<"langfuse_chat_turn_export_failed", LangfuseChatTurnExportFailureDetails>
  | EventByAction<"langfuse_chat_turn_start_failed", LangfuseChatTurnStartFailureDetails>
  | EventByAction<"langfuse_chat_transcription_export_failed", LangfuseChatTranscriptionExportFailureDetails>
  | EventByAction<"langfuse_chat_transcription_start_failed", LangfuseChatTranscriptionStartFailureDetails>
  | (EventByAction<"chat_resume_contract_violation", Readonly<{
    path: string;
    method: string;
    resumeAttemptId: string | null;
    clientPlatform: string | null;
    clientVersion: string | null;
    violationReason: string;
    resolvedLiveCursor: string | null;
    snapshotRunState: string | null;
    latestAssistantItemId: string | null;
    latestAssistantItemOrder: number | null;
    latestAssistantState: string | null;
    inProgressAssistantItemId: string | null;
    inProgressAssistantItemOrder: number | null;
    terminationReason: string | null;
  }>> & Readonly<{ message: string }>)
  | (EventByAction<"reset_invalid_fsrs_state", ResetInvalidFsrsStateDetails> & Readonly<{ message: string }>)
  | (
    EventByAction<"guest_merge_drop_third_workspace_conflict", GuestMergeDropThirdWorkspaceConflictDetails>
    & Readonly<{ message: string }>
  )
  | (
    EventByAction<
      "guest_merge_drop_review_event_missing_target_card",
      GuestMergeDropReviewEventMissingTargetCardDetails
    >
    & Readonly<{ message: string }>
  )
  | (EventByAction<"guest_upgrade_complete_suspicious", GuestUpgradeCompleteSuspiciousDetails> & Readonly<{
    message: string;
  }>);

export type BackendExceptionEvent =
  | (EventByAction<"request_failed", BackendFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_push_error", SyncConflictFailureDetailsFor<SyncPushDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_pull_error", FailureDetailsFor<SyncPullDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_bootstrap_error", SyncConflictFailureDetailsFor<SyncBootstrapDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_review_history_pull_error", FailureDetailsFor<SyncReviewHistoryPullDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_review_history_import_error", SyncConflictFailureDetailsFor<SyncReviewHistoryImportDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_summary_error", FailureDetailsFor<ProgressSummaryDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_review_schedule_error", FailureDetailsFor<ProgressReviewScheduleDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_series_error", FailureDetailsFor<ProgressSeriesDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"account_delete_error", FailureDetailsFor<AccountDeleteDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_tags_list_error", FailureDetailsFor<WorkspaceTagsListDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"cards_query_error", FailureDetailsFor<CardsQueryDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"guest_upgrade_complete_error", FailureDetailsFor<GuestUpgradeCompleteDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspaces_list_error", FailureDetailsFor<WorkspacesListDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_create_error", FailureDetailsFor<WorkspaceIdDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_select_error", FailureDetailsFor<WorkspaceIdDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_rename_error", FailureDetailsFor<WorkspaceIdDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_delete_preview_error", FailureDetailsFor<WorkspaceDeletePreviewDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_delete_error", FailureDetailsFor<WorkspaceDeleteDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_reset_progress_preview_error", FailureDetailsFor<WorkspaceResetProgressPreviewDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_reset_progress_error", FailureDetailsFor<WorkspaceResetProgressDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_create_transaction_error", WorkspaceTransactionDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_delete_preview_transaction_error", WorkspaceTransactionDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_reset_progress_preview_transaction_error", WorkspaceTransactionDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_reset_progress_transaction_error", WorkspaceTransactionDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_delete_transaction_error", WorkspaceTransactionDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_worker_dispatch_failed", ChatWorkerDispatchFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_worker_failed", ChatWorkerFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"global_metrics_snapshot_failed", GlobalMetricsSnapshotFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"migration_failed", MigrationFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_bootstrap_failed", ChatLiveBootstrapFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_request_error", ChatLiveRequestDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_stream_crashed", ChatLiveStreamCrashDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_poll_failed", ChatLiveLifecycleDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails> & Readonly<{ error: Error }>);

type BackendLogEvent = BackendBreadcrumbEvent | BackendWarningEvent | BackendExceptionEvent;

type InitializeBackendSentryDependencies = Readonly<{
  init: (options: BackendSentryInitOptions) => void;
}>;

type BackendSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BackendSentryEvent = Parameters<NonNullable<BackendSentryInitOptions["beforeSend"]>>[0];
type BackendSentryEventHint = Parameters<NonNullable<BackendSentryInitOptions["beforeSend"]>>[1];
type BackendSentrySpan = Parameters<NonNullable<BackendSentryInitOptions["beforeSendSpan"]>>[0];
type BackendSentryTransactionEvent = Parameters<NonNullable<BackendSentryInitOptions["beforeSendTransaction"]>>[0];
type BackendSentryIntegration = ReturnType<typeof Sentry.honoIntegration>;
type BackendSentryIntegrationFactory = (
  defaultIntegrations: Array<BackendSentryIntegration>,
) => Array<BackendSentryIntegration>;
type BackendSentryContextData = Parameters<Sentry.Scope["setContext"]>[1];
type BackendSentryBreadcrumbData = NonNullable<Parameters<typeof Sentry.addBreadcrumb>[0]["data"]>;
type SentryExceptionValue = Readonly<Record<string, unknown>> & Readonly<{
  type?: unknown;
  value?: unknown;
}>;
type DatabaseExceptionDiagnostics = Readonly<{
  errorClass: string | null;
  errorCode: string | null;
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  errorMessage: string | null;
}>;

type BackendSentryConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
    enabled: true;
    dsn: string;
    environment: string;
    release: string;
    tracesSampleRate: number;
  }>;

const initializedServices = new Set<BackendService>();
let currentBackendService: BackendService | null = null;
const capturedExceptionSet = new WeakSet<Error>();
const normalizedNonErrorObjectMap = new WeakMap<object, Error>();
const normalizedNonErrorPrimitiveMap = new Map<NonErrorPrimitive, Error>();
const manualBackendCaptureTagName = "backend.manual_capture";
const manualBackendWarningCaptureTagName = "backend.manual_warning_capture";
const backendActionTagName = "backend.action";
const manualBackendCaptureTagValue = "true";
const disabledDefaultIntegrationNames = new Set<string>(["Postgres", "OpenAI"]);
const redactedExceptionTextValue = "<redacted-content>";
const exceptionTextFieldNames: ReadonlySet<string> = new Set([
  "errormessage",
  "errorstack",
  "errorvalue",
  "exceptionmessage",
  "exceptionvalue",
  "message",
  "providererrormessage",
  "rawstack",
  "stack",
  "value",
]);
const cloudWatchActionableExceptionTextFieldNames: ReadonlySet<string> = new Set([
  "errormessage",
  "errorstack",
]);
const nonSqlStateDatabaseErrorCodes: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);
let backendSentryInitializedForOpenTelemetry = false;

type NonErrorPrimitive = string | number | boolean | bigint | symbol | null | undefined;

function isAwsLambdaRuntime(env: NodeJS.ProcessEnv): boolean {
  return (env.AWS_EXECUTION_ENV ?? "").startsWith("AWS_Lambda_")
    || (env.AWS_LAMBDA_FUNCTION_NAME ?? "") !== "";
}

function readRequiredSentryValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required when backend Sentry is enabled`);
  }

  return value.trim();
}

function parseTraceSampleRate(rawValue: string): number {
  const tracesSampleRate = Number.parseFloat(rawValue);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1");
  }

  return tracesSampleRate;
}

export function getBackendSentryConfig(env: NodeJS.ProcessEnv): BackendSentryConfig {
  const dsn = env.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === "") {
    if (isAwsLambdaRuntime(env)) {
      throw new Error("SENTRY_DSN is required in AWS Lambda backend runtimes");
    }

    return { enabled: false };
  }

  return {
    enabled: true,
    dsn: dsn.trim(),
    environment: readRequiredSentryValue(env, "SENTRY_ENVIRONMENT"),
    release: readRequiredSentryValue(env, "SENTRY_RELEASE"),
    tracesSampleRate: parseTraceSampleRate(readRequiredSentryValue(env, "SENTRY_TRACES_SAMPLE_RATE")),
  };
}

function isManuallyCapturedSentryEvent(event: BackendSentryEvent): boolean {
  return event.tags?.[manualBackendCaptureTagName] === manualBackendCaptureTagValue;
}

function getManualBackendWarningMessage(event: BackendSentryEvent): string | null {
  if (event.tags?.[manualBackendWarningCaptureTagName] !== manualBackendCaptureTagValue) {
    return null;
  }

  if (typeof event.message !== "string") {
    return null;
  }

  return event.tags?.[backendActionTagName] === event.message ? event.message : null;
}

function shouldDropPreviouslyCapturedBackendException(
  event: BackendSentryEvent,
  hint: BackendSentryEventHint,
): boolean {
  if (isManuallyCapturedSentryEvent(event)) {
    return false;
  }

  const originalException = hint.originalException;
  return originalException instanceof Error && capturedExceptionSet.has(originalException);
}

function sanitizeSentryEvent(event: BackendSentryEvent, hint: BackendSentryEventHint): BackendSentryEvent | null {
  if (shouldDropPreviouslyCapturedBackendException(event, hint)) {
    return null;
  }

  const manualBackendWarningMessage = getManualBackendWarningMessage(event);
  const sanitizedEvent = sanitizeBackendTelemetryValue(redactExceptionTextFields(event)) as unknown as typeof event;
  const sanitizedEventWithDatabaseDiagnostics = restoreSentryDatabaseExceptionDiagnostics(
    event,
    sanitizedEvent,
    hint,
  );
  if (manualBackendWarningMessage === null) {
    return sanitizedEventWithDatabaseDiagnostics;
  }

  return {
    ...sanitizedEventWithDatabaseDiagnostics,
    message: manualBackendWarningMessage,
  };
}

function sanitizeSentrySpan(span: BackendSentrySpan): BackendSentrySpan {
  return sanitizeBackendTelemetryValue(redactExceptionTextFields(span)) as unknown as typeof span;
}

function sanitizeSentryTransactionEvent(event: BackendSentryTransactionEvent): BackendSentryTransactionEvent {
  return sanitizeBackendTelemetryValue(redactExceptionTextFields(event)) as unknown as typeof event;
}

function hasSentryIntegrationNamed(
  integrations: ReadonlyArray<BackendSentryIntegration>,
  integrationName: string,
): boolean {
  return integrations.some((integration) => integration.name === integrationName);
}

function appendSentryIntegrationIfMissing(
  integrations: ReadonlyArray<BackendSentryIntegration>,
  integrationName: string,
  integration: BackendSentryIntegration,
): ReadonlyArray<BackendSentryIntegration> {
  if (hasSentryIntegrationNamed(integrations, integrationName)) {
    return integrations;
  }

  return [...integrations, integration];
}

function createConfiguredOpenAIIntegration(): BackendSentryIntegration {
  return Sentry.openAIIntegration({
    recordInputs: false,
    recordOutputs: false,
  });
}

function createConfiguredSentryIntegrations(
  defaultIntegrations: ReadonlyArray<BackendSentryIntegration>,
): Array<BackendSentryIntegration> {
  const filteredIntegrations = defaultIntegrations.filter(
    (integration) => disabledDefaultIntegrationNames.has(integration.name) === false,
  );
  const integrationsWithHono = appendSentryIntegrationIfMissing(
    filteredIntegrations,
    "Hono",
    Sentry.honoIntegration(),
  );
  const integrationsWithHttp = appendSentryIntegrationIfMissing(
    integrationsWithHono,
    "Http",
    Sentry.httpIntegration(),
  );
  const integrationsWithFetch = appendSentryIntegrationIfMissing(
    integrationsWithHttp,
    "NodeFetch",
    Sentry.nativeNodeFetchIntegration(),
  );

  return [
    ...integrationsWithFetch,
    createConfiguredOpenAIIntegration(),
  ];
}

function createSentryIntegrations(): BackendSentryIntegrationFactory {
  return (defaultIntegrations) => createConfiguredSentryIntegrations(defaultIntegrations);
}

export function initializeBackendSentryWithDeps(
  service: BackendService,
  env: NodeJS.ProcessEnv,
  dependencies: InitializeBackendSentryDependencies,
): void {
  currentBackendService = service;
  if (initializedServices.has(service)) {
    return;
  }

  const config = getBackendSentryConfig(env);
  if (!config.enabled) {
    initializedServices.add(service);
    return;
  }

  dependencies.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: (event, hint) => sanitizeSentryEvent(event, hint),
    beforeSendSpan: (span) => sanitizeSentrySpan(span),
    beforeSendTransaction: (event) => sanitizeSentryTransactionEvent(event),
    integrations: createSentryIntegrations(),
  });
  backendSentryInitializedForOpenTelemetry = true;
  initializedServices.add(service);
}

export function initializeBackendSentry(service: BackendService): void {
  initializeBackendSentryWithDeps(service, process.env, {
    init: Sentry.init,
  });
}

export function resetBackendSentryForTests(): void {
  initializedServices.clear();
  currentBackendService = null;
  backendSentryInitializedForOpenTelemetry = false;
}

export function isBackendSentryInitializedForOpenTelemetry(): boolean {
  return backendSentryInitializedForOpenTelemetry;
}

export function normalizeCaughtError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    const cachedError = normalizedNonErrorObjectMap.get(error as object);
    if (cachedError !== undefined) {
      return cachedError;
    }

    const normalizedError = createNonErrorThrowWrapper(error);
    normalizedNonErrorObjectMap.set(error as object, normalizedError);
    return normalizedError;
  }

  const primitiveError = error as NonErrorPrimitive;
  const cachedError = normalizedNonErrorPrimitiveMap.get(primitiveError);
  if (cachedError !== undefined) {
    return cachedError;
  }

  const normalizedError = createNonErrorThrowWrapper(error);
  normalizedNonErrorPrimitiveMap.set(primitiveError, normalizedError);
  return normalizedError;
}

function createNonErrorThrowWrapper(error: unknown): Error {
  const normalizedError = new Error(String(error));
  normalizedError.name = "NonErrorThrow";
  return normalizedError;
}

export function hasCapturedBackendException(error: Error): boolean {
  return capturedExceptionSet.has(error);
}

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function readStringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isSqlState(value: string): boolean {
  return /^[A-Z0-9]{5}$/i.test(value) && nonSqlStateDatabaseErrorCodes.has(value) === false;
}

function readDatabaseExceptionDiagnostics(error: unknown): DatabaseExceptionDiagnostics | null {
  const errorRecord = readRecord(error);
  if (errorRecord === null) {
    return null;
  }

  const code = readStringField(errorRecord, "code");
  const sqlState = readStringField(errorRecord, "sqlState")
    ?? readStringField(errorRecord, "sqlstate")
    ?? (code !== null && isSqlState(code) ? code : null);
  const diagnostics: DatabaseExceptionDiagnostics = {
    errorClass: error instanceof Error && error.name.trim() !== "" ? error.name : null,
    errorCode: readStringField(errorRecord, "errorCode") ?? code,
    sqlState,
    constraint: readStringField(errorRecord, "constraint"),
    table: readStringField(errorRecord, "table"),
    errorMessage: error instanceof Error ? error.message : readStringField(errorRecord, "message"),
  };

  if (
    diagnostics.sqlState === null
    && diagnostics.constraint === null
    && diagnostics.table === null
  ) {
    return null;
  }

  return diagnostics;
}

function isSafeDatabaseExceptionMessage(
  message: string,
  diagnostics: DatabaseExceptionDiagnostics,
): boolean {
  return diagnostics.constraint !== null && message.includes(diagnostics.constraint);
}

function createDatabaseExceptionDiagnosticValue(
  diagnostics: DatabaseExceptionDiagnostics,
): string | null {
  const diagnosticParts: Array<string> = [];
  if (diagnostics.sqlState !== null) {
    diagnosticParts.push(`SQLSTATE ${diagnostics.sqlState}`);
  }
  if (diagnostics.errorCode !== null && diagnostics.errorCode !== diagnostics.sqlState) {
    diagnosticParts.push(`code ${diagnostics.errorCode}`);
  }
  if (diagnostics.constraint !== null) {
    diagnosticParts.push(`constraint ${diagnostics.constraint}`);
  }
  if (diagnostics.table !== null) {
    diagnosticParts.push(`table ${diagnostics.table}`);
  }
  if (diagnosticParts.length === 0) {
    return null;
  }

  const label = diagnostics.errorClass ?? "DatabaseError";
  if (
    diagnostics.errorMessage !== null
    && isSafeDatabaseExceptionMessage(diagnostics.errorMessage, diagnostics)
  ) {
    return `${label}: ${sanitizeInternalErrorText(diagnostics.errorMessage)} (${diagnosticParts.join(", ")})`;
  }

  return `${label}: ${diagnosticParts.join(", ")}`;
}

function createDatabaseDiagnosticTags(
  diagnostics: DatabaseExceptionDiagnostics,
): Readonly<Record<string, string>> {
  const tags: Record<string, string> = {};
  if (diagnostics.sqlState !== null) tags["db.sql_state"] = diagnostics.sqlState;
  if (diagnostics.errorCode !== null) tags["db.error_code"] = diagnostics.errorCode;
  if (diagnostics.constraint !== null) tags["db.constraint"] = diagnostics.constraint;
  if (diagnostics.table !== null) tags["db.table"] = diagnostics.table;
  return tags;
}

function restoreSentryExceptionValue(
  value: SentryExceptionValue,
  diagnosticValue: string,
): SentryExceptionValue {
  if (typeof value.value !== "string") {
    return value;
  }

  return {
    ...value,
    value: diagnosticValue,
  };
}

function restoreSentryDatabaseExceptionValues(
  event: BackendSentryEvent,
  diagnosticValue: string,
): BackendSentryEvent {
  const exceptionRecord = readRecord(event.exception);
  const exceptionValues = exceptionRecord?.values;
  if (Array.isArray(exceptionValues) === false) {
    return event;
  }

  return {
    ...event,
    exception: {
      ...event.exception,
      values: exceptionValues.map((value) => {
        const exceptionValue = readRecord(value);
        return exceptionValue === null
          ? value
          : restoreSentryExceptionValue(exceptionValue as SentryExceptionValue, diagnosticValue);
      }),
    },
  };
}

function restoreSentryDatabaseExceptionDiagnostics(
  originalEvent: BackendSentryEvent,
  sanitizedEvent: BackendSentryEvent,
  hint: BackendSentryEventHint,
): BackendSentryEvent {
  const diagnostics = readDatabaseExceptionDiagnostics(hint.originalException);
  if (diagnostics === null) {
    return sanitizedEvent;
  }

  const diagnosticValue = createDatabaseExceptionDiagnosticValue(diagnostics);
  if (diagnosticValue === null) {
    return sanitizedEvent;
  }

  const eventWithExceptionValue = restoreSentryDatabaseExceptionValues(sanitizedEvent, diagnosticValue);
  return {
    ...eventWithExceptionValue,
    message: typeof originalEvent.message === "string" ? diagnosticValue : eventWithExceptionValue.message,
    tags: {
      ...eventWithExceptionValue.tags,
      ...createDatabaseDiagnosticTags(diagnostics),
    },
  };
}

function shouldRedactExceptionTextField(key: string, value: unknown): boolean {
  return typeof value === "string" && exceptionTextFieldNames.has(normalizeTelemetryKey(key));
}

function redactExceptionTextFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactExceptionTextFields(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, childValue]) => [
      key,
      shouldRedactExceptionTextField(key, childValue)
        ? redactedExceptionTextValue
        : redactExceptionTextFields(childValue),
    ]),
  );
}

function shouldRedactCloudWatchExceptionDetailTextField(key: string, value: unknown): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return typeof value === "string"
    && exceptionTextFieldNames.has(normalizedKey)
    && cloudWatchActionableExceptionTextFieldNames.has(normalizedKey) === false;
}

function redactCloudWatchExceptionDetailTextFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactCloudWatchExceptionDetailTextFields(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, childValue]) => [
      key,
      shouldRedactCloudWatchExceptionDetailTextField(key, childValue)
        ? redactedExceptionTextValue
        : redactCloudWatchExceptionDetailTextFields(childValue),
    ]),
  );
}

function sanitizeInternalErrorText(value: string): string {
  const sanitizedValue = sanitizeBackendTelemetryValue(value);
  if (typeof sanitizedValue !== "string") {
    throw new Error("Expected sanitized internal error text to remain a string");
  }

  return sanitizedValue;
}

function shouldPreserveCloudWatchActionableErrorText(key: string, value: unknown): value is string {
  return typeof value === "string" && cloudWatchActionableExceptionTextFieldNames.has(normalizeTelemetryKey(key));
}

function readSanitizedTelemetryEntry(key: string, value: unknown): SanitizedTelemetryValue {
  const sanitizedObject = sanitizeBackendTelemetryValue({ [key]: value });
  if (typeof sanitizedObject !== "object" || sanitizedObject === null || Array.isArray(sanitizedObject)) {
    throw new Error("Expected sanitized telemetry entry to remain an object");
  }

  return (sanitizedObject as Readonly<Record<string, SanitizedTelemetryValue>>)[key];
}

function sanitizeCloudWatchLogEntry(key: string, value: unknown): SanitizedTelemetryValue {
  if (shouldPreserveCloudWatchActionableErrorText(key, value)) {
    return sanitizeInternalErrorText(value);
  }

  const sanitizedValue = readSanitizedTelemetryEntry(key, value);
  if (typeof sanitizedValue !== "object" || sanitizedValue === null) {
    return sanitizedValue;
  }

  return sanitizeCloudWatchLogValue(value);
}

function sanitizeCloudWatchLogValue(value: unknown): SanitizedTelemetryValue {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCloudWatchLogValue(item));
  }

  if (typeof value !== "object" || value === null) {
    return sanitizeBackendTelemetryValue(value);
  }

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, childValue]) => [
      key,
      sanitizeCloudWatchLogEntry(key, childValue),
    ]),
  );
}

function getLogRecordDetails(event: BackendLogEvent): unknown {
  return "error" in event ? redactCloudWatchExceptionDetailTextFields(event.details) : event.details;
}

function createCloudWatchRecord(event: BackendLogEvent): SanitizedTelemetryValue {
  const errorContext = "error" in event ? getBackendErrorLogDetails(event.error) : {};
  const message = "message" in event ? { message: event.message } : {};
  return sanitizeCloudWatchLogValue({
    domain: "backend",
    action: event.action,
    ...event.scope,
    ...(getLogRecordDetails(event) as Readonly<Record<string, unknown>>),
    ...message,
    ...errorContext,
  });
}

function writeCloudWatchRecord(
  event: BackendLogEvent,
  severity: "breadcrumb" | "warning" | "exception",
): void {
  const serializedRecord = JSON.stringify(createCloudWatchRecord(event));
  if (severity === "exception") {
    console.error(serializedRecord);
    return;
  }

  if (severity === "warning") {
    console.warn(serializedRecord);
    return;
  }

  console.log(serializedRecord);
}

function getScopeTagValue(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function setSentryScope(scope: Sentry.Scope, observationScope: BackendObservationScope): void {
  scope.setTag("backend.service", observationScope.service);
  const requestId = getScopeTagValue(observationScope.requestId);
  const route = getScopeTagValue(observationScope.route);
  const method = getScopeTagValue(observationScope.method);
  const workspaceId = getScopeTagValue(observationScope.workspaceId);
  const chatRequestId = getScopeTagValue(observationScope.chatRequestId);
  const runId = getScopeTagValue(observationScope.runId);
  const sessionId = getScopeTagValue(observationScope.sessionId);

  if (requestId !== undefined) scope.setTag("requestId", requestId);
  if (route !== undefined) scope.setTag("route", route);
  if (method !== undefined) scope.setTag("method", method);
  if (workspaceId !== undefined) scope.setTag("workspaceId", workspaceId);
  if (chatRequestId !== undefined) scope.setTag("chatRequestId", chatRequestId);
  if (runId !== undefined) scope.setTag("runId", runId);
  if (sessionId !== undefined) scope.setTag("sessionId", sessionId);
  if (observationScope.userId !== null && observationScope.userId !== "") {
    scope.setUser({ id: observationScope.userId });
    scope.setTag("userId", observationScope.userId);
  }

  scope.setContext("backend", sanitizeBackendTelemetryValue(redactExceptionTextFields(observationScope)) as BackendSentryContextData);
}

function getSentryData(event: BackendLogEvent): BackendSentryBreadcrumbData {
  return sanitizeBackendTelemetryValue(redactExceptionTextFields({
    scope: event.scope,
    details: event.details,
  })) as BackendSentryBreadcrumbData;
}

export function addBackendBreadcrumb(event: BackendBreadcrumbEvent): void {
  writeCloudWatchRecord(event, "breadcrumb");
  addBackendSentryBreadcrumb(event);
}

export function addBackendSentryBreadcrumb(event: BackendBreadcrumbEvent): void {
  Sentry.addBreadcrumb({
    category: "backend",
    level: "info",
    message: event.action,
    data: getSentryData(event),
  });
}

export function captureBackendWarning(event: BackendWarningEvent): void {
  writeCloudWatchRecord(event, "warning");
  Sentry.withScope((scope) => {
    setSentryScope(scope, event.scope);
    scope.setContext(
      "backend.details",
      sanitizeBackendTelemetryValue(redactExceptionTextFields(event.details)) as BackendSentryContextData,
    );
    scope.setTag(manualBackendWarningCaptureTagName, manualBackendCaptureTagValue);
    scope.setTag(backendActionTagName, event.action);
    scope.setFingerprint([event.action]);
    Sentry.captureMessage(event.action, "warning");
  });
}

export function captureBackendException(event: BackendExceptionEvent): void {
  capturedExceptionSet.add(event.error);
  writeCloudWatchRecord(event, "exception");
  Sentry.withScope((scope) => {
    setSentryScope(scope, event.scope);
    scope.setContext(
      "backend.details",
      sanitizeBackendTelemetryValue(redactExceptionTextFields(event.details)) as BackendSentryContextData,
    );
    scope.setTag(manualBackendCaptureTagName, manualBackendCaptureTagValue);
    Sentry.captureException(event.error);
  });
}

export function getBackendTraceCarrier(): BackendTraceCarrier {
  const traceData = Sentry.getTraceData({ propagateTraceparent: true });
  return {
    sentryTrace: traceData["sentry-trace"] ?? null,
    baggage: traceData.baggage ?? null,
  };
}

export function continueBackendTrace<Result>(
  traceCarrier: BackendTraceCarrier | null,
  callback: () => Result,
): Result {
  if (traceCarrier === null) {
    return callback();
  }

  return Sentry.continueTrace({
    sentryTrace: traceCarrier.sentryTrace ?? undefined,
    baggage: traceCarrier.baggage ?? undefined,
  }, callback);
}

export function startBackendSpan<Result>(
  name: string,
  operation: string,
  callback: () => Result,
): Result {
  return Sentry.startSpan({ name, op: operation }, callback);
}

export function runWithBackendSentryIsolationScope<Result>(
  scope: BackendObservationScope,
  callback: () => Result,
): Result {
  return Sentry.withIsolationScope((isolationScope) => {
    setSentryScope(isolationScope, scope);
    return callback();
  });
}

export function wrapBackendHandler<TEvent, TResult>(
  handler: Handler<TEvent, TResult>,
): Handler<TEvent, TResult> {
  return Sentry.wrapHandler(handler);
}

export function wrapBackendStreamHandler<TEvent, TResult>(
  handler: StreamifyHandler<TEvent, TResult>,
): StreamifyHandler<TEvent, TResult> {
  return Sentry.wrapHandler(handler);
}

export async function flushBackendSentry(timeoutMs: number): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}

export function createBackendObservationScope(
  service: BackendService,
  requestId: string | null,
  route: string | null,
  method: string | null,
  userId: string | null,
  workspaceId: string | null,
  chatRequestId: string | null,
  runId: string | null,
  sessionId: string | null,
): BackendObservationScope {
  return {
    service,
    requestId,
    route,
    method,
    userId,
    workspaceId,
    chatRequestId,
    runId,
    sessionId,
  };
}

export function createBackendRuntimeObservationScope(): BackendObservationScope {
  if (currentBackendService === null) {
    throw new Error("Backend Sentry must be initialized before creating runtime observation scope.");
  }

  return createBackendObservationScope(
    currentBackendService,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
}

export function getBackendErrorLogDetails(error: unknown): BackendErrorLogDetails {
  if (error instanceof Error) {
    const stack = error.stack ?? null;
    return {
      errorClass: error.name,
      errorMessage: sanitizeInternalErrorText(error.message),
      errorStack: stack === null ? null : sanitizeInternalErrorText(stack),
      ...parseErrorSourceLocation(stack),
    };
  }

  return {
    errorClass: "UnknownError",
    errorMessage: sanitizeInternalErrorText(String(error)),
    errorStack: null,
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

function parseErrorSourceLocation(stack: string | null): Pick<
  BackendErrorLogDetails,
  "sourceFile" | "sourceLine" | "sourceColumn"
> {
  if (stack === null) {
    return {
      sourceFile: null,
      sourceLine: null,
      sourceColumn: null,
    };
  }

  const stackLines = stack.split("\n");
  for (const stackLine of stackLines.slice(1)) {
    const trimmedLine = stackLine.trim();
    const match = /^\s*at .+ \((.+):(\d+):(\d+)\)$/.exec(trimmedLine)
      ?? /^\s*at (.+):(\d+):(\d+)$/.exec(trimmedLine)
      ?? /^(.+):(\d+):(\d+)$/.exec(trimmedLine);
    if (match === null) {
      continue;
    }

    return {
      sourceFile: match[1] ?? null,
      sourceLine: Number.parseInt(match[2] ?? "", 10),
      sourceColumn: Number.parseInt(match[3] ?? "", 10),
    };
  }

  return {
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null,
  };
}
