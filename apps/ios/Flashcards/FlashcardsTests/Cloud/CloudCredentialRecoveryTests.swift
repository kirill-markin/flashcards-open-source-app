import Foundation
import XCTest
@testable import Flashcards

final class CloudCredentialRecoveryTests: LocalWorkspaceSyncTestCase {
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

    @MainActor
    func testGuestMissingSessionPreservesLocalDataAndPersistsRecovery() async throws {
        let suiteName: String = "guest-credential-recovery-\(UUID().uuidString)"
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
        XCTAssertEqual(.guest, cloudSettings.cloudState)
        XCTAssertEqual(Optional("guest-user"), cloudSettings.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettings.activeWorkspaceId)

        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.guestSessionMissing, recoveryState.reason)
        XCTAssertEqual(.guest, recoveryState.previousCloudState)
        XCTAssertEqual(Optional("guest-user"), recoveryState.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), recoveryState.activeWorkspaceId)
        XCTAssertNil(recoveryState.linkedEmail)
        XCTAssertEqual(.custom, recoveryState.configurationMode)
        XCTAssertEqual("https://api.example.test/v1", recoveryState.apiBaseUrl)
        XCTAssertEqual(recoveryState, try self.loadPersistedRecoveryState(userDefaults: userDefaults, decoder: decoder))
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .guestSessionMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testGuestMissingStoredSessionWithActiveSessionRestoresCredentialAndSyncs() async throws {
        let suiteName: String = "guest-active-session-credential-restore-\(UUID().uuidString)"
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
        store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: "guest-user",
                workspaceId: workspace.workspaceId,
                email: nil,
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl,
                authorization: .guest("guest-token")
            )
        )

        await store.syncCloudIfLinked(trigger: self.makeRecoverySyncTrigger())

        XCTAssertNotNil(store.cloudRuntime.activeCloudSession())
        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(
            guestSessionFixture(
                token: "guest-token",
                userId: "guest-user",
                workspaceId: workspace.workspaceId,
                configuration: configuration
            ),
            try guestCredentialStore.loadGuestSession()
        )
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertEqual(.idle, store.syncStatus)
    }

    @MainActor
    func testGuestMissingStoredSessionUsesPreservedActiveSessionForSync() async throws {
        let suiteName: String = "guest-active-session-sync-restore-\(UUID().uuidString)"
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
        let activeSession: CloudLinkedSession = CloudLinkedSession(
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            email: nil,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            authorization: .guest("guest-token")
        )
        store.cloudRuntime.setActiveCloudSession(linkedSession: activeSession)

        _ = try await store.runLinkedSyncPreservingSessionContext(linkedSession: activeSession)

        XCTAssertNotNil(store.cloudRuntime.activeCloudSession())
        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(
            guestSessionFixture(
                token: "guest-token",
                userId: "guest-user",
                workspaceId: workspace.workspaceId,
                configuration: configuration
            ),
            try guestCredentialStore.loadGuestSession()
        )
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
    }

    @MainActor
    func testGuestRecoverySignInSkipsGuestUpgradeAndPreservesLocalData() async throws {
        let suiteName: String = "guest-recovery-linked-resolution-\(UUID().uuidString)"
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
        let recoveredWorkspace = CloudWorkspaceSummary(
            workspaceId: "linked-recovery-workspace",
            name: workspace.name,
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )
        let expectedRecoveredCardId: String = forkedCardIdForWorkspace(
            sourceWorkspaceId: workspace.workspaceId,
            destinationWorkspaceId: recoveredWorkspace.workspaceId,
            sourceCardId: savedCard.cardId
        )
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
        let linkedWorkspace = CloudWorkspaceSummary(
            workspaceId: "linked-workspace",
            name: "Recovered",
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
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
                userId: "unrelated-email-user",
                email: "other@example.com",
                workspaces: [linkedWorkspace]
            )
        }
        cloudSyncService.createWorkspaceHandler = { apiBaseUrl, bearerToken, name in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            XCTAssertEqual(workspace.name, name)
            return recoveredWorkspace
        }
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            XCTAssertEqual("unrelated-email-user", linkedSession.userId)
            XCTAssertEqual("other@example.com", linkedSession.email)
            XCTAssertEqual(recoveredWorkspace.workspaceId, linkedSession.workspaceId)
            XCTAssertEqual(configuration.apiBaseUrl, linkedSession.apiBaseUrl)
            XCTAssertEqual(.bearer(credentials.idToken), linkedSession.authorization)
            try database.deleteAllOutboxEntries(workspaceId: linkedSession.workspaceId)
            return .noChanges
        }
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .guestSessionMissing,
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
        XCTAssertEqual(.guestLocalRecovery, linkContext.postAuthRecoveryRoute)
        XCTAssertEqual("unrelated-email-user", linkContext.userId)
        XCTAssertEqual(.autoLink(.createNew), makeCloudWorkspacePostAuthRoute(linkContext: linkContext))
        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, cloudSyncService.selectWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.isWorkspaceEmptyForBootstrapCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertNotNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))

        do {
            try await store.completeCloudLink(
                linkContext: linkContext,
                selection: .existing(workspaceId: linkedWorkspace.workspaceId)
            )
            XCTFail("Expected guest local recovery to stop before cloud link completion.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(0, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertNotNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))

        do {
            try await store.completeGuestCloudLink(
                linkContext: linkContext,
                selection: .existing(workspaceId: linkedWorkspace.workspaceId)
            )
            XCTFail("Expected guest local recovery to stop before guest upgrade completion.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        try await store.completeCloudLink(
            linkContext: linkContext,
            selection: .createNew
        )

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, cloudSyncService.selectWorkspaceCallCount)
        XCTAssertEqual(1, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.isWorkspaceEmptyForBootstrapCallCount)
        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(1, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertEqual(credentials, try credentialStore.loadCredentials())
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNil(userDefaults.data(forKey: guestLocalRecoveryWorkspaceCheckpointUserDefaultsKey))
        let cloudSettingsAfterLink: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        XCTAssertEqual(.linked, cloudSettingsAfterLink.cloudState)
        XCTAssertEqual(Optional("unrelated-email-user"), cloudSettingsAfterLink.linkedUserId)
        XCTAssertEqual(Optional(recoveredWorkspace.workspaceId), cloudSettingsAfterLink.linkedWorkspaceId)
        XCTAssertEqual(Optional(recoveredWorkspace.workspaceId), cloudSettingsAfterLink.activeWorkspaceId)
        XCTAssertEqual(Optional("other@example.com"), cloudSettingsAfterLink.linkedEmail)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertEqual([recoveredWorkspace.workspaceId], try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: recoveredWorkspace.workspaceId).contains { card in
            card.cardId == expectedRecoveredCardId
        })
    }

    @MainActor
    func testGuestRecoveryRetryReusesMigratedLinkedWorkspaceAfterInitialSyncFailure() async throws {
        let suiteName: String = "guest-recovery-sync-retry-\(UUID().uuidString)"
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
        let recoveredWorkspace = CloudWorkspaceSummary(
            workspaceId: "linked-recovery-retry-workspace",
            name: workspace.name,
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )
        let expectedRecoveredCardId: String = forkedCardIdForWorkspace(
            sourceWorkspaceId: workspace.workspaceId,
            destinationWorkspaceId: recoveredWorkspace.workspaceId,
            sourceCardId: savedCard.cardId
        )
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
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "retry-email-user",
                email: "retry@example.com",
                workspaces: []
            )
        }
        cloudSyncService.createWorkspaceHandler = { apiBaseUrl, bearerToken, name in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            XCTAssertEqual(workspace.name, name)
            return recoveredWorkspace
        }
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            XCTAssertEqual("retry-email-user", linkedSession.userId)
            XCTAssertEqual(recoveredWorkspace.workspaceId, linkedSession.workspaceId)
            XCTAssertEqual(.bearer(credentials.idToken), linkedSession.authorization)
            if cloudSyncService.runLinkedSyncCallCount == 1 {
                throw LocalStoreError.database("Forced guest local recovery sync failure")
            }

            try database.deleteAllOutboxEntries(workspaceId: linkedSession.workspaceId)
            return .noChanges
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
            reason: .guestSessionMissing,
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

        do {
            try await store.completeCloudLink(
                linkContext: linkContext,
                selection: .createNew
            )
            XCTFail("Expected initial guest local recovery sync to fail.")
        } catch let error as LocalStoreError {
            guard case .database(let message) = error else {
                XCTFail("Expected database error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual("Forced guest local recovery sync failure", message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(1, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertEqual(credentials, try credentialStore.loadCredentials())
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertNotNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNotNil(userDefaults.data(forKey: guestLocalRecoveryWorkspaceCheckpointUserDefaultsKey))
        let failedCloudSettings: CloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        XCTAssertEqual(.linked, failedCloudSettings.cloudState)
        XCTAssertEqual(Optional("retry-email-user"), failedCloudSettings.linkedUserId)
        XCTAssertEqual(Optional(recoveredWorkspace.workspaceId), failedCloudSettings.activeWorkspaceId)
        XCTAssertEqual([recoveredWorkspace.workspaceId], try self.loadWorkspaceIds(database: database))
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: recoveredWorkspace.workspaceId).contains { card in
            card.cardId == expectedRecoveredCardId
        })
        let failurePresentation = makeCloudPostAuthFailurePresentation(
            operation: .completeLink(linkContext: linkContext, selection: .createNew),
            cloudState: store.cloudSettings?.cloudState
        )
        XCTAssertEqual(
            aiSettingsLocalized(
                "settings.account.cloudSignIn.guestLocalRecovery.failure.title",
                "Local data recovery failed."
            ),
            failurePresentation.title
        )
        XCTAssertEqual(
            Optional(aiSettingsLocalized(
                "settings.account.cloudSignIn.guestLocalRecovery.failure.message",
                "Try again; local data stays on this device."
            )),
            failurePresentation.message
        )
        XCTAssertEqual(.guestLocalRecovery, failurePresentation.kind)
        XCTAssertFalse(failurePresentation.allowsAccountExitActions)
        XCTAssertEqual(
            .completeLink(linkContext: linkContext, selection: .createNew),
            failurePresentation.retryAction
        )
        let syncPresentation = makeCloudPostAuthSyncPresentation(
            operation: .completeLink(linkContext: linkContext, selection: .createNew)
        )
        XCTAssertEqual(
            aiSettingsLocalized(
                "settings.account.cloudSignIn.guestLocalRecovery.recovering.title",
                "Recovering local data"
            ),
            syncPresentation.title
        )
        XCTAssertEqual(
            aiSettingsLocalized(
                "settings.account.cloudSignIn.guestLocalRecovery.recovering.message",
                "Keep this screen open while iOS reconnects local data on this device to your recovered workspace."
            ),
            syncPresentation.message
        )

        try await store.completeCloudLink(
            linkContext: linkContext,
            selection: .createNew
        )

        XCTAssertEqual(1, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(2, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(2, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNil(userDefaults.data(forKey: guestLocalRecoveryWorkspaceCheckpointUserDefaultsKey))
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertEqual(.idle, store.syncStatus)
    }

    @MainActor
    func testGuestRecoveryRetryReusesCreatedWorkspaceCheckpointBeforeLocalMigration() async throws {
        let suiteName: String = "guest-recovery-created-workspace-checkpoint-\(UUID().uuidString)"
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
        let recoveredWorkspace = CloudWorkspaceSummary(
            workspaceId: "linked-recovery-checkpoint-workspace",
            name: workspace.name,
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )
        let expectedRecoveredCardId: String = forkedCardIdForWorkspace(
            sourceWorkspaceId: workspace.workspaceId,
            destinationWorkspaceId: recoveredWorkspace.workspaceId,
            sourceCardId: savedCard.cardId
        )
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
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "checkpoint-email-user",
                email: "checkpoint@example.com",
                workspaces: []
            )
        }
        cloudSyncService.createWorkspaceHandler = { _, _, _ in
            XCTFail("Guest local recovery retry should reuse the created workspace checkpoint.")
            return recoveredWorkspace
        }
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            XCTAssertEqual("checkpoint-email-user", linkedSession.userId)
            XCTAssertEqual(recoveredWorkspace.workspaceId, linkedSession.workspaceId)
            XCTAssertEqual(.bearer(credentials.idToken), linkedSession.authorization)
            try database.deleteAllOutboxEntries(workspaceId: linkedSession.workspaceId)
            return .noChanges
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
            reason: .guestSessionMissing,
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
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        try saveGuestLocalRecoveryWorkspaceCheckpoint(
            checkpoint: GuestLocalRecoveryWorkspaceCheckpoint(
                userId: linkContext.userId,
                apiBaseUrl: linkContext.apiBaseUrl,
                configurationMode: configuration.mode,
                recoveryDetectedAt: recoveryState.detectedAt,
                workspace: recoveredWorkspace
            ),
            userDefaults: userDefaults,
            encoder: encoder
        )

        try await store.completeCloudLink(
            linkContext: linkContext,
            selection: .createNew
        )

        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(1, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertNil(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        XCTAssertNil(userDefaults.data(forKey: guestLocalRecoveryWorkspaceCheckpointUserDefaultsKey))
        XCTAssertEqual([recoveredWorkspace.workspaceId], try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: recoveredWorkspace.workspaceId).contains { card in
            card.cardId == expectedRecoveredCardId
        })
    }

    @MainActor
    func testPendingGuestUpgradeMissingLinkedCredentialsPersistsRecoveryWithoutBackendCompletion() async throws {
        let suiteName: String = "pending-guest-upgrade-linked-recovery-\(UUID().uuidString)"
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
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
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
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "linked-user",
                email: "user@example.com",
                workspaces: []
            )
        }
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

        await store.syncCloudIfLinked(trigger: self.makeRecoverySyncTrigger())

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNotNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.linkedCredentialsMissing, recoveryState.reason)
        XCTAssertEqual(.guest, recoveryState.previousCloudState)
        XCTAssertEqual(Optional("guest-user"), recoveryState.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), recoveryState.activeWorkspaceId)
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .linkedCredentialsMissing,
            file: #filePath,
            line: #line
        )

        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            let body = try guestCloudAuthServiceTestRequestBody(request: request)
            let requestBody = try JSONDecoder().decode(
                GuestUpgradePrepareRequestBody.self,
                from: body
            )
            XCTAssertEqual("guest-token", requestBody.guestToken)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            return (response, Data(#"{"mode":"merge_required"}"#.utf8))
        }

        let linkContext: CloudWorkspaceLinkContext = try await store.prepareCloudLink(
            verifiedContext: CloudVerifiedAuthContext(
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials
            )
        )

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(1, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(.mergeRequired, linkContext.guestUpgradeMode)
        XCTAssertEqual(.pendingGuestUpgradeRecovery, linkContext.postAuthRecoveryRoute)
        XCTAssertEqual("linked-user", linkContext.userId)
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
    }

    @MainActor
    func testCompletedPendingGuestUpgradeRecoveredLinkRequiresActiveRecovery() throws {
        let suiteName: String = "pending-guest-upgrade-relink-shortcut-\(UUID().uuidString)"
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
        let recoveredLinkContext: CloudWorkspaceLinkContext = CloudWorkspaceLinkContext(
            userId: "linked-user",
            email: "user@example.com",
            apiBaseUrl: configuration.apiBaseUrl,
            credentials: credentials,
            workspaces: [],
            guestUpgradeMode: nil,
            postAuthRecoveryRoute: .none
        )
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        let pendingState: PendingGuestUpgradeState = pendingGuestUpgradeInFlightState(
            linkContext: CloudWorkspaceLinkContext(
                userId: recoveredLinkContext.userId,
                email: recoveredLinkContext.email,
                apiBaseUrl: recoveredLinkContext.apiBaseUrl,
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
        guard case .inFlight(let inFlightState) = pendingState else {
            XCTFail("Expected in-flight pending state.")
            return
        }
        let completedState: PendingGuestUpgradeState = PendingGuestUpgradeState.completed(
            pendingGuestUpgradeCompletedState(
                state: inFlightState,
                workspace: CloudWorkspaceSummary(
                    workspaceId: "workspace-linked",
                    name: "Personal",
                    createdAt: "2026-04-01T00:00:00.000Z",
                    isSelected: true
                )
            )
        )
        userDefaults.set(try encoder.encode(completedState), forKey: pendingGuestUpgradeUserDefaultsKey)
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

        XCTAssertFalse(
            try store.shouldFinalizeCompletedPendingGuestUpgradeForRecoveredLink(
                linkContext: recoveredLinkContext
            )
        )

        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        XCTAssertTrue(
            try store.shouldFinalizeCompletedPendingGuestUpgradeForRecoveredLink(
                linkContext: recoveredLinkContext
            )
        )
    }

    @MainActor
    func testPrepareCloudLinkForCompletedPendingGuestUpgradeRecoverySkipsGuestPrepare() async throws {
        let suiteName: String = "pending-guest-upgrade-prepare-recovery-\(UUID().uuidString)"
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
        let completedWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-linked",
            name: "Recovered",
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "stale-guest-token",
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
                guestUpgradeMode: .mergeRequired,
                postAuthRecoveryRoute: .none
            ),
            configuration: configuration,
            guestSession: guestSession,
            selection: .createNew,
            supportsDroppedEntities: true
        )
        guard case .inFlight(let inFlightState) = pendingState else {
            XCTFail("Expected in-flight pending state.")
            return
        }
        userDefaults.set(
            try encoder.encode(
                PendingGuestUpgradeState.completed(
                    pendingGuestUpgradeCompletedState(
                        state: inFlightState,
                        workspace: completedWorkspace
                    )
                )
            ),
            forKey: pendingGuestUpgradeUserDefaultsKey
        )
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { _ in
            throw LocalStoreError.database("Guest upgrade prepare should not run during completed recovery.")
        }
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "linked-user",
                email: "user@example.com",
                workspaces: [
                    CloudWorkspaceSummary(
                        workspaceId: "workspace-other",
                        name: "Other",
                        createdAt: "2026-04-02T00:00:00.000Z",
                        isSelected: false
                    ),
                    completedWorkspace
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

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertNil(linkContext.guestUpgradeMode)
        XCTAssertEqual(.pendingGuestUpgradeRecovery, linkContext.postAuthRecoveryRoute)
        XCTAssertEqual([completedWorkspace], linkContext.workspaces)
        XCTAssertEqual(
            .autoLink(.existing(workspaceId: completedWorkspace.workspaceId)),
            makeCloudWorkspacePostAuthRoute(linkContext: linkContext)
        )
    }

    @MainActor
    func testPrepareCompletedPendingGuestUpgradeRecoveryRejectsWrongAccountBeforeReset() async throws {
        let suiteName: String = "pending-guest-upgrade-completed-wrong-account-\(UUID().uuidString)"
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
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
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
        guard case .inFlight(let inFlightState) = pendingState else {
            XCTFail("Expected in-flight pending state.")
            return
        }
        let completedState: PendingGuestUpgradeState = PendingGuestUpgradeState.completed(
            pendingGuestUpgradeCompletedState(
                state: inFlightState,
                workspace: CloudWorkspaceSummary(
                    workspaceId: workspace.workspaceId,
                    name: workspace.name,
                    createdAt: workspace.createdAt,
                    isSelected: true
                )
            )
        )
        userDefaults.set(try encoder.encode(completedState), forKey: pendingGuestUpgradeUserDefaultsKey)
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "different-user",
                email: "other@example.com",
                workspaces: []
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
        let guestCloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: guestCloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "linked-user",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: workspace.workspaceId,
            linkedEmail: "user@example.com"
        )
        try store.reload()

        do {
            _ = try await store.prepareCloudLink(
                verifiedContext: CloudVerifiedAuthContext(
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials
                )
            )
            XCTFail("Expected completed recovery to reject a different signed-in account before reset.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage(), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(outboxCountBefore, try self.loadOutboxCount(database: database))
        XCTAssertEqual(workspaceIdsBefore, try self.loadWorkspaceIds(database: database))
        XCTAssertTrue(try database.loadActiveCards(workspaceId: workspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertEqual(completedState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
    }

    @MainActor
    func testCompletedPendingGuestUpgradeRecoveryKeepsRecoveryWhenFinalSyncFails() async throws {
        let suiteName: String = "pending-guest-upgrade-final-sync-failure-\(UUID().uuidString)"
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
        let completedWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-linked",
            name: "Recovered",
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "stale-guest-token",
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
                guestUpgradeMode: .mergeRequired,
                postAuthRecoveryRoute: .none
            ),
            configuration: configuration,
            guestSession: guestSession,
            selection: .createNew,
            supportsDroppedEntities: true
        )
        guard case .inFlight(let inFlightState) = pendingState else {
            XCTFail("Expected in-flight pending state.")
            return
        }
        let completedState: PendingGuestUpgradeState = PendingGuestUpgradeState.completed(
            pendingGuestUpgradeCompletedState(
                state: inFlightState,
                workspace: completedWorkspace
            )
        )
        userDefaults.set(try encoder.encode(completedState), forKey: pendingGuestUpgradeUserDefaultsKey)
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            XCTAssertEqual("linked-user", linkedSession.userId)
            XCTAssertEqual(completedWorkspace.workspaceId, linkedSession.workspaceId)
            throw LocalStoreError.database("Forced final sync failure")
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
            try await store.completeCloudLink(
                linkContext: CloudWorkspaceLinkContext(
                    userId: "linked-user",
                    email: "user@example.com",
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials,
                    workspaces: [completedWorkspace],
                    guestUpgradeMode: nil,
                    postAuthRecoveryRoute: .pendingGuestUpgradeRecovery
                ),
                selection: .existing(workspaceId: completedWorkspace.workspaceId)
            )
            XCTFail("Expected completed guest upgrade recovery to surface the final sync failure.")
        } catch let error as LocalStoreError {
            guard case .database(let message) = error else {
                XCTFail("Expected database error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual("Forced final sync failure", message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNotNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.linkedCredentialsMissing, recoveryState.reason)
        XCTAssertEqual(.guest, recoveryState.previousCloudState)
        XCTAssertEqual(recoveryState, try self.loadPersistedRecoveryState(userDefaults: userDefaults, decoder: decoder))
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)

        cloudSyncService.runLinkedSyncHandler = { linkedSession in
            XCTAssertEqual("linked-user", linkedSession.userId)
            XCTAssertEqual(completedWorkspace.workspaceId, linkedSession.workspaceId)
            return .noChanges
        }

        try await store.syncCloudNow(trigger: self.makeRecoverySyncTrigger())

        XCTAssertEqual(2, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.idle, store.syncStatus)
    }

    @MainActor
    func testPrepareCloudLinkWithMissingGuestTokenPersistsRecoveryAndPreservesPendingUpgrade() async throws {
        let suiteName: String = "pending-guest-upgrade-prepare-missing-token-\(UUID().uuidString)"
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
            guestSession: StoredGuestCloudSession(
                guestToken: "guest-token",
                userId: "guest-user",
                workspaceId: workspace.workspaceId,
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl
            ),
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
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "any-linked-user",
                email: "any@example.com",
                workspaces: []
            )
        }
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .guestSessionMissing,
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

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(0, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertNil(linkContext.guestUpgradeMode)
        XCTAssertEqual(.pendingGuestUpgradeMissingGuestSessionRecovery, linkContext.postAuthRecoveryRoute)
        XCTAssertEqual(.guestLocalRecoveryNeeded, makeCloudWorkspacePostAuthRoute(linkContext: linkContext))
        XCTAssertEqual("any-linked-user", linkContext.userId)
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.guestSessionMissing, recoveryState.reason)
        XCTAssertEqual(.guest, recoveryState.previousCloudState)
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .guestSessionMissing,
            file: #filePath,
            line: #line
        )

        do {
            try await store.completeCloudLink(
                linkContext: linkContext,
                selection: .createNew
            )
            XCTFail("Expected pending guest-upgrade missing-token recovery to stay blocked.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, cloudSyncService.createWorkspaceCallCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(0, cloudSyncService.runGuestLocalRecoveryLinkedSyncCallCount)
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertNotNil(store.cloudCredentialRecoveryState)
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
    }

    @MainActor
    func testCompleteGuestCloudLinkRejectsDifferentAccountBeforeOverwritingPendingUpgrade() async throws {
        let suiteName: String = "pending-guest-upgrade-wrong-account-\(UUID().uuidString)"
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
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
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
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
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
            try await store.completeGuestCloudLink(
                linkContext: CloudWorkspaceLinkContext(
                    userId: "different-user",
                    email: "other@example.com",
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials,
                    workspaces: [],
                    guestUpgradeMode: .mergeRequired,
                    postAuthRecoveryRoute: .pendingGuestUpgradeRecovery
                ),
                selection: .createNew
            )
            XCTFail("Expected different account to be rejected before overwriting pending guest upgrade.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage(), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNil(try credentialStore.loadCredentials())
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
    }

    @MainActor
    func testPrepareCloudLinkRejectsDifferentPendingGuestUpgradeAccountBeforePrepareRequest() async throws {
        let suiteName: String = "pending-guest-upgrade-prepare-wrong-account-\(UUID().uuidString)"
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
        let guestSession: StoredGuestCloudSession = StoredGuestCloudSession(
            guestToken: "guest-token",
            userId: "guest-user",
            workspaceId: workspace.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        let credentials: StoredCloudCredentials = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
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
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
        let cloudSyncService: GuestUpgradeDrainCloudSyncService = GuestUpgradeDrainCloudSyncService()
        cloudSyncService.fetchCloudAccountHandler = { apiBaseUrl, bearerToken in
            XCTAssertEqual(configuration.apiBaseUrl, apiBaseUrl)
            XCTAssertEqual(credentials.idToken, bearerToken)
            return CloudAccountSnapshot(
                userId: "different-user",
                email: "other@example.com",
                workspaces: []
            )
        }
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
            _ = try await store.prepareCloudLink(
                verifiedContext: CloudVerifiedAuthContext(
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials
                )
            )
            XCTFail("Expected different account to be rejected before guest upgrade prepare.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage(), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(1, cloudSyncService.fetchCloudAccountCallCount)
        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(pendingState, try decoder.decode(
            PendingGuestUpgradeState.self,
            from: try XCTUnwrap(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        ))
    }

    @MainActor
    func testPendingGuestUpgradeMissingGuestTokenPersistsRecovery() async throws {
        let suiteName: String = "pending-guest-upgrade-recovery-\(UUID().uuidString)"
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
            guestSession: StoredGuestCloudSession(
                guestToken: "guest-token",
                userId: "guest-user",
                workspaceId: workspace.workspaceId,
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl
            ),
            selection: .createNew,
            supportsDroppedEntities: true
        )
        userDefaults.set(try encoder.encode(pendingState), forKey: pendingGuestUpgradeUserDefaultsKey)
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
        XCTAssertNotNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.guestSessionMissing, recoveryState.reason)
        XCTAssertEqual(.guest, recoveryState.previousCloudState)
        XCTAssertEqual(Optional("guest-user"), recoveryState.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), recoveryState.activeWorkspaceId)
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .guestSessionMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testCompleteGuestCloudLinkWithMissingGuestTokenPersistsRecovery() async throws {
        let suiteName: String = "guest-upgrade-complete-missing-token-\(UUID().uuidString)"
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
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
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
            try await store.completeGuestCloudLink(
                linkContext: CloudWorkspaceLinkContext(
                    userId: "linked-user",
                    email: "user@example.com",
                    apiBaseUrl: configuration.apiBaseUrl,
                    credentials: credentials,
                    workspaces: [
                        CloudWorkspaceSummary(
                            workspaceId: "workspace-linked",
                            name: "Linked",
                            createdAt: "2026-04-01T00:00:00.000Z",
                            isSelected: true
                        )
                    ],
                    guestUpgradeMode: .mergeRequired,
                    postAuthRecoveryRoute: .none
                ),
                selection: .createNew
            )
            XCTFail("Expected missing guest token to block account upgrade completion.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertEqual(0, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        let recoveryState: CloudCredentialRecoveryState = try XCTUnwrap(store.cloudCredentialRecoveryState)
        XCTAssertEqual(.guestSessionMissing, recoveryState.reason)
        XCTAssertEqual(.guest, recoveryState.previousCloudState)
        XCTAssertEqual(Optional("guest-user"), recoveryState.linkedUserId)
        XCTAssertEqual(Optional(workspace.workspaceId), recoveryState.activeWorkspaceId)
        XCTAssertRecoveryPayloadHasNoSecrets(userDefaults: userDefaults, file: #filePath, line: #line)
        XCTAssertBlockedSyncStatus(
            store.syncStatus,
            expectedReason: .guestSessionMissing,
            file: #filePath,
            line: #line
        )
    }

    @MainActor
    func testRecoveryStateBlocksNewGuestSessionCreation() async throws {
        let suiteName: String = "guest-recovery-blocks-recreate-\(UUID().uuidString)"
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
        let urlSessionConfiguration: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        urlSessionConfiguration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        let guestCloudAuthService: GuestCloudAuthService = GuestCloudAuthService(
            session: URLSession(configuration: urlSessionConfiguration)
        )
        GuestCloudAuthServiceTestURLProtocol.reset()
        let store: FlashcardsStore = self.makeRecoveryStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            guestCloudAuthService: guestCloudAuthService,
            cloudSyncService: GuestUpgradeDrainCloudSyncService()
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
        let cloudSettings: CloudSettings = try XCTUnwrap(store.cloudSettings)
        try store.markCloudCredentialRecoveryRequired(
            reason: .guestSessionMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )

        do {
            _ = try await store.prepareGuestCloudSessionForUITestLaunch()
            XCTFail("Expected recovery state to block guest session creation.")
        } catch let error as LocalStoreError {
            guard case .validation(let message) = error else {
                XCTFail("Expected validation error, received \(Flashcards.errorMessage(error: error))")
                return
            }
            XCTAssertEqual(localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing), message)
        } catch {
            XCTFail("Unexpected error: \(Flashcards.errorMessage(error: error))")
        }

        XCTAssertEqual(0, GuestCloudAuthServiceTestURLProtocol.requestCount)
        XCTAssertNil(try guestCredentialStore.loadGuestSession())
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

    private func saveRecoveryTestCard(database: LocalDatabase, workspaceId: String) throws -> Card {
        try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["recovery"],
                effortLevel: .medium
            ),
            cardId: nil
        )
    }

    private func guestSessionFixture(
        token: String,
        userId: String,
        workspaceId: String,
        configuration: CloudServiceConfiguration
    ) -> StoredGuestCloudSession {
        StoredGuestCloudSession(
            guestToken: token,
            userId: userId,
            workspaceId: workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
    }

    private func makeCredentialStore(
        suiteName: String,
        encoder: JSONEncoder,
        decoder: JSONDecoder
    ) -> CloudCredentialStore {
        CloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(suiteName)-cloud-auth",
            account: "primary"
        )
    }

    private func makeGuestCredentialStore(
        suiteName: String,
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder
    ) -> GuestCloudCredentialStore {
        GuestCloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(suiteName)-guest-auth",
            account: "primary",
            bundle: .main,
            userDefaults: userDefaults
        )
    }

    @MainActor
    private func makeRecoveryStore(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase,
        credentialStore: CloudCredentialStore,
        guestCredentialStore: GuestCloudCredentialStore,
        guestCloudAuthService: GuestCloudAuthService,
        cloudSyncService: GuestUpgradeDrainCloudSyncService
    ) -> FlashcardsStore {
        FlashcardsStore(
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
    }

    private func makeRecoverySyncTrigger() -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: Date(timeIntervalSince1970: 1_775_000_000),
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false
        )
    }

    private func loadPersistedRecoveryState(
        userDefaults: UserDefaults,
        decoder: JSONDecoder
    ) throws -> CloudCredentialRecoveryState {
        let data: Data = try XCTUnwrap(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        return try decoder.decode(CloudCredentialRecoveryState.self, from: data)
    }
}

private func XCTAssertBlockedSyncStatus(
    _ syncStatus: SyncStatus,
    expectedReason: CloudCredentialRecoveryReason,
    file: StaticString,
    line: UInt
) {
    guard case .blocked(let message) = syncStatus else {
        XCTFail("Expected blocked sync status.", file: file, line: line)
        return
    }

    XCTAssertEqual(
        localizedCloudCredentialRecoveryBlockedMessage(reason: expectedReason),
        message,
        file: file,
        line: line
    )
}

private func XCTAssertRecoveryPayloadHasNoSecrets(
    userDefaults: UserDefaults,
    file: StaticString,
    line: UInt
) {
    guard let data = userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey) else {
        XCTFail("Expected persisted recovery payload.", file: file, line: line)
        return
    }

    let allowedKeys: Set<String> = [
        "activeWorkspaceId",
        "apiBaseUrl",
        "configurationMode",
        "detectedAt",
        "installationId",
        "linkedEmail",
        "linkedUserId",
        "linkedWorkspaceId",
        "previousCloudState",
        "reason"
    ]

    do {
        let jsonObject = try JSONSerialization.jsonObject(with: data)
        guard let payload = jsonObject as? [String: Any] else {
            XCTFail("Expected recovery payload JSON object.", file: file, line: line)
            return
        }

        let unexpectedKeys = Set(payload.keys).subtracting(allowedKeys)
        XCTAssertTrue(
            unexpectedKeys.isEmpty,
            "Recovery payload contains unexpected keys: \(unexpectedKeys.sorted())",
            file: file,
            line: line
        )
    } catch {
        XCTFail("Expected valid recovery payload JSON: \(Flashcards.errorMessage(error: error))", file: file, line: line)
    }
}
