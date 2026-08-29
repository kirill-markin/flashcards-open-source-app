import Foundation
import UserNotifications

@MainActor
extension FlashcardsStore {
    /**
     Clears all account-scoped local state so the next cloud link starts from a
     fresh local database and a freshly generated sync device id.
     
     This reset is the boundary that intentionally breaks identity continuity
     across logout and account deletion. The next guest cloud restore creates a
     brand new server-side guest session with a new guest user/workspace, so we
     never try to merge a future guest account into another linked account as if
     it were the same pre-reset guest identity.
     */
    func resetLocalStateForCloudIdentityChange() throws {
        // The identity boundary logout and account deletion share. It rotates anonymous_id and
        // discards whatever analytics events are still queued: they belong to the person leaving,
        // and this function never suspends before the credentials are cleared below, so anything
        // left behind would be posted later under a fresh guest session or the next account and
        // would name the wrong user on an append-only table. The discarded count is reported
        // through observability, not as an analytics_events_dropped reason.
        Analytics.reset()
        self.restoreSurfaceForPromptsClosedByCloudIdentityReset()
        let database = try requireLocalDatabase(database: self.database)
        let previousStrictReminderNotificationScope = storedStrictReminderNotificationScope(userDefaults: self.userDefaults)

        self.reviewRuntime.cancelForAccountDeletion()
        self.cloudRuntime.cancelForAccountDeletion()
        let previousStrictRemindersReconciliationTask = self.cancelStrictRemindersReconciliation()
        try self.cloudRuntime.clearCredentials()
        try self.dependencies.guestCredentialStore.clearGuestSession()
        try database.resetForAccountDeletion()
        let nextStrictReminderNotificationScope = rotateStrictReminderNotificationScope(
            userDefaults: self.userDefaults
        )
        self.invalidateAppNotificationPresentationOwnership(
            strictReminderScope: nextStrictReminderNotificationScope
        )
        clearPendingAppNotificationTap(userDefaults: self.userDefaults)
        self.removeStrictReminderNotificationsForCloudIdentityReset(
            previousNotificationScope: previousStrictReminderNotificationScope,
            previousReconciliationTask: previousStrictRemindersReconciliationTask
        )
        clearStoredReviewFilters(userDefaults: self.userDefaults)
        clearStoredStrictReminders(userDefaults: self.userDefaults)
        self.userDefaults.removeObject(forKey: reviewNotificationPromptStateUserDefaultsKey)
        self.userDefaults.removeObject(forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey)
        self.userDefaults.removeObject(forKey: reviewNotificationLastActiveAtUserDefaultsKey)
        self.userDefaults.removeObject(forKey: accountDeletionPendingUserDefaultsKey)
        self.userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
        self.clearGuestSignInAfterReviewPromptState()
        self.clearFeedbackPromptState()
        self.resetAccountPreferencesForCloudIdentityReset()
        self.cachedAIChatStore?.clearLocalHistory()
        clearStoredAIChatHistories(userDefaults: self.userDefaults)
        self.reviewRuntime = ReviewQueueRuntime(
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.applyReviewPublishedState(
            reviewState: ReviewQueueRuntime.makeInitialPublishedState(selectedReviewFilter: .allCards)
        )
        self.notificationPermissionPromptState = makeDefaultNotificationPermissionPromptState()
        self.isReviewNotificationPrePromptPresented = false
        self.accountDeletionState = .hidden
        self.accountDeletionSuccessMessage = nil
        self.cloudSyncFastPollingUntil = nil
        self.pendingReviewCardIds = []
        self.reviewSubmissionFailure = nil
        self.isAccountDeletionRunning = false
        self.clearTransientBanners()
        self.lastSuccessfulCloudSyncAt = nil
        self.syncStatus = .idle
        self.globalErrorMessage = ""
        self.clearPendingGuestUpgradeStateAndUnblockMutations()
        try self.reload()
        self.clearCloudCredentialRecoveryState()
    }

    /**
     * Hands the surface back for whichever of our two in-app prompts this reset is about to close.
     *
     * The reset closes them by writing their presentation state directly, which reports no
     * `prompt_answered` — nobody answered one — but also bypasses SwiftUI's binding write-back, so
     * neither prompt's own restore runs, and `Analytics.reset` rotates the identity without touching
     * the surface tracker. Left undone the tracker keeps naming a prompt that is gone: the next
     * `permission_prompt_answered` would carry it, and the person's genuine next arrival on the tab
     * underneath would be swallowed by the dedupe.
     *
     * Placed after `Analytics.reset` on purpose. The person is on that tab now, under the identity
     * this reset just started, and that is the only identity the report can honestly carry.
     */
    private func restoreSurfaceForPromptsClosedByCloudIdentityReset() {
        let landingSurface = analyticsSurface(tab: self.currentVisibleTab)
        if self.isReviewNotificationPrePromptPresented {
            Analytics.trackScreenViewedOnDismiss(
                of: .notificationsPrePrompt,
                restoring: landingSurface
            )
        }
        if self.isGuestSignInAfterReviewPromptPresented {
            Analytics.trackScreenViewedOnDismiss(
                of: .signInAfterReviewPrompt,
                restoring: landingSurface
            )
        }
    }

    private func removeStrictReminderNotificationsForCloudIdentityReset(
        previousNotificationScope: String?,
        previousReconciliationTask: Task<Void, Never>
    ) {
        Task { @MainActor in
            await previousReconciliationTask.value
            await removePendingAndDeliveredStrictReminders(
                center: UNUserNotificationCenter.current(),
                removalScope: previousNotificationScope
            )
        }
    }

    func resetLocalStateIfLinkedUserDiffers(nextUserId: String) throws {
        guard self.cloudSettings?.cloudState == .linked else {
            return
        }

        guard let linkedUserId = self.cloudSettings?.linkedUserId, linkedUserId.isEmpty == false else {
            return
        }

        if linkedUserId != nextUserId {
            try self.throwIfLinkedWorkspaceUnavailableRecoveryRequired()
            try self.resetLocalStateForCloudIdentityChange()
        }
    }

    func loadGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
        guard let storedGuestSession = try self.dependencies.guestCredentialStore.loadGuestSession() else {
            return nil
        }

        let configuration = try self.currentCloudServiceConfiguration()
        if storedGuestSession.apiBaseUrl != configuration.apiBaseUrl
            || storedGuestSession.configurationMode != configuration.mode {
            try self.dependencies.guestCredentialStore.clearGuestSession()
            return nil
        }

        return storedGuestSession
    }

    /**
     * The stored guest session, but only when this install has adopted it as its cloud session.
     *
     * A credential minted to authenticate analytics is not a cloud session: it must never restore
     * guest cloud state, migrate the local workspace or start a sync. `loadOrCreateGuestCloudSession`
     * adopts that same credential when the person opts into AI chat, feedback or cloud sync, so an
     * install still only ever has one guest identity.
     */
    func loadUsableCloudGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
        guard let storedGuestSession = try self.loadUsableGuestSessionForCurrentConfiguration() else {
            // Nothing is stored, so any marker left behind names a token this install no longer has.
            // Swept opportunistically, so the sidecar stops carrying a dead token — not because that
            // marker could capture anything: `isAnalyticsOnlyGuestSession` is authoritative only by
            // value, and a marker whose token is gone can never match a later credential. Best-effort
            // for the same reason: the answer is already correct without it, this is hygiene the next
            // read performs again, and this loader runs on every sync, so an unreadable sidecar must
            // not be allowed to fail all of them.
            try? self.dependencies.guestCredentialStore.clearAnalyticsOnlyGuestToken()
            return nil
        }
        // A credential this install already runs its cloud session on is a cloud session whatever it
        // was originally created for.
        if self.cloudSettings?.cloudState == .guest {
            return storedGuestSession
        }
        // A marker that cannot be read answers "analytics-only". This loader only ever widens what
        // the app may adopt as a cloud session, so treating an unclassifiable credential as a cloud
        // session is the one outcome the marker exists to prevent, and throwing instead would fail
        // every sync on the install for as long as the sidecar stays unreadable.
        //
        // An unreadable sidecar is unreachable by construction; `GuestCloudCredentialStore.loadSidecar`
        // states what keeps it that way. This is the direction to fall in if that ever stops holding,
        // not a state the code is expected to reach.
        let isAnalyticsOnly = (
            try? self.isAnalyticsOnlyGuestSession(storedGuestSession: storedGuestSession)
        ) ?? true
        guard isAnalyticsOnly == false else {
            return nil
        }

        return storedGuestSession
    }

    /// The stored guest session when this install created it to authenticate analytics and has not
    /// adopted it as its cloud session. Such a credential owns nothing, which is what makes it safe to
    /// hand to the identity link route instead of the guest upgrade flow.
    func loadAnalyticsOnlyGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
        guard let storedGuestSession = try self.loadGuestSessionForCurrentConfiguration() else {
            return nil
        }
        guard try self.isAnalyticsOnlyGuestSession(storedGuestSession: storedGuestSession) else {
            return nil
        }

        return storedGuestSession
    }

    /**
     * Whether the stored guest session is the analytics-only credential, sweeping the marker whenever
     * it names something else.
     *
     * The marker is authoritative only by value: this answers `true` only for the exact token the
     * session record holds. Every guest token the server hands out is freshly random, on a first
     * create and on an idempotency-key rotation alike, so a marker that outlives its session names a
     * value nothing will ever hold again. That is what makes a diverged marker harmless — it
     * mismatches, answers `false`, and is swept right here.
     *
     * The marker and the session record are two Keychain items, so they do diverge: a session record
     * written straight from an active cloud session, a clear that removed only one of the two, or a
     * failed write between them. The sweeps that follow such a divergence — here, in
     * `loadUsableCloudGuestSessionForCurrentConfiguration`, in `clearGuestSessionIfNeeded`, in
     * `createAndStoreGuestCloudSession`'s rollback and in
     * `loadUsableGuestSessionForCurrentConfiguration` — are opportunistic hygiene that stop the
     * sidecar carrying a dead token. They are best-effort because no answer depends on them.
     *
     * Do not replace the value comparison with a presence check. Presence is what would let a stale
     * marker capture the next credential, and it is what would turn those hygiene sweeps into
     * load-bearing steps that must not be skipped. The one sweep that is load-bearing today is the
     * fatal clear in `loadOrCreateGuestCloudSession`, and it is load-bearing precisely because the
     * marker there names the very token being adopted, so the two values do match.
     */
    private func isAnalyticsOnlyGuestSession(storedGuestSession: StoredGuestCloudSession) throws -> Bool {
        guard let analyticsOnlyGuestToken = try self.dependencies.guestCredentialStore.loadAnalyticsOnlyGuestToken() else {
            return false
        }
        guard analyticsOnlyGuestToken == storedGuestSession.guestToken else {
            try? self.dependencies.guestCredentialStore.clearAnalyticsOnlyGuestToken()
            return false
        }

        return true
    }

    private func loadAuthenticatedCloudAccountSnapshot(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) async throws -> CloudAccountSnapshot {
        try await self.cloudRuntime.fetchCloudAccount(
            verifiedContext: CloudVerifiedAuthContext(
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials
            )
        )
    }

    func isAuthenticatedSilentRestoreEligible(
        configuration: CloudServiceConfiguration,
        hasStoredCredentials: Bool,
        hasStoredGuestSession: Bool
    ) throws -> Bool {
        guard configuration.mode == .official else {
            return false
        }
        guard hasStoredCredentials else {
            return false
        }
        guard hasStoredGuestSession == false else {
            return false
        }
        guard self.cloudSettings?.cloudState == .disconnected || self.cloudSettings?.cloudState == .linkingReady else {
            return false
        }

        let database = try requireLocalDatabase(database: self.database)
        return try database.isSafeForAuthenticatedSilentRestore()
    }

    private func selectedWorkspaceForAuthenticatedSilentRestore(
        account: CloudAccountSnapshot
    ) throws -> CloudWorkspaceSummary {
        guard let selectedWorkspace = account.workspaces.first(where: { workspace in
            workspace.isSelected
        }) else {
            throw LocalStoreError.validation("Authenticated cloud account is missing a selected workspace")
        }

        return selectedWorkspace
    }

    private func performAuthenticatedSilentRestore(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        trigger: CloudSyncTrigger
    ) async throws {
        let account = try await self.loadAuthenticatedCloudAccountSnapshot(
            credentials: credentials,
            configuration: configuration
        )
        let selectedWorkspace = try self.selectedWorkspaceForAuthenticatedSilentRestore(account: account)

        do {
            defer {
                self.applyCloudAccountPreferences(account: account)
            }

            try await self.finishCloudLink(
                linkedSession: CloudLinkedSession(
                    userId: account.userId,
                    workspaceId: selectedWorkspace.workspaceId,
                    email: account.email,
                    configurationMode: configuration.mode,
                    apiBaseUrl: configuration.apiBaseUrl,
                    authorization: .bearer(credentials.idToken)
                ),
                trigger: trigger
            )
        }
        // This install has just become `linked` without passing through sign-in. The startup call has
        // already returned, because the state was still `disconnected` when it ran, so without this
        // the claim would wait a whole cold start. Started, never awaited, exactly as at sign-in.
        self.resumeAnalyticsGuestIdentityLinkIfNeeded()
    }

    func restoreAuthenticatedCloudSessionAfterReinstall(
        trigger: CloudSyncTrigger
    ) async throws {
        try await self.withStoredAuthenticatedCredentials { credentials, configuration in
            try await self.performAuthenticatedSilentRestore(
                credentials: credentials,
                configuration: configuration,
                trigger: trigger
            )
        }
    }

    func shouldResetLocalStateAfterAuthenticatedSilentRestoreFailure(error: Error) -> Bool {
        if self.cloudCredentialRecoveryState?.reason == .linkedWorkspaceUnavailable {
            return false
        }
        if error is URLError {
            return true
        }
        if error is CloudAuthError {
            return true
        }
        if error is CloudSyncError {
            return true
        }

        return false
    }

    /**
     Prevents stored credentials from silently restoring a different cloud
     account into local state that still belongs to the previous user.
     */
    @discardableResult
    private func resetLocalStateIfStoredCredentialsBelongToDifferentUser(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) async throws -> Bool {
        guard self.cloudSettings?.cloudState == .linked else {
            return false
        }

        let authenticatedAccount = try await self.loadAuthenticatedCloudAccountSnapshot(
            credentials: credentials,
            configuration: configuration
        )
        guard let linkedUserId = self.cloudSettings?.linkedUserId, linkedUserId.isEmpty == false else {
            return false
        }

        if linkedUserId == authenticatedAccount.userId {
            self.applyCloudAccountPreferences(account: authenticatedAccount)
            return false
        }

        try self.throwIfLinkedWorkspaceUnavailableRecoveryRequired()
        try self.resetLocalStateForCloudIdentityChange()
        return true
    }

    func currentCloudServiceConfiguration() throws -> CloudServiceConfiguration {
        try loadCloudServiceConfiguration(
            bundle: .main,
            userDefaults: self.userDefaults,
            decoder: self.decoder
        )
    }

    func refreshCloudCredentials(forceRefresh: Bool) async throws -> StoredCloudCredentials {
        let configuration = try self.currentCloudServiceConfiguration()
        return try await self.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration
        )
    }

    private func refreshCloudCredentials(
        forceRefresh: Bool,
        configuration: CloudServiceConfiguration
    ) async throws -> StoredCloudCredentials {
        try await self.cloudRuntime.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration,
            now: Date()
        )
    }

    func withStoredAuthenticatedCredentials<Result>(
        operation: @MainActor (StoredCloudCredentials, CloudServiceConfiguration) async throws -> Result
    ) async throws -> Result {
        try self.throwIfCloudCredentialRecoveryRequired()
        if try self.markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(detectedAt: Date()) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        let configuration = try self.currentCloudServiceConfiguration()

        do {
            let credentials = try await self.refreshCloudCredentials(
                forceRefresh: false,
                configuration: configuration
            )
            return try await operation(credentials, configuration)
        } catch {
            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        let refreshedCredentials = try await self.refreshCloudCredentials(
            forceRefresh: true,
            configuration: configuration
        )
        return try await operation(refreshedCredentials, configuration)
    }

    func restoreLinkedSessionFromCredentials(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        trigger: CloudSyncTrigger
    ) async throws {
        if try await self.resetLocalStateIfStoredCredentialsBelongToDifferentUser(
            credentials: credentials,
            configuration: configuration
        ) {
            return
        }

        let linkedSession = try self.cloudRuntime.storedLinkedSession(
            cloudSettings: self.cloudSettings,
            configuration: configuration,
            bearerToken: credentials.idToken
        )
        if self.workspace?.workspaceId == linkedSession.workspaceId {
            try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
        } else {
            try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
        }
        // The other silent restore into a linked session, for the same reason: whatever ran at startup
        // saw the state before this. Started, never awaited, and a no-op unless a claim is owed.
        self.resumeAnalyticsGuestIdentityLinkIfNeeded()
    }

    func clearGuestSessionIfNeeded() throws {
        guard try self.dependencies.guestCredentialStore.loadGuestSession() != nil else {
            // No session record to remove, but the analytics-only marker lives in its own Keychain
            // item and can outlive one. It is swept so the sidecar stops carrying a dead token, not
            // because it could name the next stored session: `isAnalyticsOnlyGuestSession` matches by
            // value and the token it names is gone for good. Best-effort for that reason, and because
            // this runs at the end of a completed cloud link, where credentials are already saved and
            // sync has already started, and no analytics bookkeeping question may fail a sign-in.
            try? self.dependencies.guestCredentialStore.clearAnalyticsOnlyGuestToken()
            return
        }

        try self.dependencies.guestCredentialStore.clearGuestSession()
    }

    /// Clears the stored guest session only while it is still the one named.
    ///
    /// The analytics identity claim suspends, and a logout during it resets local state and lets the
    /// next flush mint a fresh credential. Clearing whatever is stored when the claim finally returns
    /// would destroy that new identity, so the claim clears only the credential it actually linked.
    func clearGuestSessionIfStillStored(guestToken: String) throws {
        guard try self.dependencies.guestCredentialStore.loadGuestSession()?.guestToken == guestToken else {
            return
        }

        try self.dependencies.guestCredentialStore.clearGuestSession()
    }
}
