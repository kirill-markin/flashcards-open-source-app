import Foundation

// The after-review prompt rules are canonical in apps/backend/src/reviewPrompts/reviewPromptConfig.ts.
// These built-in defaults are synced with it by hand, as are the Android ones in
// apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/review/prompts/ReviewPromptConfigDefaults.kt.
// The app prefers the server values once it has them, but every release should ship the current defaults.

/// The prompts this app has; the walk skips every other id in `order`.
enum ReviewPromptId: String, CaseIterable, Sendable {
    case hardReminder = "hard-reminder"
    case paywallInitial = "paywall-initial"
    case paywallSecond = "paywall-second"
    case paywallPeriodic = "paywall-periodic"
    case notificationsPrePrompt = "notifications-pre-prompt"
    case ratingRequest = "rating-request"
    case guestSignIn = "guest-sign-in"
    case automaticFeedback = "automatic-feedback"
}

/// An absent value is no condition.
struct ReviewPromptSettings: Codable, Equatable, Sendable {
    let enabled: Bool
    let minTotalReviews: Int?
    let minReviewsToday: Int?
    let minReviewDays: Int?
    let cooldownDays: Int?
}

/// Ids stay raw strings, so ids of other platforms and unknown ids pass through untouched.
struct ReviewPromptConfig: Codable, Equatable, Sendable {
    let schemaVersion: Int
    /// Sent unchanged as `review_prompt_config_version` on prompt analytics events.
    let version: String
    let order: [String]
    let prompts: [String: ReviewPromptSettings]
}

let builtInReviewPromptConfig = ReviewPromptConfig(
    schemaVersion: 1,
    version: "2026-10-28-1",
    order: [
        "hard-reminder",
        "paywall-initial",
        "paywall-second",
        "paywall-periodic",
        "notifications-pre-prompt",
        "rating-request",
        "web-mobile-app-promo",
        "guest-sign-in",
        "automatic-feedback"
    ],
    prompts: [
        "hard-reminder": ReviewPromptSettings(
            enabled: true, minTotalReviews: nil, minReviewsToday: nil, minReviewDays: nil, cooldownDays: 3
        ),
        "paywall-initial": ReviewPromptSettings(
            enabled: true, minTotalReviews: 3, minReviewsToday: nil, minReviewDays: nil, cooldownDays: nil
        ),
        "paywall-second": ReviewPromptSettings(
            enabled: true, minTotalReviews: nil, minReviewsToday: 2, minReviewDays: 2, cooldownDays: nil
        ),
        "paywall-periodic": ReviewPromptSettings(
            enabled: true, minTotalReviews: nil, minReviewsToday: 2, minReviewDays: 3, cooldownDays: 7
        ),
        "notifications-pre-prompt": ReviewPromptSettings(
            enabled: true, minTotalReviews: 6, minReviewsToday: nil, minReviewDays: nil, cooldownDays: 7
        ),
        "rating-request": ReviewPromptSettings(
            enabled: true, minTotalReviews: nil, minReviewsToday: 5, minReviewDays: 2, cooldownDays: 90
        ),
        "web-mobile-app-promo": ReviewPromptSettings(
            enabled: true, minTotalReviews: nil, minReviewsToday: 5, minReviewDays: nil, cooldownDays: 1
        ),
        "guest-sign-in": ReviewPromptSettings(
            enabled: true, minTotalReviews: 20, minReviewsToday: nil, minReviewDays: nil, cooldownDays: 7
        ),
        "automatic-feedback": ReviewPromptSettings(
            enabled: true, minTotalReviews: nil, minReviewsToday: 15, minReviewDays: 2, cooldownDays: 30
        )
    ]
)
