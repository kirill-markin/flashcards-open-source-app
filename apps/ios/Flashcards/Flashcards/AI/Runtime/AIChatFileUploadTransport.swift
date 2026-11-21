import Foundation

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

private func aiChatFileUploadPutStatusIsRetryable(statusCode: Int) -> Bool {
    statusCode == 408 || statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}

struct AIChatFileUploadTransport: Sendable {
    private let urlSession: URLSession
    private let consentReceiptProvider: AIConsentReceiptProvider

    init(urlSession: URLSession, consentReceiptProvider: @escaping AIConsentReceiptProvider) {
        self.urlSession = urlSession
        self.consentReceiptProvider = consentReceiptProvider
    }

    func putFile(
        session: CloudLinkedSession,
        consentId: String,
        target: AIChatFileUploadTarget,
        fileURL: URL,
        clientRequestId: String
    ) async throws {
        guard let uploadURL = URL(string: target.url) else {
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
        request.httpMethod = target.method
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        for (headerName, headerValue) in target.headers {
            request.setValue(headerValue, forHTTPHeaderField: headerName)
        }

        var lastError: Error?
        for attempt in 1...aiChatFileUploadPutMaxAttempts {
            do {
                try Task.checkCancellation()
                guard try await self.consentReceiptProvider(session) == consentId else {
                    throw AIConsentError.required
                }
                let (data, response) = try await self.urlSession.upload(for: request, fromFile: fileURL)
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
