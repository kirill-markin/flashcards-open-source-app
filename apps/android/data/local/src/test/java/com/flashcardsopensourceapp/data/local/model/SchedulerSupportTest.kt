package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SchedulerSupportTest {
    @Test
    fun goodOnNewCardSchedulesSecondLearningStep() {
        val schedule = computeReviewSchedule(
            card = sampleNewCard(),
            settings = makeDefaultWorkspaceSchedulerSettings(
                workspaceId = "workspace-demo",
                updatedAtMillis = 100L
            ),
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 1_000L
        )

        assertEquals(FsrsCardState.LEARNING, schedule.fsrsCardState)
        assertEquals(1, schedule.fsrsStepIndex)
        assertEquals(1_000L + 10L * 60L * 1_000L, schedule.dueAtMillis)
    }

    @Test
    fun goodOnReviewCardKeepsCardInReviewWithPositiveInterval() {
        val schedule = computeReviewSchedule(
            card = sampleReviewCard(),
            settings = makeDefaultWorkspaceSchedulerSettings(
                workspaceId = "workspace-demo",
                updatedAtMillis = 100L
            ),
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 1_000L
        )

        assertEquals(FsrsCardState.REVIEW, schedule.fsrsCardState)
        assertEquals(4, schedule.reps)
        assertTrue((schedule.fsrsScheduledDays ?: 0) >= 1)
        assertTrue((schedule.dueAtMillis ?: 0L) > 1_000L)
    }

    @Test
    fun schedulerValidationRejectsOutOfRangeRetention() {
        try {
            validateWorkspaceSchedulerSettingsInput(
                workspaceId = "workspace-demo",
                desiredRetention = 1.0,
                learningStepsMinutes = listOf(1, 10),
                relearningStepsMinutes = listOf(10),
                maximumIntervalDays = 365,
                enableFuzz = true,
                updatedAtMillis = 100L
            )
        } catch (error: IllegalArgumentException) {
            assertEquals("Desired retention must be greater than 0 and less than 1.", error.message)
            return
        }

        throw AssertionError("Expected scheduler validation to fail.")
    }

    private fun sampleNewCard(): CardSummary {
        return CardSummary(
            cardId = "card-new",
            workspaceId = "workspace-demo",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = EffortLevel.FAST,
            dueAtMillis = null,
            createdAtMillis = 100L,
            updatedAtMillis = 100L,
            reps = 0,
            lapses = 0,
            fsrsCardState = FsrsCardState.NEW,
            fsrsStepIndex = null,
            fsrsStability = null,
            fsrsDifficulty = null,
            fsrsLastReviewedAtMillis = null,
            fsrsScheduledDays = null
        )
    }

    private fun sampleReviewCard(): CardSummary {
        return CardSummary(
            cardId = "card-review",
            workspaceId = "workspace-demo",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = EffortLevel.FAST,
            dueAtMillis = 0L,
            createdAtMillis = 100L,
            updatedAtMillis = 100L,
            reps = 3,
            lapses = 0,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = 3.0,
            fsrsDifficulty = 5.0,
            fsrsLastReviewedAtMillis = 0L,
            fsrsScheduledDays = 3
        )
    }
}
