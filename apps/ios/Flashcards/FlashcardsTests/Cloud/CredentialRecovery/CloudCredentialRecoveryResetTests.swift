import Foundation
import XCTest
@testable import Flashcards

final class CloudCredentialRecoveryResetTests: CloudCredentialRecoveryTestCase {
    @MainActor
    func testEraseLocalDataForCredentialRecoveryClearsLocalStateAndStartsFresh() throws {
        let suiteName: String = "recovery-erase-local-reset-\(UUID().uuidString)"
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
        let initialCloudSettings: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        _ = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: "guest-user",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: workspace.workspaceId,
            linkedEmail: nil
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
        try credentialStore.saveCredentials(credentials: credentials)
        let guestSession: StoredGuestCloudSession = self.guestSessionFixture(
            token: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configuration: configuration
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        let pendingState: PendingGuestUpgradeState = pendingGuestUpgradeInFlightState(
            linkContext: CloudWorkspaceLinkContext(
                userId: "linked-user",
                email: "user@example.com",
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials,
                workspaces: [],
                guestUpgradeMode: .mergeRequired,
                postAuthRecoveryRoute: .none
            ),
            configuration: configuration,
            guestSession: guestSession,
            selection: .createNew,
            supportsDroppedEntities: true
        )
        userDefaults.set(try encoder.encode(pendingState), forKey: pendingGuestUpgradeUserDefaultsKey)
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
            reason: .guestSessionMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).isEmpty == false)
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertEqual([workspace.workspaceId], try self.loadWorkspaceIds(database: database))
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertNotNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNotNil(try credentialStore.loadCredentials())
        XCTAssertEqual(guestSession, try guestCredentialStore.loadGuestSession())
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))

        try store.eraseLocalDataForCredentialRecovery()

        let cloudSettingsAfterErase: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspaceAfterErase: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertFalse(try self.loadWorkspaceIds(database: database).contains(workspace.workspaceId))
        XCTAssertEqual([workspaceAfterErase.workspaceId], try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).isEmpty)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspaceAfterErase.workspaceId).isEmpty)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertEqual(.idle, store.syncStatus)
        XCTAssertEqual(.disconnected, cloudSettingsAfterErase.cloudState)
        XCTAssertNil(cloudSettingsAfterErase.linkedUserId)
        XCTAssertNil(cloudSettingsAfterErase.linkedWorkspaceId)
        XCTAssertNil(cloudSettingsAfterErase.linkedEmail)
        XCTAssertEqual(Optional(workspaceAfterErase.workspaceId), cloudSettingsAfterErase.activeWorkspaceId)
        XCTAssertNotEqual(workspace.workspaceId, workspaceAfterErase.workspaceId)
        XCTAssertNotEqual(initialCloudSettings.installationId, cloudSettingsAfterErase.installationId)
    }

    @MainActor
    func testEraseLocalDataForCredentialRecoveryRequiresActiveRecovery() throws {
        let suiteName: String = "recovery-erase-local-requires-active-\(UUID().uuidString)"
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
        let initialCloudSettings: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        _ = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: "guest-user",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: workspace.workspaceId,
            linkedEmail: nil
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
        try credentialStore.saveCredentials(credentials: credentials)
        let guestSession: StoredGuestCloudSession = self.guestSessionFixture(
            token: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configuration: configuration
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        let pendingState: PendingGuestUpgradeState = pendingGuestUpgradeInFlightState(
            linkContext: CloudWorkspaceLinkContext(
                userId: "linked-user",
                email: "user@example.com",
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials,
                workspaces: [],
                guestUpgradeMode: .mergeRequired,
                postAuthRecoveryRoute: .none
            ),
            configuration: configuration,
            guestSession: guestSession,
            selection: .createNew,
            supportsDroppedEntities: true
        )
        userDefaults.set(try encoder.encode(pendingState), forKey: pendingGuestUpgradeUserDefaultsKey)
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
            try store.eraseLocalDataForCredentialRecovery()
            XCTFail("Expected erase to require active cloud credential recovery.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual("Cloud credential recovery is not active.", message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        let cloudSettingsAfterFailedErase: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).isEmpty == false)
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertEqual([workspace.workspaceId], try self.loadWorkspaceIds(database: database))
        XCTAssertEqual(credentials, try credentialStore.loadCredentials())
        XCTAssertEqual(guestSession, try guestCredentialStore.loadGuestSession())
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
        XCTAssertEqual(.guest, cloudSettingsAfterFailedErase.cloudState)
        XCTAssertEqual(Optional("guest-user"), cloudSettingsAfterFailedErase.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettingsAfterFailedErase.linkedWorkspaceId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettingsAfterFailedErase.activeWorkspaceId)
        XCTAssertEqual(initialCloudSettings.installationId, cloudSettingsAfterFailedErase.installationId)
    }

    @MainActor
    func testExplicitLogoutStillPerformsFullResetAndClearsRecovery() throws {
        let suiteName: String = "recovery-logout-reset-\(UUID().uuidString)"
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
        _ = try self.saveRecoveryTestCard(database: database, workspaceId: workspace.workspaceId)
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
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
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            )
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

        try store.logoutCloudAccount()

        let cloudSettingsAfterLogout: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspaceAfterLogout: Workspace = try database.workspaceSettingsStore.loadWorkspace()
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspaceAfterLogout.workspaceId).isEmpty)
        XCTAssertEqual(.disconnected, cloudSettingsAfterLogout.cloudState)
        XCTAssertNil(cloudSettingsAfterLogout.linkedUserId)
        XCTAssertNil(cloudSettingsAfterLogout.linkedWorkspaceId)
        XCTAssertEqual(Optional(workspaceAfterLogout.workspaceId), cloudSettingsAfterLogout.activeWorkspaceId)
        XCTAssertEqual(.idle, store.syncStatus)
    }
}
