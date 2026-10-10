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
        "This file type is not supported for AI chat. Remove the file or save it as PDF, TXT, CSV, JSON, XML, Markdown, HTML, Python, JavaScript, TypeScript, YAML, XLS/XLSX, DOCX, ZIP, Anki APKG, or an image, then try again."
    )
}

func isAIChatAttachmentUnsupportedTypeError(error: Error) -> Bool {
    aiChatServiceErrorCode(error: error) == aiChatAttachmentUnsupportedTypeCode
}

/// The upload error codes of `apps/backend/src/chatFiles/uploads.ts`.
private let aiChatFileUploadTooLargeCode = "CHAT_FILE_UPLOAD_TOO_LARGE"
private let aiChatFileUploadNotFoundCode = "CHAT_FILE_UPLOAD_NOT_FOUND"
private let aiChatFileUploadsTooManyCode = "CHAT_FILE_UPLOADS_TOO_MANY"
private let aiChatFileUploadImagesTooLargeCode = "CHAT_FILE_UPLOAD_IMAGES_TOO_LARGE"

/// The message for attachments over a limit, whether this client or the backend refused them; nil for any other error.
func aiChatAttachmentLimitMessage(error: Error) -> String? {
    if let limitError = error as? AIChatAttachmentLimitError {
        return limitError.errorDescription
    }

    guard let code = aiChatServiceErrorCode(error: error) else {
        return nil
    }

    switch code {
    case aiChatFileUploadTooLargeCode:
        return aiChatAttachmentTooLargeMessage()
    case aiChatFileUploadsTooManyCode:
        return aiChatTooManyUploadsMessage()
    case aiChatFileUploadImagesTooLargeCode:
        return aiChatTurnImagesTooLargeMessage()
    default:
        return nil
    }
}

/// The person resolves a limit by changing the message, so it is not reported as a failure.
func isAIChatAttachmentLimitError(error: Error) -> Bool {
    aiChatAttachmentLimitMessage(error: error) != nil
}

/// The message for an attachment whose bytes did not reach the backend; nil for any other error.
func aiChatAttachmentUploadFailureMessage(error: Error) -> String? {
    if error is AIChatAttachmentUnavailableError {
        return aiChatAttachmentUnavailableMessage()
    }

    if error is AIChatFileUploadPutError || aiChatServiceErrorCode(error: error) == aiChatFileUploadNotFoundCode {
        return aiChatAttachmentUploadFailedMessage()
    }

    return nil
}

private func aiChatServiceErrorCode(error: Error) -> String? {
    guard let serviceError = error as? AIChatServiceError,
          case .invalidResponse(let errorDetails, _, _) = serviceError else {
        return nil
    }

    return errorDetails.code
}

/// The pre-signed PUT of an attachment failed; `diagnostics.rawSnippet` keeps the storage error body.
struct AIChatFileUploadPutError: LocalizedError, AIChatFailureDiagnosticProviding {
    let statusCode: Int
    let diagnostics: AIChatFailureDiagnostics

    var errorDescription: String? {
        "AI chat file upload PUT failed with status \(self.statusCode)."
    }
}

private let aiChatFileUploadPutMaxAttempts: Int = 3
private let aiChatFileUploadPutRetryDelayNanoseconds: UInt64 = 500_000_000
private let aiChatStartRunMaxAttempts: Int = 3

private func aiChatFileUploadPutStatusIsRetryable(statusCode: Int) -> Bool {
    statusCode == 408 || statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}

/// A client timeout and a gateway timeout can both hide a turn the backend already stored.
private func isAIChatStartRunTimeout(error: Error) -> Bool {
    if flashcardsURLErrorCode(error: error, remainingDepth: 4) == .timedOut {
        return true
    }

    guard let serviceError = error as? AIChatServiceError,
          case .invalidResponse(_, _, let diagnostics) = serviceError else {
        return false
    }

    return diagnostics.statusCode == 504
}

private let aiChatSessionNotCurrentCode = "CHAT_SESSION_NOT_CURRENT"

func aiChatSessionNotCurrentNotice() -> String {
    aiSettingsLocalized(
        "ai.chatNotCurrent.notice",
        "This chat was replaced by a newer one. Your message is still in the box — send it again."
    )
}

/// The backend refuses a turn into a chat that is no longer the latest one before any run starts, so nothing was saved.
func isAIChatSessionNotCurrentError(error: Error) -> Bool {
    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    guard case .invalidResponse(let errorDetails, _, let diagnostics) = serviceError else {
        return false
    }

    return diagnostics.statusCode == 409 && errorDetails.code == aiChatSessionNotCurrentCode
}

private let aiChatSessionArchiveActiveRunCode = "CHAT_SESSION_ARCHIVE_ACTIVE_RUN"

/// The session endpoints answer 404 for an unknown, archived, or foreign chat.
func isAIChatSessionUnavailableError(error: Error) -> Bool {
    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    guard case .invalidResponse(_, _, let diagnostics) = serviceError else {
        return false
    }

    return diagnostics.statusCode == 404
}

func isAIChatSessionArchiveActiveRunError(error: Error) -> Bool {
    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    guard case .invalidResponse(let errorDetails, _, _) = serviceError else {
        return false
    }

    return errorDetails.code == aiChatSessionArchiveActiveRunCode
}

func encodeAIChatStartRunRequestBody(
    request: AIChatStartRunRequestBody,
    encoder: JSONEncoder,
    maximumByteCount: Int
) throws -> Data {
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

final class AIChatService: AIChatSessionServicing, @unchecked Sendable {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let ownOpenAIKeyStore: OwnOpenAIKeyStore

    init(session: URLSession, encoder: JSONEncoder, decoder: JSONDecoder, ownOpenAIKeyStore: OwnOpenAIKeyStore) {
        self.session = session
        self.encoder = encoder
        self.decoder = decoder
        self.ownOpenAIKeyStore = ownOpenAIKeyStore
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
            clientRequestId: clientRequestId,
            additionalHeaders: try addingOwnOpenAIKeyHeader(
                headers: ["X-Client-Platform": aiChatClientPlatform],
                ownOpenAIKeyStore: self.ownOpenAIKeyStore
            )
        )
        let data = try await self.executeStartRun(
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

    func uploadChatFile(
        session: CloudLinkedSession,
        fileName: String,
        mediaType: String,
        sizeBytes: Int,
        fileURL: URL
    ) async throws -> String {
        let clientRequestId = UUID().uuidString.lowercased()
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: "/chat/files/uploads",
            method: "POST",
            body: AIChatFileUploadRequestBody(
                fileName: fileName,
                mediaType: mediaType,
                sizeBytes: sizeBytes
            ),
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )
        let response = try self.decodeSessionHistoryPayload(
            AIChatFileUploadResponse.self,
            data: data,
            clientRequestId: clientRequestId,
            invalidPayloadMessage: "AI chat file upload response is invalid."
        )
        try await self.putChatFile(
            upload: response.upload,
            fileURL: fileURL,
            clientRequestId: clientRequestId
        )
        return response.uploadId
    }

    private func putChatFile(
        upload: AIChatFileUploadTarget,
        fileURL: URL,
        clientRequestId: String
    ) async throws {
        guard let uploadURL = URL(string: upload.url) else {
            throw AIChatServiceError.invalidPayload(
                "AI chat file upload URL is invalid.",
                makeAIChatFileUploadPutDiagnostics(
                    clientRequestId: clientRequestId,
                    stage: .requestBuild,
                    errorKind: .invalidStreamContract,
                    statusCode: nil,
                    rawSnippet: nil
                )
            )
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = upload.method
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        for (headerName, headerValue) in upload.headers {
            request.setValue(headerValue, forHTTPHeaderField: headerName)
        }

        var lastError: Error?
        for attempt in 1...aiChatFileUploadPutMaxAttempts {
            do {
                let (data, response) = try await self.session.upload(for: request, fromFile: fileURL)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw AIChatServiceError.invalidHttpResponse(
                        makeAIChatFileUploadPutDiagnostics(
                            clientRequestId: clientRequestId,
                            stage: .invalidHttpResponse,
                            errorKind: .invalidHttpResponse,
                            statusCode: nil,
                            rawSnippet: nil
                        )
                    )
                }
                if httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 {
                    return
                }

                let putError = AIChatFileUploadPutError(
                    statusCode: httpResponse.statusCode,
                    diagnostics: makeAIChatFileUploadPutDiagnostics(
                        clientRequestId: clientRequestId,
                        stage: .responseNotOk,
                        errorKind: .invalidHttpResponse,
                        statusCode: httpResponse.statusCode,
                        rawSnippet: aiChatTruncatedSnippet(String(decoding: data, as: UTF8.self))
                    )
                )
                lastError = putError
                guard aiChatFileUploadPutStatusIsRetryable(statusCode: httpResponse.statusCode),
                      attempt < aiChatFileUploadPutMaxAttempts else {
                    throw putError
                }

                try await self.retryChatFilePut(
                    error: putError,
                    request: request,
                    clientRequestId: clientRequestId,
                    attempt: attempt
                )
            } catch let error as CancellationError {
                throw error
            } catch {
                if isRequestCancellationError(error: error) {
                    throw error
                }
                lastError = error
                guard isRetryableNetworkTransportFailure(error: error),
                      attempt < aiChatFileUploadPutMaxAttempts else {
                    throw error
                }

                try await self.retryChatFilePut(
                    error: error,
                    request: request,
                    clientRequestId: clientRequestId,
                    attempt: attempt
                )
            }
        }

        guard let lastError else {
            throw LocalStoreError.database("AI chat file upload PUT retry failed without an error")
        }
        throw lastError
    }

    private func retryChatFilePut(
        error: Error,
        request: URLRequest,
        clientRequestId: String,
        attempt: Int
    ) async throws {
        FlashcardsObservability.addBreadcrumb(
            .cloudRetry(
                CloudRetryObservation(
                    action: "ai_chat_file_upload_put_retry",
                    scope: makeAIChatRetryObservationScope(
                        workspaceId: nil,
                        clientRequestId: clientRequestId,
                        configurationMode: nil
                    ),
                    attempt: attempt,
                    maxAttempts: aiChatFileUploadPutMaxAttempts,
                    apiBaseUrl: nil,
                    messageSummary: Flashcards.errorMessage(error: error),
                    transportDiagnostics: makeIOSNetworkTransportDiagnostics(
                        error: error,
                        httpMethod: request.httpMethod,
                        endpointPath: request.url?.path,
                        apiBaseUrl: nil
                    )
                )
            )
        )
        try await Task.sleep(nanoseconds: aiChatFileUploadPutRetryDelayNanoseconds)
    }

    /// The backend de-duplicates a turn by its client request id, so a timed-out POST is sent again unchanged and
    /// answers with the turn it may already have stored.
    private func executeStartRun(
        session: CloudLinkedSession,
        request: URLRequest,
        clientRequestId: String
    ) async throws -> Data {
        var lastError: Error?
        for attempt in 1...aiChatStartRunMaxAttempts {
            do {
                return try await self.execute(
                    session: session,
                    request: request,
                    clientRequestId: clientRequestId
                )
            } catch {
                lastError = error
                guard isAIChatStartRunTimeout(error: error), attempt < aiChatStartRunMaxAttempts else {
                    throw error
                }

                FlashcardsObservability.addBreadcrumb(
                    .cloudRetry(
                        CloudRetryObservation(
                            action: "ai_chat_start_run_retry",
                            scope: makeAIChatRetryObservationScope(
                                workspaceId: session.workspaceId,
                                clientRequestId: clientRequestId,
                                configurationMode: session.configurationMode
                            ),
                            attempt: attempt,
                            maxAttempts: aiChatStartRunMaxAttempts,
                            apiBaseUrl: session.apiBaseUrl,
                            messageSummary: Flashcards.errorMessage(error: error),
                            transportDiagnostics: makeIOSNetworkTransportDiagnostics(
                                error: error,
                                httpMethod: request.httpMethod,
                                endpointPath: request.url?.path,
                                apiBaseUrl: session.apiBaseUrl
                            )
                        )
                    )
                )
            }
        }

        guard let lastError else {
            throw LocalStoreError.database("AI chat start-run retry failed without an error")
        }
        throw lastError
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

    func listChatSessions(
        session: CloudLinkedSession,
        cursor: String?,
        searchText: String?
    ) async throws -> AIChatSessionHistoryPage {
        let clientRequestId = UUID().uuidString.lowercased()
        let path = makeChatPath(
            basePath: "/chat/sessions",
            queryItems: [
                URLQueryItem(name: "workspaceId", value: session.workspaceId),
                URLQueryItem(name: "limit", value: String(aiChatSessionHistoryPageLimit)),
                URLQueryItem(name: "cursor", value: cursor),
                URLQueryItem(name: "q", value: searchText)
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

        return try self.decodeSessionHistoryPayload(
            AIChatSessionHistoryPage.self,
            data: data,
            clientRequestId: clientRequestId,
            invalidPayloadMessage: "AI chat history payload is invalid."
        )
    }

    func renameChatSession(
        session: CloudLinkedSession,
        sessionId: String,
        title: String
    ) async throws -> AIChatSessionHistorySummary {
        let clientRequestId = UUID().uuidString.lowercased()
        let urlRequest = try self.makeJsonRequest(
            session: session,
            path: makeChatPath(
                basePath: "/chat/sessions/\(sessionId)/rename",
                queryItems: [URLQueryItem(name: "workspaceId", value: session.workspaceId)]
            ),
            method: "POST",
            body: AIChatSessionRenameRequestBody(title: title),
            clientRequestId: clientRequestId
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )

        return try self.decodeSessionHistoryPayload(
            AIChatSessionHistorySummary.self,
            data: data,
            clientRequestId: clientRequestId,
            invalidPayloadMessage: "AI chat rename response is invalid."
        )
    }

    /// Not retried: a repeated archive of the same chat answers 404.
    func archiveChatSession(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatArchivedSession {
        let clientRequestId = UUID().uuidString.lowercased()
        let urlRequest = try self.makeRequest(
            session: session,
            path: makeChatPath(
                basePath: "/chat/sessions/\(sessionId)/archive",
                queryItems: [URLQueryItem(name: "workspaceId", value: session.workspaceId)]
            ),
            method: "POST",
            clientRequestId: clientRequestId,
            additionalHeaders: [:]
        )
        let data = try await self.execute(
            session: session,
            request: urlRequest,
            clientRequestId: clientRequestId
        )

        return try self.decodeSessionHistoryPayload(
            AIChatArchivedSession.self,
            data: data,
            clientRequestId: clientRequestId,
            invalidPayloadMessage: "AI chat archive response is invalid."
        )
    }

    private func decodeSessionHistoryPayload<Payload: Decodable>(
        _ payloadType: Payload.Type,
        data: Data,
        clientRequestId: String,
        invalidPayloadMessage: String
    ) throws -> Payload {
        do {
            return try self.decoder.decode(payloadType, from: data)
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
            throw AIChatServiceError.invalidPayload(invalidPayloadMessage, diagnostics)
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
        clientRequestId: String,
        additionalHeaders: [String: String]
    ) throws -> URLRequest {
        var request = try self.makeRequest(
            session: session,
            path: path,
            method: method,
            clientRequestId: clientRequestId,
            additionalHeaders: additionalHeaders
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

enum AIUsageRequestError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidHttpResponse
    case responseNotOk(Int, CloudApiErrorDetails)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl(let apiBaseUrl):
            return "AI usage URL is invalid for API base URL \(apiBaseUrl)"
        case .invalidHttpResponse:
            return "AI usage request did not receive an HTTP response"
        case .responseNotOk(let statusCode, let errorDetails):
            return "AI usage request failed with status \(statusCode): \(errorDetails.message)"
        }
    }
}

/// Reads `GET /me/ai-usage` for the caller the session authenticates.
func loadAIMonthlyUsage(
    urlSession: URLSession,
    session: CloudLinkedSession
) async throws -> AIMonthlyUsage {
    let trimmedBaseUrl = session.apiBaseUrl.hasSuffix("/") ? String(session.apiBaseUrl.dropLast()) : session.apiBaseUrl
    guard let url = URL(string: "\(trimmedBaseUrl)/me/ai-usage") else {
        throw AIUsageRequestError.invalidBaseUrl(session.apiBaseUrl)
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue(session.authorization.headerValue, forHTTPHeaderField: "Authorization")
    let (data, response) = try await urlSession.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
        throw AIUsageRequestError.invalidHttpResponse
    }

    guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
        throw AIUsageRequestError.responseNotOk(
            httpResponse.statusCode,
            decodeCloudApiErrorDetails(data: data, requestId: extractChatRequestId(httpResponse: httpResponse))
        )
    }

    return try makeFlashcardsRemoteJSONDecoder().decode(AIUsageStatusResponse.self, from: data).usage
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

private func makeAIChatFileUploadPutDiagnostics(
    clientRequestId: String,
    stage: AIChatFailureStage,
    errorKind: AIChatFailureKind,
    statusCode: Int?,
    rawSnippet: String?
) -> AIChatFailureDiagnostics {
    AIChatFailureDiagnostics(
        clientRequestId: clientRequestId,
        backendRequestId: nil,
        stage: stage,
        errorKind: errorKind,
        statusCode: statusCode,
        eventType: nil,
        toolName: nil,
        toolCallId: nil,
        lineNumber: nil,
        rawSnippet: rawSnippet,
        decoderSummary: nil,
        continuationAttempt: nil,
        continuationToolCallIds: []
    )
}

private func makeAIChatRetryObservationScope(
    workspaceId: String?,
    clientRequestId: String,
    configurationMode: CloudServiceConfigurationMode?
) -> IOSObservationScope {
    IOSObservationScope(
        feature: .aiChat,
        userId: nil,
        workspaceId: workspaceId,
        requestId: nil,
        clientRequestId: clientRequestId,
        sessionId: nil,
        runId: nil,
        cloudState: nil,
        configurationMode: configurationMode
    )
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

    // URLComponents leaves `+` unencoded, but the backend decodes it as a space,
    // so a search for "C++" would reach it as "C  ".
    let backendSafeQuery = percentEncodedQuery.replacingOccurrences(of: "+", with: "%2B")
    return "\(basePath)?\(backendSafeQuery)"
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
