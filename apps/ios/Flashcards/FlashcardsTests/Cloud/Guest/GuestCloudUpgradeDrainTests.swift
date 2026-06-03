import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class GuestCloudUpgradeDrainTests: XCTestCase {
    func testCompleteGuestCloudLinkRunsFreshGuestDrainAfterAlreadyActiveSync() async throws {
        let suiteName: String = "guest-upgrade-fresh-drain-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let databaseURL: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-fresh-drain-\(UUID().uuidString.lowercased())")
            .appendingPathExtension("sqlite")
        let database: LocalDatabase = try LocalDatabase(databaseURL: databaseURL)
        let credentialStore: CloudCredentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore: GuestCloudCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        let activeSyncStarted: XCTestExpectation = expectation(description: "active guest sync started")
        let freshDrainStarted: XCTestExpectation = expectation(description: "fresh guest drain started")
        let allowActiveSync: GuestUpgradeAsyncGate = GuestUpgradeAsyncGate()
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            if linkedSession.authorization.isGuest {
                if cloudSyncService.runLinkedSyncCallCount == 1 {
                    activeSyncStarted.fulfill()
                    await allowActiveSync.wait()
                } else if cloudSyncService.runLinkedSyncCallCount == 2 {
                    freshDrainStarted.fulfill()
                }
            }

            return .noChanges
        }
        GuestCloudAuthServiceTestURLProtocol.reset()
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            let body: Data = try guestCloudAuthServiceTestRequestBody(request: request)
            let requestBody: GuestUpgradeCompleteRequestBody = try JSONDecoder().decode(
                GuestUpgradeCompleteRequestBody.self,
                from: body
            )
            GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues.append(
                requestBody.supportsDroppedEntities
            )
            GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues.append(
                requestBody.guestWorkspaceSyncedAndOutboxDrained
            )
            GuestCloudAuthServiceTestURLProtocol.guestTokens.append(requestBody.guestToken)

            let response: HTTPURLResponse = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            let responseBody: Data = Data(
                """
                {
                  "workspace": {
                    "workspaceId": "workspace-linked",
                    "name": "Personal",
                    "createdAt": "2026-04-01T00:00:00.000Z",
                    "isSelected": true
                  }
                }
                """.utf8
            )
            return (response, responseBody)
        }
        let store: FlashcardsStore = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
            try? database.close()
            try? FileManager.default.removeItem(at: databaseURL)
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            GuestCloudAuthServiceTestURLProtocol.reset()
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let localWorkspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: localWorkspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil
        )
        try store.reload()
        let guestLinkedSession: CloudLinkedSession = CloudLinkedSession(
            userId: guestSession.userId,
            workspaceId: guestSession.workspaceId,
            email: nil,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            authorization: .guest(guestSession.guestToken)
        )
        store.cloudRuntime.setActiveCloudSession(linkedSession: guestLinkedSession)

        let activeSyncTask: Task<Void, Error> = Task { @MainActor in
            try await store.syncCloudNow(trigger: store.manualCloudSyncTrigger(now: Date()))
        }
        await fulfillment(of: [activeSyncStarted], timeout: 2)

        let linkContext: CloudWorkspaceLinkContext = CloudWorkspaceLinkContext(
            userId: "linked-user",
            email: "user@example.com",
            apiBaseUrl: configuration.apiBaseUrl,
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            ),
            workspaces: [],
            guestUpgradeMode: .mergeRequired,
            postAuthRecoveryRoute: .none
        )
        let upgradeTask: Task<Void, Error> = Task { @MainActor in
            try await store.completeGuestCloudLink(linkContext: linkContext, selection: .createNew)
        }

        XCTAssertEqual([.guest("guest-token")], cloudSyncService.runLinkedSyncAuthorizations)
        await allowActiveSync.open()
        try await activeSyncTask.value
        await fulfillment(of: [freshDrainStarted], timeout: 2)
        try await upgradeTask.value

        XCTAssertEqual(
            [.guest("guest-token"), .guest("guest-token"), .bearer("id-token")],
            cloudSyncService.runLinkedSyncAuthorizations
        )
        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual([true], GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues)
        XCTAssertEqual([true], GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues)
        XCTAssertEqual(["guest-token"], GuestCloudAuthServiceTestURLProtocol.guestTokens)
    }

    func testCompleteGuestCloudLinkStopsBeforeBackendWhenGuestOutboxRemainsAfterSync() async throws {
        let suiteName = "guest-upgrade-drain-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-drain-\(UUID().uuidString.lowercased())")
            .appendingPathExtension("sqlite")
        let database = try LocalDatabase(databaseURL: databaseURL)
        let credentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        let cloudSyncService = GuestUpgradeDrainCloudSyncService()
        let urlSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService = GuestCloudAuthService(session: URLSession(configuration: urlSessionConfiguration))
        GuestCloudAuthServiceTestURLProtocol.reset()
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
            try? database.close()
            try? FileManager.default.removeItem(at: databaseURL)
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            GuestCloudAuthServiceTestURLProtocol.reset()
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let configuration = try makeCustomCloudServiceConfiguration(customOrigin: "https://example.test")
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let guestSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: localWorkspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil
        )
        _ = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        try store.reload()

        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            _ = request
            throw LocalStoreError.database("Guest upgrade backend complete should not be called")
        }

        let linkContext = CloudWorkspaceLinkContext(
            userId: "linked-user",
            email: "user@example.com",
            apiBaseUrl: configuration.apiBaseUrl,
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            ),
            workspaces: [],
            guestUpgradeMode: .mergeRequired,
            postAuthRecoveryRoute: .none
        )

        do {
            try await store.completeGuestCloudLink(linkContext: linkContext, selection: .createNew)
            XCTFail("Guest upgrade should fail before backend complete when guest outbox remains.")
        } catch CloudGuestUpgradeDrainError.pendingGuestOutboxEntries(let workspaceId) {
            XCTAssertEqual(localWorkspace.workspaceId, workspaceId)
        } catch {
            XCTFail("Unexpected guest upgrade drain error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(.guest, try database.workspaceSettingsStore.loadCloudSettings().cloudState)
        XCTAssertGreaterThan(try database.loadOutboxEntries(workspaceId: localWorkspace.workspaceId, limit: 1).count, 0)
        XCTAssertNil(try credentialStore.loadCredentials())
    }
}
