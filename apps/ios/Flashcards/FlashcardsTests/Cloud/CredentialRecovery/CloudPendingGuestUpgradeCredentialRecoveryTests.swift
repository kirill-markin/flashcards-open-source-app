import Foundation
import XCTest
@testable import Flashcards

final class CloudPendingGuestUpgradeCredentialRecoveryTests: CloudCredentialRecoveryTestCase {
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
}
