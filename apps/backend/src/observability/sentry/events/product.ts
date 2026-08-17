import type { SyncConflictEntityType } from "../../../shared/errors";
import type {
  BackendDatabaseDetails,
  EventByAction,
  FailureDetailsFor,
  SyncConflictFailureDetailsFor,
} from "./common";

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

export type LeaderboardProfileDetails = Readonly<{
  statusCode: number;
  authTransport: string;
  status: string | null;
  isFriend: boolean | null;
  currentStreakDays: number | null;
  bestRatingWindowKey: string | null;
  bestRatingRank: number | null;
  reviewActivityDayCount: number | null;
  totalCards: number | null;
  generatedAt: string | null;
}>;

export type StreakLeaderboardDetails = Readonly<{
  statusCode: number;
  authTransport: string;
  status: string | null;
  metricVersion: string | null;
  participantCount: number | null;
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

export type WorkspacePackageExportPreviewDetails = Readonly<{
  statusCode: number;
  selectedCardCount: number | null;
  referencedMediaCount: number | null;
}>;

export type WorkspacePackageExportDetails = Readonly<{
  statusCode: number;
  bytesCount: number | null;
}>;

export type WorkspacePackageImportPreviewDetails = Readonly<{
  statusCode: number;
  bytesCount: number | null;
  cardCount: number | null;
  referencedMediaCount: number | null;
  packageMediaFileCount: number | null;
}>;

export type WorkspacePackageImportDetails = Readonly<{
  statusCode: number;
  bytesCount: number | null;
  cardCount: number | null;
  referencedMediaCount: number | null;
  importedMediaAssetCount: number | null;
  appliedMediaAssetCount: number | null;
}>;

export type MediaAssetRouteDetails = Readonly<{
  statusCode: number;
  mediaAssetId: string | null;
  collectionId?: string;
  sessionId?: string | null;
  mimeType?: string;
  sizeBytes?: number;
  partSizeBytes?: number;
  partCount?: number;
  applied?: boolean;
}>;

export type MultipartCompletionResolutionRetryDetails = Readonly<{
  attempt: number;
  delayMs: number;
  leaseExpiresAtMs: number;
  sqlState: string | null;
  errorCode: string | null;
  errorClass: string;
  errorMessage: string;
}>;

export type MultipartCompletionRenewalRejectedDetails = Readonly<{
  mediaAssetId: string;
  sessionId: string;
  durableOutcome: string;
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
  entityType: SyncConflictEntityType;
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

export type ProductBreadcrumbEvent =
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
  | EventByAction<"me_progress_leaderboard_profile", LeaderboardProfileDetails>
  | EventByAction<"me_progress_leaderboard_profile_error", FailureDetailsFor<LeaderboardProfileDetails>>
  | EventByAction<"me_progress_streak_leaderboard", StreakLeaderboardDetails>
  | EventByAction<"me_progress_streak_leaderboard_error", FailureDetailsFor<StreakLeaderboardDetails>>
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
  | EventByAction<"workspace_package_export_preview", WorkspacePackageExportPreviewDetails>
  | EventByAction<"workspace_package_export_preview_error", FailureDetailsFor<WorkspacePackageExportPreviewDetails>>
  | EventByAction<"workspace_package_export", WorkspacePackageExportDetails>
  | EventByAction<"workspace_package_export_error", FailureDetailsFor<WorkspacePackageExportDetails>>
  | EventByAction<"workspace_package_import_preview", WorkspacePackageImportPreviewDetails>
  | EventByAction<"workspace_package_import_preview_error", FailureDetailsFor<WorkspacePackageImportPreviewDetails>>
  | EventByAction<"workspace_package_import", WorkspacePackageImportDetails>
  | EventByAction<"workspace_package_import_error", FailureDetailsFor<WorkspacePackageImportDetails>>
  | EventByAction<"media_asset_image_ingest", MediaAssetRouteDetails>
  | EventByAction<"media_asset_image_ingest_error", FailureDetailsFor<MediaAssetRouteDetails>>
  | EventByAction<"media_asset_upload_session_media_reuse", MediaAssetRouteDetails>
  | EventByAction<"media_asset_upload_session_concurrent_media_reuse", MediaAssetRouteDetails>
  | EventByAction<"media_asset_upload_session_create", MediaAssetRouteDetails>
  | EventByAction<"media_asset_upload_session_create_error", FailureDetailsFor<MediaAssetRouteDetails>>
  | EventByAction<"media_asset_upload_session_part_urls_create", MediaAssetRouteDetails>
  | EventByAction<"media_asset_upload_session_part_urls_create_error", FailureDetailsFor<MediaAssetRouteDetails>>
  | EventByAction<"media_asset_upload_session_complete", MediaAssetRouteDetails>
  | EventByAction<"media_asset_upload_session_complete_error", FailureDetailsFor<MediaAssetRouteDetails>>
  | EventByAction<"media_asset_upload_session_abort", MediaAssetRouteDetails>
  | EventByAction<"media_asset_upload_session_abort_error", FailureDetailsFor<MediaAssetRouteDetails>>
  | EventByAction<"media_asset_get", MediaAssetRouteDetails>
  | EventByAction<"media_asset_get_error", FailureDetailsFor<MediaAssetRouteDetails>>
  | EventByAction<"media_asset_download_url_create", MediaAssetRouteDetails>
  | EventByAction<"media_asset_download_url_create_error", FailureDetailsFor<MediaAssetRouteDetails>>
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
  | EventByAction<"workspace_delete_transaction_error", WorkspaceTransactionDetails>;

export type ProductWarningEvent =
  | EventByAction<
    "media_asset_upload_session_completion_resolution_retry",
    MultipartCompletionResolutionRetryDetails
  >
  | EventByAction<
    "media_asset_upload_session_completion_renewal_rejected",
    MultipartCompletionRenewalRejectedDetails
  >
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

export type ProductExceptionEvent =
  | (EventByAction<"sync_push_error", SyncConflictFailureDetailsFor<SyncPushDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_pull_error", FailureDetailsFor<SyncPullDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_bootstrap_error", SyncConflictFailureDetailsFor<SyncBootstrapDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_review_history_pull_error", FailureDetailsFor<SyncReviewHistoryPullDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"sync_review_history_import_error", SyncConflictFailureDetailsFor<SyncReviewHistoryImportDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_summary_error", FailureDetailsFor<ProgressSummaryDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_review_schedule_error", FailureDetailsFor<ProgressReviewScheduleDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_series_error", FailureDetailsFor<ProgressSeriesDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"me_progress_leaderboard_error", FailureDetailsFor<ProgressLeaderboardDetails>> & Readonly<{ error: Error }>)
  | (
    EventByAction<"me_progress_leaderboard_profile_error", FailureDetailsFor<LeaderboardProfileDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"me_progress_streak_leaderboard_error", FailureDetailsFor<StreakLeaderboardDetails>>
    & Readonly<{ error: Error }>
  )
  | (EventByAction<"account_delete_error", FailureDetailsFor<AccountDeleteDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"feedback_state_error", FailureDetailsFor<FeedbackStateDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"feedback_prompt_event_error", FailureDetailsFor<FeedbackPromptEventDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"feedback_submission_error", FailureDetailsFor<FeedbackSubmissionDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"workspace_tags_list_error", FailureDetailsFor<WorkspaceTagsListDetails>> & Readonly<{ error: Error }>)
  | (EventByAction<"cards_query_error", FailureDetailsFor<CardsQueryDetails>> & Readonly<{ error: Error }>)
  | (
    EventByAction<"workspace_package_export_preview_error", FailureDetailsFor<WorkspacePackageExportPreviewDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"workspace_package_export_error", FailureDetailsFor<WorkspacePackageExportDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"workspace_package_import_preview_error", FailureDetailsFor<WorkspacePackageImportPreviewDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"workspace_package_import_error", FailureDetailsFor<WorkspacePackageImportDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_image_ingest_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_upload_session_create_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_upload_session_part_urls_create_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_upload_session_complete_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_upload_session_abort_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_get_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
  | (
    EventByAction<"media_asset_download_url_create_error", FailureDetailsFor<MediaAssetRouteDetails>>
    & Readonly<{ error: Error }>
  )
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
  | (EventByAction<"workspace_delete_transaction_error", WorkspaceTransactionDetails> & Readonly<{ error: Error }>);
