import Foundation
import XCTest
@testable import Flashcards

final class GuestCloudAuthServiceTestURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    nonisolated(unsafe) static var requestCount: Int = 0
    nonisolated(unsafe) static var supportsDroppedEntitiesValues: [Bool] = []
    nonisolated(unsafe) static var guestWorkspaceSyncedAndOutboxDrainedValues: [Bool] = []
    nonisolated(unsafe) static var guestTokens: [String] = []
    nonisolated(unsafe) static var pendingGuestUpgradeStateWasSavedBeforeComplete: Bool = false

    override class func canInit(with request: URLRequest) -> Bool {
        _ = request
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.requestCount += 1
        guard let requestHandler = Self.requestHandler else {
            self.client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try requestHandler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {
    }

    static func reset() {
        self.requestHandler = nil
        self.requestCount = 0
        self.supportsDroppedEntitiesValues = []
        self.guestWorkspaceSyncedAndOutboxDrainedValues = []
        self.guestTokens = []
        self.pendingGuestUpgradeStateWasSavedBeforeComplete = false
    }
}

struct GuestUpgradeCompleteRequestBody: Decodable {
    let guestToken: String
    let guestWorkspaceSyncedAndOutboxDrained: Bool
    let supportsDroppedEntities: Bool
}

actor GuestUpgradeAsyncGate {
    private var isOpen: Bool = false
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        if self.isOpen {
            return
        }

        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func open() {
        self.isOpen = true
        self.continuation?.resume()
        self.continuation = nil
    }
}

@MainActor
final class GuestUpgradeDrainCloudSyncService: CloudSyncServing {
    private(set) var runLinkedSyncCallCount: Int = 0
    private(set) var runLinkedSyncAuthorizations: [CloudAuthorization] = []
    var runLinkedSyncHandler: ((CloudLinkedSession) async throws -> CloudSyncResult)?

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserProgressSummary {
        _ = apiBaseUrl
        _ = authorizationHeader
        return UserProgressSummary(
            timeZone: timeZone,
            summary: ProgressSummary(
                currentStreakDays: 0,
                hasReviewedToday: false,
                lastReviewedOn: nil,
                activeReviewDays: 0
            ),
            generatedAt: "2026-04-25T00:00:00.000Z"
        )
    }

    func loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries {
        _ = apiBaseUrl
        _ = authorizationHeader
        return UserProgressSeries(
            timeZone: timeZone,
            from: from,
            to: to,
            dailyReviews: [],
            summary: ProgressSummary(
                currentStreakDays: 0,
                hasReviewedToday: false,
                lastReviewedOn: nil,
                activeReviewDays: 0
            ),
            generatedAt: "2026-04-25T00:00:00.000Z"
        )
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = name
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = name
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceDeleteResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceResetProgressResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func listAgentApiKeys(
        apiBaseUrl: String,
        bearerToken: String
    ) async throws -> ([AgentApiKeyConnection], String) {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func revokeAgentApiKey(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ) async throws -> (AgentApiKeyConnection, String) {
        _ = apiBaseUrl
        _ = bearerToken
        _ = connectionId
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        installationId: String
    ) async throws -> Bool {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = workspaceId
        _ = installationId
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        _ = apiBaseUrl
        _ = bearerToken
        _ = confirmationText
        fatalError("Not used in GuestCloudUpgradeDrainTests.")
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        self.runLinkedSyncCallCount += 1
        self.runLinkedSyncAuthorizations.append(linkedSession.authorization)
        if let runLinkedSyncHandler {
            return try await runLinkedSyncHandler(linkedSession)
        }
        return .noChanges
    }
}

func guestCloudAuthServiceTestRequestBody(request: URLRequest) throws -> Data {
    if let httpBody = request.httpBody {
        return httpBody
    }

    guard let stream = request.httpBodyStream else {
        throw LocalStoreError.database("Guest auth service test request is missing HTTP body")
    }

    stream.open()
    defer {
        stream.close()
    }

    let bufferSize: Int = 1024
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    while stream.hasBytesAvailable {
        let readCount = stream.read(&buffer, maxLength: buffer.count)
        if readCount < 0 {
            throw LocalStoreError.database("Guest auth service test request body stream failed")
        }
        if readCount == 0 {
            break
        }
        data.append(buffer, count: readCount)
    }
    return data
}
