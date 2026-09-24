import Foundation

@MainActor
extension FlashcardsStore {
    func currentActiveCloudSessionForAI() throws -> CloudLinkedSession {
        try self.throwIfCloudCredentialRecoveryRequired()
        try self.throwIfCustomGuestWorkspacePaused()
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }

        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            throw LocalStoreError.uninitialized("Cloud session is unavailable")
        }

        return activeSession
    }

    func logoutCloudAccount() throws {
        try self.resetLocalStateForCloudIdentityChange()
    }

    /**
     * The deliberate sign-out, from one of the two controls a person presses to leave an account:
     * the account screen's *Log out* and the one inside the sign-in sheet.
     *
     * It reports `signed_out(user_initiated)` and drains the queue here, before the teardown, while
     * the departing person's credential is still live — that is the whole difference from
     * `logoutCloudAccount`, which the sync reconciler also calls when it finds a linked state with
     * no stored session at all. That path is nobody's press: it has no control to show a wait on,
     * and it loses its queued events, which the `signed_out` catalog entry states.
     *
     * The suspension is here and never inside `resetLocalStateForCloudIdentityChange`. That function
     * checks preconditions and then clears credentials, and a suspension between the two would let a
     * sign-in arriving meanwhile believe a boundary ran when it did not.
     *
     * One press is one row. The emit is attached to a discrete confirmation a person gives rather
     * than to the teardown that half a dozen code paths reach, and each caller holds its own
     * in-flight flag so a second tap on the same control does nothing.
     *
     * `hasReportedPendingSignOut` covers the one case those two do not, and is the only marker this
     * design keeps. `logoutCloudAccount` can throw — at `requireLocalDatabase`, `clearCredentials`,
     * `resetForAccountDeletion` or the reload — and both callers correctly restore their control and
     * surface the error, so the person presses again while the first row has already been delivered.
     * The emit cannot simply move after the throwing part instead: the first statement of the
     * teardown is `Analytics.reset()`, which rotates `anonymous_id` and discards the queue, so a row
     * written on the far side is either swept or filed under the next identity — the exact
     * misattribution this whole arrangement exists to prevent. So the retry reuses the row it
     * already wrote. It is released by the identity boundary itself — in
     * `resetLocalStateForCloudIdentityChange`, the moment the departing credential is cleared —
     * rather than here, so a teardown that throws past that point does not strand it set on a
     * device that has already left. A sign-out abandoned before that point and completed much later
     * reports nothing; on an append-only table with no repair path that is the direction to lose in.
     *
     * The flag lives on the store rather than on either view, so it holds across the two controls:
     * both reach the same store instance.
     */
    func signOutCloudAccountFromPressedControl(screen: AnalyticsSurface) async throws {
        if self.hasReportedPendingSignOut {
            await Analytics.drainForPressedControl()
        } else {
            self.hasReportedPendingSignOut = true
            await Analytics.trackAndDrainForPressedControl(
                .signedOut(reason: .userInitiated),
                screen: screen
            )
        }
        try self.logoutCloudAccount()
    }

    func beginAccountDeletion() {
        self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
        self.accountDeletionState = .inProgress
        Task { @MainActor in
            await self.drainAnalyticsBeforeAccountDeletionRequest()
            await self.runPendingAccountDeletion()
        }
    }

    func retryPendingAccountDeletion() {
        self.accountDeletionState = .inProgress
        Task { @MainActor in
            await self.drainAnalyticsBeforeAccountDeletionRequest()
            await self.runPendingAccountDeletion()
        }
    }

    /**
     * The last moment this install's queued events can be delivered when a person deletes their
     * account, so it runs before the deletion request rather than after it.
     *
     * After the request the ingest answers `410 ACCOUNT_DELETED` for this credential before it even
     * reads the batch body, so a drain placed on the far side provably delivers nothing while still
     * costing a wait on a pressed control and arming a retry deferral the next identity inherits.
     * Nothing is reported here for the same reason: `signed_out(account_deleted)` could not be
     * delivered, and writing it anyway would leave a row whose only way to survive is to lose the
     * race with the identity rotation and be filed under the next person.
     *
     * Both callers have already set `accountDeletionState` to `.inProgress`, so the deletion screen
     * is showing its progress while this waits. The resume path deliberately does not call it: that
     * one runs at launch with nobody watching, and its request usually answers `410` anyway.
     */
    private func drainAnalyticsBeforeAccountDeletionRequest() async {
        await Analytics.drainForPressedControl()
    }

    func resumePendingAccountDeletionIfNeeded() async {
        guard self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) else {
            return
        }

        self.accountDeletionState = .inProgress
        await self.runPendingAccountDeletion()
    }

    func dismissAccountDeletionSuccessMessage() {
        self.accountDeletionSuccessMessage = nil
    }

    func cloudSessionForAI() async throws -> CloudLinkedSession {
        try self.throwIfCloudCredentialRecoveryRequired()
        try self.throwIfCustomGuestWorkspacePaused()
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
        if self.cloudSettings?.cloudState == .linked {
            return try await self.prepareAuthenticatedCloudSessionForAI()
        }

        return try await self.prepareGuestCloudSessionForAI()
    }

    func warmUpAuthenticatedCloudSessionForAI() async {
        guard self.cloudSettings?.cloudState == .linked else {
            return
        }

        do {
            _ = try await self.prepareAuthenticatedCloudSessionForAI()
        } catch {
            // A cancellation is the person or the app ending the work, not a failure to report, so
            // it is not warned about either: the same first test every other capture on these paths
            // already applies.
            if isRequestCancellationError(error: error) {
                return
            }

            FlashcardsObservability.captureWarning(
                .aiChatLifecycle(
                    AIChatLifecycleObservation(
                        action: .storeLifecycle,
                        scope: IOSObservationScope(
                            feature: .aiChat,
                            userId: self.cloudSettings?.linkedUserId,
                            workspaceId: self.cloudSettings?.activeWorkspaceId ?? self.cloudSettings?.linkedWorkspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: self.cloudSettings?.cloudState,
                            configurationMode: nil
                        ),
                        sessionId: nil,
                        runId: nil,
                        conversationScopeId: nil,
                        eventType: nil,
                        statusCode: nil,
                        backendCode: nil,
                        backendRequestId: nil,
                        clientRequestId: nil,
                        stage: nil,
                        errorKind: nil,
                        failureKind: "ai_chat_session_warmup_failed",
                        attempt: nil,
                        maxAttempts: nil,
                        delayNanoseconds: nil,
                        outgoingContentCount: nil,
                        contentCount: nil,
                        textLength: nil,
                        summaryLength: nil,
                        suggestionCount: nil,
                        messageCount: nil,
                        contentPartCount: nil,
                        renderedTextCharacterCount: nil,
                        renderedTextUTF8ByteCount: nil,
                        largestRenderedTextPartCharacterCount: nil,
                        largestRenderedTextPartUTF8ByteCount: nil,
                        hasOlderMessages: nil,
                        isError: nil,
                        isStopped: nil,
                        outcome: nil,
                        reason: nil,
                        errorSummary: Flashcards.errorMessage(error: error)
                    )
                )
            )
        }
    }

    private func loadOrCreateGuestCloudSession() async throws -> CloudLinkedSession {
        try self.throwIfCloudCredentialRecoveryRequired()
        try self.throwIfCustomGuestWorkspacePaused()
        let configuration = try self.currentCloudServiceConfiguration()
        let existingGuestSession = try self.loadUsableGuestSessionForCurrentConfiguration()
        if existingGuestSession == nil,
            try self.markCloudCredentialRecoveryForMissingPersistedCredentialsIfNeeded(detectedAt: Date()) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }

        let storedGuestSession: StoredGuestCloudSession
        if let existingGuestSession {
            storedGuestSession = existingGuestSession
        } else {
            // After logout/account deletion the stored guest session is gone and
            // the local installation id has already been regenerated. Creating
            // a session here intentionally starts a brand new guest identity.
            //
            // Through the creation gate, because the analytics credential mint creates guest sessions
            // too: two creations at once would carry the same idempotency key, and the second would
            // revoke the token the first one stored. A mint that is already in flight is joined here
            // rather than duplicated, and its session becomes this install's cloud session below.
            storedGuestSession = try await self.cloudRuntime.createGuestCloudSession { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                return try await self.createAndStoreGuestCloudSession(
                    configuration: configuration,
                    marksAnalyticsOnly: false
                )
            }
        }

        // Whatever this install already held becomes its cloud session here, including a credential
        // minted for analytics alone: one install, one guest identity.
        //
        // The one marker sweep that is deliberately fatal, and the only one that changes an answer.
        // The others meet a marker naming a token the record no longer holds, which
        // `isAnalyticsOnlyGuestSession` mismatches by value and discards on its own, so they are
        // hygiene. Here the marker names the very credential this install is about to run its cloud
        // session on, so the two values do match: survive this line and
        // `loadAnalyticsOnlyGuestSessionForCurrentConfiguration` hands a guest token that owns a
        // workspace to the identity link route, which revokes it. It throws rather than sweeping
        // best-effort because the sidecar read behind it cannot fail — see
        // `GuestCloudCredentialStore.loadSidecar`.
        try self.dependencies.guestCredentialStore.clearAnalyticsOnlyGuestToken()

        return CloudLinkedSession(
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            email: nil,
            configurationMode: storedGuestSession.configurationMode,
            apiBaseUrl: storedGuestSession.apiBaseUrl,
            authorization: .guest(storedGuestSession.guestToken)
        )
    }

    /**
     * Creates one guest session and persists it as this install's guest credential.
     *
     * Call it only inside `cloudRuntime.createGuestCloudSession`: that gate is what keeps the
     * persisted idempotency key describing a single creation attempt at a time, and a second creation
     * carrying the same key rotates the session and revokes the token this one stored.
     *
     * `marksAnalyticsOnly` writes the analytics-only marker first, in the same synchronous step as
     * the session record. A session stored without it reads as a cloud session, which is the one
     * outcome the analytics credential mint exists to avoid.
     */
    func createAndStoreGuestCloudSession(
        configuration: CloudServiceConfiguration,
        marksAnalyticsOnly: Bool
    ) async throws -> StoredGuestCloudSession {
        let idempotencyKey = try self.loadOrCreateGuestSessionCreationIdempotencyKey()
        let createdGuestSession = try await self.dependencies.guestCloudAuthService.createGuestSession(
            apiBaseUrl: configuration.apiBaseUrl,
            configurationMode: configuration.mode,
            idempotencyKey: idempotencyKey
        )
        if marksAnalyticsOnly {
            try self.dependencies.guestCredentialStore.saveAnalyticsOnlyGuestToken(
                guestToken: createdGuestSession.guestToken
            )
        }

        do {
            try self.dependencies.guestCredentialStore.saveGuestSession(session: createdGuestSession)
        } catch {
            if marksAnalyticsOnly {
                // Rolled back so the sidecar does not keep a token this install never stored. Left
                // behind it would still be harmless — `isAnalyticsOnlyGuestSession` matches by value,
                // and no future credential will ever carry that token — which is why this is
                // best-effort and must not replace the failure that brought us here.
                try? self.dependencies.guestCredentialStore.clearAnalyticsOnlyGuestToken()
            }

            throw error
        }

        try self.dependencies.guestCredentialStore.clearGuestSessionCreationIdempotencyKey()
        return createdGuestSession
    }

    private func prepareGuestCloudSessionForAI() async throws -> CloudLinkedSession {
        let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded(
            trigger: CloudSyncTrigger(
                source: .manualSyncNow,
                now: Date(),
                extendsFastPolling: false,
                allowsVisibleChangeBanner: false,
                surfacesGlobalErrorMessage: true,
                capturesTechnicalFailures: false
            )
        )
        return restoredGuestSession.session
    }

    func prepareGuestCloudSessionForUITestLaunch() async throws -> CloudLinkedSession {
        try await self.loadOrCreateGuestCloudSession()
    }

    /**
     Marketing screenshot launches use short-lived guest cloud workspaces.
     Delete any stored guest session remotely before the existing local reset
     boundary so each manual run starts from a clean cloud state.

     If the backend already deleted the guest session, treat the stale local
     token as an already-cleaned state, clear local guest credentials, and
     continue with the reset. Any other delete failure still blocks the run.
     */
    func deleteStoredGuestCloudSessionForUITestCleanupIfNeeded() async throws -> Bool {
        guard let storedGuestSession = try self.loadGuestSessionForCurrentConfiguration() else {
            return false
        }

        do {
            try await self.dependencies.guestCloudAuthService.deleteGuestSession(
                apiBaseUrl: storedGuestSession.apiBaseUrl,
                guestToken: storedGuestSession.guestToken
            )
        } catch {
            guard self.isGuestSessionInvalidError(error) else {
                throw error
            }

            FlashcardsObservability.captureWarning(
                .staleGuestCredentials(
                    StaleGuestCredentialsWarning(
                        scope: IOSObservationScope(
                            feature: .cloudAuth,
                            userId: storedGuestSession.userId,
                            workspaceId: storedGuestSession.workspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: .guest,
                            configurationMode: storedGuestSession.configurationMode
                        ),
                        apiBaseUrl: storedGuestSession.apiBaseUrl,
                        messageSummary: Flashcards.errorMessage(error: error)
                    )
                )
            )
        }

        try self.dependencies.guestCredentialStore.clearGuestSession()
        return true
    }

    private func isGuestSessionInvalidError(_ error: Error) -> Bool {
        guard let guestCloudAuthError = error as? GuestCloudAuthError else {
            return false
        }

        switch guestCloudAuthError {
        case .invalidResponse(let details, let statusCode):
            return statusCode == 401 && details.code == "GUEST_AUTH_INVALID"
        case .invalidBaseUrl, .invalidResponseBody:
            return false
        }
    }

    func restoreGuestCloudSessionIfNeeded(
        trigger: CloudSyncTrigger
    ) async throws -> GuestCloudSessionRestoreResult {
        try await self.cloudRuntime.prepareGuestCloudSession { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            return try await self.performRestoreGuestCloudSessionIfNeeded(trigger: trigger)
        }
    }

    private func performRestoreGuestCloudSessionIfNeeded(
        trigger: CloudSyncTrigger
    ) async throws -> GuestCloudSessionRestoreResult {
        let guestSession = try await self.loadOrCreateGuestCloudSession()
        let isAlreadyGuestLinked = self.cloudSettings?.cloudState == .guest
            && self.workspace?.workspaceId == guestSession.workspaceId
            && self.cloudSettings?.linkedUserId == guestSession.userId

        if isAlreadyGuestLinked {
            self.cloudRuntime.setActiveCloudSession(linkedSession: guestSession)
            if case .failed = self.syncStatus {
                try await self.performSameWorkspaceCloudRestore(linkedSession: guestSession, trigger: trigger)
                return GuestCloudSessionRestoreResult(session: guestSession, didRunSync: true)
            }
            return GuestCloudSessionRestoreResult(session: guestSession, didRunSync: false)
        }

        try await self.finishCloudLink(linkedSession: guestSession, trigger: trigger)
        return GuestCloudSessionRestoreResult(session: guestSession, didRunSync: true)
    }

    func prepareAuthenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        return try await self.cloudRuntime.prepareAuthenticatedCloudSessionForAI(
            restoreCloudLink: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
            },
            resolveSession: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                return try await self.withAuthenticatedCloudSession { session in
                    session
                }
            }
        )
    }

    func restoreCloudLinkFromStoredCredentials(trigger: CloudSyncTrigger) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performRestoreCloudLinkFromStoredCredentials(trigger: trigger)
        }
    }

    /**
     Restores the linked cloud session from persisted credentials. When the
     stored workspace already matches the local workspace, it reuses the
     non-blocking restore path; otherwise it falls back to the full relink flow.
     */
    private func performRestoreCloudLinkFromStoredCredentials(trigger: CloudSyncTrigger) async throws {
        do {
            try await self.withStoredAuthenticatedCredentials { credentials, configuration in
                try await self.restoreLinkedSessionFromCredentials(
                    credentials: credentials,
                    configuration: configuration,
                    trigger: trigger
                )
            }
        } catch {
            // Unwrapped here rather than inside `isCloudAccountDeletedError`: the restore this
            // branch guards fails through `performSameWorkspaceCloudRestore`, which captures the
            // failure and rethrows it boxed in `ObservedTechnicalError`, so the classifier's own
            // `as? CloudSyncError` stops matching the error that actually arrives here. The rule is
            // local: this branch receives an error the restore path has already captured and boxed.
            // It says nothing about the form any other caller of the classifier sees, and the shared
            // classifier stays untouched so no other path changes behaviour.
            if self.isCloudAccountDeletedError(technicalErrorPresentationSource(error: error)) {
                self.handleRemoteAccountDeletedCleanup()
                // The cleanup just erased this install, so there is no restored session to hand
                // back. Returning normally reads as success to every caller, and each one goes
                // straight on to `withAuthenticatedCloudSession`, which fails on the credentials
                // the cleanup removed and stacks a technical error on top of the deletion notice.
                // Ending as a cancellation stops the caller's remaining work quietly instead.
                throw CancellationError()
            }

            // Same already-captured error as the branch above: the restore path boxed it in
            // `ObservedTechnicalError`, so this classification has to look through the box.
            if self.isCloudAuthorizationError(technicalErrorPresentationSource(error: error)) {
                try self.logoutCloudAccount()
            }

            throw error
        }
    }

    func withAuthenticatedCloudSession<Result>(
        operation: (CloudLinkedSession) async throws -> Result
    ) async throws -> Result {
        do {
            return try await self.withStoredAuthenticatedCredentials { credentials, _ in
                let linkedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: credentials)
                return try await operation(linkedSession)
            }
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                throw error
            }

            if self.isCloudAuthorizationError(error) {
                try self.logoutCloudAccount()
            }

            throw error
        }
    }

    func withCloudSessionPreservingStableContext<Result>(
        linkedSession: CloudLinkedSession,
        operation: @MainActor (CloudLinkedSession) async throws -> Result
    ) async throws -> Result {
        switch linkedSession.authorization {
        case .guest:
            return try await operation(linkedSession)
        case .bearer:
            do {
                return try await self.withStoredAuthenticatedCredentials { credentials, _ in
                    let refreshedSession = CloudLinkedSession(
                        userId: linkedSession.userId,
                        workspaceId: linkedSession.workspaceId,
                        email: linkedSession.email,
                        configurationMode: linkedSession.configurationMode,
                        apiBaseUrl: linkedSession.apiBaseUrl,
                        authorization: .bearer(credentials.idToken)
                    )
                    return try await operation(refreshedSession)
                }
            } catch {
                if self.isCloudAccountDeletedError(error) {
                    self.handleRemoteAccountDeletedCleanup()
                }

                if self.isCloudAuthorizationError(error) {
                    try self.logoutCloudAccount()
                }

                throw error
            }
        }
    }

    func runLinkedSyncPreservingSessionContext(
        linkedSession: CloudLinkedSession
    ) async throws -> CloudSyncResult {
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }

        return try await self.withCloudSessionPreservingStableContext(linkedSession: linkedSession) { refreshedSession in
            try await self.runLinkedSync(linkedSession: refreshedSession)
        }
    }

    func runPendingAccountDeletion() async {
        guard self.isAccountDeletionRunning == false else {
            return
        }

        self.isAccountDeletionRunning = true
        defer {
            self.isAccountDeletionRunning = false
        }

        do {
            try await self.performCloudAccountDeletion()
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            if self.isCloudAccountDeletedError(error) {
                return
            }
            if isRequestCancellationError(error: error) {
                return
            }

            if self.shouldPresentAccountDeletionTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.accountDeletionState = .failed
        }
    }

    func performCloudAccountDeletion() async throws {
        try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            try await cloudSyncService.deleteAccount(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                confirmationText: accountDeletionConfirmationText
            )
        }
    }

    func completeLocalAccountDeletion() throws {
        self.userDefaults.removeObject(forKey: accountDeletionPendingUserDefaultsKey)
        try self.resetLocalStateForCloudIdentityChange()
    }

    func handleRemoteAccountDeletedCleanup() {
        do {
            self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            self.presentTechnicalError(error)
            self.accountDeletionState = .failed
        }
    }

    private func shouldPresentAccountDeletionTechnicalError(error: Error) -> Bool {
        if isRequestCancellationError(error: error) {
            return false
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return false
        }
        if self.blockedCloudIdentityConflictMessage(error: error) != nil {
            return false
        }

        return true
    }
}
