import type {
  ChatBreadcrumbEvent,
  ChatExceptionEvent,
  ChatWarningEvent,
} from "./chat";
import type {
  CommonBreadcrumbEvent,
  CommonExceptionEvent,
} from "./common";
import type {
  OperationsBreadcrumbEvent,
  OperationsExceptionEvent,
  OperationsWarningEvent,
} from "./operations";
import type {
  ProductBreadcrumbEvent,
  ProductExceptionEvent,
  ProductWarningEvent,
} from "./product";

export type {
  BackendFailureDetails,
  BackendValidationIssueDetail,
} from "../../failureDetails";
export type {
  BackendDatabaseDetails,
  BackendErrorLogDetails,
  BackendObservationScope,
  BackendService,
  BackendSyncConflictDetails,
  BackendTraceCarrier,
  EmptyDetails,
  RequestErrorDetails,
} from "./common";
export type {
  AccountDeleteDetails,
  CardsQueryDetails,
  FeedbackPromptEventDetails,
  FeedbackStateDetails,
  FeedbackSubmissionDetails,
  GuestMergeDropReviewEventMissingTargetCardDetails,
  GuestMergeDropThirdWorkspaceConflictDetails,
  GuestUpgradeCompleteDetails,
  GuestUpgradeCompleteSuspiciousDetails,
  LeaderboardProfileDetails,
  MediaAssetRouteDetails,
  MultipartCompletionRenewalRejectedDetails,
  MultipartCompletionResolutionRetryDetails,
  ProgressLeaderboardDetails,
  ProgressReviewScheduleDetails,
  ProgressSeriesDetails,
  ProgressSummaryDetails,
  ResetInvalidFsrsStateDetails,
  StreakLeaderboardDetails,
  SyncBootstrapDetails,
  SyncPullDetails,
  SyncPushDetails,
  SyncReviewHistoryImportDetails,
  SyncReviewHistoryPullDetails,
  WorkspaceDeleteDetails,
  WorkspaceDeletePreviewDetails,
  WorkspaceIdDetails,
  WorkspacePackageExportDetails,
  WorkspacePackageExportPreviewDetails,
  WorkspacePackageImportDetails,
  WorkspacePackageImportPreviewDetails,
  WorkspaceResetProgressDetails,
  WorkspaceResetProgressPreviewDetails,
  WorkspacesListDetails,
  WorkspaceTagsListDetails,
  WorkspaceTransactionDetails,
} from "./product";
export type {
  ChatLiveAttachDetails,
  ChatLiveBootstrapFailureDetails,
  ChatLiveLifecycleDetails,
  ChatLiveRequestDetails,
  ChatLiveStreamCrashDetails,
  ChatTranscriptionFailureDetails,
  ChatWorkerDispatchFailureDetails,
  ChatWorkerFailureDetails,
  ChatWorkerLifecycleDetails,
  GeneratedCardImageProviderDetails,
  LangfuseChatTranscriptionExportFailureDetails,
  LangfuseChatTranscriptionStartFailureDetails,
  LangfuseChatTurnExportFailureDetails,
  LangfuseChatTurnStartFailureDetails,
  LangfuseTelemetryFlushFailureDetails,
  McpWorkspaceSelectionEnrichmentFailureDetails,
} from "./chat";
export type {
  AdminQueryDetails,
  AgentSqlDetails,
  CommunityLeaderboardSnapshotFailureDetails,
  CommunityLeaderboardSnapshotGeneratedDetails,
  DatabasePoolErrorDetails,
  DatabaseRollbackFailureDetails,
  DatabaseTransientRetryDetails,
  FeedbackEmailFailureDetails,
  FeedbackEmailRetryDetails,
  GeneratedMediaPromotionBatchDetails,
  GlobalMetricsS3RetryDetails,
  GlobalMetricsSnapshotFailureDetails,
  GlobalMetricsSnapshotGeneratedDetails,
  McpRequestDetails,
  MediaAssetStorageRetryDetails,
  MediaAssetStorageTerminalDetails,
  MediaBlobCleanupBatchDetails,
  MediaBlobCleanupFailureRecordedDetails,
  MediaBlobCleanupRetryDetails,
  MigrationFailureDetails,
  MultipartCompletionFailureReportBatchDetails,
  MultipartCompletionReconciliationBatchDetails,
  MultipartCompletionReconciliationTerminalFailureDetails,
  ProgressActiveDaysBackfillCandidateFailureDetails,
  ProgressActiveDaysBackfillCompletedDetails,
  ProgressActiveDaysBackfillFailureDetails,
  StreakLeaderboardSnapshotFailureDetails,
  StreakLeaderboardSnapshotGeneratedDetails,
} from "./operations";

export type BackendBreadcrumbEvent =
  | CommonBreadcrumbEvent
  | ProductBreadcrumbEvent
  | ChatBreadcrumbEvent
  | OperationsBreadcrumbEvent;

export type BackendWarningEvent =
  | ProductWarningEvent
  | ChatWarningEvent
  | OperationsWarningEvent;

export type BackendExceptionEvent =
  | CommonExceptionEvent
  | ProductExceptionEvent
  | ChatExceptionEvent
  | OperationsExceptionEvent;

export type BackendLogEvent = BackendBreadcrumbEvent | BackendWarningEvent | BackendExceptionEvent;
