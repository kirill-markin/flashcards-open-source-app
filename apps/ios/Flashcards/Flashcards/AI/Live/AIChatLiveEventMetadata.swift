import Foundation

struct AIChatLiveEventMetadata: Hashable, Sendable {
    let sessionId: String
    let conversationScopeId: String
    let runId: String
    let cursor: String?
    let requestId: String?
    let clientRequestId: String?
    let sequenceNumber: Int
    let streamEpoch: String
}

func aiChatLiveEventLogMetadata(
    event: AIChatLiveEvent,
    sessionId: String,
    requestedRunId: String,
    afterCursor: String?,
    clientRequestId: String
) -> [String: String] {
    let liveMetadata = aiChatLiveEventMetadata(event)
    var metadata: [String: String] = [
        "sessionId": sessionId,
        "requestedRunId": requestedRunId,
        "afterCursor": afterCursor ?? "-",
        "eventSessionId": liveMetadata.sessionId,
        "conversationScopeId": liveMetadata.conversationScopeId,
        "eventRunId": liveMetadata.runId,
        "cursor": liveMetadata.cursor ?? "-",
        "clientRequestId": clientRequestId,
        "requestId": liveMetadata.requestId ?? "-",
        "sequenceNumber": String(liveMetadata.sequenceNumber),
        "streamEpoch": liveMetadata.streamEpoch
    ]

    switch event {
    case .assistantDelta(metadata: _, text: let text, itemId: let itemId):
        metadata["eventType"] = "assistant_delta"
        metadata["itemId"] = itemId
        metadata["textLength"] = String(text.count)
    case .assistantToolCall(metadata: _, toolCall: let toolCall, itemId: let itemId):
        metadata["eventType"] = "assistant_tool_call"
        metadata["itemId"] = itemId
        metadata["toolName"] = toolCall.name
        metadata["toolStatus"] = toolCall.status.rawValue
    case .assistantReasoningStarted(metadata: _, reasoningId: let reasoningId, itemId: let itemId):
        metadata["eventType"] = "assistant_reasoning_started"
        metadata["itemId"] = itemId
        metadata["reasoningId"] = reasoningId
    case .assistantReasoningSummary(
        metadata: _,
        reasoningId: let reasoningId,
        summary: let summary,
        itemId: let itemId
    ):
        metadata["eventType"] = "assistant_reasoning_summary"
        metadata["itemId"] = itemId
        metadata["reasoningId"] = reasoningId
        metadata["summaryLength"] = String(summary.count)
    case .assistantReasoningDone(metadata: _, reasoningId: let reasoningId, itemId: let itemId):
        metadata["eventType"] = "assistant_reasoning_done"
        metadata["itemId"] = itemId
        metadata["reasoningId"] = reasoningId
    case .assistantMessageDone(
        metadata: _,
        itemId: let itemId,
        content: let content,
        isError: let isError,
        isStopped: let isStopped
    ):
        metadata["eventType"] = "assistant_message_done"
        metadata["itemId"] = itemId
        metadata["contentCount"] = String(content.count)
        metadata["isError"] = isError ? "true" : "false"
        metadata["isStopped"] = isStopped ? "true" : "false"
    case .composerSuggestionsUpdated(metadata: _, suggestions: let suggestions):
        metadata["eventType"] = "composer_suggestions_updated"
        metadata["suggestionCount"] = String(suggestions.count)
    case .repairStatus(metadata: _, status: let status):
        metadata["eventType"] = "repair_status"
        metadata["attempt"] = String(status.attempt)
        metadata["maxAttempts"] = String(status.maxAttempts)
        metadata["toolName"] = status.toolName ?? "-"
    case .runTerminal(
        metadata: _,
        outcome: let outcome,
        message: let message,
        assistantItemId: let assistantItemId,
        isError: let isError,
        isStopped: let isStopped
    ):
        metadata["eventType"] = "run_terminal"
        metadata["outcome"] = outcome.rawValue
        metadata["message"] = message ?? "-"
        metadata["assistantItemId"] = assistantItemId ?? "-"
        metadata["isError"] = isError.map { $0 ? "true" : "false" } ?? "-"
        metadata["isStopped"] = isStopped.map { $0 ? "true" : "false" } ?? "-"
    }

    return metadata
}

func logAIChatLiveClientEvent(action: String, metadata: [String: String]) {
    let actionValue = AILiveLifecycleAction(rawValue: action) ?? .eventReceived
    let requestId = metadata["requestId"].flatMap(nonPlaceholderString)
    let backendRequestId = metadata["backendRequestId"].flatMap(nonPlaceholderString)
    let clientRequestId = metadata["clientRequestId"].flatMap(nonPlaceholderString)
    let sessionId = metadata["sessionId"].flatMap(nonPlaceholderString)
        ?? metadata["eventSessionId"].flatMap(nonPlaceholderString)
        ?? "-"
    let runId = metadata["runId"].flatMap(nonPlaceholderString)
        ?? metadata["eventRunId"].flatMap(nonPlaceholderString)
        ?? metadata["requestedRunId"].flatMap(nonPlaceholderString)
    let statusCode = metadata["statusCode"].flatMap(Int.init)
    let scope = IOSObservationScope(
        feature: .aiLive,
        userId: nil,
        workspaceId: nil,
        requestId: backendRequestId ?? requestId,
        clientRequestId: clientRequestId,
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
        afterCursor: metadata["afterCursor"].flatMap(nonPlaceholderString),
        requestId: requestId,
        backendRequestId: backendRequestId,
        backendCode: metadata["backendCode"].flatMap(nonPlaceholderString),
        statusCode: statusCode,
        eventType: metadata["eventType"].flatMap(nonPlaceholderString),
        sequenceNumber: metadata["sequenceNumber"].flatMap(Int.init),
        cursor: metadata["cursor"].flatMap(nonPlaceholderString),
        streamEpoch: metadata["streamEpoch"].flatMap(nonPlaceholderString),
        itemId: metadata["itemId"].flatMap(nonPlaceholderString),
        toolName: metadata["toolName"].flatMap(nonPlaceholderString),
        toolStatus: metadata["toolStatus"].flatMap(nonPlaceholderString),
        contentCount: metadata["contentCount"].flatMap(Int.init),
        textLength: metadata["textLength"].flatMap(Int.init),
        summaryLength: metadata["summaryLength"].flatMap(Int.init),
        suggestionCount: metadata["suggestionCount"].flatMap(Int.init),
        isError: metadata["isError"].flatMap(Bool.init),
        isStopped: metadata["isStopped"].flatMap(Bool.init),
        outcome: metadata["outcome"].flatMap(nonPlaceholderString),
        failureKind: metadata["failureKind"].flatMap(nonPlaceholderString),
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        resumeAttempt: metadata["resumeAttempt"].flatMap(Int.init)
    )
    FlashcardsObservability.addBreadcrumb(.aiLiveLifecycle(observation))
}

private func nonPlaceholderString(_ value: String) -> String? {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue != "-" else {
        return nil
    }

    return trimmedValue
}

func aiChatLiveEventMetadata(_ event: AIChatLiveEvent) -> AIChatLiveEventMetadata {
    switch event {
    case .assistantDelta(metadata: let metadata, text: _, itemId: _):
        return metadata
    case .assistantToolCall(metadata: let metadata, toolCall: _, itemId: _):
        return metadata
    case .assistantReasoningStarted(metadata: let metadata, reasoningId: _, itemId: _):
        return metadata
    case .assistantReasoningSummary(metadata: let metadata, reasoningId: _, summary: _, itemId: _):
        return metadata
    case .assistantReasoningDone(metadata: let metadata, reasoningId: _, itemId: _):
        return metadata
    case .assistantMessageDone(metadata: let metadata, itemId: _, content: _, isError: _, isStopped: _):
        return metadata
    case .composerSuggestionsUpdated(metadata: let metadata, suggestions: _):
        return metadata
    case .repairStatus(metadata: let metadata, status: _):
        return metadata
    case .runTerminal(
        metadata: let metadata,
        outcome: _,
        message: _,
        assistantItemId: _,
        isError: _,
        isStopped: _
    ):
        return metadata
    }
}
