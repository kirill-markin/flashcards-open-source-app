import Foundation
import XCTest
@testable import Flashcards

final class CloudLinkedCredentialRecoveryTests: CloudCredentialRecoveryTestCase {
    @MainActor
    func testLinkedMissingCredentialsPreservesLocalDataAndPersistsRecovery() async throws {
        let suiteName: String = "linked-credential-recovery-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard: Card = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
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
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
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

        await store.syncCloudIfLinked(trigger: self.makeRecoverySyncTrigger())

        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        let cloudSettings: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        XCTAssertEqual(.linked, cloudSettings.cloudState)
        XCTAssertEqual(Optional("linked-user"), cloudSettings.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettings.activeWorkspaceId)

        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.linkedCredentialsMissing, recoveryState.reason)
        XCTAssertEqual(.linked, recoveryState.previousCloudState)
        XCTAssertEqual(Optional("linked-user"), recoveryState.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), recoveryState.activeWorkspaceId)
        XCTAssertEqual(Optional("user@example.com"), recoveryState.linkedEmail)
        XCTAssertEqual(.custom, recoveryState.configurationMode)
        XCTAssertEqual("https://api.example.test/v1", recoveryState.apiBaseUrl)
        XCTAssertEqual(recoveryState, try self.loadPersistedRecoveryState(userDefaults: userDefaults, decoder: decoder))
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testDirectAuthenticatedSessionMarksRecoveryWhenLinkedCredentialsMissing() async throws {
        let suiteName: String = "direct-auth-credential-recovery-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
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
        let store: FlashcardsStore = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            cloudSyncService: GuestUpgradeDrainCloudSyncService()
        )
        defer {
            store.shutdownForTests()
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        do {
            _ = try await store.cloudSessionForAI()
            XCTFail("Expected missing linked credentials to block cloud session creation.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedCredentialsMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.linkedCredentialsMissing, recoveryState.reason)
        XCTAssertEqual(recoveryState, try self.loadPersistedRecoveryState(userDefaults: userDefaults, decoder: decoder))
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testLinkedRecoveryRejectsDifferentAccountWithoutResettingLocalData() async throws {
        let suiteName: String = "linked-recovery-wrong-account-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard: Card = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "different-user",
                email: "other@example.com",
                workspaces: [
                    CloudWorkspaceSummary(
                        workspaceId: "different-workspace",
                        name: "Other",
                        createdAt: "2026-04-01T00:00:00.000Z",
                        isSelected: true
                    )
                ]
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        do {
            _ = try await store.prepareCloudLink(
                verifiedContext: CloudVerifiedAuthContext(
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials
                )
            )
            XCTFail("Expected different linked account to be rejected during recovery.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryWrongLinkedAccountMessage(), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        let cloudSettingsAfterRejectedLink: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        XCTAssertEqual(.linked, cloudSettingsAfterRejectedLink.cloudState)
        XCTAssertEqual(Optional("linked-user"), cloudSettingsAfterRejectedLink.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettingsAfterRejectedLink.activeWorkspaceId)
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.linkedCredentialsMissing, recoveryState.reason)
        XCTAssertEqual(Optional("linked-user"), recoveryState.linkedUserId)
        XCTAssertEqual(recoveryState, try self.loadPersistedRecoveryState(userDefaults: userDefaults, decoder: decoder))
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testLinkedRecoveryRestoresSameAccountAndWorkspace() async throws {
        let suiteName: String = "linked-recovery-same-account-workspace-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard: Card = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
        let expectedWorkspace: CloudWorkspaceSummary = CloudWorkspaceSummary(
            workspaceId: workspace.workspaceId,
            name: workspace.name,
            createdAt: workspace.createdAt,
            isSelected: true
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "linked-user",
                email: "user@example.com",
                workspaces: [expectedWorkspace]
            )
        }
        cloudSyncService.selectWorkspaceHandler = { apiBaseUrl, bearerToken, workspaceId in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            XCTAssertEqual(expectedWorkspace.workspaceId, workspaceId)
            return expectedWorkspace
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        let linkContext: CloudWorkspaceLinkContext = try await store.prepareCloudLink(
            verifiedContext: CloudVerifiedAuthContext(
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials
            )
        )
        XCTAssertNil(linkContext.guestUpgradeMode)
        XCTAssertEqual(.linkedCredentialRestore, linkContext.postAuthRecoveryRoute)
        XCTAssertEqual([expectedWorkspace], linkContext.workspaces)
        XCTAssertEqual(
            .autoLink(.existing(workspaceId: expectedWorkspace.workspaceId)),
            makeCloudWorkspacePostAuthRoute(linkContext: linkContext)
        )

        try await store.completeCloudLink(
            linkContext: linkContext,
            selection: .existing(workspaceId: expectedWorkspace.workspaceId)
        )

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(1, cloudSyncService.selectWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertEqual(credentials, try credentialStore.loadCredentials())
        let cloudSettingsAfterLink: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        XCTAssertEqual(.linked, cloudSettingsAfterLink.cloudState)
        XCTAssertEqual(Optional("linked-user"), cloudSettingsAfterLink.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettingsAfterLink.linkedWorkspaceId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettingsAfterLink.activeWorkspaceId)
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
    }

    @MainActor
    func testLinkedRecoveryRejectsMissingExpectedWorkspaceBeforeWorkspaceSideEffects() async throws {
        let suiteName: String = "linked-recovery-missing-workspace-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard: Card = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "linked-user",
                email: "user@example.com",
                workspaces: [
                    CloudWorkspaceSummary(
                        workspaceId: "different-workspace",
                        name: "Other",
                        createdAt: "2026-04-01T00:00:00.000Z",
                        isSelected: true
                    )
                ]
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        do {
            _ = try await store.prepareCloudLink(
                verifiedContext: CloudVerifiedAuthContext(
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials
                )
            )
            XCTFail("Expected missing linked workspace to be rejected during recovery.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage(), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, cloudSyncService.selectWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertNotNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
    }

    @MainActor
    func testLinkedRecoveryRejectsCreateNewWorkspaceBeforeSelectionSideEffect() async throws {
        let suiteName: String = "linked-recovery-wrong-workspace-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard: Card = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )
        let linkContext = CloudWorkspaceLinkContext(
            userId: "linked-user",
            email: "user@example.com",
            apiBaseUrl: configuration.apiBaseUrl,
            credentials: credentials,
            workspaces: [
                CloudWorkspaceSummary(
                    workspaceId: "different-workspace",
                    name: "Other",
                    createdAt: "2026-04-01T00:00:00.000Z",
                    isSelected: true
                )
            ],
            guestUpgradeMode: nil,
            postAuthRecoveryRoute: .linkedCredentialRestore
        )

        do {
            try await store.completeCloudLink(
                linkContext: linkContext,
                selection: .createNew
            )
            XCTFail("Expected new linked workspace to be rejected during recovery.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage(), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, cloudSyncService.selectWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertNotNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testLinkedRecoveryUsesEmailFallbackAndFailsClosedForWrongServer() throws {
        let suiteName: String = "linked-recovery-email-fallback-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: nil,
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let store: FlashcardsStore = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            cloudSyncService: GuestUpgradeDrainCloudSyncService()
        )
        defer {
            store.shutdownForTests()
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        XCTAssertNoThrow(try store.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
            userId: "new-linked-user-id",
            email: "USER@example.com",
            apiBaseUrl: configuration.apiBaseUrl
        ))
        XCTAssertThrowsError(try store.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
            userId: "new-linked-user-id",
            email: "other@example.com",
            apiBaseUrl: configuration.apiBaseUrl
        )) { error in
            guard let localStoreError = error as? LocalStoreError,
                case .validation(let message) = localStoreError else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryWrongLinkedAccountMessage(), message)
        }
        XCTAssertThrowsError(try store.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
            userId: "new-linked-user-id",
            email: "user@example.com",
            apiBaseUrl: "https://api.other.test/v1"
        )) { error in
            guard let localStoreError = error as? LocalStoreError,
                case .validation(let message) = localStoreError else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryWrongLinkedAccountMessage(), message)
        }
    }

    @MainActor
    func testActiveRecoveryBlocksDirectCredentialUseAndLinkedSync() async throws {
        let suiteName: String = "active-recovery-blocks-direct-paths-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
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
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            )
        )
        let guestCredentialStore: GuestCloudCredentialStore = self.makeGuestCredentialStore(
            suiteName: suiteName,
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder
        )
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        do {
            let _: String = try await store.withStoredAuthenticatedCredentials { _, _ in
                XCTFail("Expected active recovery to block credential use.")
                return "unexpected"
            }
            XCTFail("Expected active recovery to throw before returning credentials.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedCredentialsMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        do {
            _ = try await store.runLinkedSync(
                linkedSession: CloudLinkedSession(
                    userId: "linked-user",
                    workspaceId: workspace.workspaceId,
                    email: "user@example.com",
                    configurationMode: configuration.mode,
                    apiBaseUrl: configuration.apiBaseUrl,
                    authorization: .bearer("id-token")
                )
            )
            XCTFail("Expected active recovery to block linked sync.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedCredentialsMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )
    }
}
