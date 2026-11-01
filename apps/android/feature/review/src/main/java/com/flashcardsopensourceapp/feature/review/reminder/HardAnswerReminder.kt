package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.review.ReviewRating

internal const val hardAnswerReminderRecentRatingWindowSize: Int = 8
internal const val hardAnswerReminderHardCountThreshold: Int = 5

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
 * The reminder's fixed rule: the saved answer is Hard and the session window, which already
 * includes it, has enough Hard answers. Its cooldown comes from the review prompt config.
 */
internal fun shouldShowHardAnswerReminder(
    savedRating: ReviewRating,
    recentReviewRatings: List<ReviewRating>
): Boolean {
    if (savedRating != ReviewRating.HARD || recentReviewRatings.size < hardAnswerReminderRecentRatingWindowSize) {
        return false
    }

    val hardCount = recentReviewRatings.count { rating -> rating == ReviewRating.HARD }
    return hardCount >= hardAnswerReminderHardCountThreshold
}
