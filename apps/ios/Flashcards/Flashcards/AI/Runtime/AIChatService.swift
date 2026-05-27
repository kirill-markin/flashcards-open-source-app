import Foundation

enum AIChatServiceError: LocalizedError, AIChatFailureDiagnosticProviding {
    case invalidBaseUrl(String, AIChatFailureDiagnostics)
    case invalidHttpResponse(AIChatFailureDiagnostics)
    case invalidResponse(CloudApiErrorDetails, String, AIChatFailureDiagnostics)
    case invalidPayload(String, AIChatFailureDiagnostics)

    var diagnostics: AIChatFailureDiagnostics {
        switch self {
        case .invalidBaseUrl(_, let diagnostics):
            return diagnostics
        case .invalidHttpResponse(let diagnostics):
            return diagnostics
        case .invalidResponse(_, _, let diagnostics):
            return diagnostics
        case .invalidPayload(_, let diagnostics):
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
        case .invalidHttpResponse(let diagnostics):
            return formatAIChatUserError(
                summary: "AI chat did not receive an HTTP response.",
                diagnostics: diagnostics
            )
        case .invalidResponse(_, let message, let diagnostics):
            return formatAIChatUserError(
                summary: message,
                diagnostics: diagnostics
            )
        case .invalidPayload(let message, let diagnostics):
            return formatAIChatUserError(
                summary: message,
                diagnostics: diagnostics
            )
        }
    }
}

struct AIChatRequestTooLargeError: LocalizedError, Sendable, Equatable {
    let byteCount: Int?
    let maximumByteCount: Int

    var errorDescription: String? {
        aiChatRequestTooLargeMessage()
    }
}

func aiChatRequestTooLargeTitle() -> String {
    aiSettingsLocalized(
        "ai.error.requestTooLarge.title",
        "Message is too large"
    )
}

func aiChatRequestTooLargeMessage() -> String {
    aiSettingsLocalized(
        "ai.error.requestTooLarge.message",
        "AI chat can’t send this much content at once. Remove one or more attachments, choose a smaller file or photo, or split the request and try again."
    )
}

func isAIChatRequestTooLargeError(error: Error) -> Bool {
    error is AIChatRequestTooLargeError
}

private let aiChatAttachmentUnsupportedTypeCode = "CHAT_ATTACHMENT_UNSUPPORTED_TYPE"

func aiChatAttachmentUnsupportedTypeTitle() -> String {
    aiSettingsLocalized(
        "ai.error.attachmentUnsupported.title",
        "Unsupported file type"
    )
}

func aiChatAttachmentUnsupportedTypeMessage() -> String {
    aiSettingsLocalized(
        "ai.error.attachmentUnsupported.message",
        "This file type is not supported for AI chat. Remove the file or save it as PDF, TXT, CSV, JSON, XML, Markdown, HTML, Python, JavaScript, TypeScript, YAML, XLS/XLSX, DOCX, or an image, then try again."
    )
}

func isAIChatAttachmentUnsupportedTypeError(error: Error) -> Bool {
    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    guard case .invalidResponse(let errorDetails, _, _) = serviceError else {
        return false
    }

    return errorDetails.code == aiChatAttachmentUnsupportedTypeCode
}

func encodeAIChatStartRunRequestBody(
    request: AIChatStartRunRequestBody,
    encoder: JSONEncoder,
    maximumByteCount: Int
) throws -> Data {
    try validateAIChatOutgoingAttachmentSizes(outgoingContent: request.content)
    let encodedBody = try encoder.encode(request)
    try validateAIChatStartRunRequestBodySize(
        encodedBody: encodedBody,
        maximumByteCount: maximumByteCount
    )
    return encodedBody
}

func validateAIChatStartRunRequestBodySize(
    encodedBody: Data,
    maximumByteCount: Int
) throws {
    if encodedBody.count > maximumByteCount {
        throw AIChatRequestTooLargeError(
            byteCount: encodedBody.count,
            maximumByteCount: maximumByteCount
        )
    }
}

func validateAIChatOutgoingAttachmentSizes(outgoingContent: [AIChatContentPart]) throws {
    for part in outgoingContent {
        let base64Data: String?
        switch part {
        case .image(mediaType: _, base64Data: let imageBase64Data):
            base64Data = imageBase64Data
        case .file(fileName: _, mediaType: _, base64Data: let fileBase64Data):
            base64Data = fileBase64Data
        case .text,
             .card,
             .toolCall,
             .reasoningSummary,
             .accountUpgradePrompt,
             .unknown:
            base64Data = nil
        }

        guard let base64Data else {
            continue
        }

        let byteCount = aiChatBase64DataByteCount(base64Data)
        if byteCount > aiChatMaximumAttachmentBytes {
            throw AIChatRequestTooLargeError(
                byteCount: byteCount,
                maximumByteCount: aiChatMaximumAttachmentBytes
            )
        }
    }
}

private func aiChatBase64DataByteCount(_ base64Data: String) -> Int {
    let normalizedBase64Data = base64Data.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalizedBase64Data.isEmpty {
        return 0
    }

    let paddingCharacters: Int
    if normalizedBase64Data.hasSuffix("==") {
        paddingCharacters = 2
    } else if normalizedBase64Data.hasSuffix("=") {
        paddingCharacters = 1
    } else {
        paddingCharacters = 0
    }
    return (normalizedBase64Data.utf8.count * 3 / 4) - paddingCharacters
}

final class AIChatService: AIChatSessionServicing, @unchecked Sendable {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(session: URLSession, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.session = session
        self.encoder = encoder
        self.decoder = decoder
    }

    func loadSnapshot(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatSessionSnapshot {
        let clientRequestId = UUID().uuidString.lowercased()
        let path = makeChatPath(
            basePath: "/chat",
            queryItems: [
                URLQueryItem(name: "sessionId", value: sessionId),
                URLQueryItem(name: "workspaceId", value: session.workspaceId)
            ]
        )
        let request = try self.makeRequest(
            session: session,
            path: path,
            method: "GET",
            clientRequestId: clientRequestId,
            additionalHeaders: [:]
        )

        let data = try await self.execute(
            session: session,
            request: request,
            clientRequestId: clientRequestId
        )

        do {
            let payload = try self.decoder.decode(AIChatSessionSnapshotWire.self, from: data)
            return mapConversationEnvelope(payload)
        } catch {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .decodingEventJSON,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
                decoderSummary: aiChatDecoderSummary(error: error),
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidPayload("AI chat snapshot payload is invalid.", diagnostics)
        }
    }

    func loadBootstrap(
        session: CloudLinkedSession,
        sessionId: String?,
        limit: Int,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) async throws -> AIChatBootstrapResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let path = makeChatPath(
            basePath: "/chat",
            queryItems: [
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(name: "sessionId", value: sessionId),
                URLQueryItem(name: "workspaceId", value: session.workspaceId)
            ]
        )
        let request = try self.makeRequest(
            session: session,
            path: path,
            method: "GET",
            clientRequestId: clientRequestId,
            additionalHeaders: self.resumeAttemptHeaders(diagnostics: resumeAttemptDiagnostics)
        )
        let data = try await self.execute(
            session: session,
            request: request,
            clientRequestId: clientRequestId
        )

        do {
            let payload = try self.decoder.decode(AIChatBootstrapResponseWire.self, from: data)
            return mapConversationEnvelope(payload)
        } catch {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .decodingEventJSON,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
                decoderSummary: aiChatDecoderSummary(error: error),
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidPayload("AI chat bootstrap payload is invalid.", diagnostics)
        }
    }

    func loadOlderMessages(
        session: CloudLinkedSession,
        sessionId: String,
        beforeCursor: String,
        limit: Int
    ) async throws -> AIChatOlderMessagesResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let path = makeChatPath(
            basePath: "/chat",
            queryItems: [
                URLQueryItem(name: "sessionId", value: sessionId),
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(name: "before", value: beforeCursor),
                URLQueryItem(name: "workspaceId", value: session.workspaceId)
            ]
        )
        let request = try self.makeRequest(
            session: session,
            path: path,
            method: "GET",
            clientRequestId: clientRequestId,
            additionalHeaders: [:]
        )
        let data = try await self.execute(
            session: session,
            request: request,
            clientRequestId: clientRequestId
        )

        do {
            let payload = try self.decoder.decode(AIChatBootstrapResponseWire.self, from: data)
            return AIChatOlderMessagesResponse(
                messages: payload.conversation.messages.enumerated().map { index, message in
                    mapConversationMessage(
                        sessionId: payload.sessionId,
                        index: index,
                        message: message
                    )
                },
                hasOlder: payload.conversation.hasOlder ?? false,
                oldestCursor: payload.conversation.oldestCursor
            )
        } catch {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .decodingEventJSON,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
                decoderSummary: aiChatDecoderSummary(error: error),
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidPayload("AI chat older messages payload is invalid.", diagnostics)
        }
    }

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse {
        let clientRequestId = request.clientRequestId
        let requestBody = AIChatStartRunRequestBody(
            sessionId: request.sessionId,
            clientRequestId: request.clientRequestId,
            content: request.content,
            timezone: request.timezone,
            uiLocale: request.uiLocale,
            workspaceId: session.workspaceId
        )
        let encodedBody = try encodeAIChatStartRunRequestBody(
            request: requestBody,
            encoder: self.encoder,
            maximumByteCount: aiChatMaximumStartRunRequestBytes
        )
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: "/chat",
            method: "POST",
            bodyData: encodedBody,
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )

        do {
            let payload = try self.decoder.decode(AIChatAcceptedConversationEnvelopeWire.self, from: data)
            return mapAcceptedConversationEnvelope(payload)
        } catch {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .decodingEventJSON,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
                decoderSummary: aiChatDecoderSummary(error: error),
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidPayload("AI chat start response is invalid.", diagnostics)
        }
    }

    func createNewSession(
        session: CloudLinkedSession,
        request: AIChatNewSessionRequestBody
    ) async throws -> AIChatNewSessionResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let requestBody = AIChatNewSessionRequestBody(
            sessionId: request.sessionId,
            uiLocale: request.uiLocale,
            workspaceId: session.workspaceId
        )
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: "/chat/new",
            method: "POST",
            body: requestBody,
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )

        do {
            return try self.decoder.decode(AIChatNewSessionResponse.self, from: data)
        } catch {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .decodingEventJSON,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
                decoderSummary: aiChatDecoderSummary(error: error),
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidPayload("AI chat new-session response is invalid.", diagnostics)
        }
    }

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String,
        runId: String?
    ) async throws -> AIChatStopRunResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: "/chat/stop",
            method: "POST",
            body: AIChatStopRunRequestBody(
                sessionId: sessionId,
                runId: aiChatNonEmptyRunId(runId: runId),
                workspaceId: session.workspaceId
            ),
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )

        do {
            return try self.decoder.decode(AIChatStopRunResponse.self, from: data)
        } catch {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .decodingEventJSON,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
                decoderSummary: aiChatDecoderSummary(error: error),
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidPayload("AI chat stop response is invalid.", diagnostics)
        }
    }

    private func execute(
        session: CloudLinkedSession,
        request: URLRequest,
        clientRequestId: String
    ) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
            throw error
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            let diagnostics = AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .invalidHttpResponse,
                errorKind: .invalidHttpResponse,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: nil,
                decoderSummary: nil,
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidHttpResponse(diagnostics)
        }

        if httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 {
            return data
        }

        let backendRequestId = extractChatRequestId(httpResponse: httpResponse)
        let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: backendRequestId)
        if isAIChatRequestTooLargeResponse(
            statusCode: httpResponse.statusCode,
            code: errorDetails.code
        ) {
            throw AIChatRequestTooLargeError(
                byteCount: nil,
                maximumByteCount: aiChatMaximumStartRunRequestBytes
            )
        }
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
            rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self)),
            decoderSummary: nil,
            continuationAttempt: nil,
            continuationToolCallIds: []
        )
        let message = makeRequestFailureMessage(
            statusCode: httpResponse.statusCode,
            errorDetails: errorDetails,
            configurationMode: session.configurationMode
        )
        throw AIChatServiceError.invalidResponse(errorDetails, message, diagnostics)
    }

    private func makeRequest(
        session: CloudLinkedSession,
        path: String,
        method: String,
        clientRequestId: String,
        additionalHeaders: [String: String]
    ) throws -> URLRequest {
        var request = URLRequest(url: try self.makeURL(
            apiBaseUrl: session.apiBaseUrl,
            path: path,
            clientRequestId: clientRequestId
        ))
        request.httpMethod = method
        request.setValue(session.authorization.headerValue, forHTTPHeaderField: "Authorization")
        for (headerName, headerValue) in additionalHeaders {
            request.setValue(headerValue, forHTTPHeaderField: headerName)
        }
        request.setValue(clientRequestId, forHTTPHeaderField: "X-Chat-Request-Id")
        return request
    }

    private func makeJsonRequest<Body: Encodable>(
        session: CloudLinkedSession,
        path: String,
        method: String,
        body: Body,
        clientRequestId: String
    ) throws -> URLRequest {
        var request = try self.makeRequest(
            session: session,
            path: path,
            method: method,
            clientRequestId: clientRequestId,
            additionalHeaders: [:]
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try self.encoder.encode(body)
        return request
    }

    private func makeJsonRequest(
        session: CloudLinkedSession,
        path: String,
        method: String,
        bodyData: Data,
        clientRequestId: String
    ) throws -> URLRequest {
        var request = try self.makeRequest(
            session: session,
            path: path,
            method: method,
            clientRequestId: clientRequestId,
            additionalHeaders: [:]
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData
        return request
    }

    private func resumeAttemptHeaders(
        diagnostics: AIChatResumeAttemptDiagnostics?
    ) -> [String: String] {
        guard let diagnostics else {
            return [:]
        }

        return [
            "X-Chat-Resume-Attempt-Id": diagnostics.headerValue,
            "X-Client-Platform": aiChatClientPlatform,
            "X-Client-Version": aiChatAppVersion(),
        ]
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
                rawSnippet: aiChatTruncatedSnippet(apiBaseUrl),
                decoderSummary: nil,
                continuationAttempt: nil,
                continuationToolCallIds: []
            )
            throw AIChatServiceError.invalidBaseUrl(apiBaseUrl, diagnostics)
        }

        return url
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

private func isAIChatRequestTooLargeResponse(statusCode: Int, code: String?) -> Bool {
    if statusCode == 413 {
        return true
    }

    return code == "CHAT_REQUEST_TOO_LARGE"
}

private func makeChatPath(basePath: String, queryItems: [URLQueryItem]) -> String {
    let encodedQueryItems: [URLQueryItem] = queryItems.compactMap { item -> URLQueryItem? in
        guard let value = item.value, value.isEmpty == false else {
            return nil
        }

        return URLQueryItem(name: item.name, value: value)
    }

    guard encodedQueryItems.isEmpty == false else {
        return basePath
    }

    var components = URLComponents()
    components.queryItems = encodedQueryItems
    guard let percentEncodedQuery = components.percentEncodedQuery, percentEncodedQuery.isEmpty == false else {
        return basePath
    }

    return "\(basePath)?\(percentEncodedQuery)"
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

private func makeRequestFailureMessage(
    statusCode: Int,
    errorDetails: CloudApiErrorDetails,
    configurationMode: CloudServiceConfigurationMode
) -> String {
    let baseMessage = makeAIChatUserFacingErrorMessage(
        rawMessage: errorDetails.message,
        code: errorDetails.code,
        requestId: errorDetails.requestId,
        configurationMode: configurationMode,
        surface: .chat
    )
    return "AI chat request failed with status \(statusCode): \(baseMessage)"
}
