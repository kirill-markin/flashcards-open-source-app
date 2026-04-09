import Foundation

enum GuestCloudAuthError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(CloudApiErrorDetails, Int)
    case invalidResponseBody(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl:
            return "Guest AI is unavailable. Check the app configuration."
        case .invalidResponse(let details, _):
            return appendCloudRequestIdReference(message: details.message, requestId: details.requestId)
        case .invalidResponseBody:
            return "Guest AI setup failed. Try again."
        }
    }
}

private struct GuestSessionEnvelope: Decodable {
    let guestToken: String
    let userId: String
    let workspaceId: String
}

private struct GuestUpgradePrepareRequest: Encodable {
    let guestToken: String
}

private struct GuestUpgradePrepareEnvelope: Decodable {
    let mode: CloudGuestUpgradeMode
}

private struct GuestUpgradeCompleteRequest: Encodable {
    struct Selection: Encodable {
        let type: String
        let workspaceId: String?
    }

    let guestToken: String
    let selection: Selection
}

private struct GuestUpgradeCompleteEnvelope: Decodable {
    let workspace: CloudWorkspaceSummary
}

@MainActor
final class GuestCloudAuthService {
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let session: URLSession

    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder(),
        session: URLSession = .shared
    ) {
        self.encoder = encoder
        self.decoder = decoder
        self.session = session
    }

    func createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ) async throws -> StoredGuestCloudSession {
        let response: GuestSessionEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: nil,
            path: "/guest-auth/session",
            method: "POST",
            body: Optional<String>.none
        )
        return StoredGuestCloudSession(
            guestToken: response.guestToken,
            userId: response.userId,
            workspaceId: response.workspaceId,
            configurationMode: configurationMode,
            apiBaseUrl: apiBaseUrl
        )
    }

    func prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ) async throws -> CloudGuestUpgradeMode {
        let response: GuestUpgradePrepareEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/guest-auth/upgrade/prepare",
            method: "POST",
            body: GuestUpgradePrepareRequest(guestToken: guestToken)
        )
        return response.mode
    }

    func completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection
    ) async throws -> CloudWorkspaceSummary {
        let requestSelection: GuestUpgradeCompleteRequest.Selection
        switch selection {
        case .existing(let workspaceId):
            requestSelection = GuestUpgradeCompleteRequest.Selection(
                type: "existing",
                workspaceId: workspaceId
            )
        case .createNew:
            requestSelection = GuestUpgradeCompleteRequest.Selection(
                type: "create_new",
                workspaceId: nil
            )
        }

        let response: GuestUpgradeCompleteEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/guest-auth/upgrade/complete",
            method: "POST",
            body: GuestUpgradeCompleteRequest(
                guestToken: guestToken,
                selection: requestSelection
            )
        )
        return response.workspace
    }

    private func makeUrl(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw GuestCloudAuthError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }

    private func request<Response: Decodable, Body: Encodable>(
        apiBaseUrl: String,
        authorizationHeader: String?,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let authorizationHeader {
            request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try self.encoder.encode(body)
        }

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Guest auth did not receive an HTTP response")
        }

        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
            let details = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            throw GuestCloudAuthError.invalidResponse(details, httpResponse.statusCode)
        }

        do {
            return try self.decoder.decode(Response.self, from: data)
        } catch {
            throw GuestCloudAuthError.invalidResponseBody("Failed to decode guest auth response")
        }
    }
}
