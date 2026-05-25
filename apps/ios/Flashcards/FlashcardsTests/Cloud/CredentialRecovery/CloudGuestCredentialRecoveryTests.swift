import Foundation
import XCTest
@testable import Flashcards

final class CloudGuestCredentialRecoveryTests: CloudCredentialRecoveryTestCase {
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
}
