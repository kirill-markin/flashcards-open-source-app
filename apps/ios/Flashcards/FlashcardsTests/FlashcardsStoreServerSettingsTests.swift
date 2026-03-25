import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreServerSettingsTests: XCTestCase {
    func testRenameCurrentWorkspacePersistsReturnedCloudNameLocally() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.store.cloudRuntime.setActiveCloudSession(linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: workspaceId))
        context.cloudSyncService.renamedWorkspacesById[workspaceId] = CloudWorkspaceSummary(
            workspaceId: workspaceId,
            name: "Renamed workspace",
            createdAt: "2026-03-10T09:00:00.000Z",
            isSelected: true
        )

        try await context.store.renameCurrentWorkspace(name: "Renamed workspace")

        XCTAssertEqual(context.store.workspace?.name, "Renamed workspace")
        XCTAssertEqual(try context.database.loadBootstrapSnapshot().workspace.name, "Renamed workspace")
    }

    func testDeleteCurrentWorkspaceSwitchesToReplacementWorkspaceAndClearsLocalData() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        context.store.cloudRuntime.setActiveCloudSession(linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: workspaceId))
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        let oldOutboxEntries = try context.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertFalse(oldOutboxEntries.isEmpty)

        let replacementWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-replacement",
            name: "Replacement workspace",
            createdAt: "2026-03-16T10:00:00.000Z",
            isSelected: true
        )
        context.cloudSyncService.deletedWorkspaceResultsById[workspaceId] = CloudWorkspaceDeleteResult(
            ok: true,
            deletedWorkspaceId: workspaceId,
            deletedCardsCount: 1,
            workspace: replacementWorkspace
        )

        try await context.store.deleteCurrentWorkspace(confirmationText: "delete workspace")

        XCTAssertEqual(context.store.workspace?.workspaceId, replacementWorkspace.workspaceId)
        XCTAssertEqual(context.store.workspace?.name, replacementWorkspace.name)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, replacementWorkspace.workspaceId)
        XCTAssertEqual(try context.database.loadActiveCards(workspaceId: replacementWorkspace.workspaceId).count, 0)
        XCTAssertEqual(try context.database.loadOutboxEntries(workspaceId: replacementWorkspace.workspaceId, limit: 100).count, 0)
        XCTAssertEqual(try context.database.loadLastAppliedHotChangeId(workspaceId: replacementWorkspace.workspaceId), 0)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncSessions.last?.workspaceId, replacementWorkspace.workspaceId)
    }

    func testDisconnectCloudAccountResetsLocalStateAndRegeneratesDeviceId() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)
        let originalCloudSettings = try testCloudSettings(database: context.database)
        let aiChatHistoryStore = AIChatHistoryStore(
            userDefaults: context.store.userDefaults,
            encoder: context.store.encoder,
            decoder: context.store.decoder,
            workspaceId: context.store.workspace?.workspaceId
        )

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["grammar"]),
            cardId: nil
        )
        try context.database.setLastAppliedHotChangeId(workspaceId: workspaceId, changeId: 42)
        context.store.selectedReviewFilter = .tag(tag: "grammar")
        await aiChatHistoryStore.saveState(
            state: AIChatPersistedState(
                messages: [
                    AIChatMessage(
                        id: "message-1",
                        role: .user,
                        text: "history",
                        toolCalls: [],
                        timestamp: "2026-03-10T09:00:00.000Z",
                        isError: false
                    )
                ],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig
            )
        )
        try context.store.reload()

        try context.store.logoutCloudAccount()

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            aiChatHistoryStore.loadState().messages.isEmpty
        }

        let resetCloudSettings = try testCloudSettings(database: context.database)
        let currentWorkspaceId = try XCTUnwrap(context.store.workspace?.workspaceId)
        let resetAIChatHistory = aiChatHistoryStore.loadState()
        XCTAssertEqual(resetCloudSettings.cloudState, .disconnected)
        XCTAssertNil(resetCloudSettings.linkedUserId)
        XCTAssertNotEqual(resetCloudSettings.deviceId, originalCloudSettings.deviceId)
        XCTAssertTrue(try context.database.loadOutboxEntries(workspaceId: currentWorkspaceId, limit: 100).isEmpty)
        XCTAssertEqual(try context.database.loadLastAppliedHotChangeId(workspaceId: currentWorkspaceId), 0)
        XCTAssertEqual(try context.database.loadLastAppliedReviewSequenceId(workspaceId: currentWorkspaceId), 0)
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertEqual(context.store.selectedReviewFilter, .allCards)
        XCTAssertTrue(resetAIChatHistory.messages.isEmpty)
    }

    func testValidateCustomCloudServerDoesNotPersistOverrideWhenValidationFails() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let validator = FlashcardsStoreTestSupport.MockCloudServiceConfigurationValidator()
        validator.nextValidationError = CloudServiceConfigurationValidationError.invalidStatusCode(
            "Auth service",
            "https://auth.self-hosted.example.com/health",
            503
        )
        context.store.cloudServiceConfigurationValidator = validator

        do {
            _ = try await context.store.validateCustomCloudServer(customOrigin: "https://self-hosted.example.com")
            XCTFail("Expected validation to fail")
        } catch {
            XCTAssertEqual(
                Flashcards.errorMessage(error: error),
                "Auth service health check returned status 503 for https://auth.self-hosted.example.com/health"
            )
        }

        XCTAssertNil(
            try loadCloudServerOverride(
                userDefaults: context.store.userDefaults,
                decoder: context.store.decoder
            )
        )
    }

    func testApplyCustomCloudServerClearsCloudLinkAndPendingSyncState() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)
        let validator = FlashcardsStoreTestSupport.MockCloudServiceConfigurationValidator()
        context.store.cloudServiceConfigurationValidator = validator

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        try context.guestCredentialStore.saveGuestSession(
            session: FlashcardsStoreTestSupport.makeStoredGuestCloudSession(
                userId: "guest-user-1",
                workspaceId: "guest-workspace-1",
                guestToken: "guest-token-1"
            )
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.database.setLastAppliedHotChangeId(workspaceId: workspaceId, changeId: 42)
        try context.store.reload()

        let configuration = try await context.store.validateCustomCloudServer(customOrigin: "https://self-hosted.example.com")
        try context.store.applyCustomCloudServer(configuration: configuration)

        let cloudSettings = try testCloudSettings(database: context.database)
        let outboxEntries = try context.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)

        XCTAssertEqual(validator.validatedConfigurations, [configuration])
        XCTAssertEqual(cloudSettings.cloudState, .disconnected)
        XCTAssertNil(cloudSettings.linkedUserId)
        XCTAssertTrue(outboxEntries.isEmpty)
        XCTAssertEqual(try context.database.loadLastAppliedHotChangeId(workspaceId: workspaceId), 0)
        XCTAssertEqual(try context.database.loadLastAppliedReviewSequenceId(workspaceId: workspaceId), 0)
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertNil(try context.guestCredentialStore.loadGuestSession())
        XCTAssertEqual(
            try loadCloudServerOverride(
                userDefaults: context.store.userDefaults,
                decoder: context.store.decoder
            ),
            CloudServerOverride(customOrigin: "https://self-hosted.example.com")
        )
        XCTAssertTrue(context.store.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey))
        XCTAssertEqual(try context.store.currentCloudServiceConfiguration().mode, .custom)
    }

    func testResetToOfficialCloudServerClearsOverrideAndDisconnects() throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        try context.guestCredentialStore.saveGuestSession(
            session: FlashcardsStoreTestSupport.makeStoredGuestCloudSession(
                userId: "guest-user-2",
                workspaceId: "guest-workspace-2",
                guestToken: "guest-token-2"
            )
        )
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://self-hosted.example.com"),
            userDefaults: context.store.userDefaults,
            encoder: context.store.encoder
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.store.reload()

        try context.store.resetToOfficialCloudServer()

        let cloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(cloudSettings.cloudState, .disconnected)
        XCTAssertNil(try loadCloudServerOverride(userDefaults: context.store.userDefaults, decoder: context.store.decoder))
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertNil(try context.guestCredentialStore.loadGuestSession())
        XCTAssertFalse(context.store.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey))
    }

    func testCompleteCloudLinkBootstrapsLocalDataAfterCustomServerSwitch() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.store.reload()
        try context.store.applyCustomCloudServer(
            configuration: try makeCustomCloudServiceConfiguration(customOrigin: "https://self-hosted.example.com")
        )

        let createdWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-new",
            name: "Personal",
            createdAt: "2026-03-14T10:00:00.000Z",
            isSelected: true
        )
        context.cloudSyncService.createWorkspaceResult = createdWorkspace
        context.cloudSyncService.workspaceBootstrapEmptinessById[createdWorkspace.workspaceId] = true

        try await context.store.completeCloudLink(
            linkContext: self.makeLinkContext(workspaces: []),
            selection: .createNew
        )

        XCTAssertEqual(context.store.cloudSettings?.cloudState, .linked)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, createdWorkspace.workspaceId)
        XCTAssertTrue(try context.database.loadOutboxEntries(workspaceId: createdWorkspace.workspaceId, limit: 100).isEmpty)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(context.store.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey))
    }

    func testCompleteCloudLinkBlocksBootstrapIntoNonEmptyWorkspaceAfterCustomServerSwitch() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: []),
            cardId: nil
        )
        try context.store.reload()
        try context.store.applyCustomCloudServer(
            configuration: try makeCustomCloudServiceConfiguration(customOrigin: "https://self-hosted.example.com")
        )

        let existingWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-existing",
            name: "Imported",
            createdAt: "2026-03-14T11:00:00.000Z",
            isSelected: false
        )
        context.cloudSyncService.selectedWorkspacesById[existingWorkspace.workspaceId] = existingWorkspace
        context.cloudSyncService.workspaceBootstrapEmptinessById[existingWorkspace.workspaceId] = false

        do {
            try await context.store.completeCloudLink(
                linkContext: self.makeLinkContext(workspaces: [existingWorkspace]),
                selection: .existing(workspaceId: existingWorkspace.workspaceId)
            )
            XCTFail("Expected bootstrap protection to block the link")
        } catch {
            XCTAssertEqual(
                Flashcards.errorMessage(error: error),
                "Choose a new or empty workspace on this server before uploading the current local data."
            )
        }

        let disconnectedCloudSettings = try testCloudSettings(database: context.database)
        let originalOutbox = try context.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(disconnectedCloudSettings.cloudState, .disconnected)
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertTrue(originalOutbox.isEmpty)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertTrue(context.store.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey))
    }

    func testCompleteCloudLinkAfterDisconnectUsesFreshDeviceIdForTheSameUser() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(database: context.database, workspaceId: workspaceId)
        try context.store.reload()
        let originalDeviceId = try testCloudSettings(database: context.database).deviceId

        try context.store.logoutCloudAccount()

        let existingWorkspace = CloudWorkspaceSummary(
            workspaceId: workspaceId,
            name: "Personal",
            createdAt: "2026-03-14T11:00:00.000Z",
            isSelected: true
        )
        context.cloudSyncService.selectedWorkspacesById[existingWorkspace.workspaceId] = existingWorkspace

        try await context.store.completeCloudLink(
            linkContext: self.makeLinkContext(workspaces: [existingWorkspace]),
            selection: .existing(workspaceId: existingWorkspace.workspaceId)
        )

        let relinkedCloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(relinkedCloudSettings.cloudState, .linked)
        XCTAssertEqual(relinkedCloudSettings.linkedUserId, "user-1")
        XCTAssertEqual(relinkedCloudSettings.linkedWorkspaceId, workspaceId)
        XCTAssertNotEqual(relinkedCloudSettings.deviceId, originalDeviceId)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
    }

    private func makeLinkContext(workspaces: [CloudWorkspaceSummary]) -> CloudWorkspaceLinkContext {
        CloudWorkspaceLinkContext(
            userId: "user-1",
            email: "user@example.com",
            apiBaseUrl: "https://api.self-hosted.example.com/v1",
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2030-01-01T00:00:00.000Z"
            ),
            workspaces: workspaces,
            guestUpgradeMode: nil
        )
    }
}
