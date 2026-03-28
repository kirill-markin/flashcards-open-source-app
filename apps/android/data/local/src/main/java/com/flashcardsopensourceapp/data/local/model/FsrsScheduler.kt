package com.flashcardsopensourceapp.data.local.model

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Full FSRS scheduler with persisted card state and workspace-level settings.
 *
 * This file is a full Kotlin copy of the scheduler implemented in
 * `apps/backend/src/schedule.ts` and mirrored in
 * `apps/ios/Flashcards/Flashcards/FsrsScheduler.swift`.
 * If you change algorithm behavior here, you must make the same change in the
 * backend copy, the iOS copy, update `docs/fsrs-scheduling-logic.md`, and keep
 * `tests/fsrs-full-vectors.json` plus all scheduler test suites aligned in the
 * same PR.
 *
 * Reference sources:
 * - official open-spaced-repetition ts-fsrs 5.2.3 scheduler flow mirrored here:
 *   https://github.com/open-spaced-repetition/ts-fsrs
 * - official FSRS algorithm notes:
 *   https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 * - product source of truth: docs/fsrs-scheduling-logic.md
 */

// Keep in sync with apps/backend/src/schedule.ts::ReviewableCardScheduleState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::ReviewableCardScheduleState.
data class ReviewableCardScheduleState(
    val cardId: String,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?
)

// Keep in sync with apps/backend/src/schedule.ts::ReviewHistoryEvent and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::FsrsReviewHistoryEvent.
data class FsrsReviewHistoryEvent(
    val rating: ReviewRating,
    val reviewedAtMillis: Long
)

// Keep in sync with apps/backend/src/schedule.ts::RebuiltCardScheduleState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::RebuiltCardScheduleState.
data class RebuiltCardScheduleState(
    val dueAtMillis: Long?,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?
)

// Keep in sync with apps/backend/src/schedule.ts::FsrsMemoryState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::FsrsMemoryState.
private data class FsrsMemoryState(
    val difficulty: Double,
    val stability: Double
)

// Keep in sync with apps/backend/src/schedule.ts::FuzzRange and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::FuzzRange.
private data class FuzzRange(
    val minInterval: Int,
    val maxInterval: Int
)

// Keep in sync with apps/backend/src/schedule.ts::LearningStepResult and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::LearningStepResult.
private data class LearningStepResult(
    val scheduledMinutes: Int?,
    val nextStepIndex: Int
)

private data class ShortTermWeights(
    val w17: Double,
    val w18: Double
)

private const val fsrsMinimumStability: Double = 0.001
private const val w17W18Ceiling: Double = 2.0
private const val millisecondsPerMinute: Long = 60_000L
private const val millisecondsPerDay: Long = 86_400_000L

private val schedulerTimestampFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US)
    .withZone(ZoneOffset.UTC)

// Keep in sync with apps/backend/src/schedule.ts::DEFAULT_W and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::defaultWeights.
private val defaultWeights: List<Double> = listOf(
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    0.001,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    0.1542
)

// Keep in sync with apps/backend/src/schedule.ts::FUZZ_RANGES and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::fuzzRanges.
private val fuzzRanges: List<Triple<Double, Double, Double>> = listOf(
    Triple(2.5, 7.0, 0.15),
    Triple(7.0, 20.0, 0.1),
    Triple(20.0, Double.POSITIVE_INFINITY, 0.05)
)

// Keep in sync with apps/backend/src/schedule.ts::DECAY and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::fsrsDecay.
private val fsrsDecay: Double = -defaultWeights[20]

// Keep in sync with apps/backend/src/schedule.ts::FACTOR and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::fsrsFactor.
private val fsrsFactor: Double = roundTo8(
    value = exp(fsrsDecay.pow(-1.0) * ln(0.9)) - 1
)

private class MashGenerator {
    private var n: Double = 0xefc8249d.toDouble()

    // Keep in sync with apps/backend/src/schedule.ts::createMash and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::MashGenerator.next(data:).
    fun next(data: String): Double {
        var nextValue = n
        for (character in data) {
            nextValue += character.code.toDouble()
            var h = 0.02519603282416938 * nextValue
            nextValue = floor(h)
            h -= nextValue
            h *= nextValue
            nextValue = floor(h)
            h -= nextValue
            nextValue += h * 4_294_967_296.0
        }

        n = nextValue
        val normalized = floor(nextValue) % 4_294_967_296.0
        return normalized * 2.3283064365386963e-10
    }
}

private class AleaGenerator(seed: String) {
    private var c: Double
    private var s0: Double
    private var s1: Double
    private var s2: Double

    // Keep in sync with apps/backend/src/schedule.ts::Alea and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::AleaGenerator.init(seed:).
    init {
        val mash = MashGenerator()
        c = 1.0
        s0 = mash.next(data = " ")
        s1 = mash.next(data = " ")
        s2 = mash.next(data = " ")

        s0 -= mash.next(data = seed)
        if (s0 < 0) {
            s0 += 1
        }

        s1 -= mash.next(data = seed)
        if (s1 < 0) {
            s1 += 1
        }

        s2 -= mash.next(data = seed)
        if (s2 < 0) {
            s2 += 1
        }
    }

    // Keep in sync with apps/backend/src/schedule.ts::Alea.next and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::AleaGenerator.next().
    fun next(): Double {
        val nextValue = 2_091_639.0 * s0 + c * 2.3283064365386963e-10
        s0 = s1
        s1 = s2
        c = floor(nextValue)
        s2 = nextValue - c
        return s2
    }
}

// Keep in sync with apps/backend/src/schedule.ts::roundTo8 and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::roundTo8(value:).
fun roundTo8(value: Double): Double {
    val formattedValue = String.format(Locale.US, "%.8f", value)
    return formattedValue.toDouble()
}

// Keep in sync with apps/backend/src/schedule.ts::clamp and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::clamp(value:min:max:).
private fun clamp(value: Double, minValue: Double, maxValue: Double): Double {
    return min(max(value, minValue), maxValue)
}

private fun addMinutes(reviewedAtMillis: Long, minutes: Int): Long {
    return reviewedAtMillis + minutes * millisecondsPerMinute
}

private fun addDays(reviewedAtMillis: Long, days: Int): Long {
    return reviewedAtMillis + days * millisecondsPerDay
}

private fun formatSchedulerTimestamp(timestampMillis: Long): String {
    return schedulerTimestampFormatter.format(Instant.ofEpochMilli(timestampMillis))
}

// Keep in sync with apps/backend/src/schedule.ts::dateDiffInDays and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::dateDiffInDays(lastReviewedAt:now:).
private fun dateDiffInDays(lastReviewedAtMillis: Long, reviewedAtMillis: Long): Int {
    require(reviewedAtMillis >= lastReviewedAtMillis) {
        "Review timestamp moved backwards: lastReviewedAt=${formatSchedulerTimestamp(lastReviewedAtMillis)}, now=${formatSchedulerTimestamp(reviewedAtMillis)}"
    }

    val lastReviewedAtUtcDay = Instant.ofEpochMilli(lastReviewedAtMillis)
        .atZone(ZoneOffset.UTC)
        .toLocalDate()
    val reviewedAtUtcDay = Instant.ofEpochMilli(reviewedAtMillis)
        .atZone(ZoneOffset.UTC)
        .toLocalDate()
    return ChronoUnit.DAYS.between(lastReviewedAtUtcDay, reviewedAtUtcDay).toInt()
}

// Keep in sync with apps/backend/src/schedule.ts::stateRequiresMemory and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::stateRequiresMemory(state:).
private fun stateRequiresMemory(state: FsrsCardState): Boolean {
    return state != FsrsCardState.NEW
}

// Keep in sync with apps/backend/src/schedule.ts::getIntervalModifier and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getIntervalModifier(requestRetention:).
private fun getIntervalModifier(requestRetention: Double): Double {
    return roundTo8(
        value = (requestRetention.pow(1 / fsrsDecay) - 1) / fsrsFactor
    )
}

// Keep in sync with apps/backend/src/schedule.ts::formatSeedNumber and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::formatSeedNumber(value:).
private fun formatSeedNumber(value: Double): String {
    if (value == 0.0) {
        return "0"
    }

    if (value.toLong().toDouble() == value) {
        return value.toLong().toString()
    }

    return value.toString()
}

// Keep in sync with apps/backend/src/schedule.ts::mapRatingToFsrsGrade and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::mapRatingToFsrsGrade(rating:).
private fun mapRatingToFsrsGrade(rating: ReviewRating): Int {
    return when (rating) {
        ReviewRating.AGAIN -> 1
        ReviewRating.HARD -> 2
        ReviewRating.GOOD -> 3
        ReviewRating.EASY -> 4
    }
}

// Keep in sync with apps/backend/src/schedule.ts::getStepsForState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getStepsForState(settings:state:).
private fun getStepsForState(
    settings: WorkspaceSchedulerSettings,
    state: FsrsCardState
): List<Int> {
    return if (state == FsrsCardState.RELEARNING || state == FsrsCardState.REVIEW) {
        settings.relearningStepsMinutes
    } else {
        settings.learningStepsMinutes
    }
}

// Keep in sync with apps/backend/src/schedule.ts::getCurrentStepIndex and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getCurrentStepIndex(card:).
private fun getCurrentStepIndex(card: ReviewableCardScheduleState): Int {
    return card.fsrsStepIndex ?: 0
}

// Keep in sync with apps/backend/src/schedule.ts::getLearningStrategyStepIndex and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getLearningStrategyStepIndex(card:grade:).
private fun getLearningStrategyStepIndex(
    card: ReviewableCardScheduleState,
    grade: Int
): Int {
    val currentStepIndex = getCurrentStepIndex(card = card)
    if (card.fsrsCardState == FsrsCardState.LEARNING && grade != 1 && grade != 2) {
        return currentStepIndex + 1
    }

    return currentStepIndex
}

// Keep in sync with apps/backend/src/schedule.ts::getHardStepMinutes and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getHardStepMinutes(steps:).
private fun getHardStepMinutes(steps: List<Int>): Int {
    if (steps.size == 1) {
        return (steps[0] * 1.5).roundToInt()
    }

    return ((steps[0] + steps[1]).toDouble() / 2.0).roundToInt()
}

// Keep in sync with apps/backend/src/schedule.ts::getLearningStepResult and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getLearningStepResult(settings:card:grade:).
private fun getLearningStepResult(
    settings: WorkspaceSchedulerSettings,
    card: ReviewableCardScheduleState,
    grade: Int
): LearningStepResult {
    val steps = getStepsForState(settings = settings, state = card.fsrsCardState)
    val strategyStepIndex = getLearningStrategyStepIndex(card = card, grade = grade)

    require(steps.isNotEmpty()) {
        "Workspace scheduler steps must not be empty"
    }

    if (card.fsrsCardState == FsrsCardState.REVIEW) {
        return LearningStepResult(
            scheduledMinutes = steps[0],
            nextStepIndex = 0
        )
    }

    if (grade == 1) {
        return LearningStepResult(
            scheduledMinutes = steps[0],
            nextStepIndex = 0
        )
    }

    if (grade == 2) {
        return LearningStepResult(
            scheduledMinutes = getHardStepMinutes(steps = steps),
            nextStepIndex = strategyStepIndex
        )
    }

    if (grade == 4) {
        return LearningStepResult(
            scheduledMinutes = null,
            nextStepIndex = 0
        )
    }

    val nextStepIndex = strategyStepIndex + 1
    val nextStepMinutes = steps.getOrNull(nextStepIndex)
    if (nextStepMinutes == null) {
        return LearningStepResult(
            scheduledMinutes = null,
            nextStepIndex = 0
        )
    }

    return LearningStepResult(
        scheduledMinutes = nextStepMinutes,
        nextStepIndex = nextStepIndex
    )
}

// Keep in sync with apps/backend/src/schedule.ts::initStability and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::initStability(grade:).
private fun initStability(grade: Int): Double {
    return max(defaultWeights[grade - 1], 0.1)
}

// Keep in sync with apps/backend/src/schedule.ts::initDifficulty and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::initDifficulty(grade:).
private fun initDifficulty(grade: Int): Double {
    return roundTo8(
        value = defaultWeights[4] - exp((grade - 1) * defaultWeights[5]) + 1
    )
}

// Keep in sync with apps/backend/src/schedule.ts::meanReversion and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::meanReversion(initialDifficulty:currentDifficulty:).
private fun meanReversion(initialDifficulty: Double, currentDifficulty: Double): Double {
    return roundTo8(
        value = defaultWeights[7] * initialDifficulty + (1 - defaultWeights[7]) * currentDifficulty
    )
}

// Keep in sync with apps/backend/src/schedule.ts::linearDamping and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::linearDamping(deltaDifficulty:difficulty:).
private fun linearDamping(deltaDifficulty: Double, difficulty: Double): Double {
    return roundTo8(
        value = deltaDifficulty * (10 - difficulty) / 9
    )
}

// Keep in sync with apps/backend/src/schedule.ts::nextDifficulty and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::nextDifficulty(difficulty:grade:).
private fun nextDifficulty(difficulty: Double, grade: Int): Double {
    val deltaDifficulty = -defaultWeights[6] * (grade - 3)
    val nextDifficultyValue = difficulty + linearDamping(
        deltaDifficulty = deltaDifficulty,
        difficulty = difficulty
    )

    return clamp(
        value = meanReversion(
            initialDifficulty = initDifficulty(grade = 4),
            currentDifficulty = nextDifficultyValue
        ),
        minValue = 1.0,
        maxValue = 10.0
    )
}

// Keep in sync with apps/backend/src/schedule.ts::forgettingCurve and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::forgettingCurve(elapsedDays:stability:).
private fun forgettingCurve(elapsedDays: Int, stability: Double): Double {
    return roundTo8(
        value = (1 + fsrsFactor * elapsedDays / stability).pow(fsrsDecay)
    )
}

// Keep in sync with apps/backend/src/schedule.ts::nextRecallStability and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::nextRecallStability(difficulty:stability:retrievability:grade:).
private fun nextRecallStability(
    difficulty: Double,
    stability: Double,
    retrievability: Double,
    grade: Int
): Double {
    val hardPenalty = if (grade == 2) {
        defaultWeights[15]
    } else {
        1.0
    }
    val easyBound = if (grade == 4) {
        defaultWeights[16]
    } else {
        1.0
    }

    return roundTo8(
        value = clamp(
            value = stability * (
                1 +
                    exp(defaultWeights[8]) *
                    (11 - difficulty) *
                    stability.pow(-defaultWeights[9]) *
                    (exp((1 - retrievability) * defaultWeights[10]) - 1) *
                    hardPenalty *
                    easyBound
                ),
            minValue = fsrsMinimumStability,
            maxValue = 36_500.0
        )
    )
}

// Keep in sync with apps/backend/src/schedule.ts::nextForgetStability and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::nextForgetStability(difficulty:stability:retrievability:).
private fun nextForgetStability(
    difficulty: Double,
    stability: Double,
    retrievability: Double
): Double {
    return roundTo8(
        value = clamp(
            value = defaultWeights[11] *
                difficulty.pow(-defaultWeights[12]) *
                ((stability + 1).pow(defaultWeights[13]) - 1) *
                exp((1 - retrievability) * defaultWeights[14]),
            minValue = fsrsMinimumStability,
            maxValue = 36_500.0
        )
    )
}

// Keep in sync with apps/backend/src/schedule.ts::getShortTermWeights and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getShortTermWeights(settings:).
private fun getShortTermWeights(settings: WorkspaceSchedulerSettings): ShortTermWeights {
    if (settings.relearningStepsMinutes.size <= 1) {
        return ShortTermWeights(
            w17 = defaultWeights[17],
            w18 = defaultWeights[18]
        )
    }

    val value = -(
        ln(defaultWeights[11]) +
            ln(2.0.pow(defaultWeights[13]) - 1) +
            defaultWeights[14] * 0.3
        ) / settings.relearningStepsMinutes.size
    val ceiling = clamp(
        value = roundTo8(value = value),
        minValue = 0.01,
        maxValue = w17W18Ceiling
    )

    return ShortTermWeights(
        w17 = clamp(value = defaultWeights[17], minValue = 0.0, maxValue = ceiling),
        w18 = clamp(value = defaultWeights[18], minValue = 0.0, maxValue = ceiling)
    )
}

// Keep in sync with apps/backend/src/schedule.ts::nextShortTermStability and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::nextShortTermStability(stability:grade:settings:).
private fun nextShortTermStability(
    stability: Double,
    grade: Int,
    settings: WorkspaceSchedulerSettings
): Double {
    val shortTermWeights = getShortTermWeights(settings = settings)
    val sinc = stability.pow(-defaultWeights[19]) *
        exp(shortTermWeights.w17 * (grade - 3 + shortTermWeights.w18))
    val maskedSinc = if (grade >= 3) {
        max(sinc, 1.0)
    } else {
        sinc
    }

    return roundTo8(
        value = clamp(
            value = stability * maskedSinc,
            minValue = fsrsMinimumStability,
            maxValue = 36_500.0
        )
    )
}

// Keep in sync with apps/backend/src/schedule.ts::createInitialMemoryState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::createInitialMemoryState(grade:).
private fun createInitialMemoryState(grade: Int): FsrsMemoryState {
    return FsrsMemoryState(
        difficulty = clamp(
            value = initDifficulty(grade = grade),
            minValue = 1.0,
            maxValue = 10.0
        ),
        stability = initStability(grade = grade)
    )
}

// Keep in sync with apps/backend/src/schedule.ts::computeNextShortTermMemoryState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::computeNextShortTermMemoryState(memoryState:grade:settings:).
private fun computeNextShortTermMemoryState(
    memoryState: FsrsMemoryState,
    grade: Int,
    settings: WorkspaceSchedulerSettings
): FsrsMemoryState {
    return FsrsMemoryState(
        difficulty = nextDifficulty(
            difficulty = memoryState.difficulty,
            grade = grade
        ),
        stability = nextShortTermStability(
            stability = memoryState.stability,
            grade = grade,
            settings = settings
        )
    )
}

// Keep in sync with apps/backend/src/schedule.ts::computeNextReviewMemoryState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::computeNextReviewMemoryState(memoryState:elapsedDays:grade:settings:).
private fun computeNextReviewMemoryState(
    memoryState: FsrsMemoryState,
    elapsedDays: Int,
    grade: Int,
    settings: WorkspaceSchedulerSettings
): FsrsMemoryState {
    val retrievability = forgettingCurve(
        elapsedDays = elapsedDays,
        stability = memoryState.stability
    )
    val stabilityAfterSuccess = nextRecallStability(
        difficulty = memoryState.difficulty,
        stability = memoryState.stability,
        retrievability = retrievability,
        grade = grade
    )
    val stabilityAfterFailure = nextForgetStability(
        difficulty = memoryState.difficulty,
        stability = memoryState.stability,
        retrievability = retrievability
    )

    var nextStability = stabilityAfterSuccess
    if (grade == 1) {
        val shortTermWeights = getShortTermWeights(settings = settings)
        val nextStabilityMin = memoryState.stability / exp(shortTermWeights.w17 * shortTermWeights.w18)
        nextStability = clamp(
            value = roundTo8(value = nextStabilityMin),
            minValue = fsrsMinimumStability,
            maxValue = stabilityAfterFailure
        )
    }

    return FsrsMemoryState(
        difficulty = nextDifficulty(
            difficulty = memoryState.difficulty,
            grade = grade
        ),
        stability = nextStability
    )
}

// Keep in sync with apps/backend/src/schedule.ts::getFuzzRange and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getFuzzRange(interval:elapsedDays:maximumInterval:).
private fun getFuzzRange(
    interval: Int,
    elapsedDays: Int,
    maximumInterval: Int
): FuzzRange {
    var delta = 1.0
    for ((start, end, factor) in fuzzRanges) {
        delta += factor * max(min(interval.toDouble(), end) - start, 0.0)
    }

    val clampedInterval = min(interval, maximumInterval)
    var minInterval = max(2, (clampedInterval - delta).roundToInt())
    val maxInterval = min((clampedInterval + delta).roundToInt(), maximumInterval)
    if (clampedInterval > elapsedDays) {
        minInterval = max(minInterval, elapsedDays + 1)
    }

    minInterval = min(minInterval, maxInterval)
    return FuzzRange(
        minInterval = minInterval,
        maxInterval = maxInterval
    )
}

// Keep in sync with apps/backend/src/schedule.ts::getIntervalSeed and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getIntervalSeed(now:reps:memoryState:).
private fun getIntervalSeed(
    reviewedAtMillis: Long,
    reps: Int,
    memoryState: FsrsMemoryState?
): String {
    val memoryProduct = if (memoryState == null) {
        0.0
    } else {
        memoryState.difficulty * memoryState.stability
    }

    return "${reviewedAtMillis}_${reps}_${formatSeedNumber(value = memoryProduct)}"
}

// Keep in sync with apps/backend/src/schedule.ts::nextInterval and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::nextInterval(stability:elapsedDays:settings:intervalSeed:).
private fun nextInterval(
    stability: Double,
    elapsedDays: Int,
    settings: WorkspaceSchedulerSettings,
    intervalSeed: String
): Int {
    val intervalModifier = getIntervalModifier(requestRetention = settings.desiredRetention)
    val nextRawInterval = clamp(
        value = (stability * intervalModifier).roundToInt().toDouble(),
        minValue = 1.0,
        maxValue = settings.maximumIntervalDays.toDouble()
    ).toInt()

    if (settings.enableFuzz.not() || nextRawInterval < 3) {
        return nextRawInterval
    }

    val prng = AleaGenerator(seed = intervalSeed)
    val fuzzFactor = prng.next()
    val fuzzRange = getFuzzRange(
        interval = nextRawInterval,
        elapsedDays = elapsedDays,
        maximumInterval = settings.maximumIntervalDays
    )

    return floor(
        fuzzFactor * (fuzzRange.maxInterval - fuzzRange.minInterval + 1).toDouble() +
            fuzzRange.minInterval.toDouble()
    ).toInt()
}

// Keep in sync with apps/backend/src/schedule.ts::getMemoryState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getMemoryState(card:).
private fun getMemoryState(card: ReviewableCardScheduleState): FsrsMemoryState? {
    if (stateRequiresMemory(state = card.fsrsCardState).not()) {
        require(
            card.fsrsStability == null &&
                card.fsrsDifficulty == null &&
                card.fsrsLastReviewedAtMillis == null &&
                card.fsrsScheduledDays == null &&
                card.fsrsStepIndex == null
        ) {
            "New card must not have persisted FSRS state"
        }

        return null
    }

    require(
        card.fsrsStability != null &&
            card.fsrsDifficulty != null &&
            card.fsrsLastReviewedAtMillis != null &&
            card.fsrsScheduledDays != null
    ) {
        "Persisted FSRS card state is incomplete"
    }

    require(card.fsrsCardState != FsrsCardState.REVIEW || card.fsrsStepIndex == null) {
        "Review card must not persist fsrsStepIndex"
    }
    require(
        (card.fsrsCardState != FsrsCardState.LEARNING && card.fsrsCardState != FsrsCardState.RELEARNING) ||
            card.fsrsStepIndex != null
    ) {
        "Learning or relearning card is missing fsrsStepIndex"
    }

    return FsrsMemoryState(
        difficulty = requireNotNull(card.fsrsDifficulty),
        stability = requireNotNull(card.fsrsStability)
    )
}

// Keep in sync with apps/backend/src/schedule.ts::buildShortTermSchedule and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::buildShortTermSchedule(card:nextMemoryState:rating:now:reps:lapses:settings:nextState:elapsedDays:intervalSeed:).
private fun buildShortTermSchedule(
    card: ReviewableCardScheduleState,
    nextMemoryState: FsrsMemoryState,
    rating: ReviewRating,
    reviewedAtMillis: Long,
    reps: Int,
    lapses: Int,
    settings: WorkspaceSchedulerSettings,
    nextState: FsrsCardState,
    elapsedDays: Int,
    intervalSeed: String
): ReviewSchedule {
    val grade = mapRatingToFsrsGrade(rating = rating)
    val learningStep = getLearningStepResult(
        settings = settings,
        card = card,
        grade = grade
    )

    if (learningStep.scheduledMinutes == null) {
        return buildGraduatedReviewSchedule(
            nextMemoryState = nextMemoryState,
            reviewedAtMillis = reviewedAtMillis,
            reps = reps,
            lapses = lapses,
            settings = settings,
            elapsedDays = elapsedDays,
            intervalSeed = intervalSeed
        )
    }

    return ReviewSchedule(
        dueAtMillis = addMinutes(
            reviewedAtMillis = reviewedAtMillis,
            minutes = learningStep.scheduledMinutes
        ),
        reps = reps,
        lapses = lapses,
        fsrsCardState = nextState,
        fsrsStepIndex = learningStep.nextStepIndex,
        fsrsStability = nextMemoryState.stability,
        fsrsDifficulty = nextMemoryState.difficulty,
        fsrsLastReviewedAtMillis = reviewedAtMillis,
        fsrsScheduledDays = 0
    )
}

// Keep in sync with apps/backend/src/schedule.ts::buildGraduatedReviewSchedule and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::buildGraduatedReviewSchedule(nextMemoryState:now:reps:lapses:settings:elapsedDays:intervalSeed:).
private fun buildGraduatedReviewSchedule(
    nextMemoryState: FsrsMemoryState,
    reviewedAtMillis: Long,
    reps: Int,
    lapses: Int,
    settings: WorkspaceSchedulerSettings,
    elapsedDays: Int,
    intervalSeed: String
): ReviewSchedule {
    val scheduledDays = nextInterval(
        stability = nextMemoryState.stability,
        elapsedDays = elapsedDays,
        settings = settings,
        intervalSeed = intervalSeed
    )

    return ReviewSchedule(
        dueAtMillis = addDays(
            reviewedAtMillis = reviewedAtMillis,
            days = scheduledDays
        ),
        reps = reps,
        lapses = lapses,
        fsrsCardState = FsrsCardState.REVIEW,
        fsrsStepIndex = null,
        fsrsStability = nextMemoryState.stability,
        fsrsDifficulty = nextMemoryState.difficulty,
        fsrsLastReviewedAtMillis = reviewedAtMillis,
        fsrsScheduledDays = scheduledDays
    )
}

// Keep in sync with apps/backend/src/schedule.ts::buildReviewSuccessSchedule and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::buildReviewSuccessSchedule(now:reps:lapses:settings:elapsedDays:hardMemoryState:goodMemoryState:easyMemoryState:rating:intervalSeed:).
private fun buildReviewSuccessSchedule(
    reviewedAtMillis: Long,
    reps: Int,
    lapses: Int,
    settings: WorkspaceSchedulerSettings,
    elapsedDays: Int,
    hardMemoryState: FsrsMemoryState,
    goodMemoryState: FsrsMemoryState,
    easyMemoryState: FsrsMemoryState,
    rating: ReviewRating,
    intervalSeed: String
): ReviewSchedule {
    var hardInterval = nextInterval(
        stability = hardMemoryState.stability,
        elapsedDays = elapsedDays,
        settings = settings,
        intervalSeed = intervalSeed
    )
    var goodInterval = nextInterval(
        stability = goodMemoryState.stability,
        elapsedDays = elapsedDays,
        settings = settings,
        intervalSeed = intervalSeed
    )

    hardInterval = min(hardInterval, goodInterval)
    goodInterval = max(goodInterval, hardInterval + 1)
    val easyInterval = max(
        nextInterval(
            stability = easyMemoryState.stability,
            elapsedDays = elapsedDays,
            settings = settings,
            intervalSeed = intervalSeed
        ),
        goodInterval + 1
    )

    if (rating == ReviewRating.HARD) {
        return ReviewSchedule(
            dueAtMillis = addDays(reviewedAtMillis = reviewedAtMillis, days = hardInterval),
            reps = reps,
            lapses = lapses,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = hardMemoryState.stability,
            fsrsDifficulty = hardMemoryState.difficulty,
            fsrsLastReviewedAtMillis = reviewedAtMillis,
            fsrsScheduledDays = hardInterval
        )
    }

    if (rating == ReviewRating.GOOD) {
        return ReviewSchedule(
            dueAtMillis = addDays(reviewedAtMillis = reviewedAtMillis, days = goodInterval),
            reps = reps,
            lapses = lapses,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = goodMemoryState.stability,
            fsrsDifficulty = goodMemoryState.difficulty,
            fsrsLastReviewedAtMillis = reviewedAtMillis,
            fsrsScheduledDays = goodInterval
        )
    }

    return ReviewSchedule(
        dueAtMillis = addDays(reviewedAtMillis = reviewedAtMillis, days = easyInterval),
        reps = reps,
        lapses = lapses,
        fsrsCardState = FsrsCardState.REVIEW,
        fsrsStepIndex = null,
        fsrsStability = easyMemoryState.stability,
        fsrsDifficulty = easyMemoryState.difficulty,
        fsrsLastReviewedAtMillis = reviewedAtMillis,
        fsrsScheduledDays = easyInterval
    )
}

// Keep in sync with apps/backend/src/schedule.ts::createEmptyReviewableCardScheduleState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::createEmptyReviewableCardScheduleState(cardId:).
fun createEmptyReviewableCardScheduleState(cardId: String): ReviewableCardScheduleState {
    return ReviewableCardScheduleState(
        cardId = cardId,
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

// Keep in sync with apps/backend/src/cards.ts::submitReview, apps/backend/src/schedule.ts::computeReviewSchedule, and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::computeReviewSchedule(card:settings:rating:now:).
fun computeReviewSchedule(
    card: CardSummary,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long
): ReviewSchedule {
    return computeReviewSchedule(
        card = toReviewableCardScheduleState(card = card),
        settings = settings,
        rating = rating,
        reviewedAtMillis = reviewedAtMillis
    )
}

// Keep in sync with apps/backend/src/schedule.ts::computeReviewSchedule and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::computeReviewSchedule(card:settings:rating:now:).
fun computeReviewSchedule(
    card: ReviewableCardScheduleState,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    reviewedAtMillis: Long
): ReviewSchedule {
    val memoryState = getMemoryState(card = card)
    val grade = mapRatingToFsrsGrade(rating = rating)
    val elapsedDays = card.fsrsLastReviewedAtMillis?.let { lastReviewedAtMillis ->
        dateDiffInDays(
            lastReviewedAtMillis = lastReviewedAtMillis,
            reviewedAtMillis = reviewedAtMillis
        )
    } ?: 0
    val reps = card.reps + 1
    val lapses = if (rating == ReviewRating.AGAIN && card.fsrsCardState == FsrsCardState.REVIEW) {
        card.lapses + 1
    } else {
        card.lapses
    }
    val intervalSeed = getIntervalSeed(
        reviewedAtMillis = reviewedAtMillis,
        reps = reps,
        memoryState = memoryState
    )

    if (card.fsrsCardState == FsrsCardState.NEW) {
        val nextMemoryState = createInitialMemoryState(grade = grade)
        return buildShortTermSchedule(
            card = card,
            nextMemoryState = nextMemoryState,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            reps = reps,
            lapses = lapses,
            settings = settings,
            nextState = FsrsCardState.LEARNING,
            elapsedDays = 0,
            intervalSeed = intervalSeed
        )
    }

    requireNotNull(memoryState) {
        "Persisted FSRS card state is incomplete"
    }

    if (card.fsrsCardState == FsrsCardState.LEARNING || card.fsrsCardState == FsrsCardState.RELEARNING) {
        val nextMemoryState = computeNextShortTermMemoryState(
            memoryState = memoryState,
            grade = grade,
            settings = settings
        )
        return buildShortTermSchedule(
            card = card,
            nextMemoryState = nextMemoryState,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            reps = reps,
            lapses = lapses,
            settings = settings,
            nextState = card.fsrsCardState,
            elapsedDays = elapsedDays,
            intervalSeed = intervalSeed
        )
    }

    val nextAgainMemoryState = computeNextReviewMemoryState(
        memoryState = memoryState,
        elapsedDays = elapsedDays,
        grade = 1,
        settings = settings
    )
    val nextHardMemoryState = computeNextReviewMemoryState(
        memoryState = memoryState,
        elapsedDays = elapsedDays,
        grade = 2,
        settings = settings
    )
    val nextGoodMemoryState = computeNextReviewMemoryState(
        memoryState = memoryState,
        elapsedDays = elapsedDays,
        grade = 3,
        settings = settings
    )
    val nextEasyMemoryState = computeNextReviewMemoryState(
        memoryState = memoryState,
        elapsedDays = elapsedDays,
        grade = 4,
        settings = settings
    )

    if (rating == ReviewRating.AGAIN) {
        return buildShortTermSchedule(
            card = card,
            nextMemoryState = nextAgainMemoryState,
            rating = rating,
            reviewedAtMillis = reviewedAtMillis,
            reps = reps,
            lapses = lapses,
            settings = settings,
            nextState = FsrsCardState.RELEARNING,
            elapsedDays = elapsedDays,
            intervalSeed = intervalSeed
        )
    }

    return buildReviewSuccessSchedule(
        reviewedAtMillis = reviewedAtMillis,
        reps = reps,
        lapses = lapses,
        settings = settings,
        elapsedDays = elapsedDays,
        hardMemoryState = nextHardMemoryState,
        goodMemoryState = nextGoodMemoryState,
        easyMemoryState = nextEasyMemoryState,
        rating = rating,
        intervalSeed = intervalSeed
    )
}

// Keep in sync with apps/backend/src/schedule.ts::rebuildCardScheduleState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::rebuildCardScheduleState(cardId:settings:reviewEvents:).
fun rebuildCardScheduleState(
    cardId: String,
    settings: WorkspaceSchedulerSettings,
    reviewEvents: List<FsrsReviewHistoryEvent>
): RebuiltCardScheduleState {
    if (reviewEvents.isEmpty()) {
        return RebuiltCardScheduleState(
            dueAtMillis = null,
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

    var state = createEmptyReviewableCardScheduleState(cardId = cardId)
    var dueAtMillis: Long? = null

    for (reviewEvent in reviewEvents) {
        val nextState = computeReviewSchedule(
            card = state,
            settings = settings,
            rating = reviewEvent.rating,
            reviewedAtMillis = reviewEvent.reviewedAtMillis
        )
        state = ReviewableCardScheduleState(
            cardId = state.cardId,
            reps = nextState.reps,
            lapses = nextState.lapses,
            fsrsCardState = nextState.fsrsCardState,
            fsrsStepIndex = nextState.fsrsStepIndex,
            fsrsStability = nextState.fsrsStability,
            fsrsDifficulty = nextState.fsrsDifficulty,
            fsrsLastReviewedAtMillis = nextState.fsrsLastReviewedAtMillis,
            fsrsScheduledDays = nextState.fsrsScheduledDays
        )
        dueAtMillis = nextState.dueAtMillis
    }

    return RebuiltCardScheduleState(
        dueAtMillis = dueAtMillis,
        reps = state.reps,
        lapses = state.lapses,
        fsrsCardState = state.fsrsCardState,
        fsrsStepIndex = state.fsrsStepIndex,
        fsrsStability = state.fsrsStability,
        fsrsDifficulty = state.fsrsDifficulty,
        fsrsLastReviewedAtMillis = state.fsrsLastReviewedAtMillis,
        fsrsScheduledDays = state.fsrsScheduledDays
    )
}
