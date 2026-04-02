/**
 * SSE client for the thin live chat stream.
 * Opens a URLSession bytes stream to the backend SSE endpoint and parses
 * text/event-stream protocol into typed AIChatLiveEvent values.
 */
import Foundation

actor AIChatLiveStreamClient {
    private let fallbackSession: URLSession
    private let decoder: JSONDecoder

    init(
        urlSession: URLSession,
        decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder()
    ) {
        self.fallbackSession = urlSession
        self.decoder = decoder
    }

    func connect(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) -> AsyncThrowingStream<AIChatLiveEvent, Error> {
        AsyncThrowingStream { continuation in
            let streamTask = Task {
                do {
                    let url = try makeAIChatLiveStreamURL(
                        liveUrl: liveUrl,
                        sessionId: sessionId,
                        afterCursor: afterCursor
                    )
                    logAIChatLiveClientEvent(
                        action: "ai_live_connect_start",
                        metadata: [
                            "sessionId": sessionId,
                            "afterCursor": afterCursor ?? "-",
                            "liveUrl": liveUrl
                        ]
                    )

                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
                    request.setValue(authorization, forHTTPHeaderField: "Authorization")
                    if let resumeAttemptDiagnostics {
                        request.setValue(
                            resumeAttemptDiagnostics.headerValue,
                            forHTTPHeaderField: "X-Chat-Resume-Attempt-Id"
                        )
                        request.setValue(aiChatClientPlatform, forHTTPHeaderField: "X-Client-Platform")
                        request.setValue(aiChatAppVersion(), forHTTPHeaderField: "X-Client-Version")
                    }
                    request.timeoutInterval = 600

                    let delegate = AIChatLiveStreamTaskDelegate(
                        continuation: continuation,
                        sessionId: sessionId,
                        afterCursor: afterCursor,
                        configurationMode: configurationMode,
                        decoder: self.decoder
                    )
                    let configuration = self.fallbackSession.configuration.copy() as? URLSessionConfiguration
                        ?? .ephemeral
                    configuration.timeoutIntervalForRequest = 600
                    configuration.timeoutIntervalForResource = 600
                    configuration.waitsForConnectivity = false
                    let session = URLSession(
                        configuration: configuration,
                        delegate: delegate,
                        delegateQueue: nil
                    )
                    let task = session.dataTask(with: request)
                    delegate.start(task: task, session: session)
                    task.resume()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                streamTask.cancel()
            }
        }
    }
}

private final class AIChatLiveStreamTaskDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let continuation: AsyncThrowingStream<AIChatLiveEvent, Error>.Continuation
    private let sessionId: String
    private let afterCursor: String?
    private let configurationMode: CloudServiceConfigurationMode
    private let decoder: JSONDecoder
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var httpResponse: HTTPURLResponse?
    private var responseBody: Data = Data()
    private var bufferedBytes: Data = Data()
    private var currentEventType: String?
    private var currentDataLines: [String] = []
    private var didFinish: Bool = false

    init(
        continuation: AsyncThrowingStream<AIChatLiveEvent, Error>.Continuation,
        sessionId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        decoder: JSONDecoder
    ) {
        self.continuation = continuation
        self.sessionId = sessionId
        self.afterCursor = afterCursor
        self.configurationMode = configurationMode
        self.decoder = decoder
    }

    func start(task: URLSessionDataTask, session: URLSession) {
        self.task = task
        self.session = session
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let httpResponse = response as? HTTPURLResponse else {
            self.finish(throwing: AIChatLiveStreamError.invalidResponse)
            completionHandler(.cancel)
            return
        }

        self.httpResponse = httpResponse
        logAIChatLiveClientEvent(
            action: "ai_live_http_response",
            metadata: [
                "sessionId": self.sessionId,
                "afterCursor": self.afterCursor ?? "-",
                "statusCode": String(httpResponse.statusCode),
                "requestId": extractAIChatLiveRequestId(httpResponse: httpResponse) ?? "-"
            ]
        )
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard self.didFinish == false else {
            return
        }

        guard let httpResponse = self.httpResponse else {
            self.finish(throwing: AIChatLiveStreamError.invalidResponse)
            return
        }

        guard httpResponse.statusCode == 200 else {
            self.responseBody.append(data)
            return
        }

        self.bufferedBytes.append(data)
        self.processBufferedLines()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard self.didFinish == false else {
            return
        }

        if let error {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                self.finish()
                return
            }

            self.finish(throwing: error)
            return
        }

        guard let httpResponse = self.httpResponse else {
            self.finish(throwing: AIChatLiveStreamError.invalidResponse)
            return
        }

        guard httpResponse.statusCode == 200 else {
            let requestId = extractAIChatLiveRequestId(httpResponse: httpResponse)
            let errorDetails = decodeCloudApiErrorDetails(
                data: self.responseBody,
                requestId: requestId
            )
            self.finish(throwing: AIChatLiveStreamError.invalidStatusCode(
                httpStatusCode: httpResponse.statusCode,
                errorDetails: errorDetails,
                configurationMode: self.configurationMode
            ))
            return
        }

        self.processBufferedLines(flushIncompleteLine: true)
        self.finish()
    }

    private func processBufferedLines(flushIncompleteLine: Bool = false) {
        while let newlineRange = self.bufferedBytes.firstRange(of: Data([0x0A])) {
            let lineData = self.bufferedBytes.subdata(in: 0..<newlineRange.lowerBound)
            self.bufferedBytes.removeSubrange(0...newlineRange.lowerBound)
            self.processLineData(lineData)
        }

        if flushIncompleteLine && self.bufferedBytes.isEmpty == false {
            let lineData = self.bufferedBytes
            self.bufferedBytes.removeAll(keepingCapacity: false)
            self.processLineData(lineData)
        }
    }

    private func processLineData(_ lineData: Data) {
        var normalizedLineData = lineData
        if normalizedLineData.last == 0x0D {
            normalizedLineData.removeLast()
        }
        let line = String(decoding: normalizedLineData, as: UTF8.self)

        if line.hasPrefix("event: ") {
            self.currentEventType = String(line.dropFirst(7))
            return
        }

        if line.hasPrefix("data: ") {
            self.currentDataLines.append(String(line.dropFirst(6)))
            return
        }

        if line.hasPrefix(":") {
            return
        }

        if line.isEmpty {
            self.emitCurrentEventIfNeeded()
        }
    }

    private func emitCurrentEventIfNeeded() {
        guard self.currentDataLines.isEmpty == false else {
            self.currentEventType = nil
            return
        }

        let payload = self.currentDataLines.joined(separator: "\n")
        do {
            let event = try decodeAIChatLiveEvent(
                eventType: self.currentEventType,
                payload: payload,
                decoder: self.decoder,
                context: AIChatLiveEventDecodingContext(
                    sessionId: self.sessionId,
                    afterCursor: self.afterCursor,
                    requestId: self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:))
                )
            )
            logAIChatLiveClientEvent(
                action: "ai_live_event_received",
                metadata: self.metadataForParsedEvent(event)
            )
            self.continuation.yield(event)
        } catch {
            logAIChatLiveClientEvent(
                action: "ai_live_event_parse_failed",
                metadata: [
                    "sessionId": self.sessionId,
                    "afterCursor": self.afterCursor ?? "-",
                    "eventType": self.currentEventType ?? "-",
                    "payloadSnippet": aiChatLiveTruncatedSnippet(payload),
                    "error": error.localizedDescription
                ]
            )
            self.currentEventType = nil
            self.currentDataLines = []
            self.finish(throwing: error)
            return
        }
        self.currentEventType = nil
        self.currentDataLines = []
    }

    private func finish(throwing error: Error? = nil) {
        guard self.didFinish == false else {
            return
        }

        self.didFinish = true
        self.task?.cancel()
        self.session?.invalidateAndCancel()
        self.task = nil
        self.session = nil

        if let error {
            logAIChatLiveClientEvent(
                action: "ai_live_finish_error",
                metadata: [
                    "sessionId": self.sessionId,
                    "afterCursor": self.afterCursor ?? "-",
                    "statusCode": self.httpResponse.map { String($0.statusCode) } ?? "-",
                    "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-",
                    "error": error.localizedDescription
                ]
            )
            self.continuation.finish(throwing: error)
            return
        }

        logAIChatLiveClientEvent(
            action: "ai_live_finish",
            metadata: [
                "sessionId": self.sessionId,
                "afterCursor": self.afterCursor ?? "-",
                "statusCode": self.httpResponse.map { String($0.statusCode) } ?? "-",
                "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-"
            ]
        )
        self.continuation.finish()
    }

    private func metadataForParsedEvent(_ event: AIChatLiveEvent) -> [String: String] {
        let liveMetadata = aiChatLiveEventMetadata(event)
        var metadata: [String: String] = [
            "sessionId": self.sessionId,
            "afterCursor": self.afterCursor ?? "-",
            "eventSessionId": liveMetadata.sessionId,
            "conversationScopeId": liveMetadata.conversationScopeId,
            "runId": liveMetadata.runId,
            "cursor": liveMetadata.cursor ?? "-",
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
}

enum AIChatLiveStreamError: LocalizedError {
    case invalidUrl(String)
    case invalidResponse
    case invalidStatusCode(
        httpStatusCode: Int,
        errorDetails: CloudApiErrorDetails,
        configurationMode: CloudServiceConfigurationMode
    )

    var errorDescription: String? {
        switch self {
        case .invalidUrl(let liveUrl):
            return "AI live stream URL is invalid: \(liveUrl)"
        case .invalidResponse:
            return "AI live stream did not receive an HTTP response."
        case .invalidStatusCode(let httpStatusCode, let errorDetails, let configurationMode):
            let message = makeAIChatUserFacingErrorMessage(
                rawMessage: errorDetails.message,
                code: errorDetails.code,
                requestId: errorDetails.requestId,
                configurationMode: configurationMode,
                surface: .chat
            )
            return "AI live stream failed with status \(httpStatusCode): \(message)"
        }
    }
}

private func makeAIChatLiveStreamURL(
    liveUrl: String,
    sessionId: String,
    afterCursor: String?
) throws -> URL {
    guard var components = URLComponents(string: liveUrl) else {
        throw AIChatLiveStreamError.invalidUrl(liveUrl)
    }

    var queryItems = components.queryItems ?? []
    queryItems.removeAll { item in
        item.name == "sessionId" || item.name == "afterCursor"
    }
    queryItems.append(URLQueryItem(name: "sessionId", value: sessionId))
    if let afterCursor, afterCursor.isEmpty == false {
        queryItems.append(URLQueryItem(name: "afterCursor", value: afterCursor))
    }
    components.queryItems = queryItems

    guard let url = components.url else {
        throw AIChatLiveStreamError.invalidUrl(liveUrl)
    }

    return url
}

private func extractAIChatLiveRequestId(httpResponse: HTTPURLResponse) -> String? {
    let chatRequestId = httpResponse.value(forHTTPHeaderField: "X-Chat-Request-Id")
    if let chatRequestId, chatRequestId.isEmpty == false {
        return chatRequestId
    }

    let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
    if let requestId, requestId.isEmpty == false {
        return requestId
    }

    return nil
}

private func aiChatLiveTruncatedSnippet(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.count > 240 else {
        return trimmedValue
    }

    return String(trimmedValue.prefix(240))
}

private func logAIChatLiveClientEvent(action: String, metadata: [String: String]) {
    logFlashcardsError(domain: "ios_ai_live", action: action, metadata: metadata)
}

struct AIChatLiveEventDecodingContext: Sendable {
    let sessionId: String
    let afterCursor: String?
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

private enum AIChatLiveEventType: String, Decodable {
    case assistantDelta = "assistant_delta"
    case assistantToolCall = "assistant_tool_call"
    case assistantReasoningStarted = "assistant_reasoning_started"
    case assistantReasoningSummary = "assistant_reasoning_summary"
    case assistantReasoningDone = "assistant_reasoning_done"
    case assistantMessageDone = "assistant_message_done"
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

private struct AIChatLiveRunTerminalWirePayload: Decodable {
    let outcome: AIChatRunTerminalOutcome
    let message: String?
    let assistantItemId: String?
    let isError: Bool?
    let isStopped: Bool?
}

func decodeAIChatLiveEvent(
    eventType: String?,
    payload: String,
    decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder(),
    context: AIChatLiveEventDecodingContext = AIChatLiveEventDecodingContext(
        sessionId: "-",
        afterCursor: nil,
        requestId: nil
    )
) throws -> AIChatLiveEvent {
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
                throw makeAIChatLiveStreamContractError(
                    eventType: eventType,
                    payload: payload,
                    context: context,
                    summary: "AI live stream event type is unsupported.",
                    underlyingError: nil
                )
            }
            resolvedType = parsedEventType
        } else {
            resolvedType = try decoder.decode(AIChatLiveEventTypeEnvelope.self, from: data).type
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
            return .assistantDelta(
                metadata: mapAIChatLiveEventMetadata(metadata),
                text: event.text,
                itemId: event.itemId
            )
        case .assistantToolCall:
            let event = try decoder.decode(AIChatLiveAssistantToolCallWirePayload.self, from: data)
            return .assistantToolCall(
                metadata: mapAIChatLiveEventMetadata(metadata),
                toolCall: AIChatToolCall(
                    id: event.toolCallId,
                    name: event.name,
                    status: event.status,
                    input: event.input,
                    output: event.output
                ),
                itemId: event.itemId
            )
        case .assistantReasoningStarted:
            let event = try decoder.decode(AIChatLiveAssistantReasoningStartedWirePayload.self, from: data)
            return .assistantReasoningStarted(
                metadata: mapAIChatLiveEventMetadata(metadata),
                reasoningId: event.reasoningId,
                itemId: event.itemId
            )
        case .assistantReasoningSummary:
            let event = try decoder.decode(AIChatLiveAssistantReasoningSummaryWirePayload.self, from: data)
            return .assistantReasoningSummary(
                metadata: mapAIChatLiveEventMetadata(metadata),
                reasoningId: event.reasoningId,
                summary: event.summary,
                itemId: event.itemId
            )
        case .assistantReasoningDone:
            let event = try decoder.decode(AIChatLiveAssistantReasoningDoneWirePayload.self, from: data)
            return .assistantReasoningDone(
                metadata: mapAIChatLiveEventMetadata(metadata),
                reasoningId: event.reasoningId,
                itemId: event.itemId
            )
        case .assistantMessageDone:
            let event = try decoder.decode(AIChatLiveAssistantMessageDoneWirePayload.self, from: data)
            return .assistantMessageDone(
                metadata: mapAIChatLiveEventMetadata(metadata),
                itemId: event.itemId,
                content: event.content,
                isError: event.isError,
                isStopped: event.isStopped
            )
        case .repairStatus:
            let event = try decoder.decode(AIChatLiveRepairStatusWirePayload.self, from: data)
            return .repairStatus(
                metadata: mapAIChatLiveEventMetadata(metadata),
                status: AIChatRepairAttemptStatus(
                    message: event.message,
                    attempt: event.attempt,
                    maxAttempts: event.maxAttempts,
                    toolName: event.toolName
                )
            )
        case .runTerminal:
            let event = try decoder.decode(AIChatLiveRunTerminalWirePayload.self, from: data)
            return .runTerminal(
                metadata: mapAIChatLiveEventMetadata(metadata),
                outcome: event.outcome,
                message: event.message,
                assistantItemId: event.assistantItemId,
                isError: event.isError,
                isStopped: event.isStopped
            )
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
            clientRequestId: context.sessionId,
            backendRequestId: context.requestId,
            stage: .decodingEventJSON,
            errorKind: .invalidStreamContract,
            statusCode: nil,
            eventType: eventType,
            toolName: nil,
            toolCallId: nil,
            lineNumber: nil,
            rawSnippet: aiChatLiveTruncatedSnippet(payload),
            decoderSummary: [summary, underlyingError.map { String(describing: $0) }]
                .compactMap { $0 }
                .joined(separator: " "),
            continuationAttempt: nil,
            continuationToolCallIds: []
        )
    )
}

private func mapAIChatLiveEventMetadata(_ metadata: AIChatLiveEventMetadataWire) -> AIChatLiveEventMetadata {
    AIChatLiveEventMetadata(
        sessionId: metadata.sessionId,
        conversationScopeId: metadata.conversationScopeId,
        runId: metadata.runId,
        cursor: metadata.cursor,
        sequenceNumber: metadata.sequenceNumber,
        streamEpoch: metadata.streamEpoch
    )
}

private func aiChatLiveEventMetadata(_ event: AIChatLiveEvent) -> AIChatLiveEventMetadata {
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
