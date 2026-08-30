import Foundation

/// 32 lowercase hexadecimal characters, the floor the create route accepts.
private let guestSessionCreationIdempotencyKeyByteCount: Int = 16
private let guestAnalyticsIdentityLinkMaximumAttempts: Int = 3
private let guestAnalyticsIdentityLinkRetryDelayNanoseconds: UInt64 = 500_000_000

@MainActor
extension FlashcardsStore {
    /**
     * Creates the guest credential the analytics client authenticates with on an install that has no
     * cloud identity of its own.
     *
     * The session is stored and deliberately not adopted as a cloud session: `cloudState` stays where
     * it was, no workspace is migrated and no sync starts. `loadOrCreateGuestCloudSession` reuses this
     * same credential if the person later opts into AI chat, feedback or cloud sync, so the install
     * keeps exactly one guest identity for its whole life. Both creations run through
     * `cloudRuntime.createGuestCloudSession`, so a mint and a cloud preparation that start together
     * share one identity instead of revoking each other's token.
     *
     * The credential lives in the Keychain and therefore survives an app reinstall, while
     * `anonymous_id` deliberately does not. That difference is accepted: a resurrected guest is
     * normally the same person, so it undercounts actors rather than attributing one person's history
     * to another.
     */
    func mintAnalyticsGuestCredential() async -> AnalyticsGuestCredentialMintOutcome {
        let configuration: CloudServiceConfiguration
        do {
            guard try self.isAnalyticsGuestCredentialMintEligible() else {
                return .skipped
            }

            configuration = try self.currentCloudServiceConfiguration()
        } catch {
            // Nothing has been requested yet, so this attempt created nothing and cost nothing. A
            // transient Keychain or configuration read failure must not spend the one attempt this
            // launch has; the next flush asks again.
            self.reportAnalyticsGuestCredentialFailure(error: error, stage: "mint_eligibility")
            return .skipped
        }

        do {
            let createdGuestSession = try await self.cloudRuntime.createGuestCloudSession { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                return try await self.createAndStoreGuestCloudSession(
                    configuration: configuration,
                    marksAnalyticsOnly: true
                )
            }
            // Creating suspends, so a sign-in that completed meanwhile can have cleared the credential
            // this mint was for. Only a guest that nothing references is deleted: the stored session
            // may be this same guest, adopted as the install's cloud session by a creation that joined
            // the same gate, and deleting that one would take its workspace with it.
            guard try self.dependencies.guestCredentialStore.loadGuestSession()?.guestToken
                == createdGuestSession.guestToken else {
                try await self.dependencies.guestCloudAuthService.deleteGuestSession(
                    apiBaseUrl: configuration.apiBaseUrl,
                    guestToken: createdGuestSession.guestToken
                )
                return .failed
            }
            // The same suspension can also have given this install a cloud identity, which the check
            // above cannot see: the record it reads was written by this mint after that change. A
            // credential created for the identity that was current when the create started must not
            // be handed to the one that is current now. Nothing is deleted here, unlike above:
            // whatever took over may already be running on this very session, and an unreadable
            // eligibility check is treated the same way for the same reason.
            guard (try? self.hasNoCloudIdentityForAnalyticsGuestCredentialMint()) ?? false else {
                return .failed
            }

            return .minted(
                AnalyticsCredentials(
                    apiBaseUrl: createdGuestSession.apiBaseUrl,
                    authorizationHeaderValue: CloudAuthorization.guest(createdGuestSession.guestToken).headerValue
                )
            )
        } catch {
            self.reportAnalyticsGuestCredentialFailure(error: error, stage: "mint")
            return .failed
        }
    }

    /**
     * Claims the guest identity this install still holds for the signed-in account, in the background.
     *
     * Started from startup and from sign-in completion, and never awaited by either: a claim runs over
     * the network with retries, and nothing analytics does may block, delay or fail a user action.
     * A retryable failure leaves the credential in place for the next start of this same claim.
     */
    func resumeAnalyticsGuestIdentityLinkIfNeeded() {
        guard self.isAnalyticsGuestIdentityLinkResumeRunning == false else {
            return
        }
        guard self.cloudSettings?.cloudState == .linked, self.cloudCredentialRecoveryState == nil else {
            return
        }

        do {
            guard try self.loadAnalyticsOnlyGuestSessionForCurrentConfiguration() != nil else {
                return
            }
        } catch {
            self.reportAnalyticsGuestCredentialFailure(error: error, stage: "identity_link_resume")
            return
        }

        self.isAnalyticsGuestIdentityLinkResumeRunning = true
        Task { @MainActor [weak self] in
            await self?.performAnalyticsGuestIdentityLinkResume()
            self?.isAnalyticsGuestIdentityLinkResumeRunning = false
        }
    }

    /// Reuses the key a previous attempt persisted, so a response lost in transit rotates that guest's
    /// secret instead of leaving an unreferenced guest identity on the server.
    func loadOrCreateGuestSessionCreationIdempotencyKey() throws -> String {
        if let storedKey = try self.dependencies.guestCredentialStore.loadGuestSessionCreationIdempotencyKey() {
            return storedKey
        }

        let idempotencyKey = makeGuestSessionCreationIdempotencyKey()
        try self.dependencies.guestCredentialStore.saveGuestSessionCreationIdempotencyKey(
            idempotencyKey: idempotencyKey
        )
        return idempotencyKey
    }

    private func performAnalyticsGuestIdentityLinkResume() async {
        do {
            guard let analyticsOnlyGuestSession = try self.loadAnalyticsOnlyGuestSessionForCurrentConfiguration() else {
                return
            }

            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            guard await self.claimGuestAnalyticsIdentity(
                guestSession: analyticsOnlyGuestSession,
                bearerToken: credentials.idToken
            ) else {
                return
            }

            // Only the credential this claim actually linked. A logout during the claim resets local
            // state and lets the next flush mint a fresh identity, and clearing whatever is stored now
            // would destroy that one instead.
            try self.clearGuestSessionIfStillStored(guestToken: analyticsOnlyGuestSession.guestToken)
        } catch {
            // Keeps the credential, where the same unreadable read at the sign-in site destroys it.
            // Deliberate: this resume has a later attempt at every launch and every sign-in, so
            // doing nothing costs nothing, while that site is the only point that must reach a
            // terminal decision. `FlashcardsStore+CloudLink.swift` states the other half.
            self.reportAnalyticsGuestCredentialFailure(error: error, stage: "identity_link_resume")
        }
    }

    /**
     * Whether the guest credential this install still holds may be dropped: it was claimed for the
     * signed-in account, or the server named it as a guest that is not this install's to claim.
     *
     * `false` means the credential must be kept. Dropping it there loses that guest's whole analytics
     * tail permanently, and a later attempt of this same claim is what writes the link. A guest the
     * server says still owns data is kept for the same reason: the upgrade flow is what transfers
     * that data — writing the same link on its way — and the local token is the only handle onto it.
     */
    private func claimGuestAnalyticsIdentity(
        guestSession: StoredGuestCloudSession,
        bearerToken: String
    ) async -> Bool {
        for attempt in 1...guestAnalyticsIdentityLinkMaximumAttempts {
            do {
                try await self.dependencies.guestCloudAuthService.linkGuestAnalyticsIdentity(
                    apiBaseUrl: guestSession.apiBaseUrl,
                    bearerToken: bearerToken,
                    guestToken: guestSession.guestToken
                )
                return true
            } catch {
                let verdict = guestAnalyticsIdentityLinkVerdict(error: error)
                if case .retryable(let retryAfterDelayNanoseconds) = verdict,
                    attempt < guestAnalyticsIdentityLinkMaximumAttempts {
                    do {
                        try await Task.sleep(
                            nanoseconds: retryAfterDelayNanoseconds
                                ?? guestAnalyticsIdentityLinkRetryDelayNanoseconds
                        )
                    } catch {
                        // Cancelled. The credential is kept and the next resume claims it.
                        return false
                    }

                    continue
                }

                self.reportAnalyticsGuestCredentialFailure(error: error, stage: "identity_link")
                if case .terminalDiscardingCredential = verdict {
                    return true
                }

                return false
            }
        }

        return false
    }

    /**
     * Analytics may create a guest credential only for an install that has no cloud identity at all.
     *
     * A second credential alongside a real one is what the guards below exist to prevent, because the
     * sync reconciliation would eventually resolve the disagreement by clearing this install's stored
     * cloud credentials. Two things keep that unreachable: this check, which refuses to mint while any
     * cloud identity is present or still loading, and the analytics-only marker, which keeps a minted
     * credential invisible to `loadUsableCloudGuestSessionForCurrentConfiguration` so it can never be
     * read as a guest cloud session.
     */
    private func isAnalyticsGuestCredentialMintEligible() throws -> Bool {
        guard try self.hasNoCloudIdentityForAnalyticsGuestCredentialMint() else {
            return false
        }

        return try self.loadUsableGuestSessionForCurrentConfiguration() == nil
    }

    /// The half of the eligibility question that describes this install's cloud identity rather than
    /// what it has stored, so the creation can ask it again once it returns. The stored half cannot be
    /// asked there: this mint has just written the credential it would read.
    private func hasNoCloudIdentityForAnalyticsGuestCredentialMint() throws -> Bool {
        guard self.cloudCredentialRecoveryState == nil else {
            return false
        }
        // Nil until the store has loaded its persisted state, which is exactly the window in which an
        // install that has a cloud identity does not look like one yet.
        guard let cloudSettings = self.cloudSettings else {
            return false
        }
        guard cloudSettings.cloudState == .disconnected || cloudSettings.cloudState == .linkingReady else {
            return false
        }
        guard self.cloudRuntime.activeCloudSession() == nil else {
            return false
        }

        return try self.cloudRuntime.loadCredentials() == nil
    }

    /**
     * One report per stage for the life of the process, and nothing at all for a failure that only
     * says the network was unreachable.
     *
     * Every stage here runs on a schedule rather than on a user action: `mint` once per launch for
     * every install with no cloud identity, `mint_eligibility` once per flush, and the two link
     * stages once per launch for every signed-in install whose claim cannot reach the network. An
     * unguarded capture would turn one offline stretch into a Sentry issue per launch across the
     * whole install base, which is what the transport guard the other background capture paths use
     * exists to prevent.
     */
    private func reportAnalyticsGuestCredentialFailure(error: Error, stage: String) {
        if isRequestCancellationError(error: error) {
            return
        }
        if isSilentlyIgnorableNetworkTransportFailure(error: error) {
            return
        }
        guard self.reportedAnalyticsGuestCredentialFailureStages.contains(stage) == false else {
            return
        }

        self.reportedAnalyticsGuestCredentialFailureStages.insert(stage)
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: analyticsObservationScope(),
            action: "analytics_guest_credential_failed",
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}

/// What the identity link route's answer allows the client to do next.
private enum GuestAnalyticsIdentityLinkVerdict {
    /// An unchanged retry can still succeed, after the delay the server asked for when it named one.
    case retryable(retryAfterDelayNanoseconds: UInt64?)
    /// Retryable, but only once the account has loaded a request context, so the loop stops here and a
    /// later resume tries again. Nothing in the resume itself creates that context: the credential
    /// refresh it starts with returns straight from the credential store while the id token is fresh
    /// and reaches no route at all. The claim converges because the app's ordinary authenticated
    /// traffic — workspace selection during sign-in, the sync at startup — has loaded one by the time
    /// the next resume runs, and that is what writes the account's identity row.
    case retryableAfterRequestContext
    /// No retry ever succeeds and the credential may be dropped, because it is not this install's to
    /// claim or there is no longer an account to claim it for.
    case terminalDiscardingCredential
    /// No retry ever succeeds, but the credential must be kept: the server has just said this guest
    /// owns data, and the upgrade flow is what transfers it. The local token is the only handle onto
    /// that guest, so dropping it would strand the workspace permanently.
    case terminalKeepingCredential
}

/**
 * Only the codes that name a state no retry resolves are terminal, and only two of those allow the
 * credential to be dropped: a guest that belongs to a different real account, and a deleted account
 * with nothing left to claim. `409 GUEST_IDENTITY_LINK_UPGRADE_REQUIRED` is terminal for this route
 * too, but it says the guest owns data the upgrade transfers, so the credential is kept and the
 * upgrade flow remains possible.
 *
 * Everything else keeps the guest token, which is the posture the route's contract asks for.
 * `409 GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED` says the account's identity row does not exist yet, and
 * repeating the identical request cannot create it, so it stops this loop instead of spending its
 * attempts on failures that can only be identical. Every `5xx` is retryable here: it leaves this
 * guest's tail unclaimed until a later attempt of this claim, or the upgrade flow, writes the link.
 * Dropping the token instead loses that guest's whole analytics tail, permanently and with no
 * repair path, so an unrecognised failure is treated as retryable too.
 */
private func guestAnalyticsIdentityLinkVerdict(error: Error) -> GuestAnalyticsIdentityLinkVerdict {
    guard let guestCloudAuthError = error as? GuestCloudAuthError,
        case .invalidResponse(let details, _) = guestCloudAuthError else {
        return .retryable(retryAfterDelayNanoseconds: nil)
    }

    switch details.code {
    case "GUEST_IDENTITY_LINK_OTHER_ACCOUNT", "ACCOUNT_DELETED":
        return .terminalDiscardingCredential
    case "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED":
        return .terminalKeepingCredential
    case "GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED":
        return .retryableAfterRequestContext
    default:
        return .retryable(retryAfterDelayNanoseconds: details.retryAfterDelayNanoseconds)
    }
}

/**
 * A fresh 32-character lowercase hexadecimal key for one guest session creation attempt.
 *
 * Random per attempt and never derived from the install id, the device id or any other stable value:
 * a retry carrying this key rotates that guest's secret and returns a valid token for its user and
 * workspace, so a stable or guessable key would be a bearer credential for that identity, and the
 * server's shape check cannot tell the difference.
 */
private func makeGuestSessionCreationIdempotencyKey() -> String {
    var randomBytes = [UInt8](repeating: 0, count: guestSessionCreationIdempotencyKeyByteCount)
    for index in randomBytes.indices {
        randomBytes[index] = UInt8.random(in: UInt8.min...UInt8.max)
    }

    return randomBytes.map { randomByte in
        String(format: "%02x", randomByte)
    }.joined()
}
