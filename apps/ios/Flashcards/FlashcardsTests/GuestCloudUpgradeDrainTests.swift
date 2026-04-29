import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class GuestCloudUpgradeDrainTests: XCTestCase {
    func testPendingGuestUpgradeResumeReplaysBackendCompleteWithoutGuestDrainAfterLostResponse() async throws {
        let suiteName = "guest-upgrade-replay-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-replay-\(UUID().uuidString.lowercased())")
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
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            let body = try guestCloudAuthServiceTestRequestBody(request: request)
            let requestBody = try JSONDecoder().decode(
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

            if GuestCloudAuthServiceTestURLProtocol.requestCount == 1 {
                let replayUserDefaults = UserDefaults(suiteName: suiteName)
                GuestCloudAuthServiceTestURLProtocol.pendingGuestUpgradeStateWasSavedBeforeComplete =
                    replayUserDefaults?.data(forKey: pendingGuestUpgradeUserDefaultsKey) != nil
                throw URLError(.networkConnectionLost)
            }

            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            let responseBody = Data(
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
            guestToken: "guest-token-initial",
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
            guestUpgradeMode: .mergeRequired
        )

        do {
            try await store.completeGuestCloudLink(linkContext: linkContext, selection: .createNew)
            XCTFail("Guest upgrade should preserve pending replay state when backend response is lost.")
        } catch let error as URLError {
            XCTAssertEqual(.networkConnectionLost, error.code)
        } catch {
            XCTFail("Unexpected guest upgrade replay setup error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertTrue(GuestCloudAuthServiceTestURLProtocol.pendingGuestUpgradeStateWasSavedBeforeComplete)
        let pendingData = try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        let pendingPayload = String(decoding: pendingData, as: UTF8.self)
        XCTAssertFalse(pendingPayload.contains("guestToken"))
        XCTAssertFalse(pendingPayload.contains("guest-token-initial"))
        XCTAssertTrue(pendingPayload.contains("\"guestUserId\""))
        XCTAssertTrue(pendingPayload.contains("\"guestWorkspaceId\""))
        XCTAssertTrue(pendingPayload.contains("guest-user"))
        XCTAssertTrue(pendingPayload.contains(localWorkspace.workspaceId))
        XCTAssertEqual([.guest("guest-token-initial")], cloudSyncService.runLinkedSyncAuthorizations)

        try guestCredentialStore.saveGuestSession(
            session: StoredGuestCloudSession(
                guestToken: "guest-token-replay",
                userId: guestSession.userId,
                workspaceId: guestSession.workspaceId,
                configurationMode: guestSession.configurationMode,
                apiBaseUrl: guestSession.apiBaseUrl
            )
        )

        let didResume = try await store.resumePendingGuestUpgradeIfNeeded(
            trigger: store.manualCloudSyncTrigger(now: Date())
        )

        XCTAssertTrue(didResume)
        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        XCTAssertEqual(.linked, try database.workspaceSettingsStore.loadCloudSettings().cloudState)
        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual([.guest("guest-token-initial"), .bearer("id-token")], cloudSyncService.runLinkedSyncAuthorizations)
        XCTAssertEqual(2, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(
            ["guest-token-initial", "guest-token-replay"],
            GuestCloudAuthServiceTestURLProtocol.guestTokens
        )
        XCTAssertEqual(
            [true, true],
            GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues
        )
        XCTAssertEqual(
            [true, true],
            GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues
        )
    }

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
            guestUpgradeMode: .mergeRequired
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

    func testPendingGuestUpgradeResumeRejectsMismatchedSecureStoreGuestSession() async throws {
        let suiteName: String = "guest-upgrade-replay-identity-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
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
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            _ = request
            throw LocalStoreError.database("In-flight guest upgrade replay should reject the guest session before backend complete")
        }
        GuestCloudAuthServiceTestURLProtocol.requestCount = 0
        GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues = []
        GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues = []
        GuestCloudAuthServiceTestURLProtocol.guestTokens = []
        GuestCloudAuthServiceTestURLProtocol.pendingGuestUpgradeStateWasSavedBeforeComplete = false
        let store: FlashcardsStore = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: nil,
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
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            GuestCloudAuthServiceTestURLProtocol.reset()
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            )
        )
        try guestCredentialStore.saveGuestSession(
            session: StoredGuestCloudSession(
                guestToken: "guest-token-replaced",
                userId: "guest-user-replaced",
                workspaceId: "workspace-replaced",
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl
            )
        )

        let pendingData: Data = self.inFlightPendingGuestUpgradePayload(
            apiBaseUrl: configuration.apiBaseUrl,
            guestUserId: "guest-user-original",
            guestWorkspaceId: "workspace-original"
        )
        let pendingPayload: String = String(decoding: pendingData, as: UTF8.self)
        XCTAssertFalse(pendingPayload.contains("guestToken"))
        XCTAssertFalse(pendingPayload.contains("guest-token-replaced"))
        userDefaults.set(pendingData, forKey: pendingGuestUpgradeUserDefaultsKey)

        do {
            _ = try await store.resumePendingGuestUpgradeIfNeeded(
                trigger: store.manualCloudSyncTrigger(now: Date())
            )
            XCTFail("Pending guest upgrade replay should reject a replaced secure-store guest session.")
        } catch let error as LocalStoreError {
            XCTAssertEqual(
                "In-flight pending guest upgrade guest identity mismatch: pendingGuestUserId=guest-user-original credentialGuestUserId=guest-user-replaced pendingGuestWorkspaceId=workspace-original credentialGuestWorkspaceId=workspace-replaced. Restore the original guest session for this pending upgrade before retrying recovery.",
                Flashcards.errorMessage(error: error)
            )
        } catch {
            XCTFail("Unexpected guest identity validation error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertNotNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNotNil(try guestCredentialStore.loadGuestSession())
        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
    }

    func testPendingGuestUpgradeResumeFinalizesCompletedStatesWithoutGuestCredential() async throws {
        try await self.verifyCompletedPendingGuestUpgradeResume(schemaVersion: 2, phase: nil)
        try await self.verifyCompletedPendingGuestUpgradeResume(schemaVersion: 3, phase: nil)
        try await self.verifyCompletedPendingGuestUpgradeResume(schemaVersion: 4, phase: "completed")
        try await self.verifyCompletedPendingGuestUpgradeResume(schemaVersion: 5, phase: "completed")
    }

    func testCompleteGuestCloudLinkBlocksLocalOutboxMutationsFromDrainStartUntilFinalizationCompletes() async throws {
        let suiteName = "guest-upgrade-mutation-block-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-mutation-block-\(UUID().uuidString.lowercased())")
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
        let guestDrainStarted = expectation(description: "guest drain started")
        let allowGuestDrain = GuestUpgradeAsyncGate()
        let backendCompleteStarted = expectation(description: "backend complete started")
        let allowBackendComplete = DispatchSemaphore(value: 0)
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            if linkedSession.authorization.isGuest {
                guestDrainStarted.fulfill()
                await allowGuestDrain.wait()
            }
            return .noChanges
        }
        GuestCloudAuthServiceTestURLProtocol.reset()
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            let body = try guestCloudAuthServiceTestRequestBody(request: request)
            let requestBody = try JSONDecoder().decode(
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
            let replayUserDefaults = UserDefaults(suiteName: suiteName)
            GuestCloudAuthServiceTestURLProtocol.pendingGuestUpgradeStateWasSavedBeforeComplete =
                replayUserDefaults?.data(forKey: pendingGuestUpgradeUserDefaultsKey) != nil
            backendCompleteStarted.fulfill()
            if allowBackendComplete.wait(timeout: .now() + 5) == .timedOut {
                throw URLError(.timedOut)
            }

            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            let responseBody = Data(
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
            allowBackendComplete.signal()
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
        try store.reload()

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
            guestUpgradeMode: .mergeRequired
        )

        let upgradeTask = Task { @MainActor in
            try await store.completeGuestCloudLink(linkContext: linkContext, selection: .createNew)
        }
        await fulfillment(of: [guestDrainStarted], timeout: 2)

        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertThrowsError(
            try store.saveCard(
                input: CardEditorInput(
                    frontText: "Blocked before drain finishes",
                    backText: "Blocked answer",
                    tags: [],
                    effortLevel: .medium
                ),
                editingCardId: nil
            )
        ) { error in
            XCTAssertEqual(
                "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes.",
                Flashcards.errorMessage(error: error)
            )
        }
        XCTAssertTrue(try database.loadOutboxEntries(workspaceId: localWorkspace.workspaceId, limit: 1).isEmpty)

        await allowGuestDrain.open()
        await fulfillment(of: [backendCompleteStarted], timeout: 2)

        XCTAssertTrue(GuestCloudAuthServiceTestURLProtocol.pendingGuestUpgradeStateWasSavedBeforeComplete)
        XCTAssertNotNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertThrowsError(
            try store.saveCard(
                input: CardEditorInput(
                    frontText: "Blocked question",
                    backText: "Blocked answer",
                    tags: [],
                    effortLevel: .medium
                ),
                editingCardId: nil
            )
        ) { error in
            XCTAssertEqual(
                "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes.",
                Flashcards.errorMessage(error: error)
            )
        }
        XCTAssertTrue(try database.loadOutboxEntries(workspaceId: localWorkspace.workspaceId, limit: 1).isEmpty)

        allowBackendComplete.signal()
        try await upgradeTask.value

        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual([.guest("guest-token"), .bearer("id-token")], cloudSyncService.runLinkedSyncAuthorizations)
        XCTAssertEqual([true], GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues)
        XCTAssertEqual([true], GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues)
        XCTAssertEqual(["guest-token"], GuestCloudAuthServiceTestURLProtocol.guestTokens)

        try store.saveCard(
            input: CardEditorInput(
                frontText: "Linked question",
                backText: "Linked answer",
                tags: [],
                effortLevel: .medium
            ),
            editingCardId: nil
        )
        XCTAssertEqual(1, try database.loadOutboxEntries(workspaceId: "workspace-linked", limit: Int.max).count)
    }

    func testActiveReviewSubmissionCannotAppendGuestOutboxAfterDrainBlockStarts() async throws {
        let suiteName = "guest-upgrade-review-race-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-review-race-\(UUID().uuidString.lowercased())")
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
        let reviewSubmissionOutboxMutationGate = ReviewSubmissionOutboxMutationGate()
        let reviewSubmissionExecutor = ReviewSubmissionExecutor(
            databaseURL: databaseURL,
            outboxMutationGate: reviewSubmissionOutboxMutationGate
        )
        let guestDrainStarted = expectation(description: "guest drain started")
        let allowGuestDrain = GuestUpgradeAsyncGate()
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            if linkedSession.authorization.isGuest {
                guestDrainStarted.fulfill()
                await allowGuestDrain.wait()
            }
            return .noChanges
        }
        GuestCloudAuthServiceTestURLProtocol.reset()
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            let body = try guestCloudAuthServiceTestRequestBody(request: request)
            let requestBody = try JSONDecoder().decode(
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

            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            let responseBody = Data(
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
            reviewSubmissionOutboxMutationGate: reviewSubmissionOutboxMutationGate,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
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
        let card = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let setupOutboxEntries = try database.loadOutboxEntries(
            workspaceId: localWorkspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: setupOutboxEntries.map(\.operationId))
        try store.reload()

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
            guestUpgradeMode: .mergeRequired
        )
        let upgradeTask = Task { @MainActor in
            try await store.completeGuestCloudLink(linkContext: linkContext, selection: .createNew)
        }
        await fulfillment(of: [guestDrainStarted], timeout: 2)

        XCTAssertTrue(try database.loadOutboxEntries(workspaceId: localWorkspace.workspaceId, limit: 1).isEmpty)

        do {
            _ = try await reviewSubmissionExecutor.submitReview(
                workspaceId: localWorkspace.workspaceId,
                submission: ReviewSubmission(
                    cardId: card.cardId,
                    rating: .good,
                    reviewedAtClient: "2026-04-25T12:00:00.000Z"
                )
            )
            XCTFail("Review submission executor should block guest outbox writes after guest upgrade drain starts.")
        } catch PendingGuestUpgradeLocalMutationError.blocked {
        } catch {
            XCTFail("Unexpected review submission gate error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertTrue(try database.loadOutboxEntries(workspaceId: localWorkspace.workspaceId, limit: 1).isEmpty)

        await allowGuestDrain.open()
        try await upgradeTask.value

        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual([.guest("guest-token"), .bearer("id-token")], cloudSyncService.runLinkedSyncAuthorizations)
        XCTAssertEqual([true], GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues)
        XCTAssertEqual([true], GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues)
        XCTAssertEqual(["guest-token"], GuestCloudAuthServiceTestURLProtocol.guestTokens)
    }

    func testCloudIdentityResetClearsPendingGuestUpgradeAndUnblocksMutationGates() async throws {
        let suiteName: String = "guest-upgrade-reset-cleanup-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        let databaseURL: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-reset-cleanup-\(UUID().uuidString.lowercased())")
            .appendingPathExtension("sqlite")
        let database: LocalDatabase = try LocalDatabase(databaseURL: databaseURL)
        let credentialStore: CloudCredentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore: GuestCloudCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        let reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate = ReviewSubmissionOutboxMutationGate()
        let store: FlashcardsStore = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: GuestUpgradeDrainCloudSyncService(),
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: reviewSubmissionOutboxMutationGate,
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
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        userDefaults.set(Data("pending".utf8), forKey: pendingGuestUpgradeUserDefaultsKey)
        store.isGuestUpgradeLocalOutboxMutationBlocked = true
        await reviewSubmissionOutboxMutationGate.blockNewReviewSubmissionsAndWaitForActiveSubmissions()

        XCTAssertThrowsError(try store.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()) { error in
            XCTAssertEqual(
                "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes.",
                Flashcards.errorMessage(error: error)
            )
        }
        XCTAssertThrowsError(try reviewSubmissionOutboxMutationGate.beginReviewSubmission()) { error in
            XCTAssertEqual(
                "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes.",
                Flashcards.errorMessage(error: error)
            )
        }

        try store.resetLocalStateForCloudIdentityChange()

        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertFalse(store.isGuestUpgradeLocalOutboxMutationBlocked)
        XCTAssertNoThrow(try store.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade())
        do {
            try reviewSubmissionOutboxMutationGate.beginReviewSubmission()
            reviewSubmissionOutboxMutationGate.finishReviewSubmission()
        } catch {
            XCTFail("Review submission gate should be unblocked after identity reset: \(Flashcards.errorMessage(error: error))")
        }
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
            guestUpgradeMode: .mergeRequired
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

    private func verifyCompletedPendingGuestUpgradeResume(
        schemaVersion: Int,
        phase: String?
    ) async throws {
        let suiteName = "guest-upgrade-completed-\(schemaVersion)-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-completed-\(schemaVersion)-\(UUID().uuidString.lowercased())")
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
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            _ = request
            throw LocalStoreError.database("Completed pending guest upgrade should not call backend guest completion")
        }
        GuestCloudAuthServiceTestURLProtocol.requestCount = 0
        GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues = []
        GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues = []
        GuestCloudAuthServiceTestURLProtocol.guestTokens = []
        GuestCloudAuthServiceTestURLProtocol.pendingGuestUpgradeStateWasSavedBeforeComplete = false
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
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: "guest-user",
            linkedWorkspaceId: localWorkspace.workspaceId,
            activeWorkspaceId: localWorkspace.workspaceId,
            linkedEmail: nil
        )
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token-\(schemaVersion)",
                idToken: "id-token-\(schemaVersion)",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            )
        )
        try store.reload()

        let pendingData = self.completedPendingGuestUpgradePayload(
            schemaVersion: schemaVersion,
            phase: phase,
            apiBaseUrl: configuration.apiBaseUrl
        )
        let pendingPayload = String(decoding: pendingData, as: UTF8.self)
        XCTAssertFalse(pendingPayload.contains("guestToken"))
        XCTAssertFalse(pendingPayload.contains("guest-token"))
        userDefaults.set(pendingData, forKey: pendingGuestUpgradeUserDefaultsKey)
        XCTAssertNil(try guestCredentialStore.loadGuestSession())

        let didResume = try await store.resumePendingGuestUpgradeIfNeeded(
            trigger: store.manualCloudSyncTrigger(now: Date())
        )

        XCTAssertTrue(didResume)
        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        XCTAssertEqual(.linked, try database.workspaceSettingsStore.loadCloudSettings().cloudState)
        XCTAssertEqual("workspace-linked-\(schemaVersion)", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual([.bearer("id-token-\(schemaVersion)")], cloudSyncService.runLinkedSyncAuthorizations)
        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
    }

    private func completedPendingGuestUpgradePayload(
        schemaVersion: Int,
        phase: String?,
        apiBaseUrl: String
    ) -> Data {
        let phaseLine: String
        if let phase {
            phaseLine = "  \"phase\": \"\(phase)\",\n"
        } else {
            phaseLine = ""
        }

        return Data(
            """
            {
              "schemaVersion": \(schemaVersion),
            \(phaseLine)  "apiBaseUrl": "\(apiBaseUrl)",
              "configurationMode": "custom",
              "userId": "linked-user-\(schemaVersion)",
              "email": "user-\(schemaVersion)@example.com",
              "workspace": {
                "workspaceId": "workspace-linked-\(schemaVersion)",
                "name": "Personal",
                "createdAt": "2026-04-01T00:00:00.000Z",
                "isSelected": true
              }
            }
            """.utf8
        )
    }

    private func inFlightPendingGuestUpgradePayload(
        apiBaseUrl: String,
        guestUserId: String,
        guestWorkspaceId: String
    ) -> Data {
        Data(
            """
            {
              "schemaVersion": 5,
              "phase": "in_flight",
              "apiBaseUrl": "\(apiBaseUrl)",
              "configurationMode": "custom",
              "userId": "linked-user",
              "email": "user@example.com",
              "guestUserId": "\(guestUserId)",
              "guestWorkspaceId": "\(guestWorkspaceId)",
              "selection": {
                "type": "create_new"
              },
              "supportsDroppedEntities": true
            }
            """.utf8
        )
    }
}
