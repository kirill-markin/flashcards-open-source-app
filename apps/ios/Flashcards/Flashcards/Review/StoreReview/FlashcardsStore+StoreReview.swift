import Foundation

@MainActor
extension FlashcardsStore {
    /// At most once per app version; the config cooldown counts from the last request.
    func prepareStoreReviewRequestAttemptIfDue(
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        configVersion: String,
        now: Date
    ) -> Bool {
        guard self.pendingStoreReviewRequestAttempt == nil else {
            return false
        }

        let promptState: StoreReviewPromptState
        do {
            promptState = try loadStoreReviewPromptState(userDefaults: self.userDefaults)
        } catch {
            FlashcardsObservability.captureSilentFailure(
                error: error,
                scope: IOSObservationScope(
                    feature: .storeReview,
                    userId: self.cloudSettings?.linkedUserId,
                    workspaceId: self.workspace?.workspaceId,
                    requestId: nil,
                    clientRequestId: nil,
                    sessionId: nil,
                    runId: nil,
                    cloudState: self.cloudSettings?.cloudState,
                    configurationMode: try? self.currentCloudServiceConfiguration().mode
                ),
                action: "store_review_request_prepare_after_successful_review",
                stage: "eligibility",
                statusCode: nil,
                backendCode: nil,
                requestId: nil
            )
            assertionFailure("Store review eligibility failed: \(Flashcards.errorMessage(error: error))")
            return false
        }

        let appVersion = appMarketingVersion()
        guard promptState.lastStoreReviewRequestedAppVersion != appVersion,
              reviewPromptConfigAllows(
                settings: settings,
                counters: counters,
                lastShownAt: promptState.lastStoreReviewRequestedAt,
                now: now
              ) else {
            return false
        }

        self.pendingStoreReviewRequestAttempt = StoreReviewRequestAttempt(
            id: UUID().uuidString.lowercased(),
            appVersion: appVersion,
            requestedAt: now,
            reviewPromptConfigVersion: configVersion
        )
        return true
    }

    func consumeStoreReviewRequestAttempt(attemptId: String) {
        guard self.pendingStoreReviewRequestAttempt?.id == attemptId else {
            return
        }

        self.pendingStoreReviewRequestAttempt = nil
    }

    func recordStoreReviewRequestAttempt(requestAttempt: StoreReviewRequestAttempt, now: Date) -> Bool {
        guard self.pendingStoreReviewRequestAttempt?.id == requestAttempt.id else {
            return false
        }

        persistStoreReviewPromptState(
            userDefaults: self.userDefaults,
            promptState: StoreReviewPromptState(
                lastStoreReviewRequestedAt: now,
                lastStoreReviewRequestedAppVersion: requestAttempt.appVersion
            )
        )
        Analytics.track(
            .storeReviewRequested(reviewPromptConfigVersion: requestAttempt.reviewPromptConfigVersion),
            screen: analyticsSurface(tab: self.currentVisibleTab)
        )

        return true
    }

    func clearStoreReviewPromptStateForTests() {
        clearStoreReviewPromptState(userDefaults: self.userDefaults)
        self.pendingStoreReviewRequestAttempt = nil
    }
}
