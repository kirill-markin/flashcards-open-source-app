import Foundation
import XCTest
@testable import Flashcards

final class CloudPendingGuestUpgradeTokenLossRecoveryTests: CloudCredentialRecoveryTestCase {
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
                preferences: makeDefaultAccountPreferences(),
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
                preferences: makeDefaultAccountPreferences(),
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
                    preferences: makeDefaultAccountPreferences(),
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
}
