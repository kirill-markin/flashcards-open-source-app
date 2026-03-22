package com.flashcardsopensourceapp.data.local.model

import kotlin.math.max
import kotlin.math.roundToInt

private const val defaultDesiredRetention: Double = 0.90
private const val defaultMaximumIntervalDays: Int = 36_500
private const val minimumDifficulty: Double = 1.0
private const val maximumDifficulty: Double = 10.0
private const val minimumStabilityDays: Double = 0.05

private val reviewAnswerPresentationOrder: List<ReviewRating> = listOf(
    ReviewRating.AGAIN,
    ReviewRating.HARD,
    ReviewRating.GOOD,
    ReviewRating.EASY
)

fun makeDefaultWorkspaceSchedulerSettings(
    workspaceId: String,
    updatedAtMillis: Long
): WorkspaceSchedulerSettings {
    return WorkspaceSchedulerSettings(
        workspaceId = workspaceId,
        algorithm = "fsrs-6",
        desiredRetention = defaultDesiredRetention,
        learningStepsMinutes = listOf(1, 10),
        relearningStepsMinutes = listOf(10),
        maximumIntervalDays = defaultMaximumIntervalDays,
        enableFuzz = true,
        updatedAtMillis = updatedAtMillis
    )
}

fun validateWorkspaceSchedulerSettingsInput(
    workspaceId: String,
    desiredRetention: Double,
    learningStepsMinutes: List<Int>,
    relearningStepsMinutes: List<Int>,
    maximumIntervalDays: Int,
    enableFuzz: Boolean,
    updatedAtMillis: Long
): WorkspaceSchedulerSettings {
    require(desiredRetention > 0 && desiredRetention < 1) {
        "Desired retention must be greater than 0 and less than 1."
    }
    require(learningStepsMinutes.isNotEmpty()) {
        "Learning steps must not be empty."
    }
    require(relearningStepsMinutes.isNotEmpty()) {
        "Relearning steps must not be empty."
    }
    require(learningStepsMinutes.all { value -> value > 0 }) {
        "Learning steps must contain positive integers."
    }
    require(relearningStepsMinutes.all { value -> value > 0 }) {
        "Relearning steps must contain positive integers."
    }
    require(maximumIntervalDays > 0) {
        "Maximum interval must be a positive integer."
    }

    return WorkspaceSchedulerSettings(
        workspaceId = workspaceId,
        algorithm = "fsrs-6",
        desiredRetention = desiredRetention,
        learningStepsMinutes = learningStepsMinutes,
        relearningStepsMinutes = relearningStepsMinutes,
        maximumIntervalDays = maximumIntervalDays,
        enableFuzz = enableFuzz,
        updatedAtMillis = updatedAtMillis
    )
}

fun encodeSchedulerStepListJson(values: List<Int>): String {
    return "[" + values.joinToString(separator = ",") + "]"
}

fun decodeSchedulerStepListJson(json: String): List<Int> {
    val trimmed = json.trim()
    require(trimmed.startsWith("[") && trimmed.endsWith("]")) {
        "Scheduler steps JSON must be an array."
    }

    val body = trimmed.removePrefix("[").removeSuffix("]").trim()
    if (body.isEmpty()) {
        return emptyList()
    }

    return body.split(",").map { value ->
        value.trim().toInt()
    }
}

fun isCardDue(card: CardSummary, nowMillis: Long): Boolean {
    val dueAtMillis = card.dueAtMillis
    return dueAtMillis == null || dueAtMillis <= nowMillis
}

fun isNewCard(card: CardSummary): Boolean {
    return card.reps == 0 && card.lapses == 0
}

fun isReviewedCard(card: CardSummary): Boolean {
    return card.reps > 0 || card.lapses > 0
}

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

fun computeReviewSchedule(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long
): ReviewSchedule {
    val currentDifficulty = card.fsrsDifficulty ?: initialDifficulty(rating = rating)
    val currentStability = card.fsrsStability ?: initialStability(rating = rating)
    val nextDifficulty = nextDifficulty(
        currentDifficulty = currentDifficulty,
        rating = rating
    )
    val nextReps = card.reps + 1
    val nextLapses = if (card.fsrsCardState == FsrsCardState.REVIEW && rating == ReviewRating.AGAIN) {
        card.lapses + 1
    } else {
        card.lapses
    }

    return when (card.fsrsCardState) {
        FsrsCardState.NEW -> scheduleNewCard(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        FsrsCardState.LEARNING -> scheduleLearningCard(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            currentStability = currentStability
        )

        FsrsCardState.REVIEW -> scheduleReviewCard(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            currentStability = currentStability
        )

        FsrsCardState.RELEARNING -> scheduleRelearningCard(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            currentStability = currentStability
        )
    }
}

private fun scheduleNewCard(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long,
    nextDifficulty: Double,
    nextReps: Int,
    nextLapses: Int
): ReviewSchedule {
    return when (rating) {
        ReviewRating.AGAIN -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = settings.learningStepsMinutes.first(),
            nextState = FsrsCardState.LEARNING,
            nextStepIndex = 0,
            nextStability = max(initialStability(rating = rating), minimumStabilityDays),
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.HARD -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = hardStepMinutes(settings.learningStepsMinutes),
            nextState = FsrsCardState.LEARNING,
            nextStepIndex = 0,
            nextStability = max(initialStability(rating = rating), minimumStabilityDays),
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.GOOD -> {
            if (settings.learningStepsMinutes.size == 1) {
                makeGraduatedSchedule(
                    card = card,
                    settings = settings,
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis,
                    nextDifficulty = nextDifficulty,
                    nextReps = nextReps,
                    nextLapses = nextLapses,
                    baseStability = initialStability(rating = rating)
                )
            } else {
                makeShortTermSchedule(
                    reviewedAtMillis = reviewedAtMillis,
                    scheduledMinutes = settings.learningStepsMinutes[1],
                    nextState = FsrsCardState.LEARNING,
                    nextStepIndex = 1,
                    nextStability = initialStability(rating = rating),
                    nextDifficulty = nextDifficulty,
                    nextReps = nextReps,
                    nextLapses = nextLapses
                )
            }
        }

        ReviewRating.EASY -> makeGraduatedSchedule(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            baseStability = initialStability(rating = rating)
        )
    }
}

private fun scheduleLearningCard(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long,
    nextDifficulty: Double,
    nextReps: Int,
    nextLapses: Int,
    currentStability: Double
): ReviewSchedule {
    val currentStepIndex = card.fsrsStepIndex ?: 0

    return when (rating) {
        ReviewRating.AGAIN -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = settings.learningStepsMinutes.first(),
            nextState = FsrsCardState.LEARNING,
            nextStepIndex = 0,
            nextStability = max(currentStability * 0.7, minimumStabilityDays),
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.HARD -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = hardStepMinutes(settings.learningStepsMinutes),
            nextState = FsrsCardState.LEARNING,
            nextStepIndex = currentStepIndex,
            nextStability = currentStability * 1.05,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.GOOD -> {
            val nextStepIndex = currentStepIndex + 1
            if (nextStepIndex >= settings.learningStepsMinutes.size) {
                makeGraduatedSchedule(
                    card = card,
                    settings = settings,
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis,
                    nextDifficulty = nextDifficulty,
                    nextReps = nextReps,
                    nextLapses = nextLapses,
                    baseStability = currentStability * 1.4
                )
            } else {
                makeShortTermSchedule(
                    reviewedAtMillis = reviewedAtMillis,
                    scheduledMinutes = settings.learningStepsMinutes[nextStepIndex],
                    nextState = FsrsCardState.LEARNING,
                    nextStepIndex = nextStepIndex,
                    nextStability = currentStability * 1.2,
                    nextDifficulty = nextDifficulty,
                    nextReps = nextReps,
                    nextLapses = nextLapses
                )
            }
        }

        ReviewRating.EASY -> makeGraduatedSchedule(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            baseStability = currentStability * 1.8
        )
    }
}

private fun scheduleReviewCard(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long,
    nextDifficulty: Double,
    nextReps: Int,
    nextLapses: Int,
    currentStability: Double
): ReviewSchedule {
    return when (rating) {
        ReviewRating.AGAIN -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = settings.relearningStepsMinutes.first(),
            nextState = FsrsCardState.RELEARNING,
            nextStepIndex = 0,
            nextStability = max(currentStability * 0.6, minimumStabilityDays),
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.HARD,
        ReviewRating.GOOD,
        ReviewRating.EASY -> makeGraduatedSchedule(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            baseStability = nextReviewStability(
                currentStability = currentStability,
                desiredRetention = settings.desiredRetention,
                rating = rating
            )
        )
    }
}

private fun scheduleRelearningCard(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long,
    nextDifficulty: Double,
    nextReps: Int,
    nextLapses: Int,
    currentStability: Double
): ReviewSchedule {
    val currentStepIndex = card.fsrsStepIndex ?: 0

    return when (rating) {
        ReviewRating.AGAIN -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = settings.relearningStepsMinutes.first(),
            nextState = FsrsCardState.RELEARNING,
            nextStepIndex = 0,
            nextStability = max(currentStability * 0.75, minimumStabilityDays),
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.HARD -> makeShortTermSchedule(
            reviewedAtMillis = reviewedAtMillis,
            scheduledMinutes = hardStepMinutes(settings.relearningStepsMinutes),
            nextState = FsrsCardState.RELEARNING,
            nextStepIndex = currentStepIndex,
            nextStability = currentStability * 1.03,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses
        )

        ReviewRating.GOOD -> {
            val nextStepIndex = currentStepIndex + 1
            if (nextStepIndex >= settings.relearningStepsMinutes.size) {
                makeGraduatedSchedule(
                    card = card,
                    settings = settings,
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis,
                    nextDifficulty = nextDifficulty,
                    nextReps = nextReps,
                    nextLapses = nextLapses,
                    baseStability = currentStability * 1.3
                )
            } else {
                makeShortTermSchedule(
                    reviewedAtMillis = reviewedAtMillis,
                    scheduledMinutes = settings.relearningStepsMinutes[nextStepIndex],
                    nextState = FsrsCardState.RELEARNING,
                    nextStepIndex = nextStepIndex,
                    nextStability = currentStability * 1.15,
                    nextDifficulty = nextDifficulty,
                    nextReps = nextReps,
                    nextLapses = nextLapses
                )
            }
        }

        ReviewRating.EASY -> makeGraduatedSchedule(
            card = card,
            settings = settings,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            nextDifficulty = nextDifficulty,
            nextReps = nextReps,
            nextLapses = nextLapses,
            baseStability = currentStability * 1.7
        )
    }
}

private fun makeShortTermSchedule(
    reviewedAtMillis: Long,
    scheduledMinutes: Int,
    nextState: FsrsCardState,
    nextStepIndex: Int,
    nextStability: Double,
    nextDifficulty: Double,
    nextReps: Int,
    nextLapses: Int
): ReviewSchedule {
    return ReviewSchedule(
        dueAtMillis = reviewedAtMillis + scheduledMinutes * 60_000L,
        reps = nextReps,
        lapses = nextLapses,
        fsrsCardState = nextState,
        fsrsStepIndex = nextStepIndex,
        fsrsStability = roundMetric(nextStability),
        fsrsDifficulty = roundMetric(nextDifficulty),
        fsrsLastReviewedAtMillis = reviewedAtMillis,
        fsrsScheduledDays = 0
    )
}

private fun makeGraduatedSchedule(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long,
    nextDifficulty: Double,
    nextReps: Int,
    nextLapses: Int,
    baseStability: Double
): ReviewSchedule {
    val scaledStability = max(baseStability, minimumStabilityDays)
    val scheduledDays = nextReviewIntervalDays(
        cardId = card.cardId,
        rating = rating,
        desiredRetention = settings.desiredRetention,
        maximumIntervalDays = settings.maximumIntervalDays,
        enableFuzz = settings.enableFuzz,
        stabilityDays = scaledStability,
        reviewedAtMillis = reviewedAtMillis,
        reps = nextReps
    )

    return ReviewSchedule(
        dueAtMillis = reviewedAtMillis + scheduledDays * 24L * 60L * 60L * 1_000L,
        reps = nextReps,
        lapses = nextLapses,
        fsrsCardState = FsrsCardState.REVIEW,
        fsrsStepIndex = null,
        fsrsStability = roundMetric(max(scaledStability, scheduledDays.toDouble())),
        fsrsDifficulty = roundMetric(nextDifficulty),
        fsrsLastReviewedAtMillis = reviewedAtMillis,
        fsrsScheduledDays = scheduledDays
    )
}

private fun initialDifficulty(rating: ReviewRating): Double {
    return when (rating) {
        ReviewRating.AGAIN -> 7.5
        ReviewRating.HARD -> 6.5
        ReviewRating.GOOD -> 5.0
        ReviewRating.EASY -> 4.0
    }
}

private fun initialStability(rating: ReviewRating): Double {
    return when (rating) {
        ReviewRating.AGAIN -> 0.1
        ReviewRating.HARD -> 0.4
        ReviewRating.GOOD -> 1.0
        ReviewRating.EASY -> 3.0
    }
}

private fun nextDifficulty(currentDifficulty: Double, rating: ReviewRating): Double {
    val delta = when (rating) {
        ReviewRating.AGAIN -> 0.35
        ReviewRating.HARD -> 0.15
        ReviewRating.GOOD -> -0.05
        ReviewRating.EASY -> -0.2
    }

    return (currentDifficulty + delta).coerceIn(
        minimumValue = minimumDifficulty,
        maximumValue = maximumDifficulty
    )
}

private fun nextReviewStability(
    currentStability: Double,
    desiredRetention: Double,
    rating: ReviewRating
): Double {
    val retentionScale = defaultDesiredRetention / desiredRetention
    val ratingFactor = when (rating) {
        ReviewRating.AGAIN -> 0.5
        ReviewRating.HARD -> 1.3
        ReviewRating.GOOD -> 2.2
        ReviewRating.EASY -> 3.2
    }

    return max(currentStability * ratingFactor * retentionScale, minimumStabilityDays)
}

private fun nextReviewIntervalDays(
    cardId: String,
    rating: ReviewRating,
    desiredRetention: Double,
    maximumIntervalDays: Int,
    enableFuzz: Boolean,
    stabilityDays: Double,
    reviewedAtMillis: Long,
    reps: Int
): Int {
    val intervalWithoutFuzz = max(stabilityDays.roundToInt(), 1)
        .coerceAtMost(maximumIntervalDays)
    if (!enableFuzz) {
        return intervalWithoutFuzz
    }

    val seed = "$cardId|$rating|$reviewedAtMillis|$reps"
    val rawOffset = deterministicOffset(seed = seed)
    val spread = max((intervalWithoutFuzz * 0.1).roundToInt(), 1)
    return (intervalWithoutFuzz + rawOffset.mod(spread * 2 + 1) - spread)
        .coerceIn(1, maximumIntervalDays)
}

private fun hardStepMinutes(steps: List<Int>): Int {
    if (steps.size == 1) {
        return steps.first()
    }

    return max((steps[0] + steps[1]) / 2, steps[0])
}

private fun deterministicOffset(seed: String): Int {
    return seed.fold(initial = 17) { current, character ->
        current * 31 + character.code
    }
}

private fun roundMetric(value: Double): Double {
    return ((value * 100.0).roundToInt()) / 100.0
}
