import Foundation

struct ObservabilityIdentity: Sendable, Hashable {
    let userId: String
    let workspaceId: String?
    let accountKind: ObservabilityAccountKind
}

enum ObservabilityAccountKind: String, Sendable {
    case linked
    case guest
}

enum IOSObservationFeature: String, Sendable {
    case appStartup = "app_startup"
    case cards = "cards"
    case cloudAuth = "cloud_auth"
    case cloudSync = "cloud_sync"
    case feedback = "feedback"
    case aiChat = "ai_chat"
    case aiLive = "ai_live"
    case notifications = "notifications"
    case localData = "local_data"
    case prompts = "prompts"
    case progress = "progress"
    case storeReview = "store_review"
}

struct IOSObservationScope: Sendable, Hashable {
    let feature: IOSObservationFeature
    let userId: String?
    let workspaceId: String?
    let requestId: String?
    let clientRequestId: String?
    let sessionId: String?
    let runId: String?
    let cloudState: CloudAccountState?
    let configurationMode: CloudServiceConfigurationMode?
}

enum IOSBreadcrumbEvent: Sendable {
    case cloudFlow(CloudFlowObservation)
    case cloudRetry(CloudRetryObservation)
    case aiChatLifecycle(AIChatLifecycleObservation)
    case aiLiveLifecycle(AILiveLifecycleObservation)
    case notificationTap(NotificationTapObservation)
}

enum IOSWarningEvent: Sendable {
    case aiChatLifecycle(AIChatLifecycleObservation)
    case aiLiveUnknownEvent(AILiveUnknownEventWarning)
    case aiLiveLifecycle(AILiveLifecycleObservation)
    case cloudFlow(CloudFlowObservation)
    case localDataRepair(LocalDataRepairWarning)
    case invalidCardDueAt(InvalidCardDueAtWarning)
    case notificationSchedulingFailed(NotificationSchedulingFailureWarning)
    case notificationTapDropped(NotificationTapDroppedWarning)
    case progressCacheRemoved(ProgressCacheRemovedWarning)
    case staleGuestCredentials(StaleGuestCredentialsWarning)
}

enum IOSExceptionEvent {
    case appStartupFailed(error: Error, scope: IOSObservationScope, details: AppStartupFailureDetails)
    case cloudSyncFailed(error: Error, scope: IOSObservationScope, details: CloudSyncFailureDetails)
    case cloudAuthFailed(error: Error, scope: IOSObservationScope, details: CloudAuthFailureDetails)
    case aiChatFailed(error: Error, scope: IOSObservationScope, details: AIChatFailureDiagnostics)
    case aiLiveStreamFailed(error: Error, scope: IOSObservationScope, details: AILiveStreamFailureDetails)
    case notificationSchedulingFailed(error: Error, scope: IOSObservationScope, details: NotificationFailureDetails)
    case localDataRepairFailed(error: Error, scope: IOSObservationScope, details: LocalDataRepairFailureDetails)
    case silentFailure(error: Error, scope: IOSObservationScope, details: SilentFailureDetails)
}

struct CloudFlowObservation: Sendable, Hashable {
    let phase: CloudFlowPhase
    let outcome: CloudFlowOutcome
    let scope: IOSObservationScope
    let requestId: String?
    let backendCode: String?
    let statusCode: Int?
    let workspaceId: String?
    let installationId: String?
    let selection: String?
    let sourceWorkspaceId: String?
    let targetWorkspaceId: String?
    let migrationKind: String?
    let remoteWorkspaceIsEmpty: Bool?
    let operationsCount: Int?
    let reviewScheduleImpactingOperationCount: Int?
    let changesCount: Int?
    let errorSummary: String?
}

enum CloudFlowOutcome: String, Sendable, Hashable {
    case start
    case success
    case failure
    case selfHeal = "self_heal"
}

enum AIChatLifecycleAction: String, Sendable {
    case runStart = "ai_run_start"
    case runStarted = "ai_run_started"
    case runFail = "ai_run_fail"
    case runFailed = "ai_run_failed"
    case stopFailed = "ai_stop_failed"
    case bootstrapRetryScheduled = "ai_bootstrap_retry_scheduled"
    case bootstrapSessionContractMismatch = "ai_bootstrap_session_contract_mismatch"
    case newSessionRetryScheduled = "ai_new_session_retry_scheduled"
    case contentUnknown = "ai_content_unknown"
    case chatUnknownContentReceived = "ai_chat_unknown_content_received"
    case storeLifecycle = "ai_store_lifecycle"
}

struct AIChatLifecycleObservation: Sendable, Hashable {
    let action: AIChatLifecycleAction
    let scope: IOSObservationScope
    let sessionId: String?
    let runId: String?
    let conversationScopeId: String?
    let eventType: String?
    let statusCode: Int?
    let backendCode: String?
    let backendRequestId: String?
    let clientRequestId: String?
    let stage: AIChatFailureStage?
    let errorKind: AIChatFailureKind?
    let failureKind: String?
    let attempt: Int?
    let maxAttempts: Int?
    let delayNanoseconds: UInt64?
    let outgoingContentCount: Int?
    let contentCount: Int?
    let textLength: Int?
    let summaryLength: Int?
    let suggestionCount: Int?
    let isError: Bool?
    let isStopped: Bool?
    let outcome: String?
    let reason: String?
    let errorSummary: String?
}

enum AILiveLifecycleAction: String, Sendable {
    case connectStart = "ai_live_connect_start"
    case httpResponse = "ai_live_http_response"
    case eventReceived = "ai_live_event_received"
    case eventSkippedUnknownType = "ai_live_event_skipped_unknown_type"
    case eventParseFailed = "ai_live_event_parse_failed"
    case cancelled = "ai_live_cancelled"
    case finish = "ai_live_finish"
    case finishError = "ai_live_finish_error"
    case attach = "ai_live_attach"
    case error = "ai_live_error"
    case detach = "ai_live_detach"
    case eventHandleStart = "ai_live_event_handle_start"
    case eventIgnoredStale = "ai_live_event_ignored_stale"
    case eventApplied = "ai_live_event_applied"
    case eventHandleApplied = "ai_live_event_handle_applied"
    case terminalEventReconcileRequired = "ai_live_terminal_event_reconcile_required"
    case terminalEventApplied = "ai_live_terminal_event_applied"
    case composerSuggestionsApplied = "ai_live_composer_suggestions_applied"
    case repairStatusApplied = "ai_live_repair_status_applied"
    case terminalApplied = "ai_live_run_terminal_applied"
}

struct AILiveLifecycleObservation: Sendable, Hashable {
    let action: AILiveLifecycleAction
    let scope: IOSObservationScope
    let sessionId: String
    let runId: String?
    let afterCursor: String?
    let requestId: String?
    let backendRequestId: String?
    let backendCode: String?
    let statusCode: Int?
    let eventType: String?
    let sequenceNumber: Int?
    let cursor: String?
    let streamEpoch: String?
    let itemId: String?
    let toolName: String?
    let toolStatus: String?
    let contentCount: Int?
    let textLength: Int?
    let summaryLength: Int?
    let suggestionCount: Int?
    let isError: Bool?
    let isStopped: Bool?
    let outcome: String?
    let failureKind: String?
    let stage: AIChatFailureStage?
    let errorKind: AIChatFailureKind?
    let resumeAttempt: Int?
}

struct AILiveUnknownEventWarning: Sendable, Hashable {
    let scope: IOSObservationScope
    let sessionId: String
    let runId: String?
    let afterCursor: String?
    let eventType: String
    let requestId: String?
}

enum NotificationTapAction: String, Sendable {
    case received = "notification_tap_received"
    case persisted = "notification_tap_persisted"
    case dropped = "notification_tap_dropped"
    case consumed = "notification_tap_consumed"
    case fallback = "notification_tap_fallback"
}

struct NotificationTapObservation: Sendable, Hashable {
    let action: NotificationTapAction
    let notificationType: String
    let source: AppNotificationTapSource?
    let appState: String?
    let scenePhaseAtConsume: String?
    let receivedAtMillis: Int64?
    let stage: String?
}

struct NotificationTapDroppedWarning: Sendable, Hashable {
    let observation: NotificationTapObservation
    let reason: String
    let detailSummary: String?
}

struct AppNotificationPendingRequestBreakdown: Sendable, Hashable {
    let totalCount: Int
    let reviewCount: Int
    let strictCount: Int
    let otherCount: Int
}

struct NotificationScheduledAtMillisRange: Sendable, Hashable {
    let firstScheduledAtMillis: Int64?
    let lastScheduledAtMillis: Int64?
}

struct NotificationSchedulingDelaySecondsRange: Sendable, Hashable {
    let minDelaySeconds: Int?
    let maxDelaySeconds: Int?
}

struct DelayedNotificationSchedulingReadback: Sendable, Hashable {
    let pending: AppNotificationPendingRequestBreakdown
    let recovered: Bool
}

struct NotificationSchedulingDiagnostics: Sendable, Hashable {
    let trigger: String
    let pendingBefore: AppNotificationPendingRequestBreakdown
    let pendingAfter: AppNotificationPendingRequestBreakdown
    let permissionStatusBefore: String
    let permissionStatusAfter: String
    let appStateBeforeAdd: String
    let appStateAfterReadback: String
    let scheduledAtMillisRange: NotificationScheduledAtMillisRange
    let delaySecondsRange: NotificationSchedulingDelaySecondsRange
    let delayedReadback: DelayedNotificationSchedulingReadback?
}

struct NotificationSchedulingFailureWarning: Sendable, Hashable {
    let action: String
    let scope: IOSObservationScope
    let notificationKind: String
    let workspaceId: String?
    let requestId: String?
    let stage: String
    let plannedCount: Int
    let acceptedCount: Int
    let pendingBeforeCount: Int
    let pendingAfterCount: Int
    let errorDomain: String?
    let errorCode: Int?
    let messageSummary: String?
    let diagnostics: NotificationSchedulingDiagnostics
}

struct CloudRetryObservation: Sendable, Hashable {
    let action: String
    let scope: IOSObservationScope
    let attempt: Int
    let maxAttempts: Int
    let apiBaseUrl: String?
    let messageSummary: String?
}

struct LocalDataRepairWarning: Sendable, Hashable {
    let action: String
    let scope: IOSObservationScope
    let workspaceId: String?
    let cardId: String?
    let reason: String
    let repair: String
}

struct InvalidCardDueAtWarning: Sendable, Hashable {
    let scope: IOSObservationScope
    let cardId: String
    let dueAt: String
}

struct ProgressCacheRemovedWarning: Sendable, Hashable {
    let scope: IOSObservationScope
    let cacheKind: String
    let key: String
    let reason: String
    let expectedScopeKey: String?
    let actualScopeKey: String?
    let errorSummary: String?
}

struct StaleGuestCredentialsWarning: Sendable, Hashable {
    let scope: IOSObservationScope
    let apiBaseUrl: String
    let messageSummary: String?
}

struct AppStartupFailureDetails: Sendable, Hashable {
    let stage: String
    let messageSummary: String
}

struct CloudSyncFailureDetails: Sendable, Hashable {
    let action: String
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
    let messageSummary: String?
}

struct CloudAuthFailureDetails: Sendable, Hashable {
    let action: String
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
    let messageSummary: String?
}

struct AILiveStreamFailureDetails: Sendable, Hashable {
    let sessionId: String
    let runId: String?
    let afterCursor: String?
    let requestId: String?
    let backendRequestId: String?
    let statusCode: Int?
    let backendCode: String?
    let clientRequestId: String?
    let failureKind: String
    let stage: AIChatFailureStage?
    let errorKind: AIChatFailureKind?
    let eventType: String?
    let outcome: String?
    let decoderSummary: String?
    let rawSnippetLength: Int?
    let idleTimeoutSeconds: TimeInterval?
    let isError: Bool?
    let isStopped: Bool?
    let resumeAttempt: Int?
}

struct NotificationFailureDetails: Sendable, Hashable {
    let action: String
    let workspaceId: String?
    let requestId: String?
    let stage: String
    let messageSummary: String?
}

struct LocalDataRepairFailureDetails: Sendable, Hashable {
    let action: String
    let workspaceId: String?
    let entityId: String?
    let reason: String
    let messageSummary: String?
}

struct SilentFailureDetails: Sendable, Hashable {
    let action: String
    let stage: String?
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
    let messageSummary: String?
}
