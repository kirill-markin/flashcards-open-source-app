import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class CloudSyncIdentityConflictStatusTests: XCTestCase {
    func testOrdinaryLinkedSyncBlocksWorkspaceForkRequiredError() async throws {
        try await self.assertOrdinaryLinkedSyncBlocksIdentityConflict(
            suiteNamePrefix: "linked-sync-fork-required",
            errorCode: "SYNC_WORKSPACE_FORK_REQUIRED",
            statusCode: 409,
            message: "Sync detected content copied from another workspace. Retry after forking ids.",
            requestId: "request-fork"
        )
    }

    func testOrdinarySyncBlocksGuestSessionPlatformMismatchError() async throws {
        try await self.assertOrdinaryLinkedSyncBlocksIdentityConflict(
            suiteNamePrefix: "linked-sync-guest-platform-mismatch",
            errorCode: "GUEST_SESSION_PLATFORM_MISMATCH",
            statusCode: 403,
            message: "Guest session platform does not match this sync request. Create a new guest session for this device.",
            requestId: "request-guest-platform"
        )
    }

    private func assertOrdinaryLinkedSyncBlocksIdentityConflict(
        suiteNamePrefix: String,
        errorCode: String,
        statusCode: Int,
        message: String,
        requestId: String
    ) async throws {
        let suiteName: String = "\(suiteNamePrefix)-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        let credentialStore: CloudCredentialStore = CloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(suiteName)-cloud-auth",
            account: "primary"
        )
        let guestCredentialStore: GuestCloudCredentialStore = GuestCloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(suiteName)-guest-auth",
            account: "primary",
            bundle: .main,
            userDefaults: userDefaults
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        let cloudAuthService: CloudAuthService = CloudAuthService(
            encoder: encoder,
            decoder: makeFlashcardsRemoteJSONDecoder(),
            session: nil,
            cookieStorage: HTTPCookieStorage()
        )
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            encoder: encoder,
            decoder: makeFlashcardsRemoteJSONDecoder(),
            session: URLSession(configuration: URLSessionConfiguration.ephemeral)
        )
        let store: FlashcardsStore = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: nil,
            cloudAuthService: cloudAuthService,
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
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let expectedMessage: String = "\(message) Reference: \(requestId)"
        cloudSyncService.runLinkedSyncHandler = { (linkedSession: CloudLinkedSession) in
            XCTAssertEqual(.bearer("id-token-fresh"), linkedSession.authorization)
            throw CloudSyncError.invalidResponse(
                CloudApiErrorDetails(
                    message: message,
                    requestId: requestId,
                    code: errorCode,
                    syncConflict: nil
                ),
                statusCode
            )
        }
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token-fresh",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            )
        )
        store.cloudSettings = CloudSettings(
            installationId: "installation-1",
            cloudState: .linked,
            linkedUserId: "linked-user",
            linkedWorkspaceId: "workspace-linked",
            activeWorkspaceId: "workspace-linked",
            linkedEmail: "user@example.com",
            onboardingCompleted: true,
            updatedAt: "2026-04-25T00:00:00.000Z"
        )
        store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: "linked-user",
                workspaceId: "workspace-linked",
                email: "user@example.com",
                configurationMode: .custom,
                apiBaseUrl: "https://example.test/v1",
                authorization: .bearer("id-token-stale")
            )
        )

        do {
            try await store.syncCloudNow(trigger: store.manualCloudSyncTrigger(now: Date(timeIntervalSince1970: 0)))
            XCTFail("Expected typed identity conflict to block ordinary linked sync.")
        } catch let error as CloudSyncError {
            guard case .invalidResponse(let details, let receivedStatusCode) = error else {
                XCTFail("Expected invalid response error.")
                return
            }
            XCTAssertEqual(errorCode, details.code)
            XCTAssertEqual(statusCode, receivedStatusCode)
        } catch {
            XCTFail("Unexpected sync error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(.blocked(message: expectedMessage), store.syncStatus)
        XCTAssertEqual(expectedMessage, store.globalErrorMessage)
    }
}
