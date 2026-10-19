import Foundation

private let paywallStateUserDefaultsKey: String = "paywall-state-v1"

private struct PersistedPaywallState: Codable {
    let userId: String
    let apiBaseUrl: String
    let state: PaywallState
    let hasLoadedServerState: Bool?
    let pending: [PaywallShownRequest]
}

@MainActor
extension FlashcardsStore {
    func dueReviewPaywall(now: Date) throws -> ReviewPaywallTrigger? {
        guard let entitlement = self.cloudEntitlement, entitlement.tierRank < premiumTierRank,
              entitlement.status == .noEntitlement, entitlement.isTrial == false else { return nil }
        let identity = try self.appleSubscriptionIdentity()
        let persisted = try self.loadPaywallState(identity: identity)
        guard persisted.hasLoadedServerState == true else { return nil }
        let database = try requireLocalDatabase(database: self.database)
        let calendar = makeStoreReviewLocalCalendar(timeZone: .current)
        let day = try makeStoreReviewCurrentLocalDayRange(now: now, calendar: calendar)
        return dueReviewPaywallTrigger(
            state: persisted.state,
            entitlement: self.cloudEntitlement,
            cumulativeReviews: max(
                self.userDefaults.integer(forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey),
                try database.loadReviewEventCount()
            ),
            reviewsToday: try database.loadAppWideReviewEventCount(start: day.start, end: day.end),
            now: now,
            timeZone: .current
        )
    }

    func recordActualPaywallShown(
        request: PremiumPresentationRequest,
        now: Date,
        timeZone: TimeZone
    ) {
        guard request.analyticsEntryPoint != nil, let identity = request.identity,
              (try? self.appleSubscriptionIdentity()) == identity else { return }
        do {
            let persisted = try self.loadPaywallState(identity: identity)
            let impression = PaywallShownRequest(
                presentationId: request.id,
                shownAt: formatIsoTimestamp(date: now),
                localDate: paywallLocalDate(now: now, timeZone: timeZone),
                timeZone: timeZone.identifier,
                reviewTrigger: request.reviewTrigger
            )
            try self.savePaywallState(PersistedPaywallState(
                userId: identity.userId,
                apiBaseUrl: identity.apiBaseUrl,
                state: persisted.state.recording(impression),
                hasLoadedServerState: persisted.hasLoadedServerState,
                pending: persisted.pending + [impression]
            ))
            self.syncPaywallStateIfNeeded()
        } catch {
            self.capturePaywallStateFailure(error: error, stage: "record_actual_display")
        }
    }

    func syncPaywallStateIfNeeded() {
        guard self.activePaywallStateSyncTask == nil,
              let identity = try? self.appleSubscriptionIdentity() else { return }
        let syncId = UUID()
        self.paywallStateSyncId = syncId
        self.activePaywallStateSyncTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.paywallStateSyncId == syncId {
                    self.activePaywallStateSyncTask = nil
                    self.paywallStateSyncId = nil
                }
            }
            do {
                let transport = CloudSyncTransport(session: .shared, decoder: makeFlashcardsRemoteJSONDecoder())
                let remoteState = try await self.withAppleSubscriptionSession(identity: identity) { session in
                    try await transport.loadPaywallState(session: session)
                }
                try self.requireAppleSubscriptionIdentity(identity)
                try self.mergePaywallServerState(remoteState, acknowledgedId: nil, identity: identity)
                while let impression = try self.loadPaywallState(identity: identity).pending.first {
                    let response = try await self.withAppleSubscriptionSession(identity: identity) { session in
                        try await transport.recordPaywallShown(request: impression, session: session)
                    }
                    try self.requireAppleSubscriptionIdentity(identity)
                    try self.mergePaywallServerState(response, acknowledgedId: impression.presentationId, identity: identity)
                }
            } catch is CancellationError {
                return
            } catch {
                self.capturePaywallStateFailure(error: error, stage: "sync")
            }
        }
    }

    func transferGuestPaywallState(to session: CloudLinkedSession) {
        do {
            guard let data = self.userDefaults.data(forKey: paywallStateUserDefaultsKey) else { return }
            let persisted = try self.decoder.decode(PersistedPaywallState.self, from: data)
            guard let guest = try self.loadGuestSessionForCurrentConfiguration(),
                  persisted.userId == guest.userId, persisted.apiBaseUrl == session.apiBaseUrl else { return }
            self.paywallStateSyncId = nil
            self.activePaywallStateSyncTask?.cancel()
            self.activePaywallStateSyncTask = nil
            try self.savePaywallState(PersistedPaywallState(
                userId: session.userId, apiBaseUrl: session.apiBaseUrl,
                state: persisted.state, hasLoadedServerState: false, pending: persisted.pending
            ))
        } catch {
            self.capturePaywallStateFailure(error: error, stage: "guest_upgrade")
        }
    }

    func clearPaywallStateForCloudIdentityReset() {
        self.paywallStateSyncId = nil
        self.activePaywallStateSyncTask?.cancel()
        self.activePaywallStateSyncTask = nil
        self.savedReviewPromptOpportunity = nil
        self.pendingStoreReviewRequestAttempt = nil
        self.userDefaults.removeObject(forKey: paywallStateUserDefaultsKey)
    }

    private func loadPaywallState(identity: AppleSubscriptionIdentity) throws -> PersistedPaywallState {
        guard let data = self.userDefaults.data(forKey: paywallStateUserDefaultsKey) else {
            return PersistedPaywallState(
                userId: identity.userId, apiBaseUrl: identity.apiBaseUrl,
                state: .empty, hasLoadedServerState: false, pending: []
            )
        }
        let persisted = try self.decoder.decode(PersistedPaywallState.self, from: data)
        guard persisted.userId == identity.userId, persisted.apiBaseUrl == identity.apiBaseUrl else {
            return PersistedPaywallState(
                userId: identity.userId, apiBaseUrl: identity.apiBaseUrl,
                state: .empty, hasLoadedServerState: false, pending: []
            )
        }
        _ = try persisted.state.validated()
        return persisted
    }

    private func savePaywallState(_ persisted: PersistedPaywallState) throws {
        self.userDefaults.set(try self.encoder.encode(persisted), forKey: paywallStateUserDefaultsKey)
    }

    private func mergePaywallServerState(
        _ state: PaywallState,
        acknowledgedId: UUID?,
        identity: AppleSubscriptionIdentity
    ) throws {
        let persisted = try self.loadPaywallState(identity: identity)
        try self.savePaywallState(PersistedPaywallState(
            userId: identity.userId,
            apiBaseUrl: identity.apiBaseUrl,
            state: persisted.state.merging(state),
            hasLoadedServerState: true,
            pending: persisted.pending.filter { $0.presentationId != acknowledgedId }
        ))
    }

    func capturePaywallStateFailure(error: Error, stage: String) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .subscription,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil, clientRequestId: nil, sessionId: nil, runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: "paywall_state", stage: stage,
            statusCode: nil, backendCode: nil, requestId: nil
        )
    }
}
