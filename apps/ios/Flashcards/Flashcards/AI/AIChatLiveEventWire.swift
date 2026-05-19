import Foundation

struct AIChatLiveEventDecodingContext: Sendable {
    let sessionId: String
    let afterCursor: String?
    let clientRequestId: String
    let requestId: String?
}

struct AIChatLiveStreamContractError: LocalizedError, AIChatFailureDiagnosticProviding {
    let diagnostics: AIChatFailureDiagnostics

    var errorDescription: String? {
        appendCloudRequestIdReference(
            message: "AI live stream payload is invalid.",
            requestId: self.diagnostics.backendRequestId
        )
    }
}

private struct AIChatLiveEventTypeEnvelope: Decodable {
    let type: AIChatLiveEventType
}

private struct AIChatLiveUnknownEventTypeEnvelope: Decodable {
    let type: String
}

private enum AIChatLiveEventType: String, Decodable {
    case assistantDelta = "assistant_delta"
    case assistantToolCall = "assistant_tool_call"
    case assistantReasoningStarted = "assistant_reasoning_started"
    case assistantReasoningSummary = "assistant_reasoning_summary"
    case assistantReasoningDone = "assistant_reasoning_done"
    case assistantMessageDone = "assistant_message_done"
    case composerSuggestionsUpdated = "composer_suggestions_updated"
    case repairStatus = "repair_status"
    case runTerminal = "run_terminal"
}

private struct AIChatLiveEventMetadataWire: Decodable {
    let sessionId: String
    let conversationScopeId: String
    let runId: String
    let cursor: String?
    let sequenceNumber: Int
    let streamEpoch: String
}

private struct AIChatLiveAssistantDeltaWirePayload: Decodable {
    let text: String
    let itemId: String
}

private struct AIChatLiveAssistantToolCallWirePayload: Decodable {
    let toolCallId: String
    let name: String
    let status: AIChatToolCallStatus
    let input: String?
    let output: String?
    let itemId: String
}

private struct AIChatLiveAssistantReasoningStartedWirePayload: Decodable {
    let reasoningId: String
    let itemId: String
}

private struct AIChatLiveAssistantReasoningSummaryWirePayload: Decodable {
    let reasoningId: String
    let summary: String
    let itemId: String
}

private struct AIChatLiveAssistantReasoningDoneWirePayload: Decodable {
    let reasoningId: String
    let itemId: String
}

private struct AIChatLiveAssistantMessageDoneWirePayload: Decodable {
    let itemId: String
    let content: [AIChatContentPart]
    let isError: Bool
    let isStopped: Bool
}

private struct AIChatLiveRepairStatusWirePayload: Decodable {
    let message: String
    let attempt: Int
    let maxAttempts: Int
    let toolName: String?
}

private struct AIChatLiveComposerSuggestionsUpdatedWirePayload: Decodable {
    let suggestions: [AIChatComposerSuggestion]
}

private struct AIChatLiveRunTerminalWirePayload: Decodable {
    let outcome: AIChatRunTerminalOutcome
    let message: String?
    let assistantItemId: String?
    let isError: Bool?
    let isStopped: Bool?
}

/**
 * Unknown live event types are forward-compatible extension points and must be
 * skipped. Known event types remain strict: any invalid payload is a contract
 * error that fails the stream.
 */
enum AIChatLiveEventDecodingResult {
    case event(AIChatLiveEvent)
    case ignoredUnknownType(eventType: String)
}

func decodeAIChatLiveEvent(
    eventType: String?,
    payload: String,
    decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder(),
    context: AIChatLiveEventDecodingContext = AIChatLiveEventDecodingContext(
        sessionId: "-",
        afterCursor: nil,
        clientRequestId: "-",
        requestId: nil
    )
) throws -> AIChatLiveEvent? {
    switch try decodeAIChatLiveEventResult(
        eventType: eventType,
        payload: payload,
        decoder: decoder,
        context: context
    ) {
    case .event(let event):
        return event
    case .ignoredUnknownType:
        return nil
    }
}

func decodeAIChatLiveEventResult(
    eventType: String?,
    payload: String,
    decoder: JSONDecoder,
    context: AIChatLiveEventDecodingContext
) throws -> AIChatLiveEventDecodingResult {
    guard let data = payload.data(using: .utf8) else {
        throw makeAIChatLiveStreamContractError(
            eventType: eventType,
            payload: payload,
            context: context,
            summary: "AI live stream payload is not valid UTF-8.",
            underlyingError: nil
        )
    }

    let resolvedType: AIChatLiveEventType
    do {
        if let eventType {
            guard let parsedEventType = AIChatLiveEventType(rawValue: eventType) else {
                return .ignoredUnknownType(eventType: eventType)
            }
            resolvedType = parsedEventType
        } else {
            let rawType = try decoder.decode(AIChatLiveUnknownEventTypeEnvelope.self, from: data).type
            guard let parsedEventType = AIChatLiveEventType(rawValue: rawType) else {
                return .ignoredUnknownType(eventType: rawType)
            }
            resolvedType = parsedEventType
        }
    } catch let error as AIChatLiveStreamContractError {
        throw error
    } catch {
        throw makeAIChatLiveStreamContractError(
            eventType: eventType,
            payload: payload,
            context: context,
            summary: "AI live stream event type could not be decoded.",
            underlyingError: error
        )
    }

    let metadata: AIChatLiveEventMetadataWire
    do {
        metadata = try decoder.decode(AIChatLiveEventMetadataWire.self, from: data)
    } catch {
        throw makeAIChatLiveStreamContractError(
            eventType: resolvedType.rawValue,
            payload: payload,
            context: context,
            summary: "AI live stream event metadata is missing required fields or contains invalid values.",
            underlyingError: error
        )
    }

    do {
        switch resolvedType {
        case .assistantDelta:
            let event = try decoder.decode(AIChatLiveAssistantDeltaWirePayload.self, from: data)
            return .event(.assistantDelta(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                text: event.text,
                itemId: event.itemId
            ))
        case .assistantToolCall:
            let event = try decoder.decode(AIChatLiveAssistantToolCallWirePayload.self, from: data)
            return .event(.assistantToolCall(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                toolCall: AIChatToolCall(
                    id: event.toolCallId,
                    name: event.name,
                    status: event.status,
                    input: event.input,
                    output: event.output
                ),
                itemId: event.itemId
            ))
        case .assistantReasoningStarted:
            let event = try decoder.decode(AIChatLiveAssistantReasoningStartedWirePayload.self, from: data)
            return .event(.assistantReasoningStarted(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                reasoningId: event.reasoningId,
                itemId: event.itemId
            ))
        case .assistantReasoningSummary:
            let event = try decoder.decode(AIChatLiveAssistantReasoningSummaryWirePayload.self, from: data)
            return .event(.assistantReasoningSummary(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                reasoningId: event.reasoningId,
                summary: event.summary,
                itemId: event.itemId
            ))
        case .assistantReasoningDone:
            let event = try decoder.decode(AIChatLiveAssistantReasoningDoneWirePayload.self, from: data)
            return .event(.assistantReasoningDone(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                reasoningId: event.reasoningId,
                itemId: event.itemId
            ))
        case .assistantMessageDone:
            let event = try decoder.decode(AIChatLiveAssistantMessageDoneWirePayload.self, from: data)
            return .event(.assistantMessageDone(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                itemId: event.itemId,
                content: event.content,
                isError: event.isError,
                isStopped: event.isStopped
            ))
        case .composerSuggestionsUpdated:
            let event = try decoder.decode(AIChatLiveComposerSuggestionsUpdatedWirePayload.self, from: data)
            return .event(.composerSuggestionsUpdated(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                suggestions: event.suggestions
            ))
        case .repairStatus:
            let event = try decoder.decode(AIChatLiveRepairStatusWirePayload.self, from: data)
            return .event(.repairStatus(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                status: AIChatRepairAttemptStatus(
                    message: event.message,
                    attempt: event.attempt,
                    maxAttempts: event.maxAttempts,
                    toolName: event.toolName
                )
            ))
        case .runTerminal:
            let event = try decoder.decode(AIChatLiveRunTerminalWirePayload.self, from: data)
            return .event(.runTerminal(
                metadata: mapAIChatLiveEventMetadata(
                    metadata,
                    requestId: context.requestId,
                    clientRequestId: context.clientRequestId
                ),
                outcome: event.outcome,
                message: event.message,
                assistantItemId: event.assistantItemId,
                isError: event.isError,
                isStopped: event.isStopped
            ))
        }
    } catch {
        throw makeAIChatLiveStreamContractError(
            eventType: resolvedType.rawValue,
            payload: payload,
            context: context,
            summary: "AI live stream payload is missing required fields or contains invalid values.",
            underlyingError: error
        )
    }
}

private func makeAIChatLiveStreamContractError(
    eventType: String?,
    payload: String,
    context: AIChatLiveEventDecodingContext,
    summary: String,
    underlyingError: Error?
) -> AIChatLiveStreamContractError {
    AIChatLiveStreamContractError(
        diagnostics: AIChatFailureDiagnostics(
            clientRequestId: context.clientRequestId,
            backendRequestId: context.requestId,
            stage: .decodingEventJSON,
            errorKind: .invalidStreamContract,
            statusCode: nil,
            eventType: eventType,
            toolName: nil,
            toolCallId: nil,
            lineNumber: nil,
            rawSnippet: nil,
            decoderSummary: aiChatLiveDecoderSummary(
                summary: summary,
                underlyingError: underlyingError,
                payloadByteCount: payload.utf8.count
            ),
            continuationAttempt: nil,
            continuationToolCallIds: []
        )
    )
}
private func aiChatLiveDecoderSummary(
    summary: String,
    underlyingError: Error?,
    payloadByteCount: Int
) -> String {
    var parts: [String] = [
        summary,
        "payload_bytes=\(payloadByteCount)"
    ]
    if let underlyingError {
        parts.append(aiChatLiveUnderlyingErrorSummary(underlyingError))
    }
    return parts.joined(separator: " ")
}

private func aiChatLiveUnderlyingErrorSummary(_ error: Error) -> String {
    switch error {
    case DecodingError.typeMismatch(_, let context):
        return "decoder_error=type_mismatch coding_path=\(aiChatLiveCodingPathSummary(context.codingPath))"
    case DecodingError.valueNotFound(_, let context):
        return "decoder_error=value_not_found coding_path=\(aiChatLiveCodingPathSummary(context.codingPath))"
    case DecodingError.keyNotFound(let key, let context):
        return "decoder_error=key_not_found key=\(key.stringValue) coding_path=\(aiChatLiveCodingPathSummary(context.codingPath))"
    case DecodingError.dataCorrupted(let context):
        return "decoder_error=data_corrupted coding_path=\(aiChatLiveCodingPathSummary(context.codingPath))"
    default:
        return "decoder_error=other"
    }
}

private func aiChatLiveCodingPathSummary(_ codingPath: [any CodingKey]) -> String {
    let path: String = codingPath
        .map(\.stringValue)
        .filter { value in
            value.isEmpty == false
        }
        .joined(separator: ".")
    return path.isEmpty ? "-" : path
}

private func mapAIChatLiveEventMetadata(
    _ metadata: AIChatLiveEventMetadataWire,
    requestId: String?,
    clientRequestId: String?
) -> AIChatLiveEventMetadata {
    AIChatLiveEventMetadata(
        sessionId: metadata.sessionId,
        conversationScopeId: metadata.conversationScopeId,
        runId: metadata.runId,
        cursor: metadata.cursor,
        requestId: requestId,
        clientRequestId: clientRequestId,
        sequenceNumber: metadata.sequenceNumber,
        streamEpoch: metadata.streamEpoch
    )
}
