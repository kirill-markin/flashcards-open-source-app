import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreCloudSyncTests: XCTestCase {
    func testPrepareCloudLinkResetsLocalStateWhenAuthenticatedUserDiffersFromStoredLinkedUser() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)
        let originalDeviceId = try testCloudSettings(database: context.database).deviceId

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.store.reload()
        context.cloudSyncService.fetchCloudAccountSnapshot = CloudAccountSnapshot(
            userId: "user-2",
            email: "user-2@example.com",
            workspaces: []
        )

        let linkContext = try await context.store.prepareCloudLink(
            verifiedContext: CloudVerifiedAuthContext(
                apiBaseUrl: "https://api.example.com/v1",
                credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials()
            )
        )

        let resetCloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(linkContext.userId, "user-2")
        XCTAssertEqual(resetCloudSettings.cloudState, .disconnected)
        XCTAssertNil(resetCloudSettings.linkedUserId)
        XCTAssertNotEqual(resetCloudSettings.deviceId, originalDeviceId)
        XCTAssertTrue(try context.database.loadActiveCards(workspaceId: workspaceId).isEmpty)
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
    }

    func testPrepareCloudLinkClearsStoredGuestSessionWhenServerConfigurationChanged() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let staleGuestSession = StoredGuestCloudSession(
            guestToken: "guest-token-stale",
            userId: "guest-user-stale",
            workspaceId: "guest-workspace-stale",
            configurationMode: .custom,
            apiBaseUrl: "https://api.stale.example.com/v1"
        )

        try context.guestCredentialStore.saveGuestSession(session: staleGuestSession)
        try context.database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: staleGuestSession.userId,
            linkedWorkspaceId: staleGuestSession.workspaceId,
            activeWorkspaceId: staleGuestSession.workspaceId,
            linkedEmail: nil
        )
        try context.store.reload()

        let linkContext = try await context.store.prepareCloudLink(
            verifiedContext: CloudVerifiedAuthContext(
                apiBaseUrl: "https://api.example.com/v1",
                credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials()
            )
        )

        XCTAssertNil(linkContext.guestUpgradeMode)
        XCTAssertNil(try context.guestCredentialStore.loadGuestSession())
    }

    func testSyncCloudIfLinkedResetsLocalStateWhenStoredCredentialsBelongToAnotherUser() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)
        let originalDeviceId = try testCloudSettings(database: context.database).deviceId

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.store.reload()
        context.cloudSyncService.fetchCloudAccountSnapshot = CloudAccountSnapshot(
            userId: "user-2",
            email: "user-2@example.com",
            workspaces: []
        )

        await context.store.syncCloudIfLinked()

        let resetCloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(resetCloudSettings.cloudState, .disconnected)
        XCTAssertNil(resetCloudSettings.linkedUserId)
        XCTAssertNotEqual(resetCloudSettings.deviceId, originalDeviceId)
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(context.store.syncStatus, .idle)
    }

    func testRestoreCloudLinkForSameWorkspaceNoOpKeepsPublishedReviewStateStable() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1", tags: ["tag-a"]),
            cardId: nil
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2", tags: ["tag-b"]),
            cardId: nil
        )
        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.store.isReviewHeadLoading == false
                && context.store.effectiveReviewQueue.count == 2
        }

        let initialReviewQueue = context.store.reviewQueue
        let initialCurrentCardId = context.store.effectiveReviewQueue.first?.cardId
        let initialReadVersion = context.store.localReadVersion

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.store.reviewQueue, initialReviewQueue)
        XCTAssertEqual(context.store.effectiveReviewQueue.first?.cardId, initialCurrentCardId)
        XCTAssertEqual(context.store.localReadVersion, initialReadVersion)
        XCTAssertFalse(context.store.isReviewHeadLoading)
        XCTAssertNil(context.store.currentTransientBanner)
        XCTAssertEqual(context.store.cloudRuntime.activeCloudSession()?.workspaceId, workspaceId)
    }

    func testSyncCloudIfLinkedNoOpKeepsPublishedReviewStateStable() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1", tags: ["tag-a"]),
            cardId: nil
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2", tags: ["tag-b"]),
            cardId: nil
        )
        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.store.isReviewHeadLoading == false
                && context.store.effectiveReviewQueue.count == 2
        }

        let initialReviewQueue = context.store.reviewQueue
        let initialCurrentCardId = context.store.effectiveReviewQueue.first?.cardId
        let initialReadVersion = context.store.localReadVersion

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.store.reviewQueue, initialReviewQueue)
        XCTAssertEqual(context.store.effectiveReviewQueue.first?.cardId, initialCurrentCardId)
        XCTAssertEqual(context.store.localReadVersion, initialReadVersion)
        XCTAssertFalse(context.store.isReviewHeadLoading)
        XCTAssertNil(context.store.currentTransientBanner)
    }

    func testSyncCloudIfLinkedUsesActiveGuestSessionWithoutStoredCloudCredentials() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let guestSession = FlashcardsStoreTestSupport.makeGuestSession(
            userId: "guest-user-1",
            workspaceId: "guest-workspace-1",
            guestToken: "guest-token-1"
        )

        try context.database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil
        )
        context.store.cloudRuntime.setActiveCloudSession(linkedSession: guestSession)
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncSessions, [guestSession])
        XCTAssertTrue(try XCTUnwrap(context.store.cloudRuntime.activeCloudSession()).authorization.isGuest)
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedRestoresGuestSessionFromDisconnectedStateAfterReinstall() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let configuration = try context.store.currentCloudServiceConfiguration()
        let storedGuestSession = FlashcardsStoreTestSupport.makeStoredGuestCloudSession(
            userId: "guest-user-reinstall",
            workspaceId: "guest-workspace-reinstall",
            guestToken: "guest-token-reinstall"
        )
        let configuredStoredGuestSession = StoredGuestCloudSession(
            guestToken: storedGuestSession.guestToken,
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )

        try context.guestCredentialStore.saveGuestSession(session: configuredStoredGuestSession)
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(
            context.cloudSyncService.runLinkedSyncSessions,
            [
                CloudLinkedSession(
                    userId: configuredStoredGuestSession.userId,
                    workspaceId: configuredStoredGuestSession.workspaceId,
                    email: nil,
                    configurationMode: configuration.mode,
                    apiBaseUrl: configuration.apiBaseUrl,
                    authorization: .guest(configuredStoredGuestSession.guestToken)
                )
            ]
        )
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .guest)
        XCTAssertEqual(context.store.cloudSettings?.linkedUserId, configuredStoredGuestSession.userId)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, configuredStoredGuestSession.workspaceId)
        XCTAssertTrue(try XCTUnwrap(context.store.cloudRuntime.activeCloudSession()).authorization.isGuest)
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedRestoresStoredGuestSessionWithoutStoredCloudCredentials() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let configuration = try context.store.currentCloudServiceConfiguration()
        let storedGuestSession = FlashcardsStoreTestSupport.makeStoredGuestCloudSession(
            userId: "guest-user-2",
            workspaceId: "guest-workspace-2",
            guestToken: "guest-token-2"
        )
        let configuredStoredGuestSession = StoredGuestCloudSession(
            guestToken: storedGuestSession.guestToken,
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )

        try context.guestCredentialStore.saveGuestSession(session: configuredStoredGuestSession)
        try context.database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: configuredStoredGuestSession.userId,
            linkedWorkspaceId: configuredStoredGuestSession.workspaceId,
            activeWorkspaceId: configuredStoredGuestSession.workspaceId,
            linkedEmail: nil
        )
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(
            context.cloudSyncService.runLinkedSyncSessions,
            [
                CloudLinkedSession(
                    userId: configuredStoredGuestSession.userId,
                    workspaceId: configuredStoredGuestSession.workspaceId,
                    email: nil,
                    configurationMode: configuration.mode,
                    apiBaseUrl: configuration.apiBaseUrl,
                    authorization: .guest(configuredStoredGuestSession.guestToken)
                )
            ]
        )
        XCTAssertTrue(try XCTUnwrap(context.store.cloudRuntime.activeCloudSession()).authorization.isGuest)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .guest)
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedRestoresAuthenticatedSessionFromDisconnectedStateAfterReinstall() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let selectedWorkspace = CloudWorkspaceSummary(
            workspaceId: "cloud-workspace-reinstall",
            name: "Remote Personal",
            createdAt: "2026-03-10T10:00:00.000Z",
            isSelected: true
        )

        try context.credentialStore.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.cloudSyncService.fetchCloudAccountSnapshot = CloudAccountSnapshot(
            userId: "user-1",
            email: "user@example.com",
            workspaces: [selectedWorkspace]
        )
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        let configuration = try context.store.currentCloudServiceConfiguration()
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(
            context.cloudSyncService.runLinkedSyncSessions,
            [
                CloudLinkedSession(
                    userId: "user-1",
                    workspaceId: selectedWorkspace.workspaceId,
                    email: "user@example.com",
                    configurationMode: .official,
                    apiBaseUrl: configuration.apiBaseUrl,
                    authorization: .bearer("id-token")
                )
            ]
        )
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .linked)
        XCTAssertEqual(context.store.cloudSettings?.linkedUserId, "user-1")
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, selectedWorkspace.workspaceId)
        XCTAssertEqual(context.store.cloudSettings?.activeWorkspaceId, selectedWorkspace.workspaceId)
        XCTAssertEqual(context.store.cloudSettings?.linkedEmail, "user@example.com")
        XCTAssertEqual(try context.credentialStore.loadCredentials(), FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        XCTAssertEqual(try context.database.loadCachedWorkspaces().map(\.workspaceId), [selectedWorkspace.workspaceId])
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedClearsOrphanedStoredCredentialsFromDisconnectedStateWhenLocalStateIsNotPristine() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.credentialStore.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .disconnected)
        XCTAssertNil(try context.credentialStore.loadCredentials())
        XCTAssertEqual(try context.database.loadActiveCards(workspaceId: workspaceId).count, 1)
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedDropsAuthenticatedStoredCredentialsWhenSilentRestoreFails() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )

        try context.credentialStore.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.cloudSyncService.fetchCloudAccountError = URLError(.notConnectedToInternet)
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .disconnected)
        XCTAssertNil(try context.credentialStore.loadCredentials())
        XCTAssertNil(context.store.cloudRuntime.activeCloudSession())
        XCTAssertEqual(context.store.workspace?.name, "Personal")
        XCTAssertEqual(context.store.userSettings?.userId, "local-user")
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedDoesNotRestoreAuthenticatedSessionAfterReinstallForCustomServer() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )

        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://self-hosted.example.com"),
            userDefaults: context.store.userDefaults,
            encoder: context.store.encoder
        )
        try context.credentialStore.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .disconnected)
        XCTAssertNil(try context.credentialStore.loadCredentials())
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedClearsAmbiguousStoredCredentialsAndGuestSessionFromDisconnectedState() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let configuration = try context.store.currentCloudServiceConfiguration()
        let storedGuestSession = FlashcardsStoreTestSupport.makeStoredGuestCloudSession(
            userId: "guest-user-ambiguous",
            workspaceId: "guest-workspace-ambiguous",
            guestToken: "guest-token-ambiguous"
        )
        let configuredStoredGuestSession = StoredGuestCloudSession(
            guestToken: storedGuestSession.guestToken,
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )

        try context.credentialStore.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        try context.guestCredentialStore.saveGuestSession(session: configuredStoredGuestSession)
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .disconnected)
        XCTAssertNil(try context.credentialStore.loadCredentials())
        XCTAssertNil(try context.guestCredentialStore.loadGuestSession())
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedResetsGuestStateWhenStoredGuestSessionIsMissing() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let originalDeviceId = try testCloudSettings(database: context.database).deviceId

        try context.database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: "guest-user-missing",
            linkedWorkspaceId: "guest-workspace-missing",
            activeWorkspaceId: "guest-workspace-missing",
            linkedEmail: nil
        )
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        let resetCloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(resetCloudSettings.cloudState, .disconnected)
        XCTAssertNil(resetCloudSettings.linkedUserId)
        XCTAssertNotEqual(resetCloudSettings.deviceId, originalDeviceId)
        XCTAssertNil(try context.guestCredentialStore.loadGuestSession())
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedResetsLinkedStateWhenStoredCredentialsAreMissing() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)
        let originalDeviceId = try testCloudSettings(database: context.database).deviceId

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.reload()

        await context.store.syncCloudIfLinked()

        let resetCloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(resetCloudSettings.cloudState, .disconnected)
        XCTAssertNil(resetCloudSettings.linkedUserId)
        XCTAssertNotEqual(resetCloudSettings.deviceId, originalDeviceId)
        XCTAssertNil(try context.credentialStore.loadCredentials())
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testSyncCloudIfLinkedNoOpOnFreshInstallWithoutPersistedSecureState() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .disconnected)
        XCTAssertNil(try context.credentialStore.loadCredentials())
        XCTAssertNil(try context.guestCredentialStore.loadGuestSession())
        XCTAssertEqual(context.store.syncStatus, .idle)
        XCTAssertEqual(context.store.globalErrorMessage, "")
    }

    func testRestoreCloudLinkForSameWorkspaceShowsOverlayBannerWhenRemoteSyncReplacesCurrentCard() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [
                .succeedWithResult(
                    CloudSyncResult(
                        appliedPullChangeCount: 2,
                        changedEntityTypes: [.card, .reviewEvent],
                        acknowledgedOperationCount: 0,
                        cleanedUpOperationCount: 0
                    )
                )
            ],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1", tags: ["tag-a"]),
            cardId: nil
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2", tags: ["tag-b"]),
            cardId: nil
        )
        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.store.isReviewHeadLoading == false
                && context.store.effectiveReviewQueue.count == 2
        }

        let firstCardId = try XCTUnwrap(context.store.effectiveReviewQueue.first?.cardId)
        let secondCardId = try XCTUnwrap(context.store.effectiveReviewQueue.dropFirst().first?.cardId)
        let initialReadVersion = context.store.localReadVersion

        _ = try context.database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: firstCardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.store.effectiveReviewQueue.first?.cardId, secondCardId)
        XCTAssertEqual(context.store.currentTransientBanner?.message, reviewUpdatedOnAnotherDeviceBannerMessage)
        XCTAssertEqual(context.store.currentTransientBanner?.kind, .reviewUpdatedOnAnotherDevice)
        XCTAssertGreaterThan(context.store.localReadVersion, initialReadVersion)
        XCTAssertFalse(context.store.isReviewHeadLoading)
        XCTAssertEqual(context.store.cloudRuntime.activeCloudSession()?.workspaceId, workspaceId)
    }

    func testSyncCloudIfLinkedShowsOverlayBannerWhenRemoteSyncReplacesCurrentCard() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [
                .succeedWithResult(
                    CloudSyncResult(
                        appliedPullChangeCount: 2,
                        changedEntityTypes: [.card, .reviewEvent],
                        acknowledgedOperationCount: 0,
                        cleanedUpOperationCount: 0
                    )
                )
            ],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1", tags: ["tag-a"]),
            cardId: nil
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2", tags: ["tag-b"]),
            cardId: nil
        )
        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.store.isReviewHeadLoading == false
                && context.store.effectiveReviewQueue.count == 2
        }

        let firstCardId = try XCTUnwrap(context.store.effectiveReviewQueue.first?.cardId)
        let secondCardId = try XCTUnwrap(context.store.effectiveReviewQueue.dropFirst().first?.cardId)
        let initialReadVersion = context.store.localReadVersion

        _ = try context.database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: firstCardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.store.effectiveReviewQueue.first?.cardId, secondCardId)
        XCTAssertEqual(context.store.currentTransientBanner?.message, reviewUpdatedOnAnotherDeviceBannerMessage)
        XCTAssertEqual(context.store.currentTransientBanner?.kind, .reviewUpdatedOnAnotherDevice)
        XCTAssertGreaterThan(context.store.localReadVersion, initialReadVersion)
        XCTAssertFalse(context.store.isReviewHeadLoading)
    }

    func testFinishCloudLinkAndParallelSyncCloudIfLinkedShareSingleInitialSyncTask() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: true
        )
        let linkedSession = FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: "remote-workspace")

        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        let finishTask = Task { @MainActor in
            try await context.store.finishCloudLink(linkedSession: linkedSession)
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 5_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.cloudSyncService.runLinkedSyncCallCount == 1
        }

        let syncTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }

        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)

        context.cloudSyncService.resumeRunLinkedSync()
        try await finishTask.value
        await syncTask.value

        let bootstrapSnapshot = try testBootstrapSnapshot(database: context.database)
        XCTAssertEqual(bootstrapSnapshot.workspace.workspaceId, linkedSession.workspaceId)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, linkedSession.workspaceId)
        XCTAssertEqual(context.store.globalErrorMessage, "")
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
    }

    func testParallelSyncCloudIfLinkedCallsCoalesceIntoSingleRestoreFlow() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: true
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        let firstTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }
        let secondTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.cloudSyncService.runLinkedSyncCallCount == 1
        }

        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)

        context.cloudSyncService.resumeRunLinkedSync()
        await firstTask.value
        await secondTask.value

        XCTAssertEqual(context.store.cloudSettings?.cloudState, .linked)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, workspaceId)
        XCTAssertEqual(context.store.globalErrorMessage, "")
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
    }

    func testFailedInitialSyncClearsInFlightLinkTaskAndAllowsRetry() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [
                .fail(message: "Mock sync failure"),
                .succeed,
            ],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.store.globalErrorMessage, "Mock sync failure")
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
        XCTAssertEqual(context.store.globalErrorMessage, "")
        XCTAssertNotNil(context.store.lastSuccessfulCloudSyncAt)
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
    }

    func testSwitchLinkedWorkspaceUsesCachedWorkspaceWithoutRelinkingLocalRows() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let originalWorkspaceId = try testWorkspaceId(database: context.database)
        let originalCard = try context.database.saveCard(
            workspaceId: originalWorkspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Original", backText: "Back", tags: []),
            cardId: nil
        )
        let cachedWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-second",
            name: "Second",
            createdAt: "2026-03-18T09:00:00.000Z",
            isSelected: true
        )
        try self.insertWorkspace(
            database: context.database,
            workspaceId: cachedWorkspace.workspaceId,
            name: cachedWorkspace.name,
            createdAt: cachedWorkspace.createdAt,
            settings: try testSchedulerSettings(database: context.database)
        )
        let cachedCard = try context.database.saveCard(
            workspaceId: cachedWorkspace.workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Cached", backText: "Back", tags: []),
            cardId: nil
        )

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: originalWorkspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: originalWorkspaceId)
        )
        context.cloudSyncService.selectedWorkspacesById[cachedWorkspace.workspaceId] = cachedWorkspace

        try await context.store.switchLinkedWorkspace(selection: .existing(workspaceId: cachedWorkspace.workspaceId))

        XCTAssertEqual(context.store.workspace?.workspaceId, cachedWorkspace.workspaceId)
        XCTAssertEqual(context.store.cloudSettings?.activeWorkspaceId, cachedWorkspace.workspaceId)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncSessions.last?.workspaceId, cachedWorkspace.workspaceId)
        XCTAssertEqual(try context.database.loadActiveCards(workspaceId: originalWorkspaceId).map(\.cardId), [originalCard.cardId])
        XCTAssertEqual(try context.database.loadActiveCards(workspaceId: cachedWorkspace.workspaceId).map(\.cardId), [cachedCard.cardId])
    }

    func testCancelForAccountDeletionClearsActiveCloudLinkTask() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: true
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        let syncTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.cloudSyncService.runLinkedSyncCallCount == 1
        }

        context.store.cloudRuntime.cancelForAccountDeletion()
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
        XCTAssertNil(context.store.cloudRuntime.activeCloudSession())

        context.cloudSyncService.resumeRunLinkedSync()
        await syncTask.value

        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
        XCTAssertNil(context.store.cloudRuntime.activeCloudSession())
    }

    private func insertWorkspace(
        database: LocalDatabase,
        workspaceId: String,
        name: String,
        createdAt: String,
        settings: WorkspaceSchedulerSettings
    ) throws {
        try database.core.execute(
            sql: """
            INSERT INTO workspaces (
                workspace_id,
                name,
                created_at,
                fsrs_algorithm,
                fsrs_desired_retention,
                fsrs_learning_steps_minutes_json,
                fsrs_relearning_steps_minutes_json,
                fsrs_maximum_interval_days,
                fsrs_enable_fuzz,
                fsrs_client_updated_at,
                fsrs_last_modified_by_device_id,
                fsrs_last_operation_id,
                fsrs_updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values: [
                .text(workspaceId),
                .text(name),
                .text(createdAt),
                .text(settings.algorithm),
                .real(settings.desiredRetention),
                .text(try database.workspaceSettingsStore.encodeIntegerArray(values: settings.learningStepsMinutes)),
                .text(try database.workspaceSettingsStore.encodeIntegerArray(values: settings.relearningStepsMinutes)),
                .integer(Int64(settings.maximumIntervalDays)),
                .integer(settings.enableFuzz ? 1 : 0),
                .text(settings.clientUpdatedAt),
                .text(settings.lastModifiedByDeviceId),
                .text(settings.lastOperationId),
                .text(settings.updatedAt)
            ]
        )
    }
}
