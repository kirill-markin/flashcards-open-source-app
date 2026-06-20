export type BackendService =
  | "backend-api"
  | "chat-worker"
  | "chat-live"
  | "global-metrics-snapshot"
  | "community-leaderboard-snapshot"
  | "progress-active-days-backfill"
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
  durationMs: number;
  installationId: string;
  platform: string;
  appVersion: string | null;
  mode: string;
  cursorPresent: boolean | null;
  limit: number | null;
  entriesCount: number | null;
  appliedEntriesCount: number | null;
  hasMore: boolean | null;
  nextCursorPresent: boolean | null;
  bootstrapHotChangeId: number | null;
  remoteIsEmpty: boolean | null;
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
  longestStreakDays: number | null;
  hasReviewedToday: boolean | null;
  lastReviewedOn: string | null;
  activeReviewDays: number | null;
  streakFreezeAvailableCredits: number | null;
  streakFreezeCapacity: number | null;
  streakFreezeBalanceUnits: number | null;
  streakFreezeUnitsPerCredit: number | null;
  streakFreezeEarnedUnitsPerStreakDay: number | null;
  streakFreezeNextCreditProgressUnits: number | null;
  streakFreezeNextCreditRequiredUnits: number | null;
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

export type ProgressLeaderboardDetails = Readonly<{
  statusCode: number;
  authTransport: string;
  status: string | null;
  metricVersion: string | null;
  defaultWindowKey: string | null;
  windowCount: number | null;
}>;

export type AccountDeleteDetails = Readonly<{
  statusCode: number;
  transport: string;
}>;

export type FeedbackStateDetails = Readonly<{
  statusCode: number;
}>;

export type FeedbackPromptEventDetails = Readonly<{
  statusCode: number;
  platform: string | null;
  eventType: string | null;
}>;

export type FeedbackSubmissionDetails = Readonly<{
  statusCode: number;
  platform: string | null;
  trigger: string | null;
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
  clientRequestId: string | null;
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
  clientRequestId: string | null;
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
  clientRequestId: string | null;
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
  clientRequestId: string | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  code: string;
  message: string;
}>;

export type ChatLiveLifecycleDetails = Readonly<{
  afterCursor: number | null;
  clientRequestId: string | null;
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
  | EventByAction<"community_leaderboard_snapshot_generated", CommunityLeaderboardSnapshotGeneratedDetails>
  | EventByAction<"progress_active_days_backfill_completed", ProgressActiveDaysBackfillCompletedDetails>
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
  | EventByAction<"me_progress_leaderboard", ProgressLeaderboardDetails>
  | EventByAction<"me_progress_leaderboard_error", FailureDetailsFor<ProgressLeaderboardDetails>>
  | EventByAction<"account_delete", AccountDeleteDetails>
  | EventByAction<"account_delete_error", FailureDetailsFor<AccountDeleteDetails>>
  | EventByAction<"feedback_state", FeedbackStateDetails>
  | EventByAction<"feedback_state_error", FailureDetailsFor<FeedbackStateDetails>>
  | EventByAction<"feedback_prompt_event", FeedbackPromptEventDetails>
  | EventByAction<"feedback_prompt_event_error", FailureDetailsFor<FeedbackPromptEventDetails>>
  | EventByAction<"feedback_submission", FeedbackSubmissionDetails>
  | EventByAction<"feedback_submission_error", FailureDetailsFor<FeedbackSubmissionDetails>>
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
  | EventByAction<"feedback_notification_email_retry", FeedbackEmailRetryDetails>
  | EventByAction<"feedback_notification_email_failed", FeedbackEmailFailureDetails>
  | EventByAction<"reporting_read_only_transaction_rollback_failed", DatabaseRollbackFailureDetails>
  | (EventByAction<"chat_live_backlog_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_live_write_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_transcription_failed", ChatTranscriptionFailureDetails> & Readonly<{ message: string }>)
  | (EventByAction<
    "progress_active_days_backfill_candidate_failed",
    ProgressActiveDaysBackfillCandidateFailureDetails
  > & Readonly<{ message: string }>)
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
  | (EventByAction<"me_progress_leaderboard_error", FailureDetailsFor<ProgressLeaderboardDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"account_delete_error", FailureDetailsFor<AccountDeleteDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"feedback_state_error", FailureDetailsFor<FeedbackStateDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"feedback_prompt_event_error", FailureDetailsFor<FeedbackPromptEventDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"feedback_submission_error", FailureDetailsFor<FeedbackSubmissionDetails>> & Readonly<{ error: Error }>)
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
  | (EventByAction<"community_leaderboard_snapshot_failed", CommunityLeaderboardSnapshotFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"progress_active_days_backfill_failed", ProgressActiveDaysBackfillFailureDetails> & Readonly<{
    error: Error;
  }>)
  | (EventByAction<"migration_failed", MigrationFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_bootstrap_failed", ChatLiveBootstrapFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_request_error", ChatLiveRequestDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_stream_crashed", ChatLiveStreamCrashDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_poll_failed", ChatLiveLifecycleDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails> & Readonly<{ error: Error }>);

export type BackendLogEvent = BackendBreadcrumbEvent | BackendWarningEvent | BackendExceptionEvent;
