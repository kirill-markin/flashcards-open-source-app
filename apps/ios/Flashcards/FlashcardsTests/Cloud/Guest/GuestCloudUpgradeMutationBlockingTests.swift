import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class GuestCloudUpgradeMutationBlockingTests: XCTestCase {
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
            guestUpgradeMode: .mergeRequired,
            postAuthRecoveryRoute: .none
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
            guestUpgradeMode: .mergeRequired,
            postAuthRecoveryRoute: .none
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
}
