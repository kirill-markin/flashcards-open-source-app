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
        let path = makeChatPath(basePath: "/chat", sessionId: sessionId)
        let request = try self.makeRequest(
            session: session,
            path: path,
            method: "GET",
            clientRequestId: clientRequestId
        )

        let data = try await self.execute(
            session: session,
            request: request,
            clientRequestId: clientRequestId
        )

        do {
            let payload = try self.decoder.decode(AIChatSessionSnapshotPayload.self, from: data)
            return AIChatSessionSnapshot(
                sessionId: payload.sessionId,
                runState: payload.runState,
                updatedAt: payload.updatedAt,
                mainContentInvalidationVersion: payload.mainContentInvalidationVersion,
                chatConfig: payload.chatConfig,
                messages: payload.messages.enumerated().map { index, message in
                    AIChatMessage(
                        id: makeAIChatSnapshotMessageId(
                            sessionId: payload.sessionId,
                            index: index,
                            role: message.role,
                            timestamp: message.timestamp
                        ),
                        role: message.role,
                        content: message.content,
                        timestamp: message.timestamp,
                        isError: message.isError
                    )
                }
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
            throw AIChatServiceError.invalidPayload("AI chat snapshot payload is invalid.", diagnostics)
        }
    }

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse {
        let clientRequestId = request.clientRequestId
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: "/chat",
            method: "POST",
            body: request,
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )

        do {
            return try self.decoder.decode(AIChatStartRunResponse.self, from: data)
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
        sessionId: String?
    ) async throws -> AIChatNewSessionResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let request = try self.makeJsonRequest(
            session: session,
            path: "/chat/new",
            method: "POST",
            body: AIChatNewSessionRequestBody(sessionId: sessionId),
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: request,
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
        sessionId: String
    ) async throws -> AIChatStopRunResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: "/chat/stop",
            method: "POST",
            body: ["sessionId": sessionId],
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
        clientRequestId: String
    ) throws -> URLRequest {
        var request = URLRequest(url: try self.makeURL(
            apiBaseUrl: session.apiBaseUrl,
            path: path,
            clientRequestId: clientRequestId
        ))
        request.httpMethod = method
        request.setValue(session.authorization.headerValue, forHTTPHeaderField: "Authorization")
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
            clientRequestId: clientRequestId
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try self.encoder.encode(body)
        return request
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

private func makeChatPath(basePath: String, sessionId: String?) -> String {
    guard let sessionId, sessionId.isEmpty == false else {
        return basePath
    }

    let allowedCharacters = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=?"))
    let encodedSessionId = sessionId.addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? sessionId
    return "\(basePath)?sessionId=\(encodedSessionId)"
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
