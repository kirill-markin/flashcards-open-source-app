import Foundation
import Sentry

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

extension SentryObservabilityAdapter {
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
        case .notificationSchedulingFailed(let warning):
            let context: [String: Any] = [
                "notification_kind": warning.notificationKind,
                "workspace_id": warning.workspaceId ?? "",
                "notification_request_id_hash": warning.requestId.map {
                    hashedObservationIdentifier($0, key: "notification_request_id")
                } ?? "",
                "stage": warning.stage,
                "planned_count": String(warning.plannedCount),
                "accepted_count": String(warning.acceptedCount),
                "pending_before_count": String(warning.pendingBeforeCount),
                "pending_after_count": String(warning.pendingAfterCount),
                "error_domain": warning.errorDomain ?? "",
                "error_code": warning.errorCode.map { errorCode in String(errorCode) } ?? "",
                "message_summary": warning.messageSummary ?? ""
            ]
            return ObservationPayload(
                message: "iOS notification scheduling warning: \(warning.action)",
                action: warning.action,
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

    static func writeLocalRecord(
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
