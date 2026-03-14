import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreServerSettingsTests: XCTestCase {
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
                localizedMessage(error: error),
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
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        try context.database.setLastAppliedChangeId(workspaceId: workspaceId, changeId: 42)
        try context.store.reload()

        let configuration = try await context.store.validateCustomCloudServer(customOrigin: "https://self-hosted.example.com")
        try context.store.applyCustomCloudServer(configuration: configuration)

        let cloudSettings = try testCloudSettings(database: context.database)
        let outboxEntries = try context.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)

        XCTAssertEqual(validator.validatedConfigurations, [configuration])
        XCTAssertEqual(cloudSettings.cloudState, .disconnected)
        XCTAssertNil(cloudSettings.linkedUserId)
        XCTAssertTrue(outboxEntries.isEmpty)
        XCTAssertEqual(try context.database.loadLastAppliedChangeId(workspaceId: workspaceId), 0)
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertEqual(
            try loadCloudServerOverride(
                userDefaults: context.store.userDefaults,
                decoder: context.store.decoder
            ),
            CloudServerOverride(customOrigin: "https://self-hosted.example.com")
        )
        XCTAssertFalse(context.store.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey))
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
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://self-hosted.example.com"),
            userDefaults: context.store.userDefaults,
            encoder: context.store.encoder
        )
        _ = try context.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        try context.store.reload()

        try context.store.resetToOfficialCloudServer()

        let cloudSettings = try testCloudSettings(database: context.database)
        XCTAssertEqual(cloudSettings.cloudState, .disconnected)
        XCTAssertNil(try loadCloudServerOverride(userDefaults: context.store.userDefaults, decoder: context.store.decoder))
        XCTAssertNil(try context.store.cloudRuntime.loadCredentials())
        XCTAssertTrue(context.store.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey))
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
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
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

        let outboxEntries = try context.database.loadOutboxEntries(workspaceId: createdWorkspace.workspaceId, limit: 100)
        XCTAssertEqual(context.store.cloudSettings?.cloudState, .linked)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, createdWorkspace.workspaceId)
        XCTAssertFalse(outboxEntries.isEmpty)
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
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
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
                localizedMessage(error: error),
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
            workspaces: workspaces
        )
    }
}
