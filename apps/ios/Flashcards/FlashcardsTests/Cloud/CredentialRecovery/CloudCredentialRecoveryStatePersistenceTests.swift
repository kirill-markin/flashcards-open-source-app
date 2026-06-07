import Foundation
import XCTest
@testable import Flashcards

final class CloudCredentialRecoveryStatePersistenceTests: CloudCredentialRecoveryTestCase {
    @MainActor
    func testPersistedRecoveryStateLoadsBlockedStatusOnStoreInitialization() throws {
        let suiteName: String = "recovery-relaunch-\(UUID().uuidString)"
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
        var initialStore: FlashcardsStore? = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            cloudSyncService: GuestUpgradeDrainCloudSyncService()
        )
        var relaunchedStore: FlashcardsStore?
        defer {
            initialStore?.shutdownForTests()
            relaunchedStore?.shutdownForTests()
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )
        let loadedInitialStore: FlashcardsStore = try XCTUnwrap(initialStore)
        let cloudSettings: CloudSettings = try XCTUnwrap(loadedInitialStore.cloudSettings)
        try loadedInitialStore.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )
        loadedInitialStore.shutdownForTests()
        initialStore = nil

        relaunchedStore = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            cloudSyncService: GuestUpgradeDrainCloudSyncService()
        )

        let loadedRelaunchedStore: FlashcardsStore = try XCTUnwrap(relaunchedStore)
        let persistedRecoveryState: CloudCredentialRecoveryState = try self.loadPersistedRecoveryState(
            userDefaults: userDefaults,
            decoder: decoder
        )
        XCTAssertEqual(persistedRecoveryState, loadedRelaunchedStore.cloudCredentialRecoveryState)
        XCTAssertBlockedSyncStatus(
            loadedRelaunchedStore.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testCorruptPersistedRecoveryStateLoadsBlockedWithoutDeletingPayload() throws {
        let suiteName: String = "recovery-corrupt-payload-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        let corruptPayload: Data = Data(#"{"reason":"linked_credentials_missing","apiBaseUrl":42}"#.utf8)
        userDefaults.set(corruptPayload, forKey: cloudCredentialRecoveryStateUserDefaultsKey)
        let database: LocalDatabase = try self.makeDatabase()
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

        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.invalidStoredState, recoveryState.reason)
        XCTAssertEqual(
            corruptPayload,
            try XCTUnwrap(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        )
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .invalidStoredState,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testRecoveryStateWithUnexpectedSecretKeyLoadsBlockedWithoutDeletingPayload() throws {
        let suiteName: String = "recovery-extra-key-payload-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        let payload: Data = Data(
            """
            {
              "reason": "linked_credentials_missing",
              "previousCloudState": "linked",
              "installationId": "installation",
              "linkedUserId": "linked-user",
              "linkedWorkspaceId": "workspace",
              "activeWorkspaceId": "workspace",
              "linkedEmail": "user@example.com",
              "configurationMode": "custom",
              "apiBaseUrl": "https://api.example.test/v1",
              "detectedAt": "2026-04-01T00:00:00.000Z",
              "refreshToken": "secret-refresh-token"
            }
            """.utf8
        )
        userDefaults.set(payload, forKey: cloudCredentialRecoveryStateUserDefaultsKey)
        let database: LocalDatabase = try self.makeDatabase()
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

        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.invalidStoredState, recoveryState.reason)
        XCTAssertEqual(payload, try XCTUnwrap(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey)))
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .invalidStoredState,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testInvalidStoredRecoveryBlocksPrepareCloudLinkBeforeIdentitySideEffects() async throws {
        let suiteName: String = "recovery-invalid-blocks-prepare-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let corruptPayload: Data = Data(#"{"reason":"linked_credentials_missing","apiBaseUrl":42}"#.utf8)
        userDefaults.set(corruptPayload, forKey: cloudCredentialRecoveryStateUserDefaultsKey)
        let database: LocalDatabase = try self.makeDatabase()
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
        cloudSyncService.fetchCloudAccountHandler = { _, _ in
            XCTFail("Invalid recovery must block before account fetch.")
            return CloudAccountSnapshot(userId: "unexpected", email: nil, workspaces: [])
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
        let configuration: CloudServiceConfiguration = try makeCustomCloudServiceConfiguration(
            customOrigin: "https://example.test"
        )

        do {
            _ = try await store.prepareCloudLink(
                verifiedContext: CloudVerifiedAuthContext(
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: StoredCloudCredentials(
                        refreshToken: "refresh-token",
                        idToken: "id-token",
                        idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
                    )
                )
            )
            XCTFail("Expected invalid recovery to block account link preparation.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .invalidStoredState), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertEqual(
            corruptPayload,
            try XCTUnwrap(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        )
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .invalidStoredState,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testInvalidStoredRecoveryBlocksPendingGuestUpgradeReplayBeforeSideEffects() async throws {
        let suiteName: String = "recovery-invalid-blocks-pending-upgrade-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://example.test"),
            userDefaults: userDefaults,
            encoder: encoder
        )
        let corruptPayload: Data = Data(#"{"reason":"guest_session_missing","apiBaseUrl":42}"#.utf8)
        userDefaults.set(corruptPayload, forKey: cloudCredentialRecoveryStateUserDefaultsKey)
        let database: LocalDatabase = try self.makeDatabase()
        let workspace: Workspace = try database.workspaceSettingsStore.loadWorkspace()
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
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        let pendingState: PendingGuestUpgradeState = pendingGuestUpgradeInFlightState(
            linkContext: CloudWorkspaceLinkContext(
                userId: "linked-user",
                email: "user@example.com",
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials,
                workspaces: [],
                preferences: makeDefaultAccountPreferences(),
                guestUpgradeMode: .mergeRequired,
                postAuthRecoveryRoute: .none
            ),
            configuration: configuration,
            guestSession: guestSession,
            selection: .createNew,
            supportsDroppedEntities: true
        )
        userDefaults.set(try encoder.encode(pendingState), forKey: pendingGuestUpgradeUserDefaultsKey)
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { _ in
            throw LocalStoreError.database("Pending guest upgrade replay should not run while recovery is invalid.")
        }
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        let store: FlashcardsStore = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: guestCloudAuthService,
            cloudSyncService: cloudSyncService
        )
        defer {
            store.shutdownForTests()
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            GuestCloudAuthServiceTestURLProtocol.reset()
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        do {
            try await store.syncCloudNow(trigger: self.makeRecoverySyncTrigger())
            XCTFail("Expected invalid recovery to block manual sync before pending replay.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .invalidStoredState), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        await store.syncCloudIfLinked(trigger: self.makeRecoverySyncTrigger())

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(corruptPayload, try XCTUnwrap(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey)))
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .invalidStoredState,
            file: #filePath,
            line: #line
        )
    }
}
