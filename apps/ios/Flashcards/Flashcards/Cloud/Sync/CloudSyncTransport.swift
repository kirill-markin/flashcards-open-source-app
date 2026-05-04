import Foundation

private let collectionPageLimit: Int = 100

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

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Cloud sync did not receive an HTTP response")
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
            let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            logCloudFlowPhase(
                phase: self.phase(for: path),
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudSyncError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        logCloudFlowPhase(phase: self.phase(for: path), outcome: "success")

        return try self.decoder.decode(Response.self, from: data)
    }

    private func makeUrl(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudSyncError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }

    private func phase(for path: String) -> CloudFlowPhase {
        if path == "/workspaces" {
            return .workspaceCreate
        }

        if path.hasPrefix("/workspaces/") && path.hasSuffix("/select") {
            return .workspaceSelect
        }

        if path.hasSuffix("/sync/push") {
            return .initialPush
        }

        if path.hasSuffix("/sync/bootstrap") {
            return .initialPull
        }

        if path.hasSuffix("/sync/review-history/import") {
            return .initialPush
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return .initialPull
        }

        if path.hasSuffix("/sync/pull") {
            return .initialPull
        }

        return .workspaceList
    }
}
