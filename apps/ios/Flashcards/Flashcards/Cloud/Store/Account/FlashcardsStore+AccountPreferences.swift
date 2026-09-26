import Foundation

private let accountPreferencesCacheUserDefaultsKey: String = "account-preferences-cache"

/// The most sends one drain will make before leaving the rest owed to the next refresh. A response
/// that keeps disagreeing with the answer this device holds is a server that is not taking the
/// value, and repeating forever would pin the settings screen on a request that cannot succeed.
private let maxProductAnalyticsPushAttempts: Int = 3

/// Why a drain ended with the answer still owed to the identity it was made under.
private enum ProductAnalyticsPushUnsettledReason: String {
    /// Every attempt this drain has was sent and the identity's column still disagrees.
    case attemptsExhausted = "attempts_exhausted"
    /// The identity moved while this push waited for the serialized slot or while a body was in
    /// flight, so the debt is not this push's to pay and stays owed to the identity it was made under.
    case identityChanged = "identity_changed"
    /// The install holds a cloud identity this push cannot address, so nothing here is the right
    /// carrier for the answer and no server was asked at all.
    case carrierUnavailable = "carrier_unavailable"
}

/**
 * A drain that ended with the identity's column still not holding the answer this device owes it.
 *
 * Distinct from a transport failure on purpose: every send may have succeeded, so nothing else in
 * the result says the choice was not stored. Without it an exhausted drain is indistinguishable from
 * a settled one, and the toggle reports a refused privacy choice as saved while the refresh paths
 * report nothing at all.
 */
private struct ProductAnalyticsPushUnsettledError: LocalizedError {
    let reason: ProductAnalyticsPushUnsettledReason

    var errorDescription: String? {
        "Product analytics preference was not stored for this identity (\(self.reason.rawValue))"
    }
}

@MainActor
private final class AccountPreferencesUpdateOutcome {
    var failure: Error?
}

private struct PersistedAccountPreferencesCache: Codable, Hashable {
    var preferencesByIdentityKey: [String: AccountPreferences]
}

/**
 * The identity an answer belongs to, and the two different keys it is stored under.
 *
 * They differ on purpose. Cached preferences are a per-host copy of what one host reported, so their
 * key carries the host. The answer this device still owes the person is not: the official hosts front
 * the same backend and the same account, so a build that changes the configured host must not turn an
 * unpushed opt-out into a debt owed to an identity that no longer matches anything.
 */
private struct AccountPreferencesIdentity: Hashable {
    var userId: String
    var configurationMode: CloudServiceConfigurationMode
    var apiBaseUrl: String

    var storageKey: String {
        "\(self.configurationMode.rawValue)|\(self.apiBaseUrl)|\(self.userId)"
    }

    var productAnalyticsKey: String {
        "\(self.configurationMode.rawValue)|\(self.userId)"
    }
}

@MainActor
extension FlashcardsStore {
    var canPersistAccountPreferences: Bool {
        switch self.cloudSettings?.cloudState {
        case .guest, .linked:
            return true
        case .disconnected, .linkingReady, nil:
            return false
        }
    }

    func refreshCloudAccountContextIfActive() async throws {
        guard self.isAccountPreferencesUpdateInFlight == false else {
            return
        }
        guard let session = try await self.cloudSessionForAccountContextRefresh() else {
            // No cloud session, and for most people there never is one: the only identity this install
            // holds is the analytics-only guest credential. An answer owed to it still has to reach
            // the server, so it goes out here. Its failure is reported rather than thrown: a refresh
            // that only carries a retry must not turn an offline stretch into an error on screen.
            _ = await self.pushProductAnalyticsPreferenceToAnalyticsOnlyGuest(origin: .reconciliation)
            return
        }
        guard self.isAccountPreferencesUpdateInFlight == false else {
            return
        }
        let refreshGeneration = self.accountPreferencesRefreshGeneration
        let refreshIdentity = AccountPreferencesIdentity(
            userId: session.userId,
            configurationMode: session.configurationMode,
            apiBaseUrl: session.apiBaseUrl
        )

        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let accountContext = try await cloudSyncService.fetchCloudAccountContext(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue
        )
        try self.applyRefreshedCloudAccountContext(
            accountContext: accountContext,
            session: session,
            refreshGeneration: refreshGeneration,
            refreshIdentityKey: refreshIdentity.storageKey
        )
        // After the read, never before it. The read is what decides whether anything is owed: an
        // identity with no answer of its own is handed the one this device holds just above, and an
        // identity with its own answer is left alone, because this device keeps its own either way.
        await self.pushPendingProductAnalyticsPreferenceIfNeeded(identity: refreshIdentity)
    }

    func triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: Bool) {
        Task { @MainActor in
            do {
                try await self.refreshCloudAccountContextIfActive()
            } catch {
                if surfacesGlobalErrorMessage {
                    self.globalErrorMessage = Flashcards.errorMessage(error: error)
                }
            }
        }
    }

    /**
     * The product-analytics off switch.
     *
     * The local answer is written and applied to the client before the network is touched, because a
     * refused request must not leave the app recording after the user said no, and because the choice
     * has to hold offline and at the next cold start. The server copy follows when an identity exists;
     * until it accepts it, the answer stays marked as owed and is pushed again by the next account
     * context refresh.
     *
     * The push itself waits for the serialized slot, so the body it sends is read from the debt rather
     * than from `isEnabled`: by then the user may have answered again, and the newest answer is the
     * one the server has to end up holding.
     */
    func updateProductAnalyticsEnabled(isEnabled: Bool) async throws {
        guard self.isProductAnalyticsPreferenceStoredRemotely else {
            // Ahead of the local write, not only of the remote one: recording the answer would also
            // record a debt, and a later normal launch of the same container would then push a
            // UI-test toggle onto the shared review account.
            self.applyStoredProductAnalyticsPreference()
            return
        }

        let identity = self.currentAccountPreferencesIdentity()
        ProductAnalyticsPreference.recordLocalAnswer(
            isEnabled: isEnabled,
            identityKey: identity?.productAnalyticsKey,
            userDefaults: self.userDefaults
        )
        self.applyStoredProductAnalyticsPreference()

        guard self.canPersistAccountPreferences, let identity else {
            // No account and no guest session to store it on. The analytics-only guest credential is
            // the only identity such an install has, and the server keys its refusal on that
            // credential's stored answer, so the push goes there instead. Thrown rather than only
            // reported, unlike the refresh path: this is the user's own tap, and for an install that
            // never signs in this is the whole server side of the answer.
            if let failure = await self.pushProductAnalyticsPreferenceToAnalyticsOnlyGuest(origin: .userAction) {
                throw failure
            }

            return
        }

        let outcome = AccountPreferencesUpdateOutcome()
        await self.serializedAccountPreferencesUpdate {
            let rollbackIdentityKey = self.accountPreferencesIdentityKey
            let updateGeneration = self.accountPreferencesRefreshGeneration
            outcome.failure = await self.drainOwedProductAnalyticsAnswer(
                identityKey: identity.productAnalyticsKey,
                // The press itself, with the switch still waiting on it, so the route stores it even
                // over a stored refusal. Every body this drain sends is a person's: `recordLocalAnswer`
                // just above wrote the debt it reads, `adoptServerAnswer` cannot re-own one while
                // this device holds an answer of its own, and the identity reset that can re-owns it
                // to another identity, which this drain refuses to pay.
                origin: .userAction,
                send: { owedAnswer, origin in
                    try await self.updateCloudAccountPreferences(
                        patch: AccountPreferencesPatchRequest(
                            productAnalyticsEnabled: owedAnswer,
                            productAnalyticsEnabledOrigin: origin
                        ),
                        validateResolvedSession: { session in
                            try self.requireProductAnalyticsIdentity(
                                expectedIdentityKey: identity.productAnalyticsKey,
                                session: session
                            )
                        }
                    )
                },
                applyAcknowledged: { preferences, session in
                    guard self.isCurrentAccountPreferencesUpdate(
                        identityKey: rollbackIdentityKey,
                        updateGeneration: updateGeneration
                    ) else {
                        return
                    }

                    self.applyCloudAccountPreferences(preferences: preferences, session: session)
                }
            )
        }
        if let failure = outcome.failure {
            // The local answer is deliberately not rolled back, unlike the animations path: a refused
            // request must not leave the app recording after the user said no. It stays owed to this
            // identity instead, and the next refresh pushes it again.
            //
            // Thrown unreported and unwrapped on purpose, with no captured-marker handshake like the
            // sync failure path's: this is the user's own attempt, presentation captures it, and an
            // earlier scheduled push that already reported `pending_retry` was a different attempt
            // whose record must not leave this one unrecorded.
            throw failure
        }
    }

    /**
     * A UI-test launch stores nothing server-side.
     *
     * The suites sign into the shared review account, and the client is force-disabled for the whole
     * process anyway, so a smoke or screenshot flow driving this toggle would write a permanent
     * opt-out onto that account for a switch that was never really on.
     */
    private var isProductAnalyticsPreferenceStoredRemotely: Bool {
        isFlashcardsUITestLaunch(processInfo: ProcessInfo.processInfo) == false
    }

    /// Hands the client kill switch the answer this device now holds, and publishes the value the
    /// switch actually took — which a UI-test launch forces off regardless of the stored answer, so
    /// the settings surfaces cannot read "On" while nothing is being recorded.
    func applyStoredProductAnalyticsPreference() {
        let isEnabled = ProductAnalyticsPreference.effectiveIsEnabled(
            userDefaults: self.userDefaults,
            processInfo: ProcessInfo.processInfo
        )
        self.isProductAnalyticsEnabled = isEnabled
        Analytics.setEnabled(isEnabled)
    }

    /// Best effort, and deliberately not fatal to the refresh that calls it: a failed push leaves the
    /// answer owed, so the next refresh sends it again. The answer itself is safe either way, because
    /// it was given on this device and nothing the server reports replaces one of those.
    private func pushPendingProductAnalyticsPreferenceIfNeeded(
        identity: AccountPreferencesIdentity
    ) async {
        guard self.isProductAnalyticsPreferenceStoredRemotely else {
            return
        }
        let productAnalyticsIdentityKey = identity.productAnalyticsKey
        guard ProductAnalyticsPreference.answerOwed(
            toIdentityKey: productAnalyticsIdentityKey,
            userDefaults: self.userDefaults
        ) != nil else {
            return
        }

        let outcome = AccountPreferencesUpdateOutcome()
        await self.serializedAccountPreferencesUpdate {
            // Read inside the slot rather than before it: this push may have waited for another one,
            // and the guard is about what changed while *this* body was in flight.
            let pushGeneration = self.accountPreferencesRefreshGeneration
            let pushIdentityKey = self.accountPreferencesIdentityKey
            outcome.failure = await self.drainOwedProductAnalyticsAnswer(
                identityKey: productAnalyticsIdentityKey,
                // Nobody is pressing anything here. This is an answer an earlier press left owed -
                // possibly days earlier, possibly made for an identity this install has since left,
                // and `adoptServerAnswer` re-owes one to an identity the person never answered for
                // at all - while the account may have moved past it on another device meanwhile.
                origin: .reconciliation,
                send: { owedAnswer, origin in
                    // Resolved here rather than reused from the refresh that reached this push: the
                    // wait for the slot is unbounded, and a bearer captured before it can already be
                    // expired by the time the body goes out. Which is also why the identity is
                    // re-checked on the resolved session — resolving it suspends, and the identity
                    // can move inside that suspension.
                    try await self.updateCloudAccountPreferences(
                        patch: AccountPreferencesPatchRequest(
                            productAnalyticsEnabled: owedAnswer,
                            productAnalyticsEnabledOrigin: origin
                        ),
                        validateResolvedSession: { session in
                            try self.requireProductAnalyticsIdentity(
                                expectedIdentityKey: productAnalyticsIdentityKey,
                                session: session
                            )
                        }
                    )
                },
                applyAcknowledged: { preferences, acknowledgedSession in
                    guard self.isCurrentAccountPreferencesUpdate(
                        identityKey: pushIdentityKey,
                        updateGeneration: pushGeneration
                    ) else {
                        return
                    }

                    self.applyCloudAccountPreferences(
                        preferences: preferences,
                        session: acknowledgedSession
                    )
                }
            )
        }

        guard let failure = outcome.failure else {
            return
        }

        let stage: String = failure is ProductAnalyticsPushUnsettledError
            ? "pending_unsettled"
            : "pending_retry"
        self.reportProductAnalyticsPushFailure(error: failure, stage: stage)
    }

    /**
     * One report per stage for the life of the process, and nothing at all for a failure that only
     * says the network was unreachable.
     *
     * Every stage here runs on a schedule rather than on a user action: an install whose answer is
     * still owed retries it on every launch and every foreground. Unguarded, an opted-out install that
     * cannot settle — offline, or holding a revoked credential — turns one offline stretch into a
     * Sentry issue per launch across that whole cohort, which is exactly what the guard on the
     * analytics guest credential's background path exists to prevent.
     *
     * The unsettled stages still report. They are not transport failures, and an answer the server
     * keeps refusing to hold is the thing worth knowing about; the dedupe alone is what keeps them
     * from repeating per launch.
     *
     * Returns whether this stage now has a Sentry record — true when this call captured, and also
     * true when the dedupe suppressed it because the same stage already captured in this process.
     * False means nothing was recorded and nothing ever will be for this failure, which is the only
     * answer a caller may not wrap as already observed: doing so would both hide it from Sentry and
     * blind every classifier downstream, and the transport failures filtered here are exactly the
     * ones the surfaces want to recognise so they can say "the network" instead of raising a
     * technical dialog.
     */
    @discardableResult
    private func reportProductAnalyticsPushFailure(error: Error, stage: String) -> Bool {
        if isRequestCancellationError(error: error) {
            return false
        }
        if isSilentlyIgnorableNetworkTransportFailure(error: error) {
            return false
        }
        guard self.reportedProductAnalyticsPushFailureStages.contains(stage) == false else {
            return true
        }

        self.reportedProductAnalyticsPushFailureStages.insert(stage)
        self.captureAccountPreferencesSilentFailure(
            error: error,
            action: "product_analytics_preference_push",
            stage: stage
        )
        return true
    }

    /**
     * The answer for an install whose only identity is the analytics-only guest credential.
     *
     * That is the common case for someone who never signed in: `cloudState` stays `.disconnected`, so
     * nothing above this can store the answer. The server keys its ingest-time refusal on the stored
     * answer of the credential a request carries, so without this push the backstop could never
     * engage for that whole cohort and the debt would never be settled.
     *
     * Returns the failure for the caller that must not report the answer as stored. It is marked as
     * captured only when the report above actually reached Sentry, so presenting it cannot report it
     * a second time; a failure the reporter deliberately records nothing for is returned unwrapped,
     * so the settings screen can still recognise a plain network problem and say so softly. Nil means
     * nothing was owed, the column now holds it, or nothing could carry it yet — which is not the
     * same as this being the wrong credential to ask, and the two are told apart below.
     */
    private func pushProductAnalyticsPreferenceToAnalyticsOnlyGuest(
        origin: AnalyticsPreferenceWriteOrigin
    ) async -> Error? {
        guard self.isProductAnalyticsPreferenceStoredRemotely else {
            return nil
        }
        guard ProductAnalyticsPreference.answerOwed(
            toIdentityKey: nil,
            userDefaults: self.userDefaults
        ) != nil else {
            return nil
        }

        let storedGuestSession: StoredGuestCloudSession?
        do {
            storedGuestSession = try self.loadAnalyticsOnlyGuestSessionForCurrentConfiguration()
        } catch {
            // A Keychain read failure is not a transport failure, so it reports on its first
            // occurrence in this process and reaches the dialog wrapped; nothing is sent on this
            // path, so the report here is the only one it will ever get.
            let didCapture = self.reportProductAnalyticsPushFailure(
                error: error,
                stage: "analytics_guest_load"
            )
            return didCapture ? markTechnicalErrorObserved(error: error) : error
        }
        guard storedGuestSession != nil else {
            // Two different situations, and only one of them is harmless. A `.disconnected` install
            // has no analytics-only credential minted yet, so nothing could carry the answer and the
            // next refresh tries again. A `.guest` or `.linked` install reaches here only because its
            // own user id has not resolved, and the analytics-only credential is not that identity's
            // carrier at all — no server was asked, and reporting success would tell the person their
            // refusal was stored when nothing holds it.
            guard self.canPersistAccountPreferences else {
                return nil
            }

            let unsettledError = ProductAnalyticsPushUnsettledError(reason: .carrierUnavailable)
            let didCapture = self.reportProductAnalyticsPushFailure(
                error: unsettledError,
                stage: "analytics_guest_carrier_unavailable"
            )
            return didCapture ? markTechnicalErrorObserved(error: unsettledError) : unsettledError
        }

        let outcome = AccountPreferencesUpdateOutcome()
        await self.serializedAccountPreferencesUpdate {
            outcome.failure = await self.drainOwedProductAnalyticsAnswer(
                identityKey: nil,
                // The caller's, because this credential carries both kinds: the toggle on an install
                // with no account to store the answer on reaches it with the press in hand, and the
                // refresh reaches it with a retry.
                origin: origin,
                send: { owedAnswer, sendOrigin in
                    // Re-read here rather than reused from the load above, for the same reason the
                    // linked path resolves its session at send time: the wait for the slot is
                    // unbounded, and an identity reset landing in that window replaces the very
                    // credential this answer has to reach.
                    guard let guestSession = try self.loadAnalyticsOnlyGuestSessionForCurrentConfiguration() else {
                        throw LocalStoreError.uninitialized("Analytics-only guest credential is unavailable")
                    }

                    // The guest columns are not guarded the way the account ones are - one
                    // credential on one device is the only writer either has - so the origin decides
                    // nothing there today. Sent anyway, because it is a statement about where this
                    // answer came from rather than about which column receives it, and the guard
                    // moves to that path the day a client reconciles a guest column from a
                    // remembered one.
                    return try await self.updateCloudAccountPreferences(
                        patch: AccountPreferencesPatchRequest(
                            productAnalyticsEnabled: owedAnswer,
                            productAnalyticsEnabledOrigin: sendOrigin
                        ),
                        session: CloudLinkedSession(
                            userId: guestSession.userId,
                            workspaceId: guestSession.workspaceId,
                            email: nil,
                            configurationMode: guestSession.configurationMode,
                            apiBaseUrl: guestSession.apiBaseUrl,
                            authorization: .guest(guestSession.guestToken)
                        )
                    )
                },
                // Deliberately not applied to `accountPreferences`: this credential is not a cloud
                // session and owns no account-preferences identity, so only the debt is settled here.
                applyAcknowledged: { _, _ in }
            )
        }

        guard let failure = outcome.failure,
            isRequestCancellationError(error: failure) == false else {
            return nil
        }

        let stage: String = failure is ProductAnalyticsPushUnsettledError
            ? "analytics_guest_unsettled"
            : "analytics_guest_retry"
        let didCapture = self.reportProductAnalyticsPushFailure(error: failure, stage: stage)
        return didCapture ? markTechnicalErrorObserved(error: failure) : failure
    }

    // Share one slot because each response and rollback owns a complete preferences snapshot.
    private func serializedAccountPreferencesUpdate(
        _ body: @escaping @Sendable @MainActor () async -> Void
    ) async {
        while let inFlight = self.accountPreferencesUpdateTask {
            await inFlight.value
            if self.accountPreferencesUpdateTask == inFlight {
                self.accountPreferencesUpdateTask = nil
            }
        }

        let push = Task { @MainActor in
            self.accountPreferencesRefreshGeneration += 1
            let updateGeneration = self.accountPreferencesRefreshGeneration
            self.isAccountPreferencesUpdateInFlight = true
            defer { self.releaseAccountPreferencesUpdateInFlight(updateGeneration: updateGeneration) }
            await body()
        }
        self.accountPreferencesUpdateTask = push
        await push.value
        if self.accountPreferencesUpdateTask == push {
            self.accountPreferencesUpdateTask = nil
        }
    }

    /**
     * Sends the answer this device owes `identityKey` until that identity's column holds it.
     *
     * Runs inside the serialized slot, so no other product-analytics PATCH is outstanding while it
     * does. The loop is the other half of that guarantee: the user can still answer again while a body
     * is in flight, because the local write happens before the slot is taken, and the response then
     * acknowledges a value this device no longer holds. Sending the newer answer right here, before
     * the slot is released, is what keeps the server from settling on a value nobody chose — the debt
     * is cleared only once the acknowledged value and the owed answer agree, so a mismatch or a
     * failure always leaves a retry behind for the next refresh.
     *
     * `origin` says who asked for what this drain delivers, and every body it sends carries it. It is
     * fixed for the whole drain because it is decided by the path that reached it, not by how many
     * attempts this answer has had or how long it has been owed: a press being handled right now,
     * with the control still waiting, is `userAction`, and an answer this device is carrying from
     * before is `reconciliation`. So a first attempt that fails is already reconciled the next time a
     * refresh picks it up, seconds later or days later alike - what makes the claim "a person is
     * asking for this, now" false is that they may have answered again elsewhere since, and no
     * elapsed time makes that safer. Within one drain the claim keeps holding, including on the
     * attempt that carries an answer the person gave while the previous body was in flight.
     *
     * Handed to `send` rather than captured by each closure, even where the caller already knows it
     * as a literal: the refusal below is classified on this same value, so the body and the
     * classification cannot name different origins. A closure writing its own literal would put that
     * agreement back in two places on every call site.
     *
     * Returns nil once a response has confirmed that `identityKey`'s column holds the answer, and
     * also when the route refused a `reconciliation` for loosening what it already holds - that is
     * the guard working rather than a failure, the answer stays owed, and nothing is reported. A
     * drain that ran every attempt it has without the column agreeing, or that stopped because the
     * identity moved, returns `ProductAnalyticsPushUnsettledError` instead of falling out silently:
     * the answer is not stored, and a caller that cannot tell that apart from success reports a
     * refused privacy choice as saved.
     *
     * "Nothing is owed to `identityKey` any more" is deliberately not read as success. An identity
     * reset landing while a body is in flight re-owes the answer to the credential this install holds
     * next, which empties this identity's debt without any server having taken the value, and the
     * drain would otherwise close on an empty debt and report the choice as saved.
     */
    private func drainOwedProductAnalyticsAnswer(
        identityKey: String?,
        origin: AnalyticsPreferenceWriteOrigin,
        send: (Bool, AnalyticsPreferenceWriteOrigin) async throws -> (
            preferences: AccountPreferences,
            session: CloudLinkedSession
        ),
        applyAcknowledged: (AccountPreferences, CloudLinkedSession) -> Void
    ) async -> Error? {
        var failure: Error?
        var didSend = false
        var didSettle = false
        var didRefuseReconciliation = false
        var unsettledReason: ProductAnalyticsPushUnsettledReason = .attemptsExhausted

        drainLoop: for _ in 0 ..< maxProductAnalyticsPushAttempts {
            guard let owedAnswer = ProductAnalyticsPreference.answerOwed(
                toIdentityKey: identityKey,
                userDefaults: self.userDefaults
            ) else {
                // Nothing is owed to this identity before an attempt was even made. Either no debt
                // exists anywhere, which means an earlier push already stored it, or the debt moved
                // to another identity while this one waited for the slot — and that stored nothing.
                if ProductAnalyticsPreference.isAnswerOwedToAnyIdentity(userDefaults: self.userDefaults) {
                    unsettledReason = .identityChanged
                } else {
                    didSettle = true
                }
                break drainLoop
            }
            // Checked at send time rather than once before the slot: this push may have waited behind
            // another one, and a sign-in or a guest upgrade landing in that window moves the identity
            // the send would now resolve. A debt made under the identity that left must never be
            // PATCHed onto the one that replaced it, so it stays owed and this drain reports it.
            guard self.currentAccountPreferencesIdentity()?.productAnalyticsKey == identityKey else {
                unsettledReason = .identityChanged
                break drainLoop
            }

            let updateResult: (preferences: AccountPreferences, session: CloudLinkedSession)
            do {
                // The identity goes into the send rather than staying behind in the guard above: the
                // send suspends for a credential refresh and resolves the session from whatever
                // identity is current afterwards, so a sign-out and sign-in completing inside that
                // window would otherwise PATCH this debt onto the account that replaced it and
                // overwrite that person's own answer.
                updateResult = try await send(owedAnswer, origin)
            } catch {
                failure = error
                break drainLoop
            }

            didSend = true
            applyAcknowledged(updateResult.preferences, updateResult.session)
            switch ProductAnalyticsPreference.settlePush(
                acknowledged: updateResult.preferences.productAnalyticsEnabled,
                identityKey: identityKey,
                userDefaults: self.userDefaults
            ) {
            case .settled:
                didSettle = true
                break drainLoop
            case .debtMoved:
                unsettledReason = .identityChanged
                break drainLoop
            case .disagreed:
                // A reconciliation the route refused, recognised by the only disagreement the guard
                // can produce and by nothing else:
                //
                // - the origin was `reconciliation`, because a `userAction` is never refused;
                // - the direction was the guarded one, an owed `true` answered with a stored
                //   `false`. The route refuses only that. A reconciled opt-out answered with `true`
                //   is some other disagreement, and calling it the guard would report success while
                //   nothing stored the answer;
                // - the acknowledged value is an explicit `false` rather than nil. The field is
                //   nullable because the column is, and nil means nobody has answered on that row
                //   (`db/migrations/0149_product_analytics_off_switch.sql`) rather than that a
                //   stored refusal stood. It leaves the owed answer unstored, so it has to keep
                //   burning attempts and filing `pending_unsettled`;
                // - the same answer is still owed now, so nothing was answered again while the body
                //   was in flight - that is the race this loop exists for, and it must keep retrying.
                //
                // Repeating an identical body earns an identical refusal, so this drain stops here
                // rather than spending its remaining attempts on it.
                //
                // The debt survives, and deliberately is not retired: it is undelivered, not doomed.
                // The next press sends it as `userAction` and the route stores it, and until then
                // every refresh re-offers it and the account takes it as soon as it is no longer the
                // looser answer. Not an error either - the guard refusing a carried-over answer is
                // the guard working - so nothing is reported for it.
                let isRefusedLoosening = origin == .reconciliation
                    && owedAnswer
                    && updateResult.preferences.productAnalyticsEnabled == false
                    && ProductAnalyticsPreference.answerOwed(
                        toIdentityKey: identityKey,
                        userDefaults: self.userDefaults
                    ) == owedAnswer
                if isRefusedLoosening {
                    didRefuseReconciliation = true
                    break drainLoop
                }

                continue drainLoop
            }
        }

        if didSend {
            // On every push path rather than only the ones that apply preferences. A push never writes
            // the stored answer any more, so this only republishes it — and it is what stops the
            // switch on screen from drifting away from the answer this device holds.
            self.applyStoredProductAnalyticsPreference()
        }

        if let failure {
            return failure
        }
        guard didSettle || didRefuseReconciliation else {
            return ProductAnalyticsPushUnsettledError(reason: unsettledReason)
        }

        return nil
    }

    /**
     * Releases the in-flight flag whenever this update still owns it.
     *
     * Guarded on the generation alone, unlike the write itself: every update bumps the generation
     * before raising the flag, so an unchanged generation means nobody else took it over. The identity
     * key is deliberately not part of this check, because a sign-in landing mid-flight moves it
     * without bumping the generation — leaving nobody to own the flag, and
     * `refreshCloudAccountContextIfActive` returning at its first guard for the rest of the process.
     */
    private func releaseAccountPreferencesUpdateInFlight(updateGeneration: Int) {
        guard self.accountPreferencesRefreshGeneration == updateGeneration else {
            return
        }

        self.isAccountPreferencesUpdateInFlight = false
    }

    /**
     * The stored answer for this identity, as the server reports it.
     *
     * The settled rule decides what happens to it: the answer given on this device wins on this
     * device, so a reported value is adopted only over a mirror of an earlier one or over nothing, and
     * an identity that reports none is handed the answer this device gave. A remote change made on
     * another device therefore does not re-enable recording here; this device's own switch does.
     */
    private func adoptServerProductAnalyticsPreference(
        preferences: AccountPreferences,
        productAnalyticsIdentityKey: String
    ) {
        ProductAnalyticsPreference.adoptServerAnswer(
            preferences.productAnalyticsEnabled,
            identityKey: productAnalyticsIdentityKey,
            userDefaults: self.userDefaults
        )
        self.applyStoredProductAnalyticsPreference()
    }

    func updateReviewReactionAnimationsEnabled(isEnabled: Bool) async throws {
        let identityKey = self.accountPreferencesIdentityKey
        let identityGeneration = self.accentColorIdentityGeneration
        let outcome = AccountPreferencesUpdateOutcome()
        await self.serializedAccountPreferencesUpdate {
            guard self.accountPreferencesIdentityKey == identityKey,
                  self.accentColorIdentityGeneration == identityGeneration else {
                outcome.failure = LocalStoreError.validation("The account changed before review animations could be saved")
                return
            }
            let previousPreferences = self.accountPreferences
            let updateGeneration = self.accountPreferencesRefreshGeneration
            self.accountPreferences = AccountPreferences(
                reviewReactionAnimationsEnabled: isEnabled,
                productAnalyticsEnabled: previousPreferences.productAnalyticsEnabled,
                accentColor: previousPreferences.accentColor
            )

            do {
                let updateResult = try await self.updateCloudAccountPreferences(
                    patch: AccountPreferencesPatchRequest(reviewReactionAnimationsEnabled: isEnabled),
                    validateResolvedSession: { session in
                        let identity = AccountPreferencesIdentity(
                            userId: session.userId,
                            configurationMode: session.configurationMode,
                            apiBaseUrl: session.apiBaseUrl
                        )
                        guard identity.storageKey == identityKey,
                              self.accountPreferencesIdentityKey == identityKey,
                              self.accentColorIdentityGeneration == identityGeneration else {
                            throw LocalStoreError.validation("The account changed before review animations could be saved")
                        }
                    }
                )
                if self.isCurrentAccountPreferencesUpdate(
                    identityKey: identityKey,
                    updateGeneration: updateGeneration
                ), self.accentColorIdentityGeneration == identityGeneration {
                    self.applyCloudAccountPreferences(preferences: updateResult.preferences, session: updateResult.session)
                }
            } catch {
                if self.isCurrentAccountPreferencesUpdate(
                    identityKey: identityKey,
                    updateGeneration: updateGeneration
                ), self.accentColorIdentityGeneration == identityGeneration {
                    self.accountPreferences = previousPreferences
                }
                outcome.failure = error
            }
        }
        if let failure = outcome.failure {
            throw failure
        }
        self.triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: false)
    }

    func selectAccentColor(_ color: AccountAccentColor) throws {
        guard self.canPersistAccountPreferences, let identityKey = self.accountPreferencesIdentityKey else {
            throw LocalStoreError.uninitialized("Cloud account is unavailable")
        }
        guard color == .defaultColor || self.canUseCustomAccentColor else {
            throw LocalStoreError.validation("A custom accent color requires Premium")
        }
        if self.pendingAccentColor?.color == color {
            return
        }
        guard self.effectiveAccountAccentColor != color || self.accountPreferences.accentColor != color else {
            return
        }
        self.pendingAccentColor = PendingAccountAccentColor(
            id: UUID(),
            identityKey: identityKey,
            identityGeneration: self.accentColorIdentityGeneration,
            color: color
        )
        guard self.isAccentColorSaveScheduled == false else { return }
        self.isAccentColorSaveScheduled = true
        // Store ownership keeps the final choice alive after the settings screen disappears.
        Task { @MainActor in
            defer { self.isAccentColorSaveScheduled = false }
            while let pending = self.pendingAccentColor {
                do {
                    try await Task.sleep(for: .milliseconds(300))
                    guard self.pendingAccentColor?.id == pending.id else { continue }
                    guard pending.identityKey == self.accountPreferencesIdentityKey else {
                        self.pendingAccentColor = nil
                        continue
                    }
                    try await self.updateAccentColor(pending)
                    if self.pendingAccentColor?.id == pending.id {
                        self.pendingAccentColor = nil
                    }
                } catch {
                    if self.pendingAccentColor?.id == pending.id {
                        self.pendingAccentColor = nil
                    }
                    if pending.identityKey == self.accountPreferencesIdentityKey,
                       pending.identityGeneration == self.accentColorIdentityGeneration {
                        self.presentTechnicalError(error)
                    }
                }
            }
        }
    }

    private func updateAccentColor(_ selection: PendingAccountAccentColor) async throws {
        let outcome = AccountPreferencesUpdateOutcome()
        await self.serializedAccountPreferencesUpdate {
            do {
                guard self.pendingAccentColor?.id == selection.id else { return }
                guard selection.color == .defaultColor || self.canUseCustomAccentColor else {
                    throw LocalStoreError.validation("A custom accent color requires Premium")
                }
                let updateGeneration = self.accountPreferencesRefreshGeneration
                let updateResult = try await self.updateCloudAccountPreferences(
                    patch: AccountPreferencesPatchRequest(accentColor: selection.color),
                    validateResolvedSession: { session in
                        let identity = AccountPreferencesIdentity(
                            userId: session.userId,
                            configurationMode: session.configurationMode,
                            apiBaseUrl: session.apiBaseUrl
                        )
                        guard identity.storageKey == selection.identityKey,
                              self.accountPreferencesIdentityKey == selection.identityKey,
                              self.accentColorIdentityGeneration == selection.identityGeneration else {
                            throw LocalStoreError.validation("The account changed before the accent color could be saved")
                        }
                    }
                )
                guard self.isCurrentAccountPreferencesUpdate(
                    identityKey: selection.identityKey,
                    updateGeneration: updateGeneration
                ), self.accentColorIdentityGeneration == selection.identityGeneration else { return }
                self.applyCloudAccountPreferences(preferences: updateResult.preferences, session: updateResult.session)
            } catch {
                outcome.failure = error
            }
        }
        if let failure = outcome.failure {
            throw failure
        }
    }

    func applyCloudAccountPreferences(account: CloudAccountSnapshot) {
        guard let configuration = try? self.currentCloudServiceConfiguration() else {
            return
        }

        let identity = AccountPreferencesIdentity(
            userId: account.userId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        guard self.currentAccountPreferencesIdentity() == identity else {
            return
        }

        self.applyCloudAccountPreferences(preferences: account.preferences, identity: identity)
    }

    func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        linkContext: CloudWorkspaceLinkContext
    ) {
        guard let configuration = try? self.currentCloudServiceConfiguration(),
            configuration.apiBaseUrl == linkContext.apiBaseUrl else {
            return
        }

        self.applyCloudAccountPreferences(
            preferences: preferences,
            userId: linkContext.userId,
            configurationMode: configuration.mode,
            apiBaseUrl: linkContext.apiBaseUrl
        )
    }

    func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        userId: String,
        configurationMode: CloudServiceConfigurationMode,
        apiBaseUrl: String
    ) {
        let identity = AccountPreferencesIdentity(
            userId: userId,
            configurationMode: configurationMode,
            apiBaseUrl: apiBaseUrl
        )
        guard self.currentAccountPreferencesIdentity() == identity else {
            return
        }
        self.applyCloudAccountPreferences(preferences: preferences, identity: identity)
    }

    func reloadCachedAccountPreferencesForCurrentIdentity() {
        let previousIdentityKey = self.accountPreferencesIdentityKey
        guard let identity = self.currentAccountPreferencesIdentity() else {
            self.accountPreferencesIdentityKey = nil
            self.accountPreferences = makeDefaultAccountPreferences()
            return
        }

        let identityKey = identity.storageKey
        self.accountPreferencesIdentityKey = identityKey
        let cache = self.loadPersistedAccountPreferencesCache()
        if let preferences = self.cachedAccountPreferences(cache: cache, identityKey: identityKey) {
            self.accountPreferences = preferences
        } else if previousIdentityKey != identityKey {
            self.accountPreferences = makeDefaultAccountPreferences()
        }
    }

    func resetAccountPreferencesForCloudIdentityReset() {
        // An answer given on this device is deliberately not cleared with the rest: it is the
        // person's own privacy choice, so it survives the identity change instead of silently
        // reverting to the default, and becomes owed to the credential this install obtains next. A
        // value only mirrored from the identity that left is dropped with it, which is what the
        // republish below is for.
        ProductAnalyticsPreference.clearIdentityBindingForCloudIdentityReset(userDefaults: self.userDefaults)
        self.applyStoredProductAnalyticsPreference()
        self.accountPreferencesIdentityKey = nil
        self.pendingAccentColor = nil
        self.accountPreferencesRefreshGeneration += 1
        self.isAccountPreferencesUpdateInFlight = false
        self.clearProductAnalyticsPushFailureReportsForCloudIdentityReset()
        self.accountPreferences = makeDefaultAccountPreferences()
        self.userDefaults.removeObject(forKey: accountPreferencesCacheUserDefaultsKey)
        self.communityProfileRefreshGeneration += 1
        self.isCommunityProfileUpdateInFlight = false
        self.communityPublicProfile = nil
    }

    /**
     * Re-arms the per-stage push-failure dedupe at a cloud identity boundary.
     *
     * Suppression state belongs to the identity that is leaving, exactly as it does for the sync
     * failure reporter `Analytics.reset` re-arms at this same boundary: the debt is re-owed to
     * whatever credential this install obtains next, and a stage reported under the outgoing identity
     * must not silence that new identity's first genuinely unsettled push. A suppressed report is
     * also returned as captured, so leaving the set alone would additionally wrap such a failure on
     * the toggle path and rob presentation of its own capture.
     *
     * Every site that clears the answer's identity binding calls this too: this reset,
     * `switchCloudServer`, and the credential reconciliation in `FlashcardsStore+CloudSync`. All
     * three are one-shot, so re-arming there cannot reopen the per-launch flood the dedupe exists to
     * prevent.
     */
    func clearProductAnalyticsPushFailureReportsForCloudIdentityReset() {
        self.reportedProductAnalyticsPushFailureStages = []
    }

    /**
     * Resolves the session, lets the caller reject it, and only then sends the body.
     *
     * The hook exists for the product-analytics debt, which is owed to one identity and must never be
     * paid onto another. Resolving a `.linked` session suspends for a credential refresh and comes
     * back with whatever identity is current after that suspension, so a check made before this call
     * does not hold across it. This one does, because it runs on the very session the PATCH goes out
     * under.
     */
    private func updateCloudAccountPreferences(
        patch: AccountPreferencesPatchRequest,
        validateResolvedSession: (CloudLinkedSession) throws -> Void
    ) async throws -> (preferences: AccountPreferences, session: CloudLinkedSession) {
        switch self.cloudSettings?.cloudState {
        case .linked:
            _ = try await self.linkedCloudSessionForAccountContextRefresh()
            return try await self.withAuthenticatedCloudSession { session in
                try validateResolvedSession(session)
                return try await self.updateCloudAccountPreferences(patch: patch, session: session)
            }
        case .guest:
            let session = try self.guestCloudSessionForAccountContextRefresh()
            try validateResolvedSession(session)
            return try await self.updateCloudAccountPreferences(patch: patch, session: session)
        case .disconnected, .linkingReady, nil:
            throw LocalStoreError.uninitialized("Cloud account is unavailable")
        }
    }

    /// Refuses a resolved session that is not the identity the owed answer was made under, so the debt
    /// stays owed to that identity instead of overwriting the answer of the one that replaced it.
    private func requireProductAnalyticsIdentity(
        expectedIdentityKey: String,
        session: CloudLinkedSession
    ) throws {
        let resolvedIdentityKey = AccountPreferencesIdentity(
            userId: session.userId,
            configurationMode: session.configurationMode,
            apiBaseUrl: session.apiBaseUrl
        ).productAnalyticsKey
        guard resolvedIdentityKey == expectedIdentityKey else {
            throw ProductAnalyticsPushUnsettledError(reason: .identityChanged)
        }
    }

    private func isCurrentAccountPreferencesUpdate(
        identityKey: String?,
        updateGeneration: Int
    ) -> Bool {
        self.accountPreferencesRefreshGeneration == updateGeneration
            && self.accountPreferencesIdentityKey == identityKey
    }

    private func updateCloudAccountPreferences(
        patch: AccountPreferencesPatchRequest,
        session: CloudLinkedSession
    ) async throws -> (preferences: AccountPreferences, session: CloudLinkedSession) {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let updatedPreferences = try await cloudSyncService.updateAccountPreferences(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue,
            patch: patch
        )
        return (updatedPreferences, session)
    }

    func cloudSessionForAccountContextRefresh() async throws -> CloudLinkedSession? {
        try self.throwIfCloudCredentialRecoveryRequired()
        switch self.cloudSettings?.cloudState {
        case .linked:
            return try await self.linkedCloudSessionForAccountContextRefresh()
        case .guest:
            return try self.guestCloudSessionForAccountContextRefresh()
        case .disconnected, .linkingReady, nil:
            return nil
        }
    }

    private func linkedCloudSessionForAccountContextRefresh() async throws -> CloudLinkedSession {
        if try self.markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(detectedAt: Date()) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }

        return try await self.withStoredAuthenticatedCredentials { credentials, configuration in
            let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
            guard cloudSettings.cloudState == .linked else {
                throw LocalStoreError.uninitialized("Cloud account is not linked")
            }
            guard let linkedUserId = cloudSettings.linkedUserId, linkedUserId.isEmpty == false else {
                throw LocalStoreError.uninitialized("Linked user is unavailable")
            }
            let workspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
            guard let workspaceId, workspaceId.isEmpty == false else {
                throw LocalStoreError.uninitialized("Linked workspace is unavailable")
            }

            let session = CloudLinkedSession(
                userId: linkedUserId,
                workspaceId: workspaceId,
                email: cloudSettings.linkedEmail,
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl,
                authorization: .bearer(credentials.idToken)
            )
            self.cloudRuntime.setActiveCloudSession(linkedSession: session)
            return session
        }
    }

    private func guestCloudSessionForAccountContextRefresh() throws -> CloudLinkedSession {
        if try self.markCloudCredentialRecoveryForMissingPersistedCredentialsIfNeeded(detectedAt: Date()) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        guard let storedGuestSession = try self.loadUsableGuestSessionForCurrentConfiguration() else {
            throw LocalStoreError.uninitialized("Guest cloud session is unavailable")
        }

        let session = CloudLinkedSession(
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            email: nil,
            configurationMode: storedGuestSession.configurationMode,
            apiBaseUrl: storedGuestSession.apiBaseUrl,
            authorization: .guest(storedGuestSession.guestToken)
        )
        self.cloudRuntime.setActiveCloudSession(linkedSession: session)
        return session
    }

    private func applyRefreshedCloudAccountContext(
        accountContext: CloudAccountContext,
        session: CloudLinkedSession,
        refreshGeneration: Int,
        refreshIdentityKey: String
    ) throws {
        guard refreshGeneration == self.accountPreferencesRefreshGeneration,
            self.accountPreferencesIdentityKey == refreshIdentityKey else {
            return
        }

        guard accountContext.userId == session.userId else {
            switch session.authorization {
            case .bearer:
                try self.throwIfLinkedWorkspaceUnavailableRecoveryRequired()
                try self.resetLocalStateForCloudIdentityChange()
                return
            case .guest:
                throw LocalStoreError.validation("Guest cloud session resolved to a different account")
            }
        }

        guard self.isAccountPreferencesUpdateInFlight == false else {
            return
        }

        self.applyCloudAccountPreferences(preferences: accountContext.preferences, session: session)
    }

    /**
     * The entry for this identity, falling back to one written under another official API host. An
     * install that cached its preferences before the host move would otherwise read the defaults
     * until the server refresh lands, and keep them while offline.
     */
    private func cachedAccountPreferences(
        cache: PersistedAccountPreferencesCache,
        identityKey: String
    ) -> AccountPreferences? {
        if let preferences = cache.preferencesByIdentityKey[identityKey] {
            return preferences
        }
        guard let cloudSettings = self.cloudSettings,
            let userId = cloudSettings.linkedUserId,
            let configuration = try? self.currentCloudServiceConfiguration() else {
            return nil
        }

        for apiBaseUrl in equivalentStoredCloudApiBaseUrls(configuration: configuration) {
            let candidateKey = AccountPreferencesIdentity(
                userId: userId,
                configurationMode: configuration.mode,
                apiBaseUrl: apiBaseUrl
            ).storageKey
            if let preferences = cache.preferencesByIdentityKey[candidateKey] {
                return preferences
            }
        }

        return nil
    }

    private func currentAccountPreferencesIdentity() -> AccountPreferencesIdentity? {
        guard let cloudSettings = self.cloudSettings else {
            return nil
        }
        guard cloudSettings.cloudState == .guest || cloudSettings.cloudState == .linked else {
            return nil
        }
        guard let userId = cloudSettings.linkedUserId, userId.isEmpty == false else {
            return nil
        }
        guard let configuration = try? self.currentCloudServiceConfiguration() else {
            return nil
        }

        return AccountPreferencesIdentity(
            userId: userId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
    }

    private func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        session: CloudLinkedSession
    ) {
        let identity = AccountPreferencesIdentity(
            userId: session.userId,
            configurationMode: session.configurationMode,
            apiBaseUrl: session.apiBaseUrl
        )
        self.applyCloudAccountPreferences(preferences: preferences, identity: identity)
    }

    private func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        identity: AccountPreferencesIdentity
    ) {
        let identityKey = identity.storageKey
        self.accountPreferences = preferences
        self.accountPreferencesIdentityKey = identityKey
        self.cacheAccountPreferences(preferences: preferences, identityKey: identityKey)
        self.adoptServerProductAnalyticsPreference(
            preferences: preferences,
            productAnalyticsIdentityKey: identity.productAnalyticsKey
        )
    }

    private func loadPersistedAccountPreferencesCache() -> PersistedAccountPreferencesCache {
        guard let data = self.userDefaults.data(forKey: accountPreferencesCacheUserDefaultsKey) else {
            return PersistedAccountPreferencesCache(preferencesByIdentityKey: [:])
        }

        do {
            return try self.decoder.decode(PersistedAccountPreferencesCache.self, from: data)
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error,
                action: "account_preferences_cache_load",
                stage: "decode"
            )
            self.userDefaults.removeObject(forKey: accountPreferencesCacheUserDefaultsKey)
            return PersistedAccountPreferencesCache(preferencesByIdentityKey: [:])
        }
    }

    private func savePersistedAccountPreferencesCache(_ cache: PersistedAccountPreferencesCache) {
        do {
            let data = try self.encoder.encode(cache)
            self.userDefaults.set(data, forKey: accountPreferencesCacheUserDefaultsKey)
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error,
                action: "account_preferences_cache_save",
                stage: "encode"
            )
            self.userDefaults.removeObject(forKey: accountPreferencesCacheUserDefaultsKey)
        }
    }

    private func cacheAccountPreferences(
        preferences: AccountPreferences,
        identityKey: String
    ) {
        var cache = self.loadPersistedAccountPreferencesCache()
        cache.preferencesByIdentityKey[identityKey] = preferences
        self.savePersistedAccountPreferencesCache(cache)
    }

    private func captureAccountPreferencesSilentFailure(
        error: Error,
        action: String,
        stage: String
    ) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .cloudAuth,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: action,
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}
