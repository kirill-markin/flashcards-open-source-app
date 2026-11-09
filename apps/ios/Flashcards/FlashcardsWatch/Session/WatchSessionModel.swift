import Foundation
import Observation
import OSLog

private let watchSessionLogger: Logger = Logger(subsystem: appBundleIdentifier(), category: "watch_session")
let watchStringsTableName: String = "Watch"

enum WatchSessionState: Equatable {
    case notConnected
    case connecting
    case syncing
    case ready
    /// The iPhone switched account or workspace while ratings made here failed to sync with a retryable
    /// error; the switch completes on a retry that delivers them or when the user discards them.
    case switchBlocked(unsyncedRatingCount: Int)
    case failed(message: String)
}

enum WatchSessionError: LocalizedError {
    case refreshTokenRejected(message: String)

    var errorDescription: String? {
        switch self {
        case .refreshTokenRejected(let message):
            return "The auth service rejected the stored refresh token: \(message)"
        }
    }
}

/// The account the watch is linked to: `app_local_settings` names it and the Keychain holds its tokens.
private struct WatchLinkedAccount: Equatable {
    let userId: String
    let workspaceId: String
    let email: String?
}

/// How one `syncNow()` call ended; a workspace switch reads it to decide whether the old outbox can
/// still be delivered.
enum WatchSyncOutcome {
    case succeeded
    /// No linked account or database to sync.
    case skipped
    case failed(Error)
}

private struct WatchSyncOperation {
    let id: UUID
    let task: Task<WatchSyncOutcome, Never>
}

/**
 The watch is its own installation with its own workspace replica, signed in only through the
 iPhone's handoff and following the iPhone's workspace and Review filter.
 */
@Observable
@MainActor
final class WatchSessionModel {
    private(set) var state: WatchSessionState
    private(set) var reviewFilter: ReviewFilter
    private(set) var lastSuccessfulSyncAt: Date?
    private(set) var isRequestingHandoff: Bool

    /// Nil only when the local database could not be opened; `state` then carries that error.
    @ObservationIgnored let database: LocalDatabase?
    @ObservationIgnored private let cloudSyncService: CloudSyncService?
    @ObservationIgnored private let credentialStore: CloudCredentialStore
    @ObservationIgnored private let cloudAuthService: CloudAuthService
    @ObservationIgnored private let connectivityClient: WatchConnectivityClient
    @ObservationIgnored private let userDefaults: UserDefaults
    @ObservationIgnored private var activeLinkedSession: CloudLinkedSession?
    @ObservationIgnored private var activeSync: WatchSyncOperation?
    @ObservationIgnored private var isResyncRequested: Bool
    /// The iPhone's account a blocked switch moves to.
    @ObservationIgnored private var blockedSwitchAccount: WatchHandoffSignedInAccount?

    init() {
        self.credentialStore = CloudCredentialStore()
        self.cloudAuthService = CloudAuthService()
        self.connectivityClient = WatchConnectivityClient()
        self.userDefaults = .standard
        self.activeLinkedSession = nil
        self.activeSync = nil
        self.isResyncRequested = false
        self.isRequestingHandoff = false
        self.blockedSwitchAccount = nil
        self.reviewFilter = .allCards
        self.lastSuccessfulSyncAt = nil

        let database: LocalDatabase
        do {
            // Opening never seeds the onboarding demo card: the watch only ever shows a linked workspace.
            database = try LocalDatabase()
        } catch {
            logWatchSessionFailure(event: "watch_database_open_failed", error: error)
            self.database = nil
            self.cloudSyncService = nil
            self.state = .failed(message: Flashcards.errorMessage(error: error))
            return
        }
        self.database = database
        self.cloudSyncService = CloudSyncService(database: database)
        self.state = .notConnected

        do {
            guard let account = try self.loadStoredAccount() else {
                return
            }
            self.reviewFilter = self.loadStoredReviewFilter(workspaceId: account.workspaceId)
            self.state = try database.hasHydratedHotState(workspaceId: account.workspaceId) ? .ready : .syncing
            setWatchObservabilityIdentity(account: account)
        } catch {
            logWatchSessionFailure(event: "watch_stored_session_load_failed", error: error)
            self.state = .failed(message: Flashcards.errorMessage(error: error))
        }
    }

    func activateConnectivity() {
        self.connectivityClient.activate { [weak self] in
            guard let self else {
                return
            }
            switch self.state {
            case .notConnected, .failed:
                Task {
                    await self.refreshFromIPhone()
                }
            case .connecting, .syncing, .ready, .switchBlocked:
                return
            }
        }
    }

    /// The analytics client's credential, read without touching the network or the Keychain.
    func analyticsCredentials() -> AnalyticsCredentials? {
        guard let activeLinkedSession = self.activeLinkedSession else {
            return nil
        }

        return AnalyticsCredentials(
            apiBaseUrl: activeLinkedSession.apiBaseUrl,
            authorizationHeaderValue: activeLinkedSession.authorizationHeaderValue
        )
    }

    /// Asks the iPhone for its account, applies the reply and syncs. An unreachable iPhone keeps the
    /// stored session, so the watch keeps reviewing offline.
    func refreshFromIPhone() async {
        guard self.database != nil, self.isRequestingHandoff == false else {
            return
        }
        self.isRequestingHandoff = true
        defer {
            self.isRequestingHandoff = false
        }

        let storedAccount: WatchLinkedAccount?
        do {
            storedAccount = try self.loadStoredAccount()
        } catch {
            logWatchSessionFailure(event: "watch_stored_session_load_failed", error: error)
            self.state = .failed(message: Flashcards.errorMessage(error: error))
            return
        }
        if storedAccount == nil {
            self.state = .connecting
        }

        let reply: WatchHandoffReply
        do {
            reply = try await self.connectivityClient.requestHandoff()
        } catch {
            logWatchSessionFailure(event: "watch_handoff_failed", error: error)
            // The iPhone's last answer stays the target of a blocked switch.
            if let blockedSwitchAccount = self.blockedSwitchAccount {
                await self.applySignedInAccountAndSync(account: blockedSwitchAccount)
                return
            }
            guard storedAccount != nil else {
                self.state = watchSessionStateForHandoffFailure(error: error)
                return
            }
            await self.syncNow()
            return
        }

        switch reply {
        case .signedOut:
            // The wipe drops the outbox, so ratings made offline get one best-effort push first; it
            // also waits for a running sync that may be pushing them.
            do {
                if try self.countOutboxEntries() > 0 {
                    await self.syncNow()
                }
            } catch {
                logWatchSessionFailure(event: "watch_outbox_count_failed", error: error)
            }
            await self.stopActiveSync()
            self.signOutIfLinked(reason: "iphone_signed_out")
        case .signedIn(let account):
            await self.applySignedInAccountAndSync(account: account)
        }
    }

    /// Drops the ratings a blocked switch waits for and completes the switch.
    func discardUnsyncedRatingsAndSwitch() async {
        guard let account = self.blockedSwitchAccount else {
            await self.refreshFromIPhone()
            return
        }
        guard self.isRequestingHandoff == false else {
            return
        }
        self.isRequestingHandoff = true
        defer {
            self.isRequestingHandoff = false
        }

        do {
            let cloudSettings = try self.requireDatabase().workspaceSettingsStore.loadCloudSettings()
            try await self.linkSignedInAccount(
                account: account,
                cloudSettings: cloudSettings,
                outboxDropReason: "user_discarded_for_switch"
            )
        } catch {
            logWatchSessionFailure(event: "watch_handoff_apply_failed", error: error)
            self.state = .failed(message: Flashcards.errorMessage(error: error))
            return
        }
        await self.syncNow()
    }

    private func applySignedInAccountAndSync(account: WatchHandoffSignedInAccount) async {
        let isApplied: Bool
        do {
            isApplied = try await self.applySignedInAccount(account: account)
        } catch {
            logWatchSessionFailure(event: "watch_handoff_apply_failed", error: error)
            self.state = .failed(message: Flashcards.errorMessage(error: error))
            return
        }
        guard isApplied else {
            return
        }
        await self.syncNow()
    }

    /// Runs one linked sync; a call during a running sync waits for it and one more run after it,
    /// and returns the outcome of the last run.
    @discardableResult
    func syncNow() async -> WatchSyncOutcome {
        if let activeSync = self.activeSync {
            self.isResyncRequested = true
            return await activeSync.task.value
        }

        let operationId = UUID()
        let task = Task { @MainActor in
            let outcome = await self.runSyncLoop()
            if self.activeSync?.id == operationId {
                self.activeSync = nil
            }
            return outcome
        }
        self.activeSync = WatchSyncOperation(id: operationId, task: task)
        return await task.value
    }

    private func runSyncLoop() async -> WatchSyncOutcome {
        var outcome: WatchSyncOutcome
        repeat {
            self.isResyncRequested = false
            outcome = await self.runSyncOnce()
        } while self.isResyncRequested && Task.isCancelled == false
        return outcome
    }

    private func runSyncOnce() async -> WatchSyncOutcome {
        guard let database = self.database, let cloudSyncService = self.cloudSyncService else {
            return .skipped
        }

        let account: WatchLinkedAccount
        let hasHydratedWorkspace: Bool
        do {
            guard let storedAccount = try self.loadStoredAccount() else {
                return .skipped
            }
            account = storedAccount
            hasHydratedWorkspace = try database.hasHydratedHotState(workspaceId: account.workspaceId)
        } catch {
            logWatchSessionFailure(event: "watch_stored_session_load_failed", error: error)
            self.state = .failed(message: Flashcards.errorMessage(error: error))
            return .failed(error)
        }
        if hasHydratedWorkspace == false {
            self.setStateUnlessSwitchBlocked(state: .syncing)
        }

        do {
            try await self.runLinkedSyncWithStoredCredentials(account: account, cloudSyncService: cloudSyncService)
            self.lastSuccessfulSyncAt = Date()
            self.setStateUnlessSwitchBlocked(state: .ready)
            return .succeeded
        } catch {
            if isRequestCancellationError(error: error) {
                return .failed(error)
            }
            logWatchSessionFailure(event: "watch_sync_failed", error: error)
            if case WatchSessionError.refreshTokenRejected = error {
                self.signOut(reason: "refresh_token_rejected")
                return .failed(error)
            }
            self.setStateUnlessSwitchBlocked(
                state: self.stateAfterSyncFailure(error: error, workspaceId: account.workspaceId)
            )
            return .failed(error)
        }
    }

    /// A blocked switch keeps its screen while syncs of the old workspace try to deliver its ratings.
    private func setStateUnlessSwitchBlocked(state: WatchSessionState) {
        if case .switchBlocked = self.state {
            return
        }
        self.state = state
    }

    /// A workspace that was hydrated before stays reviewable offline whatever the sync failure.
    private func stateAfterSyncFailure(error: Error, workspaceId: String) -> WatchSessionState {
        guard let database = self.database else {
            return .failed(message: Flashcards.errorMessage(error: error))
        }
        do {
            return try database.hasHydratedHotState(workspaceId: workspaceId)
                ? .ready
                : .failed(message: Flashcards.errorMessage(error: error))
        } catch {
            logWatchSessionFailure(event: "watch_stored_session_load_failed", error: error)
            return .failed(message: Flashcards.errorMessage(error: error))
        }
    }

    private func runLinkedSyncWithStoredCredentials(
        account: WatchLinkedAccount,
        cloudSyncService: CloudSyncService
    ) async throws {
        let configuration = try self.loadOfficialCloudConfiguration()
        let credentials = try await self.validCredentials(configuration: configuration)
        do {
            try await self.runLinkedSync(
                account: account,
                credentials: credentials,
                configuration: configuration,
                cloudSyncService: cloudSyncService
            )
        } catch let error as CloudSyncError where error.statusCode == 401 {
            logWatchSessionFailure(event: "watch_sync_unauthorized_refreshing", error: error)
            let refreshedCredentials = try await self.refreshCredentials(configuration: configuration)
            try await self.runLinkedSync(
                account: account,
                credentials: refreshedCredentials,
                configuration: configuration,
                cloudSyncService: cloudSyncService
            )
        }
    }

    private func runLinkedSync(
        account: WatchLinkedAccount,
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        cloudSyncService: CloudSyncService
    ) async throws {
        let linkedSession = makeWatchLinkedSession(
            account: account,
            idToken: credentials.idToken,
            configuration: configuration
        )
        self.activeLinkedSession = linkedSession
        _ = try await cloudSyncService.runLinkedSync(linkedSession: linkedSession)
    }

    private func validCredentials(configuration: CloudServiceConfiguration) async throws -> StoredCloudCredentials {
        let storedCredentials = try self.requireStoredCredentials()
        guard shouldRefreshCloudIdToken(idTokenExpiresAt: storedCredentials.idTokenExpiresAt, now: Date()) else {
            return storedCredentials
        }

        return try await self.refreshCredentials(configuration: configuration)
    }

    /// Refresh-token rotation is off server-side, so the watch refreshes with the iPhone's refresh
    /// token; a rotated one is still stored if the server returns it.
    private func refreshCredentials(configuration: CloudServiceConfiguration) async throws -> StoredCloudCredentials {
        let storedCredentials = try self.requireStoredCredentials()
        let refreshedToken: CloudIdentityToken
        do {
            refreshedToken = try await self.cloudAuthService.refreshIdToken(
                refreshToken: storedCredentials.refreshToken,
                authBaseUrl: configuration.authBaseUrl
            )
        } catch let error as CloudAuthError where error.statusCode == 401 {
            throw WatchSessionError.refreshTokenRejected(message: Flashcards.errorMessage(error: error))
        }
        try Task.checkCancellation()

        let updatedCredentials = StoredCloudCredentials(
            refreshToken: refreshedToken.rotatedRefreshToken ?? storedCredentials.refreshToken,
            idToken: refreshedToken.idToken,
            idTokenExpiresAt: refreshedToken.idTokenExpiresAt
        )
        try self.credentialStore.saveCredentials(credentials: updatedCredentials)
        return updatedCredentials
    }

    /// Returns false when the switch away from the linked workspace blocks on its unsynced changes.
    private func applySignedInAccount(account: WatchHandoffSignedInAccount) async throws -> Bool {
        let database = try self.requireDatabase()
        var cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        if cloudSettings.cloudState == .linked && cloudSettings.linkedUserId == account.linkedUserId {
            // Same principal: the iPhone's tokens may be newer than the stored ones, so they push the
            // old workspace's outbox below.
            try self.credentialStore.saveCredentials(credentials: account.credentials)
        }

        if cloudSettings.cloudState == .linked && isWatchLinked(cloudSettings: cloudSettings, account: account) == false {
            // Leaving the workspace drops its outbox, so ratings made offline are pushed first, and the
            // switch waits only while a later sync could still deliver them.
            var flushOutcome: WatchSyncOutcome = .succeeded
            if try self.countOutboxEntries() > 0 {
                flushOutcome = await self.syncNow()
            }
            await self.stopActiveSync()
            let pendingOutboxEntryCount = try self.countOutboxEntries()
            if pendingOutboxEntryCount > 0,
               case .failed(let error) = flushOutcome,
               isRetryableWatchSyncFailure(error: error) {
                watchSessionLogger.error(
                    "event=watch_account_switch_deferred pendingOutboxEntries=\(pendingOutboxEntryCount, privacy: .public) userChanged=\(String(cloudSettings.linkedUserId != account.linkedUserId), privacy: .public) error=\(Flashcards.errorMessage(error: error), privacy: .public)"
                )
                self.blockedSwitchAccount = account
                self.state = .switchBlocked(unsyncedRatingCount: try self.countUnsyncedRatings())
                return false
            }
            // A rejected refresh during the flush has already signed the watch out.
            cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        }

        try await self.linkSignedInAccount(
            account: account,
            cloudSettings: cloudSettings,
            outboxDropReason: cloudSettings.linkedUserId != account.linkedUserId
                ? "linked_user_changed"
                : "workspace_changed"
        )
        return true
    }

    /// Links the watch to the handoff account; leaving a linked workspace drops its outbox, logged
    /// with `outboxDropReason`.
    private func linkSignedInAccount(
        account: WatchHandoffSignedInAccount,
        cloudSettings: CloudSettings,
        outboxDropReason: String
    ) async throws {
        let database = try self.requireDatabase()
        let isLinkedToAccount = isWatchLinked(cloudSettings: cloudSettings, account: account)
        if isLinkedToAccount == false && cloudSettings.cloudState == .linked {
            await self.stopActiveSync()
            if cloudSettings.linkedUserId != account.linkedUserId {
                Analytics.reset()
                try self.wipeLocalState(reason: outboxDropReason)
                watchSessionLogger.log("event=watch_local_state_wiped reason=linked_user_changed")
            } else {
                // Same user: the installation id is global across workspaces, so only the workspace
                // replica is replaced below, as the iPhone keeps its installation on a workspace switch.
                // The replacement deletes the old workspace's outbox with it.
                logDroppedOutboxEntries(count: self.countOutboxEntriesForDropLog(), reason: outboxDropReason)
                self.resetWorkspaceScopedState()
                watchSessionLogger.log("event=watch_workspace_changed")
            }
        }

        try self.credentialStore.saveCredentials(credentials: account.credentials)
        let configuration = try self.loadOfficialCloudConfiguration()
        let linkedAccount = WatchLinkedAccount(
            userId: account.linkedUserId,
            workspaceId: account.workspaceId,
            email: account.email
        )
        if isLinkedToAccount == false {
            let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
            // The watch holds no content of its own before it links (no demo card, no guest mode), so
            // the local shell is always replaced and the workspace bootstraps from the server.
            try database.migrateLocalWorkspaceToLinkedWorkspace(
                localWorkspaceId: localWorkspace.workspaceId,
                linkedSession: makeWatchLinkedSession(
                    account: linkedAccount,
                    idToken: account.credentials.idToken,
                    configuration: configuration
                ),
                remoteWorkspaceIsEmpty: false
            )
            // The replica is empty until the sync below hydrates it.
            self.state = .syncing
            watchSessionLogger.log(
                "event=watch_linked userId=\(account.linkedUserId, privacy: .public) workspaceId=\(account.workspaceId, privacy: .public)"
            )
        } else if cloudSettings.linkedEmail != account.email {
            try database.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: account.linkedUserId,
                linkedWorkspaceId: account.workspaceId,
                activeWorkspaceId: account.workspaceId,
                linkedEmail: account.email
            )
        }

        try saveWatchReviewFilter(
            persistedReviewFilter: account.reviewFilter,
            workspaceId: account.workspaceId,
            userDefaults: self.userDefaults
        )
        self.reviewFilter = try makeReviewFilter(persistedReviewFilter: account.reviewFilter)
        setWatchObservabilityIdentity(account: linkedAccount)
        self.blockedSwitchAccount = nil
        // Returning to the still-linked workspace keeps it reviewable while its sync runs.
        if case .switchBlocked = self.state {
            self.state = try database.hasHydratedHotState(workspaceId: account.workspaceId) ? .ready : .syncing
        }
    }

    /// Skips the wipe when nothing is stored, so a watch whose iPhone stays signed out keeps its
    /// installation id across launches.
    private func signOutIfLinked(reason: String) {
        do {
            let cloudSettings = try self.requireDatabase().workspaceSettingsStore.loadCloudSettings()
            let hasStoredCredentials = try self.credentialStore.loadCredentials() != nil
            guard cloudSettings.cloudState != .disconnected || hasStoredCredentials else {
                self.state = .notConnected
                return
            }
        } catch {
            logWatchSessionFailure(event: "watch_stored_session_load_failed", error: error)
        }
        self.signOut(reason: reason)
    }

    private func signOut(reason: String) {
        Analytics.reset()
        do {
            try self.wipeLocalState(reason: reason)
            self.state = .notConnected
            watchSessionLogger.log("event=watch_signed_out reason=\(reason, privacy: .public)")
        } catch {
            logWatchSessionFailure(event: "watch_sign_out_failed", error: error)
            self.state = .failed(message: Flashcards.errorMessage(error: error))
        }
    }

    /// Callers stop the active sync first unless they run inside it.
    private func wipeLocalState(reason: String) throws {
        let database = try self.requireDatabase()
        let droppedOutboxEntryCount = self.countOutboxEntriesForDropLog()
        FlashcardsObservability.setIdentity(nil)
        try self.credentialStore.clearCredentials()
        try database.resetForAccountDeletion()
        self.resetWorkspaceScopedState()
        logDroppedOutboxEntries(count: droppedOutboxEntryCount, reason: reason)
    }

    private func resetWorkspaceScopedState() {
        self.activeLinkedSession = nil
        self.blockedSwitchAccount = nil
        clearStoredReviewFilters(userDefaults: self.userDefaults)
        self.reviewFilter = .allCards
        self.lastSuccessfulSyncAt = nil
    }

    private func countOutboxEntries() throws -> Int {
        try self.requireDatabase().core.scalarInt(sql: "SELECT COUNT(*) FROM outbox", values: [])
    }

    /// Nil when the outbox cannot be read, so the caller still logs the drop and carries on.
    private func countOutboxEntriesForDropLog() -> Int? {
        do {
            return try self.countOutboxEntries()
        } catch {
            logWatchSessionFailure(event: "watch_outbox_count_failed", error: error)
            return nil
        }
    }

    /// A rating queues a review event and a card update, so ratings are counted by their review events.
    private func countUnsyncedRatings() throws -> Int {
        try self.requireDatabase().core.scalarInt(
            sql: "SELECT COUNT(*) FROM outbox WHERE entity_type = ?",
            values: [.text("review_event")]
        )
    }

    private func stopActiveSync() async {
        while let activeSync = self.activeSync {
            activeSync.task.cancel()
            await activeSync.task.value
        }
    }

    private func loadStoredAccount() throws -> WatchLinkedAccount? {
        let database = try self.requireDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        guard cloudSettings.cloudState == .linked,
              let linkedUserId = cloudSettings.linkedUserId,
              let workspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId,
              try self.credentialStore.loadCredentials() != nil else {
            return nil
        }

        return WatchLinkedAccount(userId: linkedUserId, workspaceId: workspaceId, email: cloudSettings.linkedEmail)
    }

    private func loadStoredReviewFilter(workspaceId: String) -> ReviewFilter {
        do {
            return try loadWatchReviewFilter(workspaceId: workspaceId, userDefaults: self.userDefaults)
        } catch {
            logWatchSessionFailure(event: "watch_review_filter_load_failed", error: error)
            self.userDefaults.removeObject(forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId))
            return .allCards
        }
    }

    private func requireStoredCredentials() throws -> StoredCloudCredentials {
        guard let storedCredentials = try self.credentialStore.loadCredentials() else {
            throw LocalStoreError.uninitialized("Watch cloud credentials are unavailable")
        }
        return storedCredentials
    }

    private func requireDatabase() throws -> LocalDatabase {
        guard let database = self.database else {
            throw LocalStoreError.uninitialized("Watch local database is unavailable")
        }
        return database
    }

    /// The handoff carries no server configuration, so the watch always talks to the official hosts.
    private func loadOfficialCloudConfiguration() throws -> CloudServiceConfiguration {
        try loadCloudServiceConfiguration(
            bundle: .main,
            userDefaults: self.userDefaults,
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
    }
}

private func makeWatchLinkedSession(
    account: WatchLinkedAccount,
    idToken: String,
    configuration: CloudServiceConfiguration
) -> CloudLinkedSession {
    CloudLinkedSession(
        userId: account.userId,
        workspaceId: account.workspaceId,
        email: account.email,
        configurationMode: configuration.mode,
        apiBaseUrl: configuration.apiBaseUrl,
        authorization: .bearer(idToken)
    )
}

private func isWatchLinked(cloudSettings: CloudSettings, account: WatchHandoffSignedInAccount) -> Bool {
    cloudSettings.cloudState == .linked
        && cloudSettings.linkedUserId == account.linkedUserId
        && (cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId) == account.workspaceId
}

private func setWatchObservabilityIdentity(account: WatchLinkedAccount) {
    FlashcardsObservability.setIdentity(
        ObservabilityIdentity(userId: account.userId, workspaceId: account.workspaceId, accountKind: .linked)
    )
}

private func watchSessionStateForHandoffFailure(error: Error) -> WatchSessionState {
    switch error {
    case WatchConnectivityClientError.iPhoneUnreachable, WatchConnectivityClientError.replyTimedOut:
        return .notConnected
    case is WatchHandoffContractError, WatchConnectivityClientError.replyDecodingFailed:
        return .failed(message: String(
            localized: "watch.session.update_required",
            table: watchStringsTableName,
            comment: "Apple Watch message when the iPhone and watch apps are on incompatible versions"
        ))
    default:
        return .failed(message: String(
            localized: "watch.session.open_iphone_app",
            table: watchStringsTableName,
            comment: "Apple Watch message asking the user to open the iPhone app so the watch can sign in"
        ))
    }
}

/// Only a failure a later sync can get past keeps a workspace switch waiting for the old outbox;
/// a rejection or a missing or forbidden old workspace never drains it.
private func isRetryableWatchSyncFailure(error: Error) -> Bool {
    if isRequestCancellationError(error: error) || flashcardsURLErrorCode(error: error, remainingDepth: 4) != nil {
        return true
    }
    let statusCode: Int?
    switch error {
    case let syncError as CloudSyncError:
        statusCode = syncError.statusCode
    case let authError as CloudAuthError:
        statusCode = authError.statusCode
    default:
        statusCode = nil
    }
    guard let statusCode else {
        return false
    }
    return statusCode == 429 || statusCode >= 500
}

/// A nil count means the outbox could not be read, so the drop is logged as unknown.
private func logDroppedOutboxEntries(count: Int?, reason: String) {
    guard count != 0 else {
        return
    }
    watchSessionLogger.error(
        "event=watch_outbox_dropped count=\(count.map(String.init) ?? "unknown", privacy: .public) reason=\(reason, privacy: .public)"
    )
}

private func logWatchSessionFailure(event: String, error: Error) {
    watchSessionLogger.error(
        "event=\(event, privacy: .public) error=\(Flashcards.errorMessage(error: error), privacy: .public) errorType=\(String(reflecting: type(of: error)), privacy: .public)"
    )
}
