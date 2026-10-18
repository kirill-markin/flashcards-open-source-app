import Foundation

@MainActor
extension FlashcardsStore {
    func reloadFirstReviewOnboardingReportingFailure() {
        do {
            let state = try requireLocalDatabase(database: self.database).loadFirstReviewOnboarding()
            self.firstReviewOnboardingCompleted = state.isKnown ? state.completed : nil
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error, action: "first_review_onboarding_load", stage: "local_read"
            )
        }
    }

    func updateFirstReviewOnboardingCompleted(completed: Bool) throws {
        try self.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()
        let database = try requireLocalDatabase(database: self.database)
        let didChange = try database.core.inTransaction {
            try database.setFirstReviewOnboardingCompleted(completed: completed, reviewToken: nil)
        }
        self.reloadFirstReviewOnboardingReportingFailure()
        if didChange {
            Analytics.track(completed
                ? .firstReviewOnboardingCompleted(source: .settings)
                : .firstReviewOnboardingReset, screen: .settings)
        }
        self.triggerFirstReviewOnboardingPush()
    }

    func applySavedFirstReviewOnboarding(reviewToken: String) {
        do {
            let database = try requireLocalDatabase(database: self.database)
            let didComplete = try database.consumeFirstReviewOnboardingReviewTransition(reviewToken: reviewToken)
            self.reloadFirstReviewOnboardingReportingFailure()
            if didComplete {
                Analytics.track(.firstReviewOnboardingCompleted(source: .review), screen: .review)
            }
            self.triggerFirstReviewOnboardingPush()
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error, action: "first_review_onboarding_saved_review", stage: "local_read"
            )
        }
    }

    func adoptServerFirstReviewOnboarding(preferences: AccountPreferences, userId: String) {
        guard let completed = preferences.firstReviewOnboardingCompleted else { return }
        do {
            try requireLocalDatabase(database: self.database).adoptFirstReviewOnboarding(
                completed: completed, ownerUserId: userId,
                snapshotGeneration: preferences.firstReviewOnboardingSnapshotGeneration
            )
            self.reloadFirstReviewOnboardingReportingFailure()
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error, action: "first_review_onboarding_adopt", stage: "local_write"
            )
        }
    }

    func triggerFirstReviewOnboardingPush() {
        Task { @MainActor in
            await self.pushPendingFirstReviewOnboardingIfNeeded()
        }
    }

    func pushPendingFirstReviewOnboardingIfNeeded() async {
        guard self.canPersistAccountPreferences else { return }
        do {
            guard try requireLocalDatabase(database: self.database).loadFirstReviewOnboarding().pending else { return }
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error, action: "first_review_onboarding_push", stage: "local_read"
            )
            return
        }
        await self.serializedAccountPreferencesUpdate {
            do {
                let database = try requireLocalDatabase(database: self.database)
                for _ in 0..<3 {
                    let state = try database.loadFirstReviewOnboarding()
                    guard state.pending, let owner = state.ownerUserId, self.canPersistAccountPreferences else { return }
                    let generation = self.accountPreferencesRefreshGeneration
                    let identityKey = self.accountPreferencesIdentityKey
                    let result = try await self.updateCloudAccountPreferences(
                        patch: AccountPreferencesPatchRequest(firstReviewOnboardingCompleted: state.completed),
                        validateResolvedSession: { session in
                            let resolvedIdentityKey = "\(session.configurationMode.rawValue)|\(session.apiBaseUrl)|\(session.userId)"
                            guard session.userId == owner,
                                  self.cloudSettings?.linkedUserId == owner,
                                  resolvedIdentityKey == identityKey else {
                                throw LocalStoreError.validation("First review onboarding preference belongs to a different account")
                            }
                        }
                    )
                    guard self.accountPreferencesRefreshGeneration == generation,
                          self.accountPreferencesIdentityKey == identityKey,
                          self.cloudSettings?.linkedUserId == owner else { return }
                    guard result.preferences.firstReviewOnboardingCompleted == state.completed else {
                        throw LocalStoreError.validation("Server did not store the first review onboarding preference")
                    }
                    try database.acknowledgeFirstReviewOnboarding(state: state)
                    self.reloadFirstReviewOnboardingReportingFailure()
                }
                if try database.loadFirstReviewOnboarding().pending {
                    throw LocalStoreError.validation("First review onboarding preference still has pending changes")
                }
            } catch {
                self.captureAccountPreferencesSilentFailure(
                    error: error, action: "first_review_onboarding_push", stage: "reconciliation"
                )
            }
        }
    }
}
