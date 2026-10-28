package com.flashcardsopensourceapp.data.local.review.prompts

// Built-in copy of the after-review prompt rules. The main config, which also documents every
// rule, is apps/backend/src/reviewPrompts/reviewPromptConfig.ts; the iOS copy is
// apps/ios/Flashcards/Flashcards/Review/Prompts/ReviewPromptConfigDefaults.swift. The three are
// synced by hand: the app uses the server values once it has them, but every release should ship
// the current defaults.

enum class ReviewPromptId(val wireValue: String) {
    HARD_REMINDER(wireValue = "hard-reminder"),
    PAYWALL_INITIAL(wireValue = "paywall-initial"),
    PAYWALL_SECOND(wireValue = "paywall-second"),
    PAYWALL_PERIODIC(wireValue = "paywall-periodic"),
    NOTIFICATIONS_PRE_PROMPT(wireValue = "notifications-pre-prompt"),
    RATING_REQUEST(wireValue = "rating-request"),
    WEB_MOBILE_APP_PROMO(wireValue = "web-mobile-app-promo"),
    GUEST_SIGN_IN(wireValue = "guest-sign-in"),
    AUTOMATIC_FEEDBACK(wireValue = "automatic-feedback")
}

/** A null setting is no condition; every count is a non-negative integer. */
data class ReviewPromptSettings(
    val enabled: Boolean,
    val minTotalReviews: Int?,
    val minReviewsToday: Int?,
    val minReviewDays: Int?,
    val cooldownDays: Int?
)

data class ReviewPromptConfig(
    val schemaVersion: Int,
    /** Sent unchanged as the `review_prompt_config_version` analytics property. */
    val version: String,
    val order: List<ReviewPromptId>,
    val prompts: Map<ReviewPromptId, ReviewPromptSettings>
)

val reviewPromptConfigDefaults: ReviewPromptConfig = ReviewPromptConfig(
    schemaVersion = 1,
    version = "2026-10-28-1",
    order = listOf(
        ReviewPromptId.HARD_REMINDER,
        ReviewPromptId.PAYWALL_INITIAL,
        ReviewPromptId.PAYWALL_SECOND,
        ReviewPromptId.PAYWALL_PERIODIC,
        ReviewPromptId.NOTIFICATIONS_PRE_PROMPT,
        ReviewPromptId.RATING_REQUEST,
        ReviewPromptId.WEB_MOBILE_APP_PROMO,
        ReviewPromptId.GUEST_SIGN_IN,
        ReviewPromptId.AUTOMATIC_FEEDBACK
    ),
    prompts = mapOf(
        ReviewPromptId.HARD_REMINDER to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = null,
            minReviewsToday = null,
            minReviewDays = null,
            cooldownDays = 3
        ),
        ReviewPromptId.PAYWALL_INITIAL to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = 3,
            minReviewsToday = null,
            minReviewDays = null,
            cooldownDays = null
        ),
        ReviewPromptId.PAYWALL_SECOND to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = null,
            minReviewsToday = 2,
            minReviewDays = 2,
            cooldownDays = null
        ),
        ReviewPromptId.PAYWALL_PERIODIC to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = null,
            minReviewsToday = 2,
            minReviewDays = 3,
            cooldownDays = 7
        ),
        ReviewPromptId.NOTIFICATIONS_PRE_PROMPT to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = 6,
            minReviewsToday = null,
            minReviewDays = null,
            cooldownDays = 7
        ),
        ReviewPromptId.RATING_REQUEST to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = null,
            minReviewsToday = 5,
            minReviewDays = 2,
            cooldownDays = 90
        ),
        ReviewPromptId.WEB_MOBILE_APP_PROMO to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = null,
            minReviewsToday = 5,
            minReviewDays = null,
            cooldownDays = 1
        ),
        ReviewPromptId.GUEST_SIGN_IN to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = 20,
            minReviewsToday = null,
            minReviewDays = null,
            cooldownDays = 7
        ),
        ReviewPromptId.AUTOMATIC_FEEDBACK to ReviewPromptSettings(
            enabled = true,
            minTotalReviews = null,
            minReviewsToday = 15,
            minReviewDays = 2,
            cooldownDays = 30
        )
    )
)
