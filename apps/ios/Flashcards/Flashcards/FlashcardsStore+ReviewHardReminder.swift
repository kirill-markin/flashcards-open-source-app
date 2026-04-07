import Foundation

@MainActor
extension FlashcardsStore {
    /// Clears the in-memory reminder session state when the current review workspace changes.
    ///
    /// The cooldown timestamp stays persisted so the reminder remains rate-limited across app launches.
    func resetReviewHardReminderSession() {
        self.reviewHardReminderRecentRatings = []
        self.isReviewHardReminderPresented = false
    }

    /// Dismisses the reminder alert without changing the saved review answer.
    func dismissReviewHardReminder() {
        self.isReviewHardReminderPresented = false
    }

    /// Records one saved review rating and shows the reminder when the recent window is too Hard-heavy.
    ///
    /// The reminder stays non-blocking because it is evaluated only after a successful save.
    func handleSuccessfulReviewHardReminder(rating: ReviewRating, now: Date) {
        self.reviewHardReminderRecentRatings = appendReviewHardReminderRating(
            recentRatings: self.reviewHardReminderRecentRatings,
            nextRating: rating
        )

        guard rating == .hard else {
            return
        }

        guard shouldPresentReviewHardReminder(
            recentRatings: self.reviewHardReminderRecentRatings,
            lastShownAt: self.reviewHardReminderLastShownAt,
            now: now
        ) else {
            return
        }

        self.reviewHardReminderLastShownAt = now
        persistReviewHardReminderLastShownAt(userDefaults: self.userDefaults, lastShownAt: now)
        self.isReviewHardReminderPresented = true
    }
}

