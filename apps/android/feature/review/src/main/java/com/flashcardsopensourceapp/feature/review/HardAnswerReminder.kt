package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.ReviewRating

internal const val hardAnswerReminderRecentRatingWindowSize: Int = 8
internal const val hardAnswerReminderHardCountThreshold: Int = 5
internal const val hardAnswerReminderCooldownMillis: Long = 3L * 24L * 60L * 60L * 1000L

/**
 * Appends a review rating to the in-memory reminder window and trims it to the
 * configured window size.
 */
internal fun appendRecentReviewRatings(
    recentReviewRatings: List<ReviewRating>,
    nextRating: ReviewRating
): List<ReviewRating> {
    val nextRatings = recentReviewRatings + nextRating
    if (nextRatings.size <= hardAnswerReminderRecentRatingWindowSize) {
        return nextRatings
    }

    return nextRatings.takeLast(hardAnswerReminderRecentRatingWindowSize)
}

/**
 * Returns true when the current window has enough Hard answers to justify a reminder.
 */
internal fun shouldShowHardAnswerReminder(recentReviewRatings: List<ReviewRating>): Boolean {
    if (recentReviewRatings.size < hardAnswerReminderRecentRatingWindowSize) {
        return false
    }

    val hardCount = recentReviewRatings.count { rating -> rating == ReviewRating.HARD }
    return hardCount >= hardAnswerReminderHardCountThreshold
}

/**
 * Returns true when the reminder is still inside its cooldown period.
 */
internal fun isHardAnswerReminderOnCooldown(
    lastShownAtMillis: Long?,
    nowMillis: Long
): Boolean {
    if (lastShownAtMillis == null) {
        return false
    }

    return nowMillis - lastShownAtMillis < hardAnswerReminderCooldownMillis
}
