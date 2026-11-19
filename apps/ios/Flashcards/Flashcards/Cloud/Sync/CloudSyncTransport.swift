import Foundation

private let collectionPageLimit: Int = 100
private let mediaAssetUploadPartPutMaxAttempts: Int = 3
private let mediaAssetUploadPartPutRetryDelayNanoseconds: UInt64 = 500_000_000
private let mediaAssetUploadPartPutResponseBodyMaxBytes: Int = 2_048
private let progressLeaderboardProfileBasePath: String = "/me/progress/leaderboards/profiles"
private let mediaAssetDownloadURLPathSegmentAllowedCharacters: CharacterSet = {
    var allowedCharacters = CharacterSet.alphanumerics
    allowedCharacters.insert(charactersIn: "-._~")
    return allowedCharacters
}()
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

struct MediaAssetUploadPartHTTPError: LocalizedError, Sendable {
    let partNumber: Int
    let statusCode: Int
    let responseBody: String

    var errorDescription: String? {
        "Media asset upload part PUT failed with status \(self.statusCode) for partNumber=\(self.partNumber) responseBody=\(self.responseBody)"
    }
}

private func mediaAssetUploadPartPutStatusIsRetryable(statusCode: Int) -> Bool {
    statusCode == 408 || statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}

private func mediaAssetUploadPartPutResponseBodySummary(data: Data) -> String {
    guard data.isEmpty == false else {
        return ""
    }

    return String(decoding: data.prefix(mediaAssetUploadPartPutResponseBodyMaxBytes), as: UTF8.self)
}

struct CloudSyncTransport {
    private let httpTransport: CloudSyncHTTPTransport

    init(session: URLSession, decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder()) {
        self.httpTransport = CloudSyncHTTPTransport(session: session, decoder: decoder)
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

    func mediaAssetDownloadURLPath(workspaceId: String, mediaAssetId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedMediaAssetPathSegment(
            value: workspaceId,
            fieldName: "workspace id"
        )
        let encodedMediaAssetId = try self.encodedMediaAssetPathSegment(
            value: mediaAssetId,
            fieldName: "media asset id"
        )

        return "/workspaces/\(encodedWorkspaceId)/media-assets/\(encodedMediaAssetId)/download-url"
    }

    func mediaAssetUploadSessionsPath(workspaceId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedMediaAssetPathSegment(
            value: workspaceId,
            fieldName: "workspace id"
        )
        return "/workspaces/\(encodedWorkspaceId)/media-assets/upload-sessions"
    }

    func mediaAssetUploadSessionPartsPath(workspaceId: String, sessionId: String) throws -> String {
        let basePath = try self.mediaAssetUploadSessionPath(workspaceId: workspaceId, sessionId: sessionId)
        return "\(basePath)/parts"
    }

    func mediaAssetUploadSessionCompletePath(workspaceId: String, sessionId: String) throws -> String {
        let basePath = try self.mediaAssetUploadSessionPath(workspaceId: workspaceId, sessionId: sessionId)
        return "\(basePath)/complete"
    }

    func mediaAssetUploadSessionAbortPath(workspaceId: String, sessionId: String) throws -> String {
        let basePath = try self.mediaAssetUploadSessionPath(workspaceId: workspaceId, sessionId: sessionId)
        return "\(basePath)/abort"
    }

    func createMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        requestBody: MediaAssetUploadSessionCreateRequest
    ) async throws -> MediaAssetUploadSessionCreateResponse {
        try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.mediaAssetUploadSessionsPath(workspaceId: workspaceId),
            method: "POST",
            body: requestBody
        )
    }

    func loadMediaAssetUploadPartURLs(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        requestBody: MediaAssetUploadPartURLsRequest
    ) async throws -> MediaAssetUploadPartURLsResponse {
        try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.mediaAssetUploadSessionPartsPath(workspaceId: workspaceId, sessionId: sessionId),
            method: "POST",
            body: requestBody
        )
    }

    func completeMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        requestBody: MediaAssetUploadSessionCompleteRequest
    ) async throws -> MediaAssetUploadSessionCompleteResponse {
        try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.mediaAssetUploadSessionCompletePath(workspaceId: workspaceId, sessionId: sessionId),
            method: "POST",
            body: requestBody
        )
    }

    func abortMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String
    ) async throws -> MediaAssetUploadSessionAbortResponse {
        try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.mediaAssetUploadSessionAbortPath(workspaceId: workspaceId, sessionId: sessionId),
            method: "POST",
            body: Optional<String>.none
        )
    }

    func uploadMediaAssetPart(
        partURL: MediaAssetUploadPartURL,
        body: Data
    ) async throws -> String {
        guard let uploadURL = URL(string: partURL.url),
              uploadURL.scheme?.isEmpty == false,
              uploadURL.host?.isEmpty == false else {
            throw LocalStoreError.validation(
                "Media asset upload part URL is invalid for partNumber=\(partURL.partNumber)"
            )
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = partURL.method
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        for (headerName, headerValue) in partURL.headers {
            request.setValue(headerValue, forHTTPHeaderField: headerName)
        }

        let response = try await self.sendMediaAssetUploadPartWithRetry(
            request: request,
            body: body,
            partNumber: partURL.partNumber
        )
        let eTag = response.value(forHTTPHeaderField: "ETag")?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let eTag, eTag.isEmpty == false else {
            throw LocalStoreError.validation(
                "Media asset upload part PUT response was missing ETag for partNumber=\(partURL.partNumber)"
            )
        }

        return eTag
    }

    func request<Response: Decodable, Body: Encodable>(
        apiBaseUrl: String,
        authorizationHeader: String,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = try self.httpTransport.makeAuthorizedRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: path,
            method: method
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let phase = self.phase(for: path, method: method, body: body)
        return try await self.httpTransport.sendAndDecode(
            request: request,
            phase: phase,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: self.allowsRetry(path: path, method: method, body: body)
        )
    }

    private func mediaAssetUploadSessionPath(workspaceId: String, sessionId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedMediaAssetPathSegment(
            value: workspaceId,
            fieldName: "workspace id"
        )
        let encodedSessionId = try self.encodedMediaAssetPathSegment(
            value: sessionId,
            fieldName: "upload session id"
        )
        return "/workspaces/\(encodedWorkspaceId)/media-assets/upload-sessions/\(encodedSessionId)"
    }

    private func encodedMediaAssetPathSegment(value: String, fieldName: String) throws -> String {
        let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedValue.isEmpty == false else {
            throw LocalStoreError.validation("Media asset path requires a \(fieldName)")
        }

        guard let encodedValue = normalizedValue.addingPercentEncoding(
            withAllowedCharacters: mediaAssetDownloadURLPathSegmentAllowedCharacters
        ) else {
            throw LocalStoreError.validation("Media asset \(fieldName) could not be encoded: \(value)")
        }

        return encodedValue
    }

    private func sendMediaAssetUploadPartWithRetry(
        request: URLRequest,
        body: Data,
        partNumber: Int
    ) async throws -> HTTPURLResponse {
        var lastError: Error?
        for attempt in 1...mediaAssetUploadPartPutMaxAttempts {
            do {
                let (data, response) = try await self.httpTransport.session.upload(for: request, from: body)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw LocalStoreError.database(
                        "Media asset upload part PUT did not receive an HTTP response for partNumber=\(partNumber)"
                    )
                }
                if httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 {
                    return httpResponse
                }

                let statusError = MediaAssetUploadPartHTTPError(
                    partNumber: partNumber,
                    statusCode: httpResponse.statusCode,
                    responseBody: mediaAssetUploadPartPutResponseBodySummary(data: data)
                )
                lastError = statusError
                guard mediaAssetUploadPartPutStatusIsRetryable(statusCode: httpResponse.statusCode),
                      attempt < mediaAssetUploadPartPutMaxAttempts else {
                    throw statusError
                }

                try await self.retryMediaAssetUploadPartPut(
                    error: statusError,
                    request: request,
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
                      attempt < mediaAssetUploadPartPutMaxAttempts else {
                    throw error
                }

                try await self.retryMediaAssetUploadPartPut(
                    error: error,
                    request: request,
                    attempt: attempt
                )
            }
        }

        guard let lastError else {
            throw LocalStoreError.database("Media asset upload part PUT retry failed without an error")
        }
        throw lastError
    }

    private func retryMediaAssetUploadPartPut(error: Error, request: URLRequest, attempt: Int) async throws {
        FlashcardsObservability.addBreadcrumb(
            .cloudRetry(
                CloudRetryObservation(
                    action: "media_asset_upload_part_put_retry",
                    scope: IOSObservationScope(
                        feature: .cloudSync,
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
                    maxAttempts: mediaAssetUploadPartPutMaxAttempts,
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
        try await Task.sleep(nanoseconds: mediaAssetUploadPartPutRetryDelayNanoseconds)
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
        if method == "POST", requestPath == "/billing/apple/transactions" {
            return true
        }
        if method == "POST",
           requestPath.hasSuffix("/card-maintenance/preview") || requestPath.hasSuffix("/card-maintenance/reconcile") {
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
