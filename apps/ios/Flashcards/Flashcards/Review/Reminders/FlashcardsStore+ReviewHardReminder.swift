import Foundation

@MainActor
extension FlashcardsStore {
    /// A workspace change closes the reminder by writing its state directly, which bypasses the
    /// alert's binding write-back, so the surface is handed back here as well.
    func resetReviewHardReminderSession() {
        self.reviewHardReminderRecentRatings = []
        if self.isReviewHardReminderPresented {
            self.isReviewHardReminderPresented = false
            self.restoreSurfaceAfterReviewHardReminder()
        }
    }

    /// Runs for the OK button and again for SwiftUI's binding write-back behind it; the restore's
    /// guard makes the second call report nothing.
    func dismissReviewHardReminder() {
        self.isReviewHardReminderPresented = false
        self.restoreSurfaceAfterReviewHardReminder()
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
        // Reported from the state that presents the alert, which SwiftUI gives no appearance
        // callback for. The reminder has no answer to report, so the showing is its only fact.
        Analytics.trackScreenViewed(.reviewHardReminder)
    }

    /// The tab the person is on rather than `.review`, the same reading the other post-review prompts
    /// restore.
    private func restoreSurfaceAfterReviewHardReminder() {
        Analytics.trackScreenViewedOnDismiss(
            of: .reviewHardReminder,
            restoring: analyticsSurface(tab: self.currentVisibleTab)
        )
    }
}
