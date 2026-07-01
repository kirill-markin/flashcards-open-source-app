import Foundation

private let collectionPageLimit: Int = 100
private let cloudSyncClientPlatform: String = "ios"
private let cloudSyncPackageExportContentTypeInvalidCode: String = "WORKSPACE_PACKAGE_EXPORT_CONTENT_TYPE_INVALID"
private let cloudSyncPackageExportContentDispositionInvalidCode: String =
    "WORKSPACE_PACKAGE_EXPORT_CONTENT_DISPOSITION_INVALID"
private let cloudSyncResponseDecodingFailedCode: String = "RESPONSE_DECODING_FAILED"
private let cloudSyncResponseDecodingFailedMessage: String = "Failed to decode cloud sync response"
private let cloudSyncTransportMaxAttempts: Int = 3
private let cloudSyncTransportRetryDelayNanoseconds: UInt64 = 500_000_000
private let progressLeaderboardProfileBasePath: String = "/me/progress/leaderboards/profiles"
private let workspacePackageExportContentType: String = "application/zip"
private let workspacePackageImportFileName: String = "flashcards.zip"
private let mediaAssetDownloadURLPathSegmentAllowedCharacters: CharacterSet = {
    var allowedCharacters = CharacterSet.alphanumerics
    allowedCharacters.insert(charactersIn: "-._~")
    return allowedCharacters
}()
private let workspacePackagePathSegmentAllowedCharacters: CharacterSet = {
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

    func mediaAssetDownloadURLPath(workspaceId: String, mediaAssetId: String) throws -> String {
        let normalizedWorkspaceId = workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedMediaAssetId = mediaAssetId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedWorkspaceId.isEmpty == false else {
            throw LocalStoreError.validation("Media asset download URL path requires a workspace id")
        }
        guard normalizedMediaAssetId.isEmpty == false else {
            throw LocalStoreError.validation("Media asset download URL path requires a media asset id")
        }

        guard let encodedWorkspaceId = normalizedWorkspaceId.addingPercentEncoding(
            withAllowedCharacters: mediaAssetDownloadURLPathSegmentAllowedCharacters
        ) else {
            throw LocalStoreError.validation("Media asset workspace id could not be encoded: \(workspaceId)")
        }
        guard let encodedMediaAssetId = normalizedMediaAssetId.addingPercentEncoding(
            withAllowedCharacters: mediaAssetDownloadURLPathSegmentAllowedCharacters
        ) else {
            throw LocalStoreError.validation("Media asset id could not be encoded: \(mediaAssetId)")
        }

        return "/workspaces/\(encodedWorkspaceId)/media-assets/\(encodedMediaAssetId)/download-url"
    }

    func workspacePackageImportPreviewPath(workspaceId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedWorkspacePackagePathWorkspaceId(workspaceId: workspaceId)
        return "/workspaces/\(encodedWorkspaceId)/packages/import/preview"
    }

    func workspacePackageExportPreviewPath(workspaceId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedWorkspacePackagePathWorkspaceId(workspaceId: workspaceId)
        return "/workspaces/\(encodedWorkspaceId)/packages/export/preview"
    }

    func workspacePackageExportPath(workspaceId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedWorkspacePackagePathWorkspaceId(workspaceId: workspaceId)
        return "/workspaces/\(encodedWorkspaceId)/packages/export"
    }

    func workspacePackageImportPath(workspaceId: String) throws -> String {
        let encodedWorkspaceId = try self.encodedWorkspacePackagePathWorkspaceId(workspaceId: workspaceId)
        return "/workspaces/\(encodedWorkspaceId)/packages/import"
    }

    func previewWorkspacePackageExport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        requestBody: WorkspacePackageExportRequest
    ) async throws -> WorkspacePackageExportPreviewResponse {
        let path = try self.workspacePackageExportPreviewPath(workspaceId: workspaceId)
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue(cloudSyncClientPlatform, forHTTPHeaderField: "X-Client-Platform")
        request.setValue(self.appVersion(), forHTTPHeaderField: "X-Client-Version")
        request.httpBody = try JSONEncoder().encode(requestBody)

        return try await self.sendAndDecode(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: true
        )
    }

    func exportWorkspacePackage(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        requestBody: WorkspacePackageExportRequest
    ) async throws -> WorkspacePackageExportDownloadResponse {
        let path = try self.workspacePackageExportPath(workspaceId: workspaceId)
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(workspacePackageExportContentType, forHTTPHeaderField: "Accept")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue(cloudSyncClientPlatform, forHTTPHeaderField: "X-Client-Platform")
        request.setValue(self.appVersion(), forHTTPHeaderField: "X-Client-Version")
        request.httpBody = try JSONEncoder().encode(requestBody)

        return try await self.sendAndReadWorkspacePackageExport(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl
        )
    }

    func previewWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageBytes: Data
    ) async throws -> WorkspacePackageImportPreviewResponse {
        let path = try self.workspacePackageImportPreviewPath(workspaceId: workspaceId)
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = "POST"
        request.setValue("application/zip", forHTTPHeaderField: "Content-Type")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue(cloudSyncClientPlatform, forHTTPHeaderField: "X-Client-Platform")
        request.setValue(self.appVersion(), forHTTPHeaderField: "X-Client-Version")
        request.httpBody = packageBytes

        return try await self.sendAndDecode(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: true
        )
    }

    func confirmWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageBytes: Data,
        options: WorkspacePackageImportConfirmOptions
    ) async throws -> WorkspacePackageImportConfirmResponse {
        let path = try self.workspacePackageImportPath(workspaceId: workspaceId)
        let boundary = "Boundary-\(UUID().uuidString.lowercased())"
        let optionsData = try JSONEncoder().encode(options)
        guard let optionsJson = String(data: optionsData, encoding: .utf8) else {
            throw LocalStoreError.validation("Workspace package import options could not be encoded as UTF-8 JSON")
        }

        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue(cloudSyncClientPlatform, forHTTPHeaderField: "X-Client-Platform")
        request.setValue(self.appVersion(), forHTTPHeaderField: "X-Client-Version")
        request.httpBody = makeWorkspacePackageImportMultipartBody(
            boundary: boundary,
            fileName: workspacePackageImportFileName,
            packageBytes: packageBytes,
            optionsJson: optionsJson
        )

        return try await self.sendAndDecode(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: false
        )
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
        return try await self.sendAndDecode(
            request: request,
            phase: phase,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: self.allowsRetry(path: path, method: method, body: body)
        )
    }

    private func encodedWorkspacePackagePathWorkspaceId(workspaceId: String) throws -> String {
        let normalizedWorkspaceId = workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedWorkspaceId.isEmpty == false else {
            throw LocalStoreError.validation("Workspace package path requires a workspace id")
        }

        guard let encodedWorkspaceId = normalizedWorkspaceId.addingPercentEncoding(
            withAllowedCharacters: workspacePackagePathSegmentAllowedCharacters
        ) else {
            throw LocalStoreError.validation("Workspace package workspace id could not be encoded: \(workspaceId)")
        }

        return encodedWorkspaceId
    }

    private func sendAndDecode<Response: Decodable>(
        request: URLRequest,
        phase: CloudFlowPhase,
        apiBaseUrl: String,
        allowsRetry: Bool
    ) async throws -> Response {
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.sendRequestWithRetry(
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

    private func sendAndReadWorkspacePackageExport(
        request: URLRequest,
        phase: CloudFlowPhase,
        apiBaseUrl: String
    ) async throws -> WorkspacePackageExportDownloadResponse {
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.sendRequestWithRetry(
                request: request,
                phase: phase,
                apiBaseUrl: apiBaseUrl,
                allowsRetry: true
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
                errorMessage: "Workspace package export did not receive an HTTP response"
            )
            throw LocalStoreError.database("Workspace package export did not receive an HTTP response")
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
            let contentType = try workspacePackageExportResponseContentType(
                httpResponse: httpResponse,
                requestId: requestId
            )
            let fileName = try workspacePackageExportResponseFileName(
                httpResponse: httpResponse,
                requestId: requestId
            )
            logCloudFlowPhase(phase: phase, outcome: "success", requestId: requestId)
            return WorkspacePackageExportDownloadResponse(
                packageBytes: data,
                fileName: fileName,
                contentType: contentType
            )
        } catch {
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: requestId,
                statusCode: httpResponse.statusCode,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            throw error
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

private func workspacePackageExportResponseContentType(
    httpResponse: HTTPURLResponse,
    requestId: String?
) throws -> String {
    let responseContentType = httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""
    let normalizedContentType = responseContentType
        .split(separator: ";", maxSplits: 1)
        .first?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""
    guard normalizedContentType == workspacePackageExportContentType else {
        throw CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "Workspace package export returned Content-Type '\(responseContentType)' instead of application/zip.",
                requestId: requestId,
                code: cloudSyncPackageExportContentTypeInvalidCode,
                syncConflict: nil
            ),
            httpResponse.statusCode
        )
    }

    return responseContentType
}

private func workspacePackageExportResponseFileName(
    httpResponse: HTTPURLResponse,
    requestId: String?
) throws -> String {
    let contentDisposition = httpResponse.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    let fileName = workspacePackageExportContentDispositionFileName(contentDisposition: contentDisposition)
    guard let fileName, workspacePackageExportFileNameIsSafe(fileName: fileName) else {
        throw CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "Workspace package export returned an invalid Content-Disposition header.",
                requestId: requestId,
                code: cloudSyncPackageExportContentDispositionInvalidCode,
                syncConflict: nil
            ),
            httpResponse.statusCode
        )
    }

    return fileName
}

private func workspacePackageExportContentDispositionFileName(contentDisposition: String) -> String? {
    for parameter in contentDisposition.components(separatedBy: ";").dropFirst() {
        let parts = parameter.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else {
            continue
        }
        let key = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard key == "filename" else {
            continue
        }

        let value = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
        return workspacePackageExportUnquotedContentDispositionValue(value: value)
    }

    return nil
}

private func workspacePackageExportUnquotedContentDispositionValue(value: String) -> String {
    guard value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 else {
        return value
    }

    let unquotedValue = value.dropFirst().dropLast()
    return unquotedValue
        .replacingOccurrences(of: "\\\"", with: "\"")
        .replacingOccurrences(of: "\\\\", with: "\\")
}

private func workspacePackageExportFileNameIsSafe(fileName: String) -> Bool {
    let trimmedFileName = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedFileName.isEmpty == false
        && trimmedFileName.rangeOfCharacter(from: .controlCharacters) == nil
        && trimmedFileName.contains("/") == false
        && trimmedFileName.contains("\\") == false
}

private func makeWorkspacePackageImportMultipartBody(
    boundary: String,
    fileName: String,
    packageBytes: Data,
    optionsJson: String
) -> Data {
    var body = Data()
    body.append(Data("--\(boundary)\r\n".utf8))
    body.append(Data("Content-Disposition: form-data; name=\"options\"\r\n".utf8))
    body.append(Data("Content-Type: application/json\r\n\r\n".utf8))
    body.append(Data(optionsJson.utf8))
    body.append(Data("\r\n".utf8))
    body.append(Data("--\(boundary)\r\n".utf8))
    body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n".utf8))
    body.append(Data("Content-Type: application/zip\r\n\r\n".utf8))
    body.append(packageBytes)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    return body
}
