import Foundation

@MainActor
extension FlashcardsStore {
    func prepareStoreReviewRequestAttemptAfterSuccessfulReview(now: Date) {
        do {
            try self.prepareStoreReviewRequestAttemptIfEligible(now: now)
        } catch {
            assertionFailure("Store review eligibility failed: \(Flashcards.errorMessage(error: error))")
        }
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
        fireAndForgetStoreReviewRequestedAnalyticsEvent(
            event: makeStoreReviewRequestedAnalyticsEvent(
                appVersion: requestAttempt.appVersion,
                localTimestamp: now,
                installationId: requestAttempt.installationId
            )
        )

        return true
    }

    func clearStoreReviewPromptStateForTests() {
        clearStoreReviewPromptState(userDefaults: self.userDefaults)
        self.pendingStoreReviewRequestAttempt = nil
    }

    private func prepareStoreReviewRequestAttemptIfEligible(now: Date) throws {
        guard self.pendingStoreReviewRequestAttempt == nil else {
            return
        }

        guard let database = self.database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let calendar = makeStoreReviewLocalCalendar(timeZone: .current)
        let localDayRange = try makeStoreReviewCurrentLocalDayRange(now: now, calendar: calendar)
        let promptState = try loadStoreReviewPromptState(userDefaults: self.userDefaults)
        let appVersion = appMarketingVersion()
        let context = StoreReviewEligibilityContext(
            hasReviewActivityOnPreviousLocalDay: try database.hasAppWideReviewEvent(before: localDayRange.start),
            currentLocalDayCompletedReviewCount: try database.loadAppWideReviewEventCount(
                start: localDayRange.start,
                end: localDayRange.end
            ),
            currentAppVersion: appVersion,
            now: now,
            localCalendar: calendar,
            promptState: promptState
        )
        guard try shouldRequestStoreReview(context: context) else {
            return
        }

        self.pendingStoreReviewRequestAttempt = StoreReviewRequestAttempt(
            id: UUID().uuidString.lowercased(),
            appVersion: appVersion,
            requestedAt: now,
            installationId: self.cloudSettings?.installationId
        )
    }
}
