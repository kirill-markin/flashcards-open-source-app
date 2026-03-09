import Foundation

enum AIChatServiceError: LocalizedError, AIChatFailureDiagnosticProviding {
    case invalidBaseUrl(String, AIChatFailureDiagnostics)
    case invalidStreamResponse(AIChatFailureDiagnostics)
    case invalidResponse(String, AIChatFailureDiagnostics)
    case invalidStreamContract(String, AIChatFailureDiagnostics)
    case invalidSSEFraming(AIChatFailureDiagnostics)
    case invalidSSEEventJSON(AIChatFailureDiagnostics)
    case backendError(AIChatBackendError, AIChatFailureDiagnostics)

    var diagnostics: AIChatFailureDiagnostics {
        switch self {
        case .invalidBaseUrl(_, let diagnostics):
            return diagnostics
        case .invalidStreamResponse(let diagnostics):
            return diagnostics
        case .invalidResponse(_, let diagnostics):
            return diagnostics
        case .invalidStreamContract(_, let diagnostics):
            return diagnostics
        case .invalidSSEFraming(let diagnostics):
            return diagnostics
        case .invalidSSEEventJSON(let diagnostics):
            return diagnostics
        case .backendError(_, let diagnostics):
            return diagnostics
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl(_, let diagnostics):
            return formatAIChatUserError(
                summary: "AI chat base URL is invalid.",
                diagnostics: diagnostics
            )
        case .invalidStreamResponse(let diagnostics):
            return formatAIChatUserError(
                summary: "AI chat did not receive an HTTP response.",
                diagnostics: diagnostics
            )
        case .invalidResponse(let message, let diagnostics):
            return formatAIChatUserError(
                summary: message,
                diagnostics: diagnostics
            )
        case .invalidStreamContract(let message, let diagnostics):
            return formatAIChatUserError(
                summary: message,
                diagnostics: diagnostics
            )
        case .invalidSSEFraming(let diagnostics):
            return formatAIChatUserError(
                summary: "AI chat stream framing was invalid.",
                diagnostics: diagnostics
            )
        case .invalidSSEEventJSON(let diagnostics):
            return formatAIChatUserError(
                summary: "AI chat stream event JSON was invalid.",
                diagnostics: diagnostics
            )
        case .backendError(let backendError, let diagnostics):
            return formatAIChatUserError(
                summary: backendError.message,
                diagnostics: diagnostics
            )
        }
    }
}

struct AIChatSSEParser {
    private let decoder: JSONDecoder
    private let clientRequestId: String
    private var backendRequestId: String?
    private var currentDataLines: [String]
    private var currentEventType: String?
    private var currentEventLineNumber: Int?
    private var eventIndex: Int
    private var lineNumber: Int
    private var lastNonEmptyLine: String?

    init(decoder: JSONDecoder, clientRequestId: String, backendRequestId: String?) {
        self.decoder = decoder
        self.clientRequestId = clientRequestId
        self.backendRequestId = backendRequestId
        self.currentDataLines = []
        self.currentEventType = nil
        self.currentEventLineNumber = nil
        self.eventIndex = 0
        self.lineNumber = 0
        self.lastNonEmptyLine = nil
    }

    mutating func pushLine(_ line: String) throws -> AIChatBackendStreamEvent? {
        self.lineNumber += 1
        if line.isEmpty == false {
            self.lastNonEmptyLine = line
        }

        if line.hasPrefix("data: ") {
            if self.currentEventLineNumber == nil {
                self.currentEventLineNumber = self.lineNumber
            }
            let payloadLine = String(line.dropFirst(6))
            self.currentDataLines.append(payloadLine)
            if self.currentEventType == nil {
                self.currentEventType = extractEventType(payload: payloadLine)
            }
            return nil
        }

        if line.isEmpty == false {
            return nil
        }

        return try self.finishEvent(stage: .finishingEvent)
    }

    mutating func finish() throws -> [AIChatBackendStreamEvent] {
        let trailingEvent = try self.finishEvent(stage: .processingTrailingEvent)
        guard let trailingEvent else {
            return []
        }

        return [trailingEvent]
    }

    private mutating func finishEvent(stage: AIChatFailureStage) throws -> AIChatBackendStreamEvent? {
        if self.currentDataLines.isEmpty {
            return nil
        }

        self.eventIndex += 1
        let payload = self.currentDataLines.joined(separator: "\n")
        let eventType = self.currentEventType
        let eventLineNumber = self.currentEventLineNumber ?? self.lineNumber

        self.currentDataLines.removeAll(keepingCapacity: true)
        self.currentEventType = nil
        self.currentEventLineNumber = nil

        do {
            let data = Data(payload.utf8)
            return try self.decoder.decode(AIChatBackendStreamEvent.self, from: data)
        } catch {
            if looksLikeMultipleTopLevelJSONValues(payload: payload) {
                throw makeInvalidSSEFramingError(
                    clientRequestId: self.clientRequestId,
                    backendRequestId: self.backendRequestId,
                    stage: stage,
                    eventType: eventType,
                    lineNumber: eventLineNumber,
                    payload: payload,
                    decodingError: error
                )
            }

            throw makeInvalidSSEEventJSONError(
                clientRequestId: self.clientRequestId,
                backendRequestId: self.backendRequestId,
                stage: stage,
                eventType: eventType,
                lineNumber: eventLineNumber,
                payload: payload,
                decodingError: error
            )
        }
    }
}

final class AIChatService: AIChatStreaming, @unchecked Sendable {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(session: URLSession, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.session = session
        self.encoder = encoder
        self.decoder = decoder
    }

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        let clientRequestId = UUID().uuidString.lowercased()

        var urlRequest = URLRequest(url: try self.makeURL(
            apiBaseUrl: session.apiBaseUrl,
            path: "/chat/local-turn",
            clientRequestId: clientRequestId
        ))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(session.bearerToken)", forHTTPHeaderField: "Authorization")
        urlRequest.httpBody = try self.encoder.encode(request)

        let (bytes, response) = try await self.session.bytes(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .invalidHttpResponse,
                errorKind: .invalidStreamResponse,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: nil,
                decoderSummary: nil
            )
            logAIChatFailure(diagnostics: diagnostics, summary: "Missing HTTPURLResponse")
            throw AIChatServiceError.invalidStreamResponse(diagnostics)
        }

        let backendRequestId = extractChatRequestId(httpResponse: httpResponse)
        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let body = try await self.readBody(bytes: bytes)
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: backendRequestId,
                stage: .responseNotOk,
                errorKind: .invalidHttpResponse,
                statusCode: httpResponse.statusCode,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: truncatedSnippet(body),
                decoderSummary: nil
            )
            let message = makeRequestFailureMessage(
                statusCode: httpResponse.statusCode,
                body: body,
                requestId: backendRequestId
            )
            logAIChatFailure(diagnostics: diagnostics, summary: message)
            throw AIChatServiceError.invalidResponse(message, diagnostics)
        }

        var parser = AIChatSSEParser(
            decoder: self.decoder,
            clientRequestId: clientRequestId,
            backendRequestId: backendRequestId
        )
        var awaitsToolResults = false
        var requestedToolCalls: [AIToolCallRequest] = []

        for try await line in bytes.lines {
            if let event = try parser.pushLine(String(line)) {
                switch event {
                case .delta(let text):
                    await onDelta(text)
                case .toolCallRequest(let toolCallRequest):
                    requestedToolCalls.append(toolCallRequest)
                    await onToolCallRequest(toolCallRequest)
                case .repairAttempt(let status):
                    await onRepairAttempt(status)
                case .awaitToolResults:
                    awaitsToolResults = true
                case .done:
                    return AITurnStreamOutcome(
                        awaitsToolResults: false,
                        requestedToolCalls: requestedToolCalls,
                        requestId: backendRequestId
                    )
                case .error(let backendError):
                    let diagnostics = AIChatFailureDiagnostics(
                        clientRequestId: clientRequestId,
                        backendRequestId: backendError.requestId,
                        stage: .backendErrorEvent,
                        errorKind: .backendErrorEvent,
                        statusCode: nil,
                        eventType: "error",
                        toolName: nil,
                        toolCallId: nil,
                        lineNumber: nil,
                        rawSnippet: nil,
                        decoderSummary: "backend_code=\(backendError.code)"
                    )
                    logAIChatFailure(diagnostics: diagnostics, summary: backendError.message)
                    throw AIChatServiceError.backendError(backendError, diagnostics)
                }
            }
        }

        let trailingEvents = try parser.finish()
        for event in trailingEvents {
            switch event {
            case .delta(let text):
                await onDelta(text)
            case .toolCallRequest(let toolCallRequest):
                requestedToolCalls.append(toolCallRequest)
                await onToolCallRequest(toolCallRequest)
            case .repairAttempt(let status):
                await onRepairAttempt(status)
            case .awaitToolResults:
                awaitsToolResults = true
            case .done:
                return AITurnStreamOutcome(
                    awaitsToolResults: false,
                    requestedToolCalls: requestedToolCalls,
                    requestId: backendRequestId
                )
            case .error(let backendError):
                let diagnostics = AIChatFailureDiagnostics(
                    clientRequestId: clientRequestId,
                    backendRequestId: backendError.requestId,
                    stage: .backendErrorEvent,
                    errorKind: .backendErrorEvent,
                    statusCode: nil,
                    eventType: "error",
                    toolName: nil,
                    toolCallId: nil,
                    lineNumber: nil,
                    rawSnippet: nil,
                    decoderSummary: "backend_code=\(backendError.code)"
                )
                logAIChatFailure(diagnostics: diagnostics, summary: backendError.message)
                throw AIChatServiceError.backendError(backendError, diagnostics)
            }
        }

        return AITurnStreamOutcome(
            awaitsToolResults: awaitsToolResults,
            requestedToolCalls: requestedToolCalls,
            requestId: backendRequestId
        )
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
        do {
            var request = URLRequest(url: try self.makeURL(
                apiBaseUrl: session.apiBaseUrl,
                path: "/chat/local-turn/diagnostics",
                clientRequestId: body.clientRequestId
            ))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(session.bearerToken)", forHTTPHeaderField: "Authorization")
            request.httpBody = try self.encoder.encode(body)

            let (_, response) = try await self.session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                logFlashcardsError(
                    domain: "chat",
                    action: "local_chat_diagnostics_invalid_response",
                    metadata: [
                        "clientRequestId": body.clientRequestId,
                        "backendRequestId": body.backendRequestId ?? "-",
                    ]
                )
                return
            }

            if httpResponse.statusCode != 204 {
                logFlashcardsError(
                    domain: "chat",
                    action: "local_chat_diagnostics_not_accepted",
                    metadata: [
                        "clientRequestId": body.clientRequestId,
                        "backendRequestId": body.backendRequestId ?? "-",
                        "statusCode": String(httpResponse.statusCode),
                    ]
                )
            }
        } catch {
            logFlashcardsError(
                domain: "chat",
                action: "local_chat_diagnostics_failed",
                metadata: [
                    "clientRequestId": body.clientRequestId,
                    "backendRequestId": body.backendRequestId ?? "-",
                    "error": localizedMessage(error: error),
                ]
            )
        }
    }

    private func makeURL(apiBaseUrl: String, path: String, clientRequestId: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .requestBuild,
                errorKind: .invalidBaseUrl,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: truncatedSnippet(apiBaseUrl),
                decoderSummary: nil
            )
            logAIChatFailure(diagnostics: diagnostics, summary: "Invalid base URL")
            throw AIChatServiceError.invalidBaseUrl(apiBaseUrl, diagnostics)
        }

        return url
    }

    private func readBody(bytes: URLSession.AsyncBytes) async throws -> String {
        var data = Data()
        for try await byte in bytes {
            data.append(byte)
        }

        return String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
    }
}

private func extractChatRequestId(httpResponse: HTTPURLResponse) -> String? {
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

private func formatAIChatUserError(summary: String, diagnostics: AIChatFailureDiagnostics) -> String {
    var lines = [summary]

    if let backendRequestId = diagnostics.backendRequestId, backendRequestId.isEmpty == false {
        lines.append("Request: \(backendRequestId)")
    } else {
        lines.append("Debug: \(diagnostics.clientRequestId)")
    }

    lines.append("Stage: \(diagnostics.stage.rawValue)")

    if let toolName = diagnostics.toolName, toolName.isEmpty == false {
        lines.append("Tool: \(toolName)")
    }

    return lines.joined(separator: "\n")
}

private func truncatedSnippet(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count <= 240 {
        return trimmed
    }

    let endIndex = trimmed.index(trimmed.startIndex, offsetBy: 240)
    return String(trimmed[..<endIndex]) + "..."
}

private func extractEventType(payload: String) -> String? {
    guard let data = payload.data(using: .utf8) else {
        return nil
    }

    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }

    return object["type"] as? String
}

private func looksLikeMultipleTopLevelJSONValues(payload: String) -> Bool {
    payload.contains("}\n{") || payload.contains("}\r\n{")
}

private func decoderSummary(error: Error) -> String {
    if let decodingError = error as? DecodingError {
        switch decodingError {
        case .dataCorrupted(let context):
            return context.debugDescription
        case .keyNotFound(let key, let context):
            return "missing key \(key.stringValue): \(context.debugDescription)"
        case .typeMismatch(let type, let context):
            return "type mismatch \(type): \(context.debugDescription)"
        case .valueNotFound(let type, let context):
            return "missing value \(type): \(context.debugDescription)"
        @unknown default:
            return String(describing: decodingError)
        }
    }

    return localizedMessage(error: error)
}

private func makeInvalidSSEFramingError(
    clientRequestId: String,
    backendRequestId: String?,
    stage: AIChatFailureStage,
    eventType: String?,
    lineNumber: Int?,
    payload: String,
    decodingError: Error
) -> AIChatServiceError {
    let diagnostics = AIChatFailureDiagnostics(
        clientRequestId: clientRequestId,
        backendRequestId: backendRequestId,
        stage: stage,
        errorKind: .invalidSSEFraming,
        statusCode: nil,
        eventType: eventType,
        toolName: nil,
        toolCallId: nil,
        lineNumber: lineNumber,
        rawSnippet: truncatedSnippet(payload),
        decoderSummary: decoderSummary(error: decodingError)
    )
    logAIChatFailure(diagnostics: diagnostics, summary: "Invalid SSE framing")
    return .invalidSSEFraming(diagnostics)
}

private func makeInvalidSSEEventJSONError(
    clientRequestId: String,
    backendRequestId: String?,
    stage: AIChatFailureStage,
    eventType: String?,
    lineNumber: Int?,
    payload: String,
    decodingError: Error
) -> AIChatServiceError {
    let diagnostics = AIChatFailureDiagnostics(
        clientRequestId: clientRequestId,
        backendRequestId: backendRequestId,
        stage: stage,
        errorKind: .invalidSSEEventJSON,
        statusCode: nil,
        eventType: eventType,
        toolName: nil,
        toolCallId: nil,
        lineNumber: lineNumber,
        rawSnippet: truncatedSnippet(payload),
        decoderSummary: decoderSummary(error: decodingError)
    )
    logAIChatFailure(diagnostics: diagnostics, summary: "Invalid SSE event JSON")
    return .invalidSSEEventJSON(diagnostics)
}

private func logAIChatFailure(diagnostics: AIChatFailureDiagnostics, summary: String) {
    logFlashcardsError(
        domain: "chat",
        action: "local_chat_failure",
        metadata: [
            "clientRequestId": diagnostics.clientRequestId,
            "backendRequestId": diagnostics.backendRequestId ?? "-",
            "stage": diagnostics.stage.rawValue,
            "errorKind": diagnostics.errorKind.rawValue,
            "statusCode": diagnostics.statusCode.map(String.init) ?? "-",
            "eventType": diagnostics.eventType ?? "-",
            "toolName": diagnostics.toolName ?? "-",
            "toolCallId": diagnostics.toolCallId ?? "-",
            "lineNumber": diagnostics.lineNumber.map(String.init) ?? "-",
            "decoderSummary": diagnostics.decoderSummary ?? "-",
            "rawSnippet": diagnostics.rawSnippet ?? "-",
            "summary": summary,
        ]
    )
}

private func makeRequestFailureMessage(statusCode: Int, body: String, requestId: String?) -> String {
    let errorDetails = parseCloudApiErrorDetails(data: Data(body.utf8), requestId: requestId)
    let baseMessage = appendCloudRequestReference(message: errorDetails.message, requestId: errorDetails.requestId)
    return "AI chat request failed with status \(statusCode): \(baseMessage)"
}
