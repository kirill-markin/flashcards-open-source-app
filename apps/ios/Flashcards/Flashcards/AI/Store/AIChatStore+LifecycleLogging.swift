import Foundation

func logAIChatStoreEvent(action: String, metadata: [String: String]) {
    if action.hasPrefix("ai_live") {
        logAIChatStoreLiveEvent(action: action, metadata: metadata)
        return
    }

    logAIChatStoreLifecycleEvent(action: action, metadata: metadata)
}

private func logAIChatStoreLifecycleEvent(action: String, metadata: [String: String]) {
    let actionValue: AIChatLifecycleAction = AIChatLifecycleAction(rawValue: action) ?? .storeLifecycle
    let requestId: String? = metadata["backendRequestId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["requestId"].flatMap(aiChatStoreNonPlaceholderString)
    let sessionId: String? = aiChatStoreSessionId(metadata: metadata)
    let runId: String? = aiChatStoreRunId(metadata: metadata)
    let scope = IOSObservationScope(
        feature: .aiChat,
        userId: nil,
        workspaceId: metadata["workspaceId"].flatMap(aiChatStoreNonPlaceholderString),
        requestId: requestId,
        clientRequestId: metadata["clientRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        sessionId: sessionId,
        runId: runId,
        cloudState: nil,
        configurationMode: nil
    )
    let observation = AIChatLifecycleObservation(
        action: actionValue,
        scope: scope,
        sessionId: sessionId,
        runId: runId,
        conversationScopeId: metadata["conversationScopeId"].flatMap(aiChatStoreNonPlaceholderString),
        eventType: metadata["eventType"].flatMap(aiChatStoreNonPlaceholderString),
        statusCode: metadata["statusCode"].flatMap(Int.init),
        backendCode: metadata["backendCode"].flatMap(aiChatStoreNonPlaceholderString),
        backendRequestId: metadata["backendRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        clientRequestId: metadata["clientRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        failureKind: metadata["failureKind"].flatMap(aiChatStoreNonPlaceholderString)
            ?? metadata["errorType"].flatMap(aiChatStoreNonPlaceholderString)
            ?? (actionValue == .storeLifecycle ? action : nil),
        attempt: metadata["attempt"].flatMap(Int.init)
            ?? metadata["nextAttempt"].flatMap(Int.init)
            ?? metadata["resumeAttempt"].flatMap(Int.init),
        maxAttempts: metadata["maxAttempts"].flatMap(Int.init),
        delayNanoseconds: metadata["delayNanoseconds"].flatMap(UInt64.init),
        outgoingContentCount: metadata["outgoingContentCount"].flatMap(Int.init),
        contentCount: metadata["contentCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        textLength: metadata["textLength"].flatMap(Int.init),
        summaryLength: metadata["summaryLength"].flatMap(Int.init),
        suggestionCount: metadata["suggestionCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        isError: metadata["isError"].flatMap(aiChatStoreBool),
        isStopped: metadata["isStopped"].flatMap(aiChatStoreBool),
        outcome: metadata["outcome"].flatMap(aiChatStoreNonPlaceholderString),
        reason: metadata["reason"].flatMap(aiChatStoreNonPlaceholderString),
        errorSummary: nil
    )

    if aiChatStoreLifecycleEventIsWarning(actionValue) {
        FlashcardsObservability.captureWarning(.aiChatLifecycle(observation))
        return
    }

    FlashcardsObservability.addBreadcrumb(.aiChatLifecycle(observation))
}

private func logAIChatStoreLiveEvent(action: String, metadata: [String: String]) {
    let actionValue: AILiveLifecycleAction = AILiveLifecycleAction(rawValue: action) ?? .eventReceived
    let requestId: String? = metadata["requestId"].flatMap(aiChatStoreNonPlaceholderString)
    let backendRequestId: String? = metadata["backendRequestId"].flatMap(aiChatStoreNonPlaceholderString)
    let sessionId: String = aiChatStoreSessionId(metadata: metadata) ?? "unknown"
    let runId: String? = aiChatStoreRunId(metadata: metadata)
    let scope = IOSObservationScope(
        feature: .aiLive,
        userId: nil,
        workspaceId: metadata["workspaceId"].flatMap(aiChatStoreNonPlaceholderString),
        requestId: backendRequestId ?? requestId,
        clientRequestId: metadata["clientRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        sessionId: sessionId,
        runId: runId,
        cloudState: nil,
        configurationMode: nil
    )
    let observation = AILiveLifecycleObservation(
        action: actionValue,
        scope: scope,
        sessionId: sessionId,
        runId: runId,
        afterCursor: metadata["afterCursor"].flatMap(aiChatStoreNonPlaceholderString),
        requestId: requestId,
        backendRequestId: backendRequestId,
        backendCode: metadata["backendCode"].flatMap(aiChatStoreNonPlaceholderString),
        statusCode: metadata["statusCode"].flatMap(Int.init),
        eventType: metadata["eventType"].flatMap(aiChatStoreNonPlaceholderString),
        sequenceNumber: metadata["sequenceNumber"].flatMap(Int.init),
        cursor: metadata["cursor"].flatMap(aiChatStoreNonPlaceholderString),
        streamEpoch: metadata["streamEpoch"].flatMap(aiChatStoreNonPlaceholderString),
        itemId: metadata["itemId"].flatMap(aiChatStoreNonPlaceholderString),
        toolName: metadata["toolName"].flatMap(aiChatStoreNonPlaceholderString),
        toolStatus: metadata["toolStatus"].flatMap(aiChatStoreNonPlaceholderString),
        contentCount: metadata["contentCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        textLength: metadata["textLength"].flatMap(Int.init),
        summaryLength: metadata["summaryLength"].flatMap(Int.init),
        suggestionCount: metadata["suggestionCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        isError: metadata["isError"].flatMap(aiChatStoreBool),
        isStopped: metadata["isStopped"].flatMap(aiChatStoreBool),
        outcome: metadata["outcome"].flatMap(aiChatStoreNonPlaceholderString),
        failureKind: metadata["failureKind"].flatMap(aiChatStoreNonPlaceholderString)
            ?? metadata["reason"].flatMap(aiChatStoreNonPlaceholderString),
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        resumeAttempt: metadata["resumeAttempt"].flatMap(Int.init)
    )

    if aiChatStoreLiveEventIsWarning(actionValue) {
        FlashcardsObservability.captureWarning(.aiLiveLifecycle(observation))
        return
    }

    FlashcardsObservability.addBreadcrumb(.aiLiveLifecycle(observation))
}

private func aiChatStoreSessionId(metadata: [String: String]) -> String? {
    metadata["chatSessionId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["sessionId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["eventSessionId"].flatMap(aiChatStoreNonPlaceholderString)
}

private func aiChatStoreRunId(metadata: [String: String]) -> String? {
    metadata["runId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["activeRunId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["eventRunId"].flatMap(aiChatStoreNonPlaceholderString)
}

private func aiChatStoreLifecycleEventIsWarning(_ action: AIChatLifecycleAction) -> Bool {
    switch action {
    case .runFail,
            .runFailed,
            .stopFailed,
            .bootstrapSessionContractMismatch,
            .chatUnknownContentReceived:
        return true
    case .runStart,
            .runStarted,
            .bootstrapRetryScheduled,
            .newSessionRetryScheduled,
            .contentUnknown,
            .storeLifecycle:
        return false
    }
}

private func aiChatStoreLiveEventIsWarning(_ action: AILiveLifecycleAction) -> Bool {
    switch action {
    case .terminalEventReconcileRequired:
        return true
    case .connectStart,
            .httpResponse,
            .eventReceived,
            .eventSkippedUnknownType,
            .cancelled,
            .finish,
            .finishError,
            .attach,
            .detach,
            .error,
            .eventParseFailed,
            .eventHandleStart,
            .eventIgnoredStale,
            .eventApplied,
            .eventHandleApplied,
            .terminalEventApplied,
            .composerSuggestionsApplied,
            .repairStatusApplied,
            .terminalApplied:
        return false
    }
}

private func aiChatStoreBool(_ value: String) -> Bool? {
    switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "true":
        return true
    case "false":
        return false
    default:
        return nil
    }
}

private func aiChatStoreNonPlaceholderString(_ value: String) -> String? {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue != "-" else {
        return nil
    }

    return trimmedValue
}
