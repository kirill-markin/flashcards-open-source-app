package com.flashcardsopensourceapp.data.local.model

import kotlin.math.max

private val reviewAnswerPresentationOrder: List<ReviewRating> = listOf(
    ReviewRating.AGAIN,
    ReviewRating.HARD,
    ReviewRating.GOOD,
    ReviewRating.EASY
)

// Keep in sync with apps/ios/Flashcards/Flashcards/ReviewAnswerSupport.swift::formatReviewIntervalText(now:dueAt:).
fun formatReviewIntervalText(nowMillis: Long, dueAtMillis: Long?): String {
    if (dueAtMillis == null) {
        return "now"
    }

    val durationSeconds = max(((dueAtMillis - nowMillis) / 1_000L).toInt(), 0)
    if (durationSeconds < 60) {
        return "in less than a minute"
    }

    val durationMinutes = durationSeconds / 60
    if (durationMinutes < 60) {
        return "in $durationMinutes minute${if (durationMinutes == 1) "" else "s"}"
    }

    val durationHours = durationMinutes / 60
    if (durationHours < 24) {
        return "in $durationHours hour${if (durationHours == 1) "" else "s"}"
    }

    val durationDays = durationHours / 24
    return "in $durationDays day${if (durationDays == 1) "" else "s"}"
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
            intervalDescription = formatReviewIntervalText(
                nowMillis = reviewedAtMillis,
                dueAtMillis = schedule.dueAtMillis
            )
        )
    }
}
