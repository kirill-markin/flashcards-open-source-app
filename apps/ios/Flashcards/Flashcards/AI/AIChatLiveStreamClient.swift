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
        configurationMode: CloudServiceConfigurationMode
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
        var metadata: [String: String] = [
            "sessionId": self.sessionId,
            "afterCursor": self.afterCursor ?? "-"
        ]

        switch event {
        case .runState(let runState):
            metadata["eventType"] = "run_state"
            metadata["runState"] = runState
        case .assistantDelta(let text, let cursor, let itemId):
            metadata["eventType"] = "assistant_delta"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["textLength"] = String(text.count)
        case .assistantToolCall(let toolCall, let cursor, let itemId):
            metadata["eventType"] = "assistant_tool_call"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["toolName"] = toolCall.name
            metadata["toolStatus"] = toolCall.status.rawValue
        case .assistantReasoningStarted(let reasoningId, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_started"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
        case .assistantReasoningSummary(let reasoningId, let summary, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_summary"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
            metadata["summaryLength"] = String(summary.count)
        case .assistantReasoningDone(let reasoningId, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
        case .assistantMessageDone(let cursor, let itemId, let content, let isError, let isStopped):
            metadata["eventType"] = "assistant_message_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["contentCount"] = String(content.count)
            metadata["isError"] = isError ? "true" : "false"
            metadata["isStopped"] = isStopped ? "true" : "false"
        case .repairStatus(let status):
            metadata["eventType"] = "repair_status"
            metadata["attempt"] = String(status.attempt)
            metadata["maxAttempts"] = String(status.maxAttempts)
            metadata["toolName"] = status.toolName ?? "-"
        case .error(let message):
            metadata["eventType"] = "error"
            metadata["message"] = message
        case .stopAck(let sessionId):
            metadata["eventType"] = "stop_ack"
            metadata["ackSessionId"] = sessionId
        case .resetRequired:
            metadata["eventType"] = "reset_required"
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
    case runState = "run_state"
    case assistantDelta = "assistant_delta"
    case assistantToolCall = "assistant_tool_call"
    case assistantReasoningStarted = "assistant_reasoning_started"
    case assistantReasoningSummary = "assistant_reasoning_summary"
    case assistantReasoningDone = "assistant_reasoning_done"
    case assistantMessageDone = "assistant_message_done"
    case repairStatus = "repair_status"
    case error = "error"
    case stopAck = "stop_ack"
    case resetRequired = "reset_required"
}

private enum AIChatLiveRunStateWire: String, Decodable {
    case idle
    case running
    case completed
    case failed
    case stopped
    case interrupted
}

private struct AIChatLiveRunStateWireEvent: Decodable {
    let runState: AIChatLiveRunStateWire
}

private struct AIChatLiveAssistantDeltaWireEvent: Decodable {
    let text: String
    let cursor: String
    let itemId: String
}

private struct AIChatLiveAssistantToolCallWireEvent: Decodable {
    let toolCallId: String
    let name: String
    let status: AIChatToolCallStatus
    let input: String?
    let output: String?
    let cursor: String
    let itemId: String
}

private struct AIChatLiveAssistantReasoningStartedWireEvent: Decodable {
    let reasoningId: String
    let cursor: String
    let itemId: String
}

private struct AIChatLiveAssistantReasoningSummaryWireEvent: Decodable {
    let reasoningId: String
    let summary: String
    let cursor: String
    let itemId: String
}

private struct AIChatLiveAssistantReasoningDoneWireEvent: Decodable {
    let reasoningId: String
    let cursor: String
    let itemId: String
}

private struct AIChatLiveAssistantMessageDoneWireEvent: Decodable {
    let cursor: String
    let itemId: String
    let content: [AIChatContentPart]
    let isError: Bool
    let isStopped: Bool
}

private struct AIChatLiveRepairStatusWireEvent: Decodable {
    let message: String
    let attempt: Int
    let maxAttempts: Int
    let toolName: String?
}

private struct AIChatLiveErrorWireEvent: Decodable {
    let message: String
}

private struct AIChatLiveStopAckWireEvent: Decodable {
    let sessionId: String
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

    do {
        switch resolvedType {
        case .runState:
            let event = try decoder.decode(AIChatLiveRunStateWireEvent.self, from: data)
            return .runState(event.runState.rawValue)
        case .assistantDelta:
            let event = try decoder.decode(AIChatLiveAssistantDeltaWireEvent.self, from: data)
            return .assistantDelta(text: event.text, cursor: event.cursor, itemId: event.itemId)
        case .assistantToolCall:
            let event = try decoder.decode(AIChatLiveAssistantToolCallWireEvent.self, from: data)
            return .assistantToolCall(
                AIChatToolCall(
                    id: event.toolCallId,
                    name: event.name,
                    status: event.status,
                    input: event.input,
                    output: event.output
                ),
                cursor: event.cursor,
                itemId: event.itemId
            )
        case .assistantReasoningStarted:
            let event = try decoder.decode(AIChatLiveAssistantReasoningStartedWireEvent.self, from: data)
            return .assistantReasoningStarted(
                reasoningId: event.reasoningId,
                cursor: event.cursor,
                itemId: event.itemId
            )
        case .assistantReasoningSummary:
            let event = try decoder.decode(AIChatLiveAssistantReasoningSummaryWireEvent.self, from: data)
            return .assistantReasoningSummary(
                reasoningId: event.reasoningId,
                summary: event.summary,
                cursor: event.cursor,
                itemId: event.itemId
            )
        case .assistantReasoningDone:
            let event = try decoder.decode(AIChatLiveAssistantReasoningDoneWireEvent.self, from: data)
            return .assistantReasoningDone(
                reasoningId: event.reasoningId,
                cursor: event.cursor,
                itemId: event.itemId
            )
        case .assistantMessageDone:
            let event = try decoder.decode(AIChatLiveAssistantMessageDoneWireEvent.self, from: data)
            return .assistantMessageDone(
                cursor: event.cursor,
                itemId: event.itemId,
                content: event.content,
                isError: event.isError,
                isStopped: event.isStopped
            )
        case .repairStatus:
            let event = try decoder.decode(AIChatLiveRepairStatusWireEvent.self, from: data)
            return .repairStatus(
                AIChatRepairAttemptStatus(
                    message: event.message,
                    attempt: event.attempt,
                    maxAttempts: event.maxAttempts,
                    toolName: event.toolName
                )
            )
        case .error:
            let event = try decoder.decode(AIChatLiveErrorWireEvent.self, from: data)
            return .error(event.message)
        case .stopAck:
            let event = try decoder.decode(AIChatLiveStopAckWireEvent.self, from: data)
            return .stopAck(sessionId: event.sessionId)
        case .resetRequired:
            return .resetRequired
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
