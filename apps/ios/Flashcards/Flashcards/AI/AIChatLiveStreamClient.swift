/**
 * SSE client for the thin live chat stream.
 * Opens a URLSession bytes stream to the backend SSE endpoint and parses
 * text/event-stream protocol into typed AIChatLiveEvent values.
 */
import Foundation

actor AIChatLiveStreamClient {
    private let fallbackSession: URLSession

    init(urlSession: URLSession) {
        self.fallbackSession = urlSession
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
                        configurationMode: configurationMode
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
        configurationMode: CloudServiceConfigurationMode
    ) {
        self.continuation = continuation
        self.sessionId = sessionId
        self.afterCursor = afterCursor
        self.configurationMode = configurationMode
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
        if let event = parseSSEEvent(eventType: self.currentEventType, payload: payload) {
            logAIChatLiveClientEvent(
                action: "ai_live_event_received",
                metadata: self.metadataForParsedEvent(event)
            )
            self.continuation.yield(event)
        } else {
            logAIChatLiveClientEvent(
                action: "ai_live_event_parse_dropped",
                metadata: [
                    "sessionId": self.sessionId,
                    "afterCursor": self.afterCursor ?? "-",
                    "eventType": self.currentEventType ?? "-",
                    "payloadSnippet": aiChatLiveTruncatedSnippet(payload)
                ]
            )
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
        case .assistantReasoningSummary(let summary, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_summary"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["summaryLength"] = String(summary.count)
        case .assistantMessageDone(let cursor, let itemId, let isError, let isStopped):
            metadata["eventType"] = "assistant_message_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
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

private func parseSSEEvent(eventType: String?, payload: String) -> AIChatLiveEvent? {
    guard let data = payload.data(using: .utf8) else {
        return nil
    }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }

    let type = eventType ?? (json["type"] as? String ?? "")

    switch type {
    case "run_state":
        guard let runState = json["runState"] as? String else { return nil }
        return .runState(runState)

    case "assistant_delta":
        guard let text = json["text"] as? String,
              let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        return .assistantDelta(text: text, cursor: cursor, itemId: itemId)

    case "assistant_tool_call":
        guard let name = json["name"] as? String,
              let statusStr = json["status"] as? String,
              let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        let status: AIChatToolCallStatus = statusStr == "completed" ? .completed : .started
        let toolCall = AIChatToolCall(
            id: itemId,
            name: name,
            status: status,
            input: json["input"] as? String,
            output: json["output"] as? String
        )
        return .assistantToolCall(toolCall, cursor: cursor, itemId: itemId)

    case "assistant_reasoning_summary":
        guard let summary = json["summary"] as? String,
              let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        return .assistantReasoningSummary(summary: summary, cursor: cursor, itemId: itemId)

    case "assistant_message_done":
        guard let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        let isError = json["isError"] as? Bool ?? false
        let isStopped = json["isStopped"] as? Bool ?? false
        return .assistantMessageDone(cursor: cursor, itemId: itemId, isError: isError, isStopped: isStopped)

    case "repair_status":
        guard let message = json["message"] as? String,
              let attempt = json["attempt"] as? Int,
              let maxAttempts = json["maxAttempts"] as? Int else { return nil }
        let toolName = json["toolName"] as? String
        return .repairStatus(AIChatRepairAttemptStatus(
            message: message,
            attempt: attempt,
            maxAttempts: maxAttempts,
            toolName: toolName
        ))

    case "error":
        guard let message = json["message"] as? String else { return nil }
        return .error(message)

    case "stop_ack":
        guard let sessionId = json["sessionId"] as? String else { return nil }
        return .stopAck(sessionId: sessionId)

    case "reset_required":
        return .resetRequired

    default:
        return nil
    }
}
