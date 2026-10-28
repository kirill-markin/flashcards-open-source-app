import Foundation

/// The counters' day runs from this local hour to the same hour next day, so a late-night session
/// stays one day.
let reviewPromptDayStartHour: Int = 4

/// Review events across every workspace, including the review just saved.
struct ReviewPromptCounters: Equatable, Sendable {
    let totalReviews: Int
    /// Reviews on today's local day in the device's current time zone.
    let reviewsToday: Int
    /// Distinct local days in the device's current time zone with at least one review.
    let reviewDays: Int
}

/// The config `order` reduced to the prompts this app has, in priority order.
func reviewPromptWalk(config: ReviewPromptConfig) -> [ReviewPromptId] {
    config.order.compactMap { rawId in
        ReviewPromptId(rawValue: rawId)
    }
}

/// The config half of a prompt's eligibility; its fixed code rules are checked by the prompt itself.
/// `lastShownAt` must be this same prompt's last showing, never another prompt's or event's.
func reviewPromptConfigAllows(
    settings: ReviewPromptSettings,
    counters: ReviewPromptCounters,
    lastShownAt: Date?,
    now: Date
) -> Bool {
    guard settings.enabled else {
        return false
    }
    if let minTotalReviews = settings.minTotalReviews, counters.totalReviews < minTotalReviews {
        return false
    }
    if let minReviewsToday = settings.minReviewsToday, counters.reviewsToday < minReviewsToday {
        return false
    }
    if let minReviewDays = settings.minReviewDays, counters.reviewDays < minReviewDays {
        return false
    }
    if let cooldownDays = settings.cooldownDays, let lastShownAt,
       now.timeIntervalSince(lastShownAt) < TimeInterval(cooldownDays) * 24 * 60 * 60 {
        return false
    }

    return true
}
