import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class CloudSyncIdentityConflictStatusTests: CloudCredentialRecoveryTestCase {
    func testOrdinaryLinkedSyncBlocksWorkspaceForkRequiredError() async throws {
        try await self.assertOrdinaryLinkedSyncBlocksIdentityConflict(
            suiteNamePrefix: "linked-sync-fork-required",
            errorCode: "SYNC_WORKSPACE_FORK_REQUIRED",
            statusCode: 409,
            message: "Sync detected content copied from another workspace. Retry after forking ids.",
            requestId: "request-fork",
            expectedSyncStatus: .blocked(
                message: "Sync detected content copied from another workspace. Retry after forking ids. Reference: request-fork"
            )
        )
    }

    func testOrdinarySyncBlocksGuestSessionPlatformMismatchError() async throws {
        try await self.assertOrdinaryLinkedSyncBlocksIdentityConflict(
            suiteNamePrefix: "linked-sync-guest-platform-mismatch",
            errorCode: "GUEST_SESSION_PLATFORM_MISMATCH",
            statusCode: 403,
            message: "Guest session platform does not match this sync request. Create a new guest session for this device.",
            requestId: "request-guest-platform",
            expectedSyncStatus: .blocked(
                message: "Guest session platform does not match this sync request. Create a new guest session for this device. Reference: request-guest-platform"
            )
        )
    }

    func testGenericWorkspace404KeepsExistingFailureBehavior() async throws {
        try await self.assertOrdinaryLinkedSyncBlocksIdentityConflict(
            suiteNamePrefix: "linked-sync-generic-workspace-404",
            errorCode: "WORKSPACE_ACCESS_ERROR",
            statusCode: 404,
            message: "Workspace access failed.",
            requestId: "request-generic-workspace",
            expectedSyncStatus: .failed(message: "Workspace access failed. Reference: request-generic-workspace")
        )
    }

    func testWrappedLinkedWorkspaceNotFoundEntersPersistedRecoveryWithoutDeletingLocalData() async throws {
        let suiteName: String = "linked-workspace-unavailable-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard: Card = try self.saveRecoveryTestCard(
            database: database,
            workspaceId: workspace.workspaceId
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-24T10:00:03.000Z",
                reviewedTimeZone: "UTC"
            )
        )
        let reviewEventsBefore: [ReviewEvent] = try database.loadReviewEvents(workspaceId: workspace.workspaceId)
        let mediaAsset = MediaAsset(
            mediaAssetId: "00000000-0000-4000-8000-000000000041",
            workspaceId: workspace.workspaceId,
            mimeType: "image/png",
            sizeBytes: 4,
            sha256: String(repeating: "a", count: 64),
            sourceUrl: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: "2026-04-24T10:00:01.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: "operation-media-1",
            updatedAt: "2026-04-24T10:00:02.000Z",
            deletedAt: nil
        )
        try database.mediaAssetStore.upsertMediaAsset(
            workspaceId: workspace.workspaceId,
            mediaAsset: mediaAsset
        )
        let mediaTransfer = try database.mediaTransferStore.enqueueTransfer(
            request: MediaTransferEnqueueRequest(
                transferId: "00000000-0000-4000-8000-000000000042",
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAsset.mediaAssetId,
                kind: .upload,
                sha256: mediaAsset.sha256,
                mimeType: mediaAsset.mimeType,
                sizeBytes: mediaAsset.sizeBytes,
                createdAt: mediaAsset.createdAt
            )
        )
        let outboxCountBefore: Int = try self.loadOutboxCount(database: database)
        let workspaceIdsBefore: [String] = try self.loadWorkspaceIds(database: database)
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "linked-user",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: workspace.workspaceId,
            linkedEmail: "user@example.com"
        )
        let credentialStore: CloudCredentialStore = self.makeCredentialStore(
            suiteName: suiteName,
            encoder: encoder,
            decoder: decoder
        )
        let guestCredentialStore: GuestCloudCredentialStore = self.makeGuestCredentialStore(
            suiteName: suiteName,
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder
        )
        let credentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
        try credentialStore.saveCredentials(credentials: credentials)
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            XCTAssertEqual(.bearer(credentials.idToken), linkedSession.authorization)
            throw CloudSyncLocalIdRepairFailure(
                syncResult: CloudSyncResult(
                    appliedPullChangeCount: 0,
                    reviewScheduleImpactingPullChangeCount: 0,
                    changedEntityTypes: [.card],
                    localIdRepairEntityTypes: [.card],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    acknowledgedReviewScheduleImpactingOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0,
                    cleanedUpReviewScheduleImpactingOperationCount: 0
                ),
                underlyingError: CloudSyncError.invalidResponse(
                    CloudApiErrorDetails(
                        message: "Workspace not found",
                        requestId: "request-workspace-missing",
                        code: "WORKSPACE_NOT_FOUND",
                        syncConflict: nil
                    ),
                    404
                )
            )
        }
        let store: FlashcardsStore = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            cloudSyncService: cloudSyncService
        )
        defer {
            store.shutdownForTests()
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: "linked-user",
                workspaceId: workspace.workspaceId,
                email: "user@example.com",
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl,
                authorization: .bearer(credentials.idToken)
            )
        )

        do {
            try await store.syncCloudNow(trigger: store.technicalErrorModalCloudSyncTrigger(now: Date()))
            XCTFail("Expected linked workspace recovery to block the sync.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected recovery validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(
                localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedWorkspaceUnavailable),
                message
            )
        }

        await store.syncCloudIfLinked(trigger: self.makeRecoverySyncTrigger())

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertTrue(store.capturedTechnicalErrorCaptureContextIDs.isEmpty)
        XCTAssertEqual("", store.globalErrorMessage)
        XCTAssertNil(store.cloudRuntime.activeCloudSession())
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        XCTAssertEqual(reviewEventsBefore, try database.loadReviewEvents(workspaceId: workspace.workspaceId))
        XCTAssertEqual(
            mediaAsset,
            try database.mediaAssetStore.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAsset.mediaAssetId
            )
        )
        XCTAssertEqual(
            1,
            try database.core.scalarInt(
                sql: "SELECT COUNT(*) FROM media_transfer_queue WHERE transfer_id = ?",
                values: [.text(mediaTransfer.transferId)]
            )
        )
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.linkedWorkspaceUnavailable, recoveryState.reason)
        XCTAssertEqual(Optional("linked-user"), recoveryState.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), recoveryState.activeWorkspaceId)
        XCTAssertEqual(
            recoveryState,
            try self.loadPersistedRecoveryState(userDefaults: userDefaults, decoder: decoder)
        )
        XCTAssertEqual(credentials, try credentialStore.loadCredentials())
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedWorkspaceUnavailable,
            file: #filePath,
            line: #line
        )
    }

    private func assertOrdinaryLinkedSyncBlocksIdentityConflict(
        suiteNamePrefix: String,
        errorCode: String,
        statusCode: Int,
        message: String,
        requestId: String,
        expectedSyncStatus: SyncStatus
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
        XCTAssertEqual(expectedSyncStatus, store.syncStatus)
        XCTAssertEqual(expectedMessage, store.globalErrorMessage)
        XCTAssertNil(store.cloudCredentialRecoveryState)
    }
}
