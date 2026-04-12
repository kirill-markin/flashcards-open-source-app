/**
 * SSE client for the thin live chat stream.
 * Opens a URLSession bytes stream to the backend SSE endpoint and parses
 * text/event-stream protocol into typed AIChatLiveEvent values.
 */
import Foundation

struct AIChatLiveStreamConfiguration: Sendable {
    let requestTimeoutSeconds: TimeInterval
    let resourceTimeoutSeconds: TimeInterval
    let inactivityTimeoutSeconds: TimeInterval
}

private let aiChatDefaultLiveStreamConfiguration = AIChatLiveStreamConfiguration(
    requestTimeoutSeconds: 600,
    resourceTimeoutSeconds: 600,
    inactivityTimeoutSeconds: 45
)

actor AIChatLiveStreamClient {
    private let fallbackSession: URLSession
    private let decoder: JSONDecoder
    private let configuration: AIChatLiveStreamConfiguration

    init(
        urlSession: URLSession,
        decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder()
    ) {
        self.init(
            urlSession: urlSession,
            decoder: decoder,
            configuration: aiChatDefaultLiveStreamConfiguration
        )
    }

    init(
        urlSession: URLSession,
        decoder: JSONDecoder,
        configuration: AIChatLiveStreamConfiguration
    ) {
        self.fallbackSession = urlSession
        self.decoder = decoder
        self.configuration = configuration
    }

    func connect(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) -> AsyncThrowingStream<AIChatLiveEvent, Error> {
        let decoder = self.decoder
        let fallbackConfiguration = self.fallbackSession.configuration
        let liveConfiguration = self.configuration
        return AsyncThrowingStream { continuation in
            do {
                let url = try makeAIChatLiveStreamURL(
                    liveUrl: liveUrl,
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: afterCursor
                )
                logAIChatLiveClientEvent(
                    action: "ai_live_connect_start",
                    metadata: [
                        "sessionId": sessionId,
                        "runId": runId,
                        "afterCursor": afterCursor ?? "-",
                        "liveUrl": liveUrl
                    ]
                    .merging(
                        resumeAttemptDiagnostics.map { ["resumeAttempt": $0.headerValue] } ?? [:]
                    ) { _, newValue in newValue }
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
                request.timeoutInterval = liveConfiguration.requestTimeoutSeconds

                let delegate = AIChatLiveStreamTaskDelegate(
                    continuation: continuation,
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: afterCursor,
                    configurationMode: configurationMode,
                    decoder: decoder,
                    liveConfiguration: liveConfiguration,
                    callbackQueue: DispatchQueue(
                        label: "AIChatLiveStreamClient.callback.\(sessionId).\(runId)"
                    )
                )
                let configuration = fallbackConfiguration.copy() as? URLSessionConfiguration
                    ?? .ephemeral
                configuration.timeoutIntervalForRequest = liveConfiguration.requestTimeoutSeconds
                configuration.timeoutIntervalForResource = liveConfiguration.resourceTimeoutSeconds
                configuration.waitsForConnectivity = false
                let delegateQueue = OperationQueue()
                delegateQueue.maxConcurrentOperationCount = 1
                delegateQueue.underlyingQueue = delegate.callbackQueue
                let session = URLSession(
                    configuration: configuration,
                    delegate: delegate,
                    delegateQueue: delegateQueue
                )
                let task = session.dataTask(with: request)
                delegate.start(task: task, session: session)
                task.resume()

                continuation.onTermination = { _ in
                    task.cancel()
                }
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }
}

private final class AIChatLiveStreamTaskDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let continuation: AsyncThrowingStream<AIChatLiveEvent, Error>.Continuation
    private let sessionId: String
    private let runId: String
    private let afterCursor: String?
    private let configurationMode: CloudServiceConfigurationMode
    private let decoder: JSONDecoder
    private let liveConfiguration: AIChatLiveStreamConfiguration
    let callbackQueue: DispatchQueue
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var httpResponse: HTTPURLResponse?
    private var responseBody: Data = Data()
    private var bufferedBytes: Data = Data()
    private var currentEventType: String?
    private var currentDataLines: [String] = []
    private var didFinish: Bool = false
    private var inactivityTimeoutWorkItem: DispatchWorkItem?

    init(
        continuation: AsyncThrowingStream<AIChatLiveEvent, Error>.Continuation,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        decoder: JSONDecoder,
        liveConfiguration: AIChatLiveStreamConfiguration,
        callbackQueue: DispatchQueue
    ) {
        self.continuation = continuation
        self.sessionId = sessionId
        self.runId = runId
        self.afterCursor = afterCursor
        self.configurationMode = configurationMode
        self.decoder = decoder
        self.liveConfiguration = liveConfiguration
        self.callbackQueue = callbackQueue
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
                "runId": self.runId,
                "afterCursor": self.afterCursor ?? "-",
                "statusCode": String(httpResponse.statusCode),
                "requestId": extractAIChatLiveRequestId(httpResponse: httpResponse) ?? "-"
            ]
        )
        if httpResponse.statusCode == 200 {
            self.armInactivityTimeout()
        }
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

        self.armInactivityTimeout()
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
                logAIChatLiveClientEvent(
                    action: "ai_live_cancelled",
                    metadata: [
                        "sessionId": self.sessionId,
                        "runId": self.runId,
                        "afterCursor": self.afterCursor ?? "-",
                        "statusCode": self.httpResponse.map { String($0.statusCode) } ?? "-",
                        "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-",
                        "failureKind": "cancelled"
                    ]
                )
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
        self.emitCurrentEventIfNeeded()
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
            let decodingResult = try decodeAIChatLiveEventResult(
                eventType: self.currentEventType,
                payload: payload,
                decoder: self.decoder,
                context: AIChatLiveEventDecodingContext(
                    sessionId: self.sessionId,
                    afterCursor: self.afterCursor,
                    requestId: self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:))
                )
            )
            switch decodingResult {
            case .event(let event):
                logAIChatLiveClientEvent(
                    action: "ai_live_event_received",
                    metadata: self.metadataForParsedEvent(event)
                )
                self.continuation.yield(event)
            case .ignoredUnknownType(let ignoredEventType):
                logAIChatLiveClientEvent(
                    action: "ai_live_event_skipped_unknown_type",
                    metadata: [
                        "sessionId": self.sessionId,
                        "runId": self.runId,
                        "afterCursor": self.afterCursor ?? "-",
                        "eventType": ignoredEventType,
                        "payloadSnippet": aiChatLiveTruncatedSnippet(payload)
                    ]
                )
            }
        } catch {
            logAIChatLiveClientEvent(
                action: "ai_live_event_parse_failed",
                metadata: [
                    "sessionId": self.sessionId,
                    "runId": self.runId,
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
        self.cancelInactivityTimeout()
        self.task?.cancel()
        self.session?.invalidateAndCancel()
        self.task = nil
        self.session = nil

        if let error {
            logAIChatLiveClientEvent(
                action: "ai_live_finish_error",
                metadata: [
                    "sessionId": self.sessionId,
                    "runId": self.runId,
                    "afterCursor": self.afterCursor ?? "-",
                    "statusCode": self.httpResponse.map { String($0.statusCode) } ?? "-",
                    "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-",
                    "error": error.localizedDescription
                ]
                .merging(aiChatErrorLogMetadata(error: error)) { _, newValue in newValue }
            )
            self.continuation.finish(throwing: error)
            return
        }

        logAIChatLiveClientEvent(
            action: "ai_live_finish",
            metadata: [
                "sessionId": self.sessionId,
                "runId": self.runId,
                "afterCursor": self.afterCursor ?? "-",
                "statusCode": self.httpResponse.map { String($0.statusCode) } ?? "-",
                "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-"
            ]
        )
        self.continuation.finish()
    }

    private func armInactivityTimeout() {
        guard self.liveConfiguration.inactivityTimeoutSeconds > 0 else {
            return
        }
        guard self.didFinish == false else {
            return
        }

        self.inactivityTimeoutWorkItem?.cancel()
        let idleTimeoutSeconds = self.liveConfiguration.inactivityTimeoutSeconds
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else {
                return
            }
            self.finish(throwing: AIChatLiveStreamError.staleStream(
                idleTimeoutSeconds: idleTimeoutSeconds
            ))
        }
        self.inactivityTimeoutWorkItem = workItem
        self.callbackQueue.asyncAfter(
            deadline: .now() + idleTimeoutSeconds,
            execute: workItem
        )
    }

    private func cancelInactivityTimeout() {
        self.inactivityTimeoutWorkItem?.cancel()
        self.inactivityTimeoutWorkItem = nil
    }

    private func metadataForParsedEvent(_ event: AIChatLiveEvent) -> [String: String] {
        let liveMetadata = aiChatLiveEventMetadata(event)
        var metadata: [String: String] = [
            "sessionId": self.sessionId,
            "requestedRunId": self.runId,
            "afterCursor": self.afterCursor ?? "-",
            "eventSessionId": liveMetadata.sessionId,
            "conversationScopeId": liveMetadata.conversationScopeId,
            "eventRunId": liveMetadata.runId,
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
}

enum AIChatLiveStreamError: LocalizedError {
    case invalidUrl(String)
    case invalidResponse
    case staleStream(idleTimeoutSeconds: TimeInterval)
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
        case .staleStream:
            return "AI response stopped updating before the run finished."
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
    runId: String,
    afterCursor: String?
) throws -> URL {
    guard var components = URLComponents(string: liveUrl) else {
        throw AIChatLiveStreamError.invalidUrl(liveUrl)
    }

    var queryItems = components.queryItems ?? []
    queryItems.removeAll { item in
        item.name == "sessionId" || item.name == "runId" || item.name == "afterCursor"
    }
    queryItems.append(URLQueryItem(name: "sessionId", value: sessionId))
    queryItems.append(URLQueryItem(name: "runId", value: runId))
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

func aiChatErrorLogMetadata(error: Error) -> [String: String] {
    if let liveStreamError = error as? AIChatLiveStreamError {
        switch liveStreamError {
        case .invalidUrl:
            return [
                "failureKind": "local_contract_failure",
                "stage": AIChatFailureStage.requestBuild.rawValue,
                "errorKind": AIChatFailureKind.invalidBaseUrl.rawValue,
            ]
        case .invalidResponse:
            return [
                "failureKind": "transport_failure",
                "stage": AIChatFailureStage.invalidHttpResponse.rawValue,
                "errorKind": AIChatFailureKind.invalidHttpResponse.rawValue,
            ]
        case .staleStream(let idleTimeoutSeconds):
            return [
                "failureKind": "transport_stale_stream",
                "stage": AIChatFailureStage.readingLine.rawValue,
                "errorKind": AIChatFailureKind.staleStream.rawValue,
                "idleTimeoutSeconds": String(idleTimeoutSeconds)
            ]
        case .invalidStatusCode(let httpStatusCode, let errorDetails, _):
            var metadata: [String: String] = [
                "failureKind": "backend_http_failure",
                "statusCode": String(httpStatusCode),
                "stage": AIChatFailureStage.responseNotOk.rawValue,
                "errorKind": AIChatFailureKind.invalidHttpResponse.rawValue,
            ]
            if let requestId = errorDetails.requestId, requestId.isEmpty == false {
                metadata["backendRequestId"] = requestId
            }
            if let code = errorDetails.code, code.isEmpty == false {
                metadata["backendCode"] = code
            }
            return metadata
        }
    }

    if let diagnosticError = error as? AIChatFailureDiagnosticProviding {
        var metadata: [String: String] = [
            "failureKind": diagnosticError is AIChatLiveStreamSetupError
                ? "local_contract_failure"
                : "invalid_sse_payload",
            "stage": diagnosticError.diagnostics.stage.rawValue,
            "errorKind": diagnosticError.diagnostics.errorKind.rawValue,
        ]
        if let statusCode = diagnosticError.diagnostics.statusCode {
            metadata["statusCode"] = String(statusCode)
        }
        if let backendRequestId = diagnosticError.diagnostics.backendRequestId,
           backendRequestId.isEmpty == false {
            metadata["backendRequestId"] = backendRequestId
        }
        if let continuationAttempt = diagnosticError.diagnostics.continuationAttempt {
            metadata["resumeAttempt"] = String(continuationAttempt)
        }
        return metadata
    }

    let nsError = error as NSError
    return [
        "failureKind": "transport_failure",
        "errorDomain": nsError.domain,
        "errorCode": String(nsError.code),
    ]
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
private enum AIChatLiveEventDecodingResult {
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

private func decodeAIChatLiveEventResult(
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
                metadata: mapAIChatLiveEventMetadata(metadata),
                text: event.text,
                itemId: event.itemId
            ))
        case .assistantToolCall:
            let event = try decoder.decode(AIChatLiveAssistantToolCallWirePayload.self, from: data)
            return .event(.assistantToolCall(
                metadata: mapAIChatLiveEventMetadata(metadata),
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
                metadata: mapAIChatLiveEventMetadata(metadata),
                reasoningId: event.reasoningId,
                itemId: event.itemId
            ))
        case .assistantReasoningSummary:
            let event = try decoder.decode(AIChatLiveAssistantReasoningSummaryWirePayload.self, from: data)
            return .event(.assistantReasoningSummary(
                metadata: mapAIChatLiveEventMetadata(metadata),
                reasoningId: event.reasoningId,
                summary: event.summary,
                itemId: event.itemId
            ))
        case .assistantReasoningDone:
            let event = try decoder.decode(AIChatLiveAssistantReasoningDoneWirePayload.self, from: data)
            return .event(.assistantReasoningDone(
                metadata: mapAIChatLiveEventMetadata(metadata),
                reasoningId: event.reasoningId,
                itemId: event.itemId
            ))
        case .assistantMessageDone:
            let event = try decoder.decode(AIChatLiveAssistantMessageDoneWirePayload.self, from: data)
            return .event(.assistantMessageDone(
                metadata: mapAIChatLiveEventMetadata(metadata),
                itemId: event.itemId,
                content: event.content,
                isError: event.isError,
                isStopped: event.isStopped
            ))
        case .composerSuggestionsUpdated:
            let event = try decoder.decode(AIChatLiveComposerSuggestionsUpdatedWirePayload.self, from: data)
            return .event(.composerSuggestionsUpdated(
                metadata: mapAIChatLiveEventMetadata(metadata),
                suggestions: event.suggestions
            ))
        case .repairStatus:
            let event = try decoder.decode(AIChatLiveRepairStatusWirePayload.self, from: data)
            return .event(.repairStatus(
                metadata: mapAIChatLiveEventMetadata(metadata),
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
                metadata: mapAIChatLiveEventMetadata(metadata),
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
