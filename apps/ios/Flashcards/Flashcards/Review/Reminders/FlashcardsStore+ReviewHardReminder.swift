import Foundation

@MainActor
extension FlashcardsStore {
    func resetReviewHardReminderSession() {
        self.reviewHardReminderRecentRatings = []
        self.isReviewHardReminderPresented = false
    }

    func dismissReviewHardReminder() {
        self.isReviewHardReminderPresented = false
    }

    func handleSuccessfulReviewHardReminder(rating: ReviewRating, now: Date) {
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

