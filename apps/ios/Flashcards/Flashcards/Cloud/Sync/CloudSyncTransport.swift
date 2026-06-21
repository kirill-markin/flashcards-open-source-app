import Foundation

private let collectionPageLimit: Int = 100
private let cloudSyncClientPlatform: String = "ios"
private let cloudSyncResponseDecodingFailedCode: String = "RESPONSE_DECODING_FAILED"
private let cloudSyncResponseDecodingFailedMessage: String = "Failed to decode cloud sync response"
private let cloudSyncTransportMaxAttempts: Int = 3
private let cloudSyncTransportRetryDelayNanoseconds: UInt64 = 500_000_000
private let progressLeaderboardProfileBasePath: String = "/me/progress/leaderboards/profiles"
private let progressLeaderboardProfilePathSegmentAllowedCharacters: CharacterSet = {
    var allowedCharacters = CharacterSet.alphanumerics
    allowedCharacters.insert(charactersIn: "-._~")
    return allowedCharacters
}()

private protocol CloudSyncBootstrapModeRequest {
    var mode: String { get }
}

extension BootstrapPullRequest: CloudSyncBootstrapModeRequest {}
extension BootstrapPushRequest: CloudSyncBootstrapModeRequest {}

struct CloudSyncTransport {
    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession, decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder()) {
        self.session = session
        self.decoder = decoder
    }

    func appVersion() -> String {
        appMarketingVersion()
    }

    func paginatedPath(basePath: String, cursor: String?) -> String {
        guard var components = URLComponents(string: basePath) else {
            return "\(basePath)?limit=\(collectionPageLimit)"
        }

        var queryItems = [
            URLQueryItem(name: "limit", value: String(collectionPageLimit))
        ]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        components.queryItems = queryItems
        return components.string ?? "\(basePath)?limit=\(collectionPageLimit)"
    }

    func listWorkspaces(apiBaseUrl: String, authorizationHeader: String) async throws -> [CloudWorkspaceSummary] {
        var workspaces: [CloudWorkspaceSummary] = []
        var nextCursor: String? = nil

        repeat {
            let response: WorkspacesResponse = try await self.request(
                apiBaseUrl: apiBaseUrl,
                authorizationHeader: authorizationHeader,
                path: self.paginatedPath(basePath: "/workspaces", cursor: nextCursor),
                method: "GET",
                body: Optional<String>.none
            )
            workspaces.append(contentsOf: response.workspaces)
            nextCursor = response.nextCursor
        } while nextCursor != nil

        return workspaces
    }

    func progressSummaryPath(timeZone: String) throws -> String {
        guard var components = URLComponents(string: "/me/progress/summary") else {
            throw LocalStoreError.validation("Progress summary path could not be constructed")
        }

        components.queryItems = [
            URLQueryItem(name: "timeZone", value: timeZone),
        ]

        guard let path = components.string else {
            throw LocalStoreError.validation("Progress summary query could not be constructed")
        }

        return path
    }

    func progressSeriesPath(timeZone: String, from: String, to: String) throws -> String {
        guard var components = URLComponents(string: "/me/progress/series") else {
            throw LocalStoreError.validation("Progress series path could not be constructed")
        }

        components.queryItems = [
            URLQueryItem(name: "timeZone", value: timeZone),
            URLQueryItem(name: "from", value: from),
            URLQueryItem(name: "to", value: to),
        ]

        guard let path = components.string else {
            throw LocalStoreError.validation("Progress series query could not be constructed")
        }

        return path
    }

    func progressReviewSchedulePath(timeZone: String) throws -> String {
        guard var components = URLComponents(string: "/me/progress/review-schedule") else {
            throw LocalStoreError.validation("Review schedule path could not be constructed")
        }

        components.queryItems = [
            URLQueryItem(name: "timeZone", value: timeZone),
        ]

        guard let path = components.string else {
            throw LocalStoreError.validation("Review schedule query could not be constructed")
        }

        return path
    }

    func progressLeaderboardProfilePath(publicProfileId: String) throws -> String {
        let normalizedPublicProfileId = publicProfileId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedPublicProfileId.isEmpty == false else {
            throw LocalStoreError.validation("Progress leaderboard profile id must not be empty")
        }

        guard let encodedPublicProfileId = normalizedPublicProfileId.addingPercentEncoding(
            withAllowedCharacters: progressLeaderboardProfilePathSegmentAllowedCharacters
        ) else {
            throw LocalStoreError.validation(
                "Progress leaderboard profile id could not be encoded: \(publicProfileId)"
            )
        }

        return "\(progressLeaderboardProfileBasePath)/\(encodedPublicProfileId)"
    }

    func request<Response: Decodable, Body: Encodable>(
        apiBaseUrl: String,
        authorizationHeader: String,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue(cloudSyncClientPlatform, forHTTPHeaderField: "X-Client-Platform")
        request.setValue(self.appVersion(), forHTTPHeaderField: "X-Client-Version")

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let phase = self.phase(for: path, method: method, body: body)
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.sendRequestWithRetry(
                request: request,
                phase: phase,
                apiBaseUrl: apiBaseUrl,
                allowsRetry: self.allowsRetry(path: path, method: method, body: body)
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
            let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: requestId)
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

    private func makeUrl(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudSyncError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }

    private func sendRequestWithRetry(
        request: URLRequest,
        phase: CloudFlowPhase,
        apiBaseUrl: String,
        allowsRetry: Bool
    ) async throws -> (Data, URLResponse) {
        var lastError: Error?
        for attempt in 1...cloudSyncTransportMaxAttempts {
            do {
                return try await self.session.data(for: request)
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

                FlashcardsObservability.captureWarning(
                    .cloudRetry(
                        CloudRetryWarning(
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
                            messageSummary: Flashcards.errorMessage(error: error)
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

    private func phase<Body: Encodable>(for path: String, method: String, body: Body?) -> CloudFlowPhase {
        let requestPath = self.requestPath(from: path)

        if requestPath == "/workspaces" && method == "GET" {
            return .workspaceList
        }

        if requestPath == "/workspaces" && method == "POST" {
            return .workspaceCreate
        }

        if requestPath.hasPrefix("/workspaces/") && requestPath.hasSuffix("/select") {
            return .workspaceSelect
        }

        if requestPath.hasSuffix("/sync/push") {
            return .initialPush
        }

        if requestPath.hasSuffix("/sync/bootstrap") {
            if let body,
                let bootstrapRequest = body as? any CloudSyncBootstrapModeRequest,
                bootstrapRequest.mode == "push" {
                return .initialPush
            }
            return .initialPull
        }

        if requestPath.hasSuffix("/sync/review-history/import") {
            return .initialPush
        }

        if requestPath.hasSuffix("/sync/review-history/pull") {
            return .initialPull
        }

        if requestPath.hasSuffix("/sync/pull") {
            return .initialPull
        }

        return .cloudSyncRequest
    }

    private func allowsRetry<Body: Encodable>(path: String, method: String, body: Body?) -> Bool {
        let requestPath = self.requestPath(from: path)
        if method == "GET" {
            return true
        }
        if requestPath.hasSuffix("/sync/push") {
            return true
        }
        if requestPath.hasSuffix("/sync/pull") {
            return true
        }
        if requestPath.hasSuffix("/sync/review-history/import") {
            return true
        }
        if requestPath.hasSuffix("/sync/review-history/pull") {
            return true
        }
        if requestPath.hasSuffix("/sync/bootstrap") {
            guard let body,
                let bootstrapRequest = body as? any CloudSyncBootstrapModeRequest else {
                return false
            }
            return bootstrapRequest.mode == "pull"
        }
        return false
    }

    private func requestPath(from path: String) -> String {
        guard let components = URLComponents(string: path) else {
            return path
        }

        return components.path
    }
}

private func makeCloudSyncResponseDecodingErrorDetails(
    requestId: String?
) -> CloudApiErrorDetails {
    CloudApiErrorDetails(
        message: cloudSyncResponseDecodingFailedMessage,
        requestId: requestId,
        code: cloudSyncResponseDecodingFailedCode,
        syncConflict: nil
    )
}
