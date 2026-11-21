import Foundation

private let cloudSyncClientPlatform: String = "ios"
private let cloudSyncResponseDecodingFailedCode: String = "RESPONSE_DECODING_FAILED"
private let cloudSyncResponseDecodingFailedMessage: String = "Failed to decode cloud sync response"
let cloudSyncTransportMaxAttempts: Int = 3
let cloudSyncTransportRetryDelayNanoseconds: UInt64 = 500_000_000

struct CloudSyncHTTPTransport {
    let session: URLSession
    let decoder: JSONDecoder

    func makeAuthorizedRequest(
        apiBaseUrl: String,
        authorizationHeader: String,
        path: String,
        method: String
    ) throws -> URLRequest {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue(cloudSyncClientPlatform, forHTTPHeaderField: "X-Client-Platform")
        request.setValue(appMarketingVersion(), forHTTPHeaderField: "X-Client-Version")
        return request
    }

    func sendAndDecode<Response: Decodable>(
        request: URLRequest,
        phase: CloudFlowPhase,
        apiBaseUrl: String,
        allowsRetry: Bool
    ) async throws -> Response {
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.sendDataWithRetry(
                request: request,
                phase: phase,
                apiBaseUrl: apiBaseUrl,
                allowsRetry: allowsRetry
            )
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                errorMessage: Flashcards.errorMessage(error: error)
            )
            throw error
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                errorMessage: "Cloud sync did not receive an HTTP response"
            )
            throw LocalStoreError.database("Cloud sync did not receive an HTTP response")
        }
        let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let errorDetails = decodeCloudApiErrorDetails(
                data: data,
                requestId: requestId,
                retryAfterDelayNanoseconds: cloudRetryAfterDelayNanoseconds(
                    value: httpResponse.value(forHTTPHeaderField: "Retry-After")
                )
            )
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudSyncError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        do {
            let decodedResponse: Response = try self.decoder.decode(Response.self, from: data)
            logCloudFlowPhase(phase: phase, outcome: "success", requestId: requestId)
            return decodedResponse
        } catch {
            let errorDetails: CloudApiErrorDetails = makeCloudSyncResponseDecodingErrorDetails(
                requestId: requestId
            )
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode,
                errorMessage: errorDetails.message
            )
            throw CloudSyncError.invalidResponse(errorDetails, httpResponse.statusCode)
        }
    }

    func sendDataWithRetry(
        request: URLRequest,
        phase: CloudFlowPhase,
        apiBaseUrl: String,
        allowsRetry: Bool
    ) async throws -> (Data, URLResponse) {
        try await sendCloudSyncRequestWithRetry(
            phase: phase,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: allowsRetry,
            httpMethod: request.httpMethod,
            endpointPath: request.url?.path
        ) {
            try await self.session.data(for: request)
        }
    }

    private func makeUrl(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudSyncError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }
}

func sendCloudSyncRequestWithRetry<Response>(
    phase: CloudFlowPhase,
    apiBaseUrl: String?,
    allowsRetry: Bool,
    httpMethod: String?,
    endpointPath: String?,
    send: () async throws -> Response
) async throws -> Response {
    var lastError: Error?
    for attempt in 1...cloudSyncTransportMaxAttempts {
        do {
            return try await send()
        } catch let error as CancellationError {
            throw error
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }
            lastError = error
            guard allowsRetry
                && isRetryableNetworkTransportFailure(error: error)
                && attempt < cloudSyncTransportMaxAttempts else {
                throw error
            }

            FlashcardsObservability.addBreadcrumb(
                .cloudRetry(
                    CloudRetryObservation(
                        action: "cloud_sync_transport_retry",
                        scope: IOSObservationScope(
                            feature: cloudObservationFeature(phase: phase),
                            userId: nil,
                            workspaceId: nil,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: nil,
                            configurationMode: nil
                        ),
                        attempt: attempt,
                        maxAttempts: cloudSyncTransportMaxAttempts,
                        apiBaseUrl: apiBaseUrl,
                        messageSummary: Flashcards.errorMessage(error: error),
                        transportDiagnostics: makeIOSNetworkTransportDiagnostics(
                            error: error,
                            httpMethod: httpMethod,
                            endpointPath: endpointPath,
                            apiBaseUrl: apiBaseUrl
                        )
                    )
                )
            )
            try await Task.sleep(nanoseconds: cloudSyncTransportRetryDelayNanoseconds)
        }
    }

    guard let lastError else {
        throw LocalStoreError.database("Cloud sync transport retry failed without an error")
    }
    throw lastError
}

func makeCloudSyncResponseDecodingErrorDetails(
    requestId: String?
) -> CloudApiErrorDetails {
    CloudApiErrorDetails(
        message: cloudSyncResponseDecodingFailedMessage,
        requestId: requestId,
        code: cloudSyncResponseDecodingFailedCode,
        syncConflict: nil
    )
}
