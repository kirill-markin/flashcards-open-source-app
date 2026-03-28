package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewAnswerSupportTest {
    @Test
    fun makeReviewAnswerOptionsReturnsButtonsInFsrsOrder() {
        val answerOptions = makeReviewAnswerOptions(
            card = CardSummary(
                cardId = "card-review",
                workspaceId = "workspace-local",
                frontText = "Question",
                backText = "Answer",
                tags = emptyList(),
                effortLevel = EffortLevel.FAST,
                dueAtMillis = 0L,
                createdAtMillis = 0L,
                updatedAtMillis = 0L,
                reps = 1,
                lapses = 0,
                fsrsCardState = FsrsCardState.REVIEW,
                fsrsStepIndex = null,
                fsrsStability = 8.2956,
                fsrsDifficulty = 1.0,
                fsrsLastReviewedAtMillis = 0L,
                fsrsScheduledDays = 8,
                deletedAtMillis = null
            ),
            settings = makeDefaultWorkspaceSchedulerSettings(
                workspaceId = "workspace-local",
                updatedAtMillis = 0L
            ),
            reviewedAtMillis = 8L * 86_400_000L
        )

        assertEquals(
            listOf(ReviewRating.AGAIN, ReviewRating.HARD, ReviewRating.GOOD, ReviewRating.EASY),
            answerOptions.map { option -> option.rating }
        )
    }

    @Test
    fun formatReviewIntervalTextFormatsNowMinutesHoursAndDays() {
        assertEquals("now", formatReviewIntervalText(nowMillis = 0L, dueAtMillis = null))
        assertEquals("in less than a minute", formatReviewIntervalText(nowMillis = 0L, dueAtMillis = 30_000L))
        assertEquals("in 2 minutes", formatReviewIntervalText(nowMillis = 0L, dueAtMillis = 120_000L))
        assertEquals("in 3 hours", formatReviewIntervalText(nowMillis = 0L, dueAtMillis = 3L * 3_600_000L))
        assertEquals("in 4 days", formatReviewIntervalText(nowMillis = 0L, dueAtMillis = 4L * 86_400_000L))
    }
}
