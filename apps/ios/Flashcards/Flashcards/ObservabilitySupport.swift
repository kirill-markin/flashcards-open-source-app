import Foundation
import CryptoKit
import OSLog
import Sentry

enum FlashcardsObservability {
    static func configure(bundle: Bundle, processInfo: ProcessInfo) {
        SentryObservabilityAdapter.configure(bundle: bundle, processInfo: processInfo)
    }

    static func setIdentity(_ identity: ObservabilityIdentity?) {
        SentryObservabilityAdapter.setIdentity(identity)
    }

    static func addBreadcrumb(_ event: IOSBreadcrumbEvent) {
        SentryObservabilityAdapter.addBreadcrumb(event)
    }

    static func captureWarning(_ event: IOSWarningEvent) {
        SentryObservabilityAdapter.captureWarning(event)
    }

    static func captureException(_ event: IOSExceptionEvent) {
        SentryObservabilityAdapter.captureException(event)
    }
}

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
    case aiChat = "ai_chat"
    case aiLive = "ai_live"
    case notifications = "notifications"
    case localData = "local_data"
    case progress = "progress"
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
    case aiChatLifecycle(AIChatLifecycleObservation)
    case aiLiveLifecycle(AILiveLifecycleObservation)
    case notificationTap(NotificationTapObservation)
}

enum IOSWarningEvent: Sendable {
    case aiChatLifecycle(AIChatLifecycleObservation)
    case aiLiveUnknownEvent(AILiveUnknownEventWarning)
    case aiLiveLifecycle(AILiveLifecycleObservation)
    case cloudFlow(CloudFlowObservation)
    case cloudRetry(CloudRetryWarning)
    case localDataRepair(LocalDataRepairWarning)
    case invalidCardDueAt(InvalidCardDueAtWarning)
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

struct CloudRetryWarning: Sendable, Hashable {
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

private enum SentryObservabilityAdapter {
    private static let state: LockedSentryObservabilityState = LockedSentryObservabilityState(isStarted: false)
    private static let cloudLogger: Logger = Logger(
        subsystem: appBundleIdentifier(),
        category: "cloud"
    )
    private static let observabilityLogger: Logger = Logger(
        subsystem: appBundleIdentifier(),
        category: "observability"
    )

    static func configure(bundle: Bundle, processInfo: ProcessInfo) {
        let configuration: SentryRuntimeConfiguration = loadSentryRuntimeConfiguration(
            bundle: bundle,
            processInfo: processInfo
        )
        if let invalidTracesSampleRate: String = configuration.invalidTracesSampleRate {
            self.writeLocalRecord(
                kind: "configuration",
                feature: .appStartup,
                action: "sentry_invalid_traces_sample_rate",
                fields: [
                    "environment": configuration.environment,
                    "configured_value": invalidTracesSampleRate,
                    "fallback": "0.0"
                ]
            )
        }
        guard configuration.dsn.isEmpty == false else {
            self.state.setIsStarted(false)
            self.writeLocalRecord(
                kind: "configuration",
                feature: .appStartup,
                action: "sentry_disabled",
                fields: [
                    "environment": configuration.environment,
                    "reason": "empty_dsn"
                ]
            )
            return
        }

        SentrySDK.start { options in
            options.dsn = configuration.dsn
            options.releaseName = "\(configuration.bundleIdentifier)@\(configuration.marketingVersion)"
            options.dist = configuration.buildNumber
            options.environment = configuration.environment
            options.sampleRate = NSNumber(value: 1.0)
            options.tracesSampleRate = NSNumber(value: configuration.tracesSampleRate)
            options.sendDefaultPii = false
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.enableAutoBreadcrumbTracking = false
            options.reportAccessibilityIdentifier = false
            options.enableLogs = false
            options.enableNetworkBreadcrumbs = true
            options.enableNetworkTracking = true
            options.enableCaptureFailedRequests = false
            options.tracePropagationTargets = configuration.tracePropagationTargets
            options.enablePropagateTraceparent = true
            options.beforeBreadcrumb = { breadcrumb in
                sanitizeSentryBreadcrumb(breadcrumb)
            }
            options.beforeSend = { event in
                sanitizeSentryEvent(event)
            }
            options.beforeSendSpan = { span in
                sanitizeSentrySpan(span)
            }
        }
        self.state.setIsStarted(true)
        self.writeLocalRecord(
            kind: "configuration",
            feature: .appStartup,
            action: "sentry_enabled",
            fields: [
                "environment": configuration.environment,
                "tracesSampleRate": String(configuration.tracesSampleRate)
            ]
        )
    }

    static func setIdentity(_ identity: ObservabilityIdentity?) {
        guard self.state.isStarted() else {
            return
        }
        guard let identity else {
            SentrySDK.setUser(nil)
            return
        }

        let hashedUserId: String = appSpecificObservabilityHash(
            identity.userId,
            namespace: "sentry_user_id"
        )
        let hashedWorkspaceId: String? = identity.workspaceId.map { workspaceId in
            appSpecificObservabilityHash(
                workspaceId,
                namespace: "sentry_workspace_id"
            )
        }
        let user: User = User(userId: hashedUserId)
        user.data = [
            "workspace_id_hash": hashedWorkspaceId ?? "",
            "account_kind": identity.accountKind.rawValue
        ]
        SentrySDK.setUser(user)
    }

    static func addBreadcrumb(_ event: IOSBreadcrumbEvent) {
        switch event {
        case .cloudFlow(let observation):
            self.logCloudFlow(observation)
            self.addSentryBreadcrumb(
                category: "ios.cloud",
                level: .info,
                message: "\(observation.phase.rawValue).\(observation.outcome.rawValue)",
                data: self.cloudFlowContext(observation)
            )
        case .aiChatLifecycle(let observation):
            self.writeLocalRecord(
                kind: "breadcrumb",
                feature: .aiChat,
                action: observation.action.rawValue,
                fields: self.aiChatLifecycleFields(observation)
            )
            self.addSentryBreadcrumb(
                category: "ios.ai_chat",
                level: .info,
                message: observation.action.rawValue,
                data: self.aiChatLifecycleContext(observation)
            )
        case .aiLiveLifecycle(let observation):
            self.writeLocalRecord(
                kind: "breadcrumb",
                feature: .aiLive,
                action: observation.action.rawValue,
                fields: self.aiLiveLifecycleFields(observation)
            )
            self.addSentryBreadcrumb(
                category: "ios.ai_live",
                level: .info,
                message: observation.action.rawValue,
                data: self.aiLiveLifecycleContext(observation)
            )
        case .notificationTap(let observation):
            self.writeLocalRecord(
                kind: "breadcrumb",
                feature: .notifications,
                action: observation.action.rawValue,
                fields: self.notificationTapFields(observation)
            )
            self.addSentryBreadcrumb(
                category: "ios.notifications",
                level: .info,
                message: observation.action.rawValue,
                data: self.notificationTapContext(observation)
            )
        }
    }

    static func captureWarning(_ event: IOSWarningEvent) {
        let payload: ObservationPayload = self.warningPayload(event)
        self.writeLocalRecord(
            kind: "warning",
            feature: payload.scope.feature,
            action: payload.action,
            fields: payload.localFields
        )
        guard self.state.isStarted() else {
            return
        }

        SentrySDK.capture(message: payload.message) { scope in
            self.applyScope(scope, payload: payload)
            scope.setLevel(.warning)
        }
    }

    static func captureException(_ event: IOSExceptionEvent) {
        let payload: ExceptionPayload = self.exceptionPayload(event)
        self.writeLocalRecord(
            kind: "exception",
            feature: payload.observation.scope.feature,
            action: payload.observation.action,
            fields: payload.observation.localFields
        )
        guard self.state.isStarted() else {
            return
        }

        let sanitizedError: NSError = sanitizedNSError(
            payload.error,
            action: payload.observation.action
        )
        SentrySDK.capture(error: sanitizedError) { scope in
            self.applyScope(scope, payload: payload.observation)
            scope.setLevel(.error)
        }
    }

    private static func addSentryBreadcrumb(
        category: String,
        level: SentryLevel,
        message: String,
        data: [String: Any]
    ) {
        guard self.state.isStarted() else {
            return
        }

        let breadcrumb: Breadcrumb = Breadcrumb(level: level, category: category)
        breadcrumb.type = "default"
        breadcrumb.message = message
        breadcrumb.data = sanitizedDictionary(data) ?? [:]
        SentrySDK.addBreadcrumb(breadcrumb)
    }

    private static func applyScope(_ scope: Scope, payload: ObservationPayload) {
        let tags: [String: String] = self.tags(
            scope: payload.scope,
            action: payload.action,
            statusCode: payload.statusCode,
            backendCode: payload.backendCode
        )
        for (key, value) in tags {
            scope.setTag(value: value, key: key)
        }
        scope.setContext(
            value: sanitizedDictionary(self.scopeContext(payload.scope)) ?? [:],
            key: "ios_observation"
        )
        scope.setContext(
            value: sanitizedDictionary(payload.context) ?? [:],
            key: "details"
        )
    }

    private static func warningPayload(_ event: IOSWarningEvent) -> ObservationPayload {
        switch event {
        case .aiChatLifecycle(let observation):
            return ObservationPayload(
                message: "iOS AI chat warning: \(observation.action.rawValue)",
                action: observation.action.rawValue,
                scope: observation.scope,
                statusCode: observation.statusCode,
                backendCode: observation.backendCode,
                context: self.aiChatLifecycleContext(observation),
                localFields: self.aiChatLifecycleFields(observation)
            )
        case .aiLiveUnknownEvent(let warning):
            let context: [String: Any] = [
                "session_id": warning.sessionId,
                "run_id": warning.runId ?? "",
                "after_cursor": warning.afterCursor ?? "",
                "event_type": warning.eventType,
                "request_id": warning.requestId ?? ""
            ]
            return ObservationPayload(
                message: "iOS AI live stream skipped an unknown event type",
                action: "ai_live_unknown_event",
                scope: warning.scope,
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        case .aiLiveLifecycle(let observation):
            return ObservationPayload(
                message: "iOS AI live warning: \(observation.action.rawValue)",
                action: observation.action.rawValue,
                scope: observation.scope,
                statusCode: observation.statusCode,
                backendCode: observation.backendCode,
                context: self.aiLiveLifecycleContext(observation),
                localFields: self.aiLiveLifecycleFields(observation)
            )
        case .cloudFlow(let observation):
            return ObservationPayload(
                message: "iOS cloud warning: \(observation.phase.rawValue).\(observation.outcome.rawValue)",
                action: observation.phase.rawValue,
                scope: observation.scope,
                statusCode: observation.statusCode,
                backendCode: observation.backendCode,
                context: self.cloudFlowContext(observation),
                localFields: self.cloudFlowFields(observation)
            )
        case .cloudRetry(let warning):
            let context: [String: Any] = [
                "attempt": warning.attempt,
                "max_attempts": warning.maxAttempts,
                "api_base_url": warning.apiBaseUrl ?? "",
                "message_summary": warning.messageSummary ?? ""
            ]
            return ObservationPayload(
                message: "iOS cloud retry: \(warning.action)",
                action: warning.action,
                scope: warning.scope,
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        case .localDataRepair(let warning):
            let context: [String: Any] = [
                "workspace_id": warning.workspaceId ?? "",
                "card_id_hash": hashedObservationIdentifierLogValue(warning.cardId, key: "card_id"),
                "reason_hash": hashedObservationIdentifier(warning.reason, key: "local_data_repair_reason"),
                "reason_length": warning.reason.count,
                "repair": warning.repair
            ]
            return ObservationPayload(
                message: "iOS local data repair warning: \(warning.action)",
                action: warning.action,
                scope: warning.scope,
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        case .invalidCardDueAt(let warning):
            let context: [String: Any] = [
                "card_id_hash": hashedObservationIdentifier(warning.cardId, key: "card_id"),
                "due_at": warning.dueAt
            ]
            return ObservationPayload(
                message: "iOS card due date is invalid",
                action: "invalid_card_due_at",
                scope: warning.scope,
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        case .notificationTapDropped(let warning):
            var context: [String: Any] = self.notificationTapContext(warning.observation)
            context["reason"] = warning.reason
            context["detail_summary"] = warning.detailSummary ?? ""
            return ObservationPayload(
                message: "iOS notification tap dropped",
                action: warning.observation.action.rawValue,
                scope: IOSObservationScope(
                    feature: .notifications,
                    userId: nil,
                    workspaceId: nil,
                    requestId: nil,
                    clientRequestId: nil,
                    sessionId: nil,
                    runId: nil,
                    cloudState: nil,
                    configurationMode: nil
                ),
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        case .progressCacheRemoved(let warning):
            let context: [String: Any] = [
                "cache_kind": warning.cacheKind,
                "cache_key_hash": hashedObservationIdentifier(
                    warning.key,
                    key: "progress_cache_key"
                ),
                "reason": warning.reason,
                "expected_scope_key_hash": warning.expectedScopeKey.map {
                    hashedObservationIdentifier($0, key: "progress_expected_scope_key")
                } ?? "",
                "actual_scope_key_hash": warning.actualScopeKey.map {
                    hashedObservationIdentifier($0, key: "progress_actual_scope_key")
                } ?? "",
                "has_actual_scope_key": warning.actualScopeKey == nil ? "false" : "true",
                "error_summary": warning.errorSummary ?? ""
            ]
            return ObservationPayload(
                message: "iOS progress cache entry removed",
                action: "progress_cache_removed",
                scope: warning.scope,
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        case .staleGuestCredentials(let warning):
            let context: [String: Any] = [
                "api_base_url": warning.apiBaseUrl,
                "message_summary": warning.messageSummary ?? ""
            ]
            return ObservationPayload(
                message: "iOS guest credentials were stale",
                action: "stale_guest_credentials",
                scope: warning.scope,
                statusCode: nil,
                backendCode: nil,
                context: context,
                localFields: stringifyContext(context)
            )
        }
    }

    private static func exceptionPayload(_ event: IOSExceptionEvent) -> ExceptionPayload {
        switch event {
        case .appStartupFailed(let error, let scope, let details):
            let context: [String: Any] = [
                "stage": details.stage,
                "message_summary": details.messageSummary
            ]
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS app startup failed",
                    action: "app_startup_failed",
                    scope: scope,
                    statusCode: nil,
                    backendCode: nil,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        case .cloudSyncFailed(let error, let scope, let details):
            let context: [String: Any] = [
                "status_code": details.statusCode.map { statusCode in String(statusCode) } ?? "",
                "backend_code": details.backendCode ?? "",
                "request_id": details.requestId ?? "",
                "message_summary": details.messageSummary ?? ""
            ]
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS cloud sync failed: \(details.action)",
                    action: details.action,
                    scope: scope,
                    statusCode: details.statusCode,
                    backendCode: details.backendCode,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        case .cloudAuthFailed(let error, let scope, let details):
            let context: [String: Any] = [
                "status_code": details.statusCode.map { statusCode in String(statusCode) } ?? "",
                "backend_code": details.backendCode ?? "",
                "request_id": details.requestId ?? "",
                "message_summary": details.messageSummary ?? ""
            ]
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS cloud auth failed: \(details.action)",
                    action: details.action,
                    scope: scope,
                    statusCode: details.statusCode,
                    backendCode: details.backendCode,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        case .aiChatFailed(let error, let scope, let details):
            let context: [String: Any] = self.aiChatFailureDiagnosticsContext(details)
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS AI chat failed: \(details.stage.rawValue)",
                    action: "ai_chat_failed",
                    scope: scope,
                    statusCode: details.statusCode,
                    backendCode: nil,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        case .aiLiveStreamFailed(let error, let scope, let details):
            let context: [String: Any] = [
                "session_id": details.sessionId,
                "run_id": details.runId ?? "",
                "after_cursor": details.afterCursor ?? "",
                "request_id": details.requestId ?? "",
                "backend_request_id": details.backendRequestId ?? "",
                "status_code": details.statusCode.map { statusCode in String(statusCode) } ?? "",
                "backend_code": details.backendCode ?? "",
                "client_request_id": details.clientRequestId ?? "",
                "failure_kind": details.failureKind,
                "stage": details.stage?.rawValue ?? "",
                "error_kind": details.errorKind?.rawValue ?? "",
                "event_type": details.eventType ?? "",
                "outcome": details.outcome ?? "",
                "has_decoder_summary": details.decoderSummary == nil ? "false" : "true",
                "decoder_summary_length": details.decoderSummary.map { decoderSummary in String(decoderSummary.count) } ?? "",
                "raw_snippet_length": details.rawSnippetLength.map { rawSnippetLength in String(rawSnippetLength) } ?? "",
                "idle_timeout_seconds": details.idleTimeoutSeconds.map { idleTimeoutSeconds in String(idleTimeoutSeconds) } ?? "",
                "is_error": details.isError.map { isError in String(isError) } ?? "",
                "is_stopped": details.isStopped.map { isStopped in String(isStopped) } ?? "",
                "resume_attempt": details.resumeAttempt.map { resumeAttempt in String(resumeAttempt) } ?? ""
            ]
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS AI live stream failed: \(details.failureKind)",
                    action: "ai_live_stream_failed",
                    scope: scope,
                    statusCode: details.statusCode,
                    backendCode: details.backendCode,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        case .notificationSchedulingFailed(let error, let scope, let details):
            let context: [String: Any] = [
                "workspace_id": details.workspaceId ?? "",
                "request_id": details.requestId ?? "",
                "stage": details.stage,
                "message_summary": details.messageSummary ?? ""
            ]
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS notification scheduling failed: \(details.action)",
                    action: details.action,
                    scope: scope,
                    statusCode: nil,
                    backendCode: nil,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        case .localDataRepairFailed(let error, let scope, let details):
            let context: [String: Any] = [
                "workspace_id": details.workspaceId ?? "",
                "entity_id_hash": hashedObservationIdentifierLogValue(details.entityId, key: "entity_id"),
                "reason_hash": hashedObservationIdentifier(details.reason, key: "local_data_repair_failure_reason"),
                "reason_length": details.reason.count,
                "message_summary": details.messageSummary ?? ""
            ]
            return ExceptionPayload(
                error: error,
                observation: ObservationPayload(
                    message: "iOS local data repair failed: \(details.action)",
                    action: details.action,
                    scope: scope,
                    statusCode: nil,
                    backendCode: nil,
                    context: context,
                    localFields: stringifyContext(context)
                )
            )
        }
    }

    private static func tags(
        scope: IOSObservationScope,
        action: String,
        statusCode: Int?,
        backendCode: String?
    ) -> [String: String] {
        var tags: [String: String] = [
            "platform": "ios",
            "feature": scope.feature.rawValue,
            "action": action
        ]
        if let requestId = scope.requestId, requestId.isEmpty == false {
            tags["request_id"] = requestId
        }
        if let statusCode {
            tags["status_code"] = String(statusCode)
        }
        if let backendCode, backendCode.isEmpty == false {
            tags["backend_code"] = backendCode
        }
        if let cloudState = scope.cloudState {
            tags["cloud_state"] = cloudState.rawValue
        }
        if let configurationMode = scope.configurationMode {
            tags["configuration_mode"] = configurationMode.rawValue
        }
        return tags
    }

    private static func scopeContext(_ scope: IOSObservationScope) -> [String: Any] {
        [
            "feature": scope.feature.rawValue,
            "user_id": scope.userId ?? "",
            "workspace_id": scope.workspaceId ?? "",
            "request_id": scope.requestId ?? "",
            "client_request_id": scope.clientRequestId ?? "",
            "session_id": scope.sessionId ?? "",
            "run_id": scope.runId ?? "",
            "cloud_state": scope.cloudState?.rawValue ?? "",
            "configuration_mode": scope.configurationMode?.rawValue ?? ""
        ]
    }

    private static func cloudFlowContext(_ observation: CloudFlowObservation) -> [String: Any] {
        [
            "phase": observation.phase.rawValue,
            "outcome": observation.outcome.rawValue,
            "request_id": observation.requestId ?? "",
            "backend_code": observation.backendCode ?? "",
            "status_code": observation.statusCode.map { statusCode in String(statusCode) } ?? "",
            "workspace_id": observation.workspaceId ?? "",
            "installation_id": observation.installationId ?? "",
            "selection": observation.selection ?? "",
            "source_workspace_id": observation.sourceWorkspaceId ?? "",
            "target_workspace_id": observation.targetWorkspaceId ?? "",
            "migration_kind": observation.migrationKind ?? "",
            "remote_workspace_is_empty": observation.remoteWorkspaceIsEmpty.map { remoteWorkspaceIsEmpty in String(remoteWorkspaceIsEmpty) } ?? "",
            "operations_count": observation.operationsCount.map { operationsCount in String(operationsCount) } ?? "",
            "review_schedule_impacting_operation_count": observation.reviewScheduleImpactingOperationCount.map { reviewScheduleImpactingOperationCount in String(reviewScheduleImpactingOperationCount) } ?? "",
            "changes_count": observation.changesCount.map { changesCount in String(changesCount) } ?? "",
            "error_summary": observation.errorSummary ?? ""
        ]
    }

    private static func cloudFlowFields(_ observation: CloudFlowObservation) -> [String: String] {
        stringifyContext(self.cloudFlowContext(observation))
    }

    private static func aiChatLifecycleContext(_ observation: AIChatLifecycleObservation) -> [String: Any] {
        [
            "session_id": observation.sessionId ?? "",
            "run_id": observation.runId ?? "",
            "conversation_scope_id": observation.conversationScopeId ?? "",
            "event_type": observation.eventType ?? "",
            "status_code": observation.statusCode.map { statusCode in String(statusCode) } ?? "",
            "backend_code": observation.backendCode ?? "",
            "backend_request_id": observation.backendRequestId ?? "",
            "client_request_id": observation.clientRequestId ?? "",
            "stage": observation.stage?.rawValue ?? "",
            "error_kind": observation.errorKind?.rawValue ?? "",
            "failure_kind": observation.failureKind ?? "",
            "attempt": observation.attempt.map { attempt in String(attempt) } ?? "",
            "max_attempts": observation.maxAttempts.map { maxAttempts in String(maxAttempts) } ?? "",
            "delay_nanoseconds": observation.delayNanoseconds.map { delayNanoseconds in String(delayNanoseconds) } ?? "",
            "outgoing_content_count": observation.outgoingContentCount.map { outgoingContentCount in String(outgoingContentCount) } ?? "",
            "content_count": observation.contentCount.map { contentCount in String(contentCount) } ?? "",
            "text_length": observation.textLength.map { textLength in String(textLength) } ?? "",
            "summary_length": observation.summaryLength.map { summaryLength in String(summaryLength) } ?? "",
            "suggestion_count": observation.suggestionCount.map { suggestionCount in String(suggestionCount) } ?? "",
            "is_error": observation.isError.map { isError in String(isError) } ?? "",
            "is_stopped": observation.isStopped.map { isStopped in String(isStopped) } ?? "",
            "outcome": observation.outcome ?? "",
            "reason": observation.reason ?? "",
            "error_summary": observation.errorSummary ?? ""
        ]
    }

    private static func aiChatLifecycleFields(_ observation: AIChatLifecycleObservation) -> [String: String] {
        stringifyContext(self.aiChatLifecycleContext(observation))
    }

    private static func aiLiveLifecycleContext(_ observation: AILiveLifecycleObservation) -> [String: Any] {
        [
            "session_id": observation.sessionId,
            "run_id": observation.runId ?? "",
            "after_cursor": observation.afterCursor ?? "",
            "request_id": observation.requestId ?? "",
            "backend_request_id": observation.backendRequestId ?? "",
            "client_request_id": observation.scope.clientRequestId ?? "",
            "backend_code": observation.backendCode ?? "",
            "status_code": observation.statusCode.map { statusCode in String(statusCode) } ?? "",
            "event_type": observation.eventType ?? "",
            "sequence_number": observation.sequenceNumber.map { sequenceNumber in String(sequenceNumber) } ?? "",
            "cursor": observation.cursor ?? "",
            "stream_epoch": observation.streamEpoch ?? "",
            "item_id": observation.itemId ?? "",
            "tool_name": observation.toolName ?? "",
            "tool_status": observation.toolStatus ?? "",
            "content_count": observation.contentCount.map { contentCount in String(contentCount) } ?? "",
            "text_length": observation.textLength.map { textLength in String(textLength) } ?? "",
            "summary_length": observation.summaryLength.map { summaryLength in String(summaryLength) } ?? "",
            "suggestion_count": observation.suggestionCount.map { suggestionCount in String(suggestionCount) } ?? "",
            "is_error": observation.isError.map { isError in String(isError) } ?? "",
            "is_stopped": observation.isStopped.map { isStopped in String(isStopped) } ?? "",
            "outcome": observation.outcome ?? "",
            "failure_kind": observation.failureKind ?? "",
            "stage": observation.stage?.rawValue ?? "",
            "error_kind": observation.errorKind?.rawValue ?? "",
            "resume_attempt": observation.resumeAttempt.map { resumeAttempt in String(resumeAttempt) } ?? ""
        ]
    }

    private static func aiLiveLifecycleFields(_ observation: AILiveLifecycleObservation) -> [String: String] {
        stringifyContext(self.aiLiveLifecycleContext(observation))
    }

    private static func notificationTapContext(_ observation: NotificationTapObservation) -> [String: Any] {
        [
            "build": appBuildNumber(),
            "notification_type": observation.notificationType,
            "source": observation.source?.rawValue ?? "",
            "app_state": observation.appState ?? "",
            "scene_phase_at_consume": observation.scenePhaseAtConsume ?? "",
            "received_at_millis": observation.receivedAtMillis.map { receivedAtMillis in String(receivedAtMillis) } ?? "",
            "stage": observation.stage ?? ""
        ]
    }

    private static func notificationTapFields(_ observation: NotificationTapObservation) -> [String: String] {
        stringifyContext(self.notificationTapContext(observation))
    }

    private static func aiChatFailureDiagnosticsContext(_ diagnostics: AIChatFailureDiagnostics) -> [String: Any] {
        [
            "client_request_id": diagnostics.clientRequestId,
            "backend_request_id": diagnostics.backendRequestId ?? "",
            "stage": diagnostics.stage.rawValue,
            "error_kind": diagnostics.errorKind.rawValue,
            "status_code": diagnostics.statusCode.map { statusCode in String(statusCode) } ?? "",
            "event_type": diagnostics.eventType ?? "",
            "tool_name": diagnostics.toolName ?? "",
            "tool_call_id": diagnostics.toolCallId ?? "",
            "line_number": diagnostics.lineNumber.map { lineNumber in String(lineNumber) } ?? "",
            "raw_snippet_length": diagnostics.rawSnippet.map(\.count).map { rawSnippetLength in String(rawSnippetLength) } ?? "",
            "has_decoder_summary": diagnostics.decoderSummary == nil ? "false" : "true",
            "decoder_summary_length": diagnostics.decoderSummary.map { decoderSummary in String(decoderSummary.count) } ?? "",
            "continuation_attempt": diagnostics.continuationAttempt.map { continuationAttempt in String(continuationAttempt) } ?? "",
            "continuation_tool_call_count": String(diagnostics.continuationToolCallIds.count)
        ]
    }

    private static func logCloudFlow(_ observation: CloudFlowObservation) {
        let workspaceIdHash: String = hashedObservationIdentifierLogValue(
            observation.workspaceId,
            key: "workspace_id"
        )
        let installationIdHash: String = hashedObservationIdentifierLogValue(
            observation.installationId,
            key: "installation_id"
        )
        let sourceWorkspaceIdHash: String = hashedObservationIdentifierLogValue(
            observation.sourceWorkspaceId,
            key: "source_workspace_id"
        )
        let targetWorkspaceIdHash: String = hashedObservationIdentifierLogValue(
            observation.targetWorkspaceId,
            key: "target_workspace_id"
        )
        self.cloudLogger.log(
            """
            phase=\(observation.phase.rawValue, privacy: .public) \
            outcome=\(observation.outcome.rawValue, privacy: .public) \
            requestId=\(observation.requestId ?? "-", privacy: .public) \
            code=\(observation.backendCode ?? "-", privacy: .public) \
            status=\(observation.statusCode.map { statusCode in String(statusCode) } ?? "-", privacy: .public) \
            workspaceIdHash=\(workspaceIdHash, privacy: .public) \
            installationIdHash=\(installationIdHash, privacy: .public) \
            selection=\(observation.selection ?? "-", privacy: .public) \
            sourceWorkspaceIdHash=\(sourceWorkspaceIdHash, privacy: .public) \
            targetWorkspaceIdHash=\(targetWorkspaceIdHash, privacy: .public) \
            migrationKind=\(observation.migrationKind ?? "-", privacy: .public) \
            remoteWorkspaceIsEmpty=\(observation.remoteWorkspaceIsEmpty.map { remoteWorkspaceIsEmpty in String(remoteWorkspaceIsEmpty) } ?? "-", privacy: .public) \
            operations=\(observation.operationsCount.map { operationsCount in String(operationsCount) } ?? "-", privacy: .public) \
            reviewScheduleImpactingOperations=\(observation.reviewScheduleImpactingOperationCount.map { reviewScheduleImpactingOperationCount in String(reviewScheduleImpactingOperationCount) } ?? "-", privacy: .public) \
            changes=\(observation.changesCount.map { changesCount in String(changesCount) } ?? "-", privacy: .public) \
            error=\(observation.errorSummary ?? "-", privacy: .private)
            """
        )
    }

    private static func writeLocalRecord(
        kind: String,
        feature: IOSObservationFeature,
        action: String,
        fields: [String: String]
    ) {
        var record: [String: String] = fields
        record["kind"] = kind
        record["platform"] = "ios"
        record["feature"] = feature.rawValue
        record["action"] = action
        let sanitizedRecord: [String: String] = sanitizedStringDictionary(record) ?? [:]

        guard JSONSerialization.isValidJSONObject(sanitizedRecord),
              let data: Data = try? JSONSerialization.data(withJSONObject: sanitizedRecord, options: [.sortedKeys]),
              let line: String = String(data: data, encoding: .utf8) else {
            self.observabilityLogger.error("observability local record serialization failed")
            return
        }

        fputs(line + "\n", stderr)
    }
}

private final class LockedSentryObservabilityState: @unchecked Sendable {
    private let lock: NSLock
    private var started: Bool

    init(isStarted: Bool) {
        self.lock = NSLock()
        self.started = isStarted
    }

    func setIsStarted(_ isStarted: Bool) {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.started = isStarted
    }

    func isStarted() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.started
    }
}

private struct SentryRuntimeConfiguration {
    let dsn: String
    let environment: String
    let tracesSampleRate: Double
    let invalidTracesSampleRate: String?
    let bundleIdentifier: String
    let marketingVersion: String
    let buildNumber: String
    let tracePropagationTargets: [Any]
}

private struct ParsedSentrySampleRate {
    let value: Double
    let invalidRawValue: String?
}

private struct ObservationPayload {
    let message: String
    let action: String
    let scope: IOSObservationScope
    let statusCode: Int?
    let backendCode: String?
    let context: [String: Any]
    let localFields: [String: String]
}

private struct ExceptionPayload {
    let error: Error
    let observation: ObservationPayload
}

private let filteredDiagnosticValue: String = "[Filtered]"
private let sanitizedNSErrorFallbackDomain: String = "FlashcardsObservabilitySanitizedError"
private let sentryEnvironmentInfoPlistKey: String = "FLASHCARDS_SENTRY_ENVIRONMENT"
private let sentryEnvironmentOverrideKey: String = "FLASHCARDS_SENTRY_ENVIRONMENT_OVERRIDE"

private func appSpecificObservabilityHash(_ value: String, namespace: String) -> String {
    let hashInput: String = "\(appBundleIdentifier()):observability:\(namespace):\(value)"
    let digest: SHA256.Digest = SHA256.hash(data: Data(hashInput.utf8))
    return digest.map { byte in
        String(format: "%02x", byte)
    }
    .joined()
}

private func sanitizedNSError(_ error: Error, action: String) -> NSError {
    let nsError: NSError = error as NSError
    let errorType: String = safeDiagnosticIdentifier(String(reflecting: type(of: error)))
    let originalDomain: String = safeDiagnosticIdentifier(nsError.domain)
    let userInfo: [String: Any] = [
        NSLocalizedDescriptionKey: "Sanitized iOS exception: \(safeDiagnosticIdentifier(action))",
        "flashcards_original_error_type": errorType,
        "flashcards_original_error_domain": originalDomain,
        "flashcards_original_error_code": String(nsError.code),
        "flashcards_original_user_info_key_count": String(nsError.userInfo.count),
        "flashcards_safe_user_info_keys": safeNSErrorUserInfoKeys(nsError.userInfo).joined(separator: ",")
    ]

    return NSError(
        domain: sanitizedNSErrorDomain(errorType: errorType, originalDomain: originalDomain),
        code: nsError.code,
        userInfo: userInfo
    )
}

private func sanitizedNSErrorDomain(errorType: String, originalDomain: String) -> String {
    if errorType != filteredDiagnosticValue, errorType != "Foundation.NSError", errorType != "NSError" {
        return errorType
    }
    if originalDomain != filteredDiagnosticValue {
        return originalDomain
    }
    return sanitizedNSErrorFallbackDomain
}

private func safeNSErrorUserInfoKeys(_ userInfo: [String: Any]) -> [String] {
    let sortedKeys: [String] = userInfo.keys.sorted()
    return sortedKeys.compactMap { key in
        guard isSensitiveKey(key) == false else {
            return nil
        }
        let safeKey: String = safeDiagnosticIdentifier(key)
        guard safeKey != filteredDiagnosticValue else {
            return nil
        }
        return safeKey
    }
}

private func safeDiagnosticIdentifier(_ value: String) -> String {
    let trimmedValue: String = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue.count <= 160 else {
        return filteredDiagnosticValue
    }

    let allowedCharacters: CharacterSet = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"
    )
    guard trimmedValue.rangeOfCharacter(from: allowedCharacters.inverted) == nil else {
        return filteredDiagnosticValue
    }
    guard redactedString(trimmedValue) == trimmedValue else {
        return filteredDiagnosticValue
    }
    return trimmedValue
}

private func loadSentryRuntimeConfiguration(bundle: Bundle, processInfo: ProcessInfo) -> SentryRuntimeConfiguration {
    let dsn: String = loadOptionalInfoPlistString(
        bundle: bundle,
        key: "FLASHCARDS_SENTRY_DSN"
    )
    let environment: String = loadSentryEnvironment(bundle: bundle, processInfo: processInfo)
    let rawTracesSampleRate: String = nonEmptyString(
        loadOptionalInfoPlistString(
            bundle: bundle,
            key: "FLASHCARDS_SENTRY_TRACES_SAMPLE_RATE"
        ),
        fallback: "0.0"
    )
    let parsedTracesSampleRate: ParsedSentrySampleRate = parseSentrySampleRate(rawTracesSampleRate)
    let bundleIdentifier: String = nonEmptyString(
        bundle.bundleIdentifier ?? loadOptionalInfoPlistString(bundle: bundle, key: "CFBundleIdentifier"),
        fallback: appBundleIdentifier()
    )
    let marketingVersion: String = nonEmptyString(
        loadOptionalInfoPlistString(bundle: bundle, key: "CFBundleShortVersionString"),
        fallback: appMarketingVersion()
    )
    let buildNumber: String = nonEmptyString(
        loadOptionalInfoPlistString(bundle: bundle, key: "CFBundleVersion"),
        fallback: appBuildNumber()
    )

    return SentryRuntimeConfiguration(
        dsn: dsn,
        environment: environment,
        tracesSampleRate: parsedTracesSampleRate.value,
        invalidTracesSampleRate: parsedTracesSampleRate.invalidRawValue,
        bundleIdentifier: bundleIdentifier,
        marketingVersion: marketingVersion,
        buildNumber: buildNumber,
        tracePropagationTargets: makeTracePropagationTargets(bundle: bundle)
    )
}

private func loadSentryEnvironment(bundle: Bundle, processInfo: ProcessInfo) -> String {
    let overrideValue: String = nonEmptyString(
        processInfo.environment[sentryEnvironmentOverrideKey] ?? "",
        fallback: ""
    )
    if overrideValue.isEmpty == false {
        return overrideValue
    }

    return nonEmptyString(
        loadOptionalInfoPlistString(
            bundle: bundle,
            key: sentryEnvironmentInfoPlistKey
        ),
        fallback: "local"
    )
}

private func loadOptionalInfoPlistString(bundle: Bundle, key: String) -> String {
    guard let rawValue: String = bundle.object(forInfoDictionaryKey: key) as? String else {
        return ""
    }

    return rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func nonEmptyString(_ value: String, fallback: String) -> String {
    let trimmedValue: String = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        return fallback
    }

    return trimmedValue
}

private func parseSentrySampleRate(_ value: String) -> ParsedSentrySampleRate {
    guard let sampleRate: Double = Double(value), sampleRate >= 0.0, sampleRate <= 1.0 else {
        return ParsedSentrySampleRate(value: 0.0, invalidRawValue: value)
    }

    return ParsedSentrySampleRate(value: sampleRate, invalidRawValue: nil)
}

private func makeTracePropagationTargets(bundle: Bundle) -> [Any] {
    var targets: [Any] = [
        "localhost",
        "127.0.0.1",
        "::1"
    ]
    let configuredUrls: [String] = [
        loadOptionalInfoPlistString(bundle: bundle, key: "FLASHCARDS_API_BASE_URL"),
        loadOptionalInfoPlistString(bundle: bundle, key: "FLASHCARDS_AUTH_BASE_URL")
    ]
    for configuredUrl in configuredUrls {
        guard let host: String = URLComponents(string: configuredUrl)?.host, host.isEmpty == false else {
            continue
        }
        targets.append(host)
    }
    if let lambdaFunctionUrlPattern: NSRegularExpression = try? NSRegularExpression(
        pattern: #"https://[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws"#,
        options: [.caseInsensitive]
    ) {
        targets.append(lambdaFunctionUrlPattern)
    }
    return targets
}

private func sanitizeSentryEvent(_ event: Event) -> Event? {
    if let request = event.request {
        request.headers = sanitizedHeaders(request.headers)
        request.cookies = nil
        request.url = request.url.map(redactedURLString)
        request.fragment = nil
        request.queryString = nil
    }
    event.extra = sanitizedDictionary(event.extra)
    event.context = sanitizedContextDictionary(event.context)
    event.tags = sanitizedStringDictionary(event.tags)
    event.breadcrumbs = sanitizedBreadcrumbs(event.breadcrumbs)
    if let exceptions: [Exception] = event.exceptions {
        for exception in exceptions {
            exception.value = exception.value.map(redactedString)
            exception.type = exception.type.map(safeDiagnosticIdentifier)
            if let mechanism: Mechanism = exception.mechanism {
                mechanism.desc = mechanism.desc.map(redactedString)
                mechanism.data = sanitizedDictionary(mechanism.data)
            }
        }
    }
    return event
}

private func sanitizeSentrySpan(_ span: any Span) -> (any Span)? {
    span.operation = redactedSpanText(span.operation)
    span.spanDescription = span.spanDescription.map(redactedSpanText)
    for (key, value) in span.data {
        span.setData(value: sanitizedSpanDataValue(value, key: key), key: key)
    }
    return span
}

private func sanitizedSpanDataValue(_ value: Any, key: String) -> Any {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    if stableObservationIdentifierHashKey(key) != nil {
        return hashedObservationIdentifierValue(value, key: key)
    }
    if isSensitiveKey(key) || normalizedKey.contains("query") || normalizedKey.contains("fragment") {
        return filteredDiagnosticValue
    }
    if normalizedKey.contains("url"), let urlString = value as? String {
        return redactedURLString(urlString)
    }
    return sanitizedValue(value)
}

private func sanitizedBreadcrumbs(_ breadcrumbs: [Breadcrumb]?) -> [Breadcrumb]? {
    guard let breadcrumbs else {
        return nil
    }

    return breadcrumbs.compactMap(sanitizeSentryBreadcrumb)
}

private func sanitizeSentryBreadcrumb(_ breadcrumb: Breadcrumb) -> Breadcrumb? {
    breadcrumb.category = redactedString(breadcrumb.category)
    breadcrumb.type = breadcrumb.type.map(redactedString)
    breadcrumb.message = breadcrumb.message.map(redactedString)
    breadcrumb.origin = breadcrumb.origin.map(redactedString)
    breadcrumb.data = sanitizedBreadcrumbData(breadcrumb.data) ?? [:]
    return breadcrumb
}

private func sanitizedBreadcrumbData(_ dictionary: [String: Any]?) -> [String: Any]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: Any] = [:]
    for (key, value) in dictionary {
        let normalizedKey: String = normalizedDiagnosticKey(key)
        if let hashKey: String = stableObservationIdentifierHashKey(key) {
            sanitized[hashKey] = hashedObservationIdentifierValue(value, key: key)
        } else if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else if normalizedKey == "url", let urlString = value as? String {
            sanitized[key] = redactedURLString(urlString)
        } else if normalizedKey == "httpquery" || normalizedKey == "httpfragment" {
            sanitized[key] = "[Filtered]"
        } else {
            sanitized[key] = sanitizedValue(value)
        }
    }
    return sanitized
}

private func sanitizedHeaders(_ headers: [String: String]?) -> [String: String]? {
    guard let headers else {
        return nil
    }

    var sanitizedHeaders: [String: String] = [:]
    for (key, value) in headers {
        if isSensitiveKey(key) {
            sanitizedHeaders[key] = "[Filtered]"
        } else {
            sanitizedHeaders[key] = redactedString(value)
        }
    }
    return sanitizedHeaders
}

private func sanitizedContextDictionary(_ dictionary: [String: [String: Any]]?) -> [String: [String: Any]]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: [String: Any]] = [:]
    for (key, value) in dictionary {
        sanitized[key] = sanitizedDictionary(value) ?? [:]
    }
    return sanitized
}

private func sanitizedDictionary(_ dictionary: [String: Any]?) -> [String: Any]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: Any] = [:]
    for (key, value) in dictionary {
        if let hashKey: String = stableObservationIdentifierHashKey(key) {
            sanitized[hashKey] = hashedObservationIdentifierValue(value, key: key)
        } else if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else {
            sanitized[key] = sanitizedValue(value)
        }
    }
    return sanitized
}

private func sanitizedStringDictionary(_ dictionary: [String: String]?) -> [String: String]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: String] = [:]
    for (key, value) in dictionary {
        if let hashKey: String = stableObservationIdentifierHashKey(key) {
            sanitized[hashKey] = hashedObservationIdentifier(value, key: key)
        } else if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else {
            sanitized[key] = redactedString(value)
        }
    }
    return sanitized
}

private func sanitizedValue(_ value: Any) -> Any {
    if let stringValue = value as? String {
        return redactedString(stringValue)
    }
    if let dictionaryValue = value as? [String: Any] {
        return sanitizedDictionary(dictionaryValue) ?? [:]
    }
    if let stringDictionaryValue = value as? [String: String] {
        return sanitizedStringDictionary(stringDictionaryValue) ?? [:]
    }
    if let arrayValue = value as? [Any] {
        return arrayValue.map(sanitizedValue)
    }
    return value
}

private func stableObservationIdentifierHashKey(_ key: String) -> String? {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    let passThroughIdentifierKeys: Set<String> = [
        "requestid",
        "clientrequestid",
        "backendrequestid"
    ]
    guard passThroughIdentifierKeys.contains(normalizedKey) == false else {
        return nil
    }

    if normalizedKey == "userid" ||
        normalizedKey == "cardid" ||
        normalizedKey == "entityid" ||
        normalizedKey == "conversationscopeid" ||
        normalizedKey == "eventconversationscopeid" ||
        normalizedKey == "cursor" ||
        normalizedKey == "aftercursor" ||
        normalizedKey == "eventcursor" ||
        normalizedKey == "livecursor" ||
        normalizedKey == "oldestcursor" ||
        normalizedKey == "streamepoch" ||
        normalizedKey == "eventstreamepoch" ||
        normalizedKey == "activestreamepoch" ||
        normalizedKey == "installationid" ||
        normalizedKey.hasSuffix("sessionid") ||
        normalizedKey.hasSuffix("runid") ||
        normalizedKey.hasSuffix("itemid") ||
        normalizedKey.hasSuffix("messageid") ||
        normalizedKey.hasSuffix("toolcallid") ||
        normalizedKey.hasSuffix("workspaceid") {
        return key.hasSuffix("_hash") ? key : "\(key)_hash"
    }

    return nil
}

private func hashedObservationIdentifierValue(_ value: Any, key: String) -> Any {
    if let stringValue: String = value as? String {
        return hashedObservationIdentifier(stringValue, key: key)
    }
    if let stringArray: [String] = value as? [String] {
        return stringArray.map { item in
            hashedObservationIdentifier(item, key: key)
        }
    }
    return filteredDiagnosticValue
}

private func hashedObservationIdentifierLogValue(_ value: String?, key: String) -> String {
    guard let value, value.isEmpty == false else {
        return "-"
    }
    return hashedObservationIdentifier(value, key: key)
}

private func hashedObservationIdentifier(_ value: String, key: String) -> String {
    guard value.isEmpty == false else {
        return value
    }
    return appSpecificObservabilityHash(
        value,
        namespace: "observation_\(normalizedDiagnosticKey(key))"
    )
}

private func isSensitiveKey(_ key: String) -> Bool {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    let safeDiagnosticKeys: Set<String> = [
        "codingpath",
        "decodersummarylength",
        "eventtype",
        "hasdecodersummary",
        "payloadbytes",
        "payloadlength",
        "rawsnippetlength"
    ]
    if safeDiagnosticKeys.contains(normalizedKey) {
        return false
    }

    let sensitiveFragments: [String] = [
        "authorization",
        "cookie",
        "csrftoken",
        "refreshtoken",
        "idtoken",
        "otpsessiontoken",
        "token",
        "fronttext",
        "backtext",
        "prompt",
        "rawoutput",
        "rawsnippet",
        "payloadsnippet",
        "responsebody",
        "requestbody",
        "body",
        "localizeddescription",
        "debugdescription",
        "decodersummary",
        "underlyingerror",
        "messagesummary",
        "errorsummary",
        "detailsummary",
        "base64data",
        "email"
    ]
    return sensitiveFragments.contains { fragment in
        normalizedKey.contains(fragment)
    }
}

private func normalizedDiagnosticKey(_ key: String) -> String {
    key
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: ".", with: "")
        .lowercased()
}

private func redactedURLString(_ value: String) -> String {
    guard let redactedURL: String = redactedAbsoluteURLString(value) else {
        if let redactedRelativeURL: String = redactedRelativeURLString(value) {
            return redactedSensitiveString(redactedRelativeURL)
        }
        return redactedString(value)
    }

    return redactedSensitiveString(redactedURL)
}

private func redactedAbsoluteURLString(_ value: String) -> String? {
    guard var components = URLComponents(string: value),
          components.scheme != nil,
          components.host != nil else {
        return nil
    }

    components.query = nil
    components.fragment = nil
    components.path = redactedURLPath(components.path)
    return components.string ?? value
}

private func redactedRelativeURLString(_ value: String) -> String? {
    guard var components = URLComponents(string: value),
          components.path.hasPrefix("/") else {
        return nil
    }

    components.query = nil
    components.fragment = nil
    components.path = redactedURLPath(components.path)
    return components.string ?? value
}

private func redactedURLPath(_ path: String) -> String {
    path
        .split(separator: "/", omittingEmptySubsequences: false)
        .map { segment -> String in
            let segmentValue: String = String(segment)
            guard shouldRedactURLPathSegment(segmentValue) else {
                return segmentValue
            }
            return "[Filtered]"
        }
        .joined(separator: "/")
}

private func shouldRedactURLPathSegment(_ segment: String) -> Bool {
    let decodedSegment: String = segment.removingPercentEncoding ?? segment
    guard decodedSegment.isEmpty == false else {
        return false
    }

    if decodedSegment.range(
        of: #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#,
        options: .regularExpression
    ) != nil {
        return true
    }

    if decodedSegment.count >= 20,
       decodedSegment.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil {
        return true
    }

    return false
}

private func redactedString(_ value: String) -> String {
    guard value.isEmpty == false else {
        return value
    }

    return redactedSensitiveString(redactedEmbeddedURLStrings(value))
}

private func redactedSpanText(_ value: String) -> String {
    let urlRedactedValue: String = redactedString(value)
    let parts: [Substring] = urlRedactedValue.split(
        separator: " ",
        omittingEmptySubsequences: false
    )
    return parts
        .map { part -> String in
            let partValue: String = String(part)
            guard partValue.contains("?") || partValue.contains("#") else {
                return partValue
            }
            return redactedURLString(partValue)
        }
        .joined(separator: " ")
}

private func redactedEmbeddedURLStrings(_ value: String) -> String {
    let urlPattern: String = #"https?://[^\s\)\]\}"]+"#
    guard let urlRegex: NSRegularExpression = try? NSRegularExpression(
        pattern: urlPattern,
        options: [.caseInsensitive]
    ) else {
        return value
    }

    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let matches: [NSTextCheckingResult] = urlRegex.matches(
        in: value,
        options: [],
        range: fullRange
    )
    var redactedValue: String = value
    for match in matches.reversed() {
        guard let range: Range<String.Index> = Range(match.range, in: redactedValue) else {
            continue
        }
        let matchedURL: String = String(redactedValue[range])
        let replacement: String = redactedAbsoluteURLString(matchedURL) ?? redactedSensitiveString(matchedURL)
        redactedValue.replaceSubrange(range, with: replacement)
    }
    return redactedValue
}

private func redactedSensitiveString(_ value: String) -> String {
    let emailPattern: String = #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#
    let emailRegex: NSRegularExpression? = try? NSRegularExpression(
        pattern: emailPattern,
        options: [.caseInsensitive]
    )
    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let emailRedacted: String = emailRegex?.stringByReplacingMatches(
        in: value,
        options: [],
        range: fullRange,
        withTemplate: "[Filtered email]"
    ) ?? value

    let jwtPattern: String = #"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#
    let jwtRegex: NSRegularExpression? = try? NSRegularExpression(pattern: jwtPattern)
    let jwtRange: NSRange = NSRange(emailRedacted.startIndex..<emailRedacted.endIndex, in: emailRedacted)
    return jwtRegex?.stringByReplacingMatches(
        in: emailRedacted,
        options: [],
        range: jwtRange,
        withTemplate: "[Filtered token]"
    ) ?? emailRedacted
}

private func stringifyContext(_ context: [String: Any]) -> [String: String] {
    var fields: [String: String] = [:]
    for (key, value) in context {
        fields[key] = String(describing: value)
    }
    return fields
}
