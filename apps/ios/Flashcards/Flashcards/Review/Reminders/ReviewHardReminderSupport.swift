import Foundation

/// Session-only review reminder heuristics for the frequent-"Hard" nudge.
///
/// The reminder deliberately keeps the rule set small:
/// - remember only the last few ratings for the current in-memory review session
/// - trigger only after a successful Hard review
/// - persist only the last time the reminder was shown
let reviewHardReminderRecentRatingLimit: Int = 8
let reviewHardReminderHardRatingThreshold: Int = 5
let reviewHardReminderCooldownSeconds: TimeInterval = 3 * 24 * 60 * 60
let reviewHardReminderLastShownAtUserDefaultsKey: String = "review-hard-reminder-last-shown-at"

/// Returns the next in-memory rating buffer for the current review session.
func appendReviewHardReminderRating(
    recentRatings: [ReviewRating],
    nextRating: ReviewRating
) -> [ReviewRating] {
    let nextRatings = (recentRatings + [nextRating])
    if nextRatings.count <= reviewHardReminderRecentRatingLimit {
        return nextRatings
    }

    return Array(nextRatings.suffix(reviewHardReminderRecentRatingLimit))
}

/// Counts how many answers in the current session window were rated Hard.
func countReviewHardRatings(recentRatings: [ReviewRating]) -> Int {
    recentRatings.reduce(into: 0) { result, rating in
        if rating == .hard {
            result += 1
        }
    }
}

/// Returns `true` when the reminder should be shown after the latest successful review.
func shouldPresentReviewHardReminder(
    recentRatings: [ReviewRating],
    lastShownAt: Date?,
    now: Date
) -> Bool {
    guard recentRatings.count >= reviewHardReminderRecentRatingLimit else {
        return false
    }

    guard let lastShownAt else {
        return countReviewHardRatings(recentRatings: recentRatings) >= reviewHardReminderHardRatingThreshold
    }

    guard now.timeIntervalSince(lastShownAt) >= reviewHardReminderCooldownSeconds else {
        return false
    }

    return countReviewHardRatings(recentRatings: recentRatings) >= reviewHardReminderHardRatingThreshold
}

/// Loads the persisted cooldown timestamp for the review reminder.
func loadReviewHardReminderLastShownAt(userDefaults: UserDefaults) -> Date? {
    guard let rawValue = userDefaults.object(forKey: reviewHardReminderLastShownAtUserDefaultsKey) as? TimeInterval else {
        return nil
    }

    return Date(timeIntervalSince1970: rawValue)
}

/// Persists the review reminder cooldown timestamp for the current device.
func persistReviewHardReminderLastShownAt(userDefaults: UserDefaults, lastShownAt: Date) {
    userDefaults.set(lastShownAt.timeIntervalSince1970, forKey: reviewHardReminderLastShownAtUserDefaultsKey)
}
