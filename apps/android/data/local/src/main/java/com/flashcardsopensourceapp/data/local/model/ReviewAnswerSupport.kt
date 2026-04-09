package com.flashcardsopensourceapp.data.local.model

import kotlin.math.max

private val reviewAnswerPresentationOrder: List<ReviewRating> = listOf(
    ReviewRating.AGAIN,
    ReviewRating.HARD,
    ReviewRating.GOOD,
    ReviewRating.EASY
)

sealed interface ReviewIntervalDescription {
    data object Now : ReviewIntervalDescription

    data object LessThanOneMinute : ReviewIntervalDescription

    data class Minutes(
        val count: Int
    ) : ReviewIntervalDescription

    data class Hours(
        val count: Int
    ) : ReviewIntervalDescription

    data class Days(
        val count: Int
    ) : ReviewIntervalDescription
}

// Keep in sync with apps/ios/Flashcards/Flashcards/ReviewAnswerSupport.swift::formatReviewIntervalText(now:dueAt:).
fun resolveReviewIntervalDescription(nowMillis: Long, dueAtMillis: Long?): ReviewIntervalDescription {
    if (dueAtMillis == null) {
        return ReviewIntervalDescription.Now
    }

    val durationSeconds = max(((dueAtMillis - nowMillis) / 1_000L).toInt(), 0)
    if (durationSeconds < 60) {
        return ReviewIntervalDescription.LessThanOneMinute
    }

    val durationMinutes = durationSeconds / 60
    if (durationMinutes < 60) {
        return ReviewIntervalDescription.Minutes(count = durationMinutes)
    }

    val durationHours = durationMinutes / 60
    if (durationHours < 24) {
        return ReviewIntervalDescription.Hours(count = durationHours)
    }

    val durationDays = durationHours / 24
    return ReviewIntervalDescription.Days(count = durationDays)
}

// Keep in sync with apps/ios/Flashcards/Flashcards/ReviewAnswerSupport.swift::makeReviewAnswerOptions(card:schedulerSettings:now:).
fun makeReviewAnswerOptions(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    reviewedAtMillis: Long
): List<ReviewAnswerOption> {
    return reviewAnswerPresentationOrder.map { rating ->
        val schedule = computeReviewSchedule(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis
        )

        ReviewAnswerOption(
            rating = rating,
            intervalDescription = resolveReviewIntervalDescription(
                nowMillis = reviewedAtMillis,
                dueAtMillis = schedule.dueAtMillis
            )
        )
    }
}
