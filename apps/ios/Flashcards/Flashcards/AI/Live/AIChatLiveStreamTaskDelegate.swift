import Foundation

final class AIChatLiveStreamTaskDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let continuation: AsyncThrowingStream<AIChatLiveStreamElement, Error>.Continuation
    private let sessionId: String
    private let runId: String
    private let afterCursor: String?
    private let clientRequestId: String
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
        continuation: AsyncThrowingStream<AIChatLiveStreamElement, Error>.Continuation,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        clientRequestId: String,
        configurationMode: CloudServiceConfigurationMode,
        decoder: JSONDecoder,
        liveConfiguration: AIChatLiveStreamConfiguration,
        callbackQueue: DispatchQueue
    ) {
        self.continuation = continuation
        self.sessionId = sessionId
        self.runId = runId
        self.afterCursor = afterCursor
        self.clientRequestId = clientRequestId
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
            self.finish(throwing: AIChatLiveStreamError.invalidResponse(
                clientRequestId: self.clientRequestId
            ))
            completionHandler(.cancel)
            return
        }

        self.httpResponse = httpResponse
        let requestId = extractAIChatLiveRequestId(httpResponse: httpResponse)
        logAIChatLiveClientEvent(
            action: "ai_live_http_response",
            metadata: [
                "sessionId": self.sessionId,
                "runId": self.runId,
                "afterCursor": self.afterCursor ?? "-",
                "statusCode": String(httpResponse.statusCode),
                "clientRequestId": self.clientRequestId,
                "requestId": requestId ?? "-"
            ]
        )
        self.continuation.yield(.connected(
            requestId: requestId,
            clientRequestId: self.clientRequestId
        ))
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
            self.finish(throwing: AIChatLiveStreamError.invalidResponse(
                clientRequestId: self.clientRequestId
            ))
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
                        "clientRequestId": self.clientRequestId,
                        "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-",
                        "failureKind": "cancelled"
                    ]
                )
                self.finish()
                return
            }

            self.finish(throwing: AIChatLiveStreamError.transportFailure(
                underlyingError: error,
                requestId: self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)),
                clientRequestId: self.clientRequestId
            ))
            return
        }

        guard let httpResponse = self.httpResponse else {
            self.finish(throwing: AIChatLiveStreamError.invalidResponse(
                clientRequestId: self.clientRequestId
            ))
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
                configurationMode: self.configurationMode,
                clientRequestId: self.clientRequestId
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
                    clientRequestId: self.clientRequestId,
                    requestId: self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:))
                )
            )
            switch decodingResult {
            case .event(let event):
                logAIChatLiveClientEvent(
                    action: "ai_live_event_received",
                    metadata: aiChatLiveEventLogMetadata(
                        event: event,
                        sessionId: self.sessionId,
                        requestedRunId: self.runId,
                        afterCursor: self.afterCursor,
                        clientRequestId: self.clientRequestId
                    )
                )
                self.continuation.yield(.event(event))
            case .ignoredUnknownType(let ignoredEventType):
                logAIChatLiveClientEvent(
                    action: "ai_live_event_skipped_unknown_type",
                    metadata: [
                        "sessionId": self.sessionId,
                        "runId": self.runId,
                        "afterCursor": self.afterCursor ?? "-",
                        "eventType": ignoredEventType,
                        "clientRequestId": self.clientRequestId,
                        "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-"
                    ]
                )
            }
        } catch {
            let diagnostics = (error as? any AIChatFailureDiagnosticProviding)?.diagnostics
            logAIChatLiveClientEvent(
                action: "ai_live_event_parse_failed",
                metadata: [
                    "sessionId": self.sessionId,
                    "runId": self.runId,
                    "afterCursor": self.afterCursor ?? "-",
                    "eventType": diagnostics?.eventType ?? self.currentEventType ?? "-",
                    "clientRequestId": self.clientRequestId,
                    "requestId": self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)) ?? "-",
                    "payloadLength": String(payload.utf8.count),
                    "decoderSummary": diagnostics?.decoderSummary ?? "-",
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
                    "clientRequestId": self.clientRequestId,
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
                "clientRequestId": self.clientRequestId,
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
                idleTimeoutSeconds: idleTimeoutSeconds,
                requestId: self.httpResponse.flatMap(extractAIChatLiveRequestId(httpResponse:)),
                clientRequestId: self.clientRequestId
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

}
