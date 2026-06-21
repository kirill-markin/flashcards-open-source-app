import Foundation

private let guestSessionDeleteMaxAttempts: Int = 3
private let guestSessionDeleteRetryDelayNanoseconds: UInt64 = 250_000_000
private let guestCloudAuthResponseDecodingFailedCode: String = "RESPONSE_DECODING_FAILED"
private let guestCloudAuthResponseDecodingFailedMessage: String = "Failed to decode guest auth response"

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

private struct GuestSessionCreateRequest: Encodable {
    let platform: String
}

private struct DeleteGuestSessionResponse: Decodable {
    let ok: Bool
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
    let guestWorkspaceSyncedAndOutboxDrained: Bool
    let supportsDroppedEntities: Bool
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
            body: GuestSessionCreateRequest(platform: "ios")
        )
        return StoredGuestCloudSession(
            guestToken: response.guestToken,
            userId: response.userId,
            workspaceId: response.workspaceId,
            configurationMode: configurationMode,
            apiBaseUrl: apiBaseUrl
        )
    }

    func deleteGuestSession(
        apiBaseUrl: String,
        guestToken: String
    ) async throws {
        var lastError: Error?
        for attempt in 1...guestSessionDeleteMaxAttempts {
            do {
                try await self.performGuestSessionDelete(
                    apiBaseUrl: apiBaseUrl,
                    guestToken: guestToken
                )
                return
            } catch let error as CancellationError {
                throw error
            } catch {
                lastError = error

                if attempt < guestSessionDeleteMaxAttempts {
                    FlashcardsObservability.addBreadcrumb(
                        .cloudRetry(
                            CloudRetryObservation(
                                action: "guest_session_delete_retry",
                                scope: IOSObservationScope(
                                    feature: .cloudAuth,
                                    userId: nil,
                                    workspaceId: nil,
                                    requestId: nil,
                                    clientRequestId: nil,
                                    sessionId: nil,
                                    runId: nil,
                                    cloudState: .guest,
                                    configurationMode: nil
                                ),
                                attempt: attempt,
                                maxAttempts: guestSessionDeleteMaxAttempts,
                                apiBaseUrl: apiBaseUrl,
                                messageSummary: Flashcards.errorMessage(error: error)
                            )
                        )
                    )
                    try await Task.sleep(nanoseconds: guestSessionDeleteRetryDelayNanoseconds)
                    continue
                }
            }
        }

        guard let lastError else {
            throw GuestCloudAuthError.invalidResponseBody(
                "Guest session deletion did not produce a result"
            )
        }

        throw lastError
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
        selection: CloudGuestUpgradeSelection,
        supportsDroppedEntities: Bool,
        guestWorkspaceSyncedAndOutboxDrained: Bool
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
                selection: requestSelection,
                guestWorkspaceSyncedAndOutboxDrained: guestWorkspaceSyncedAndOutboxDrained,
                supportsDroppedEntities: supportsDroppedEntities,
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

    private func performGuestSessionDelete(
        apiBaseUrl: String,
        guestToken: String
    ) async throws {
        let (data, httpResponse) = try await self.performRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Guest \(guestToken)",
            path: "/guest-auth/session/delete",
            method: "POST",
            body: Optional<String>.none
        )
        let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")

        if data.isEmpty {
            logCloudFlowPhase(phase: .guestSessionDelete, outcome: "success", requestId: requestId)
            return
        }

        do {
            let response = try self.decoder.decode(DeleteGuestSessionResponse.self, from: data)
            guard response.ok else {
                throw GuestCloudAuthError.invalidResponseBody(
                    "Guest session deletion did not return ok=true"
                )
            }
            logCloudFlowPhase(phase: .guestSessionDelete, outcome: "success", requestId: requestId)
        } catch let error as GuestCloudAuthError {
            throw error
        } catch {
            let errorDetails: CloudApiErrorDetails = makeGuestCloudAuthResponseDecodingErrorDetails(
                requestId: requestId
            )
            logCloudFlowPhase(
                phase: .guestSessionDelete,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode,
                errorMessage: errorDetails.message
            )
            throw GuestCloudAuthError.invalidResponse(errorDetails, httpResponse.statusCode)
        }
    }

    private func performRequest<Body: Encodable>(
        apiBaseUrl: String,
        authorizationHeader: String?,
        path: String,
        method: String,
        body: Body?
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let authorizationHeader {
            request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try self.encoder.encode(body)
        }

        let phase: CloudFlowPhase = self.phase(for: path)
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
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
                errorMessage: "Guest auth did not receive an HTTP response"
            )
            throw LocalStoreError.database("Guest auth did not receive an HTTP response")
        }
        let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")

        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let details = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: details.requestId,
                code: details.code,
                statusCode: httpResponse.statusCode
            )
            throw GuestCloudAuthError.invalidResponse(details, httpResponse.statusCode)
        }

        return (data, httpResponse)
    }

    private func request<Response: Decodable, Body: Encodable>(
        apiBaseUrl: String,
        authorizationHeader: String?,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        let (data, httpResponse) = try await self.performRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: path,
            method: method,
            body: body
        )
        let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")

        do {
            let decodedResponse: Response = try self.decoder.decode(Response.self, from: data)
            logCloudFlowPhase(phase: self.phase(for: path), outcome: "success", requestId: requestId)
            return decodedResponse
        } catch {
            let errorDetails: CloudApiErrorDetails = makeGuestCloudAuthResponseDecodingErrorDetails(
                requestId: requestId
            )
            logCloudFlowPhase(
                phase: self.phase(for: path),
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode,
                errorMessage: errorDetails.message
            )
            throw GuestCloudAuthError.invalidResponse(errorDetails, httpResponse.statusCode)
        }
    }

    private func phase(for path: String) -> CloudFlowPhase {
        switch path {
        case "/guest-auth/session":
            return .guestSessionCreate
        case "/guest-auth/session/delete":
            return .guestSessionDelete
        case "/guest-auth/upgrade/prepare":
            return .guestUpgradePrepare
        case "/guest-auth/upgrade/complete":
            return .guestUpgradeComplete
        default:
            return .guestAuthRequest
        }
    }
}

private func makeGuestCloudAuthResponseDecodingErrorDetails(
    requestId: String?
) -> CloudApiErrorDetails {
    CloudApiErrorDetails(
        message: guestCloudAuthResponseDecodingFailedMessage,
        requestId: requestId,
        code: guestCloudAuthResponseDecodingFailedCode,
        syncConflict: nil
    )
}
