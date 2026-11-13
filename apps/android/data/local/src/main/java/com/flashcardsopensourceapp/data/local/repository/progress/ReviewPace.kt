package com.flashcardsopensourceapp.data.local.repository.progress

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.roundToInt

// Port of the reference definition in apps/web/src/progress/reviewPace.ts; keep the three in step.
//
// Last 7 local days (today and the 6 before) against the daily average of the 28 days before
// them, rest days counting 0. A young account's baseline averages only the days on or after its
// first review. There is no baseline when history since the first review is under 14 days or the
// baseline window holds under 14 reviews. The ring is the same number drawn as laps.
const val reviewPaceWindowDayCount: Int = 7
const val reviewPaceBaselineDayCount: Int = 28
const val reviewPaceMinimumHistoryDayCount: Int = 14
const val reviewPaceMinimumBaselineReviewCount: Int = 14
const val reviewPaceMaximumPercentChange: Int = 999
const val reviewPaceMaximumRingLaps: Double = 2.0

data class ReviewPaceDay(
    val localDate: LocalDate,
    val reviewCount: Int
)

data class ReviewPaceBaseline(
    val usualReviewsPerDay: Double,
    /** Rounded, signed, at most 999. 0 means no arrow. */
    val percentChange: Int,
    /** Last 7 total ÷ (usual per day × 7), stopped at two laps. */
    val ringProgress: Double
)

data class ReviewPace(
    val last7DaysReviewCount: Int,
    val last7DaysAveragePerDay: Double,
    val baseline: ReviewPaceBaseline?
)

private fun countLocalDaysInclusive(from: LocalDate, to: LocalDate): Long {
    return ChronoUnit.DAYS.between(from, to) + 1L
}

private fun sumReviewsInRange(days: List<ReviewPaceDay>, from: LocalDate, to: LocalDate): Int {
    return days.sumOf { day ->
        if (!day.localDate.isBefore(from) && !day.localDate.isAfter(to)) day.reviewCount else 0
    }
}

private fun findFirstReviewDate(days: List<ReviewPaceDay>, today: LocalDate): LocalDate? {
    return days
        .filter { day -> day.reviewCount > 0 && !day.localDate.isAfter(today) }
        .minOfOrNull { day -> day.localDate }
}

/**
 * [days] is a per-local-day series covering at least the 35 days ending [today]; missing days count
 * as 0. The earliest reviewed day in the series stands for the first review, so pass the longest
 * series the client already has.
 */
fun calculateReviewPace(days: List<ReviewPaceDay>, today: LocalDate): ReviewPace {
    val windowStart: LocalDate = today.minusDays((reviewPaceWindowDayCount - 1).toLong())
    val baselineEnd: LocalDate = windowStart.minusDays(1L)
    val baselineStart: LocalDate = windowStart.minusDays(reviewPaceBaselineDayCount.toLong())
    val last7DaysReviewCount: Int = sumReviewsInRange(days = days, from = windowStart, to = today)
    val last7DaysAveragePerDay: Double = last7DaysReviewCount.toDouble() / reviewPaceWindowDayCount
    val firstReviewDate: LocalDate? = findFirstReviewDate(days = days, today = today)

    if (
        firstReviewDate == null ||
        countLocalDaysInclusive(from = firstReviewDate, to = today) < reviewPaceMinimumHistoryDayCount
    ) {
        return ReviewPace(
            last7DaysReviewCount = last7DaysReviewCount,
            last7DaysAveragePerDay = last7DaysAveragePerDay,
            baseline = null
        )
    }

    val effectiveBaselineStart: LocalDate = if (firstReviewDate.isAfter(baselineStart)) firstReviewDate else baselineStart
    val baselineDayCount: Long = countLocalDaysInclusive(from = effectiveBaselineStart, to = baselineEnd)
    val baselineReviewCount: Int = sumReviewsInRange(days = days, from = effectiveBaselineStart, to = baselineEnd)
    if (baselineDayCount <= 0L || baselineReviewCount < reviewPaceMinimumBaselineReviewCount) {
        return ReviewPace(
            last7DaysReviewCount = last7DaysReviewCount,
            last7DaysAveragePerDay = last7DaysAveragePerDay,
            baseline = null
        )
    }

    val usualReviewsPerDay: Double = baselineReviewCount.toDouble() / baselineDayCount
    val ratio: Double = last7DaysAveragePerDay / usualReviewsPerDay
    return ReviewPace(
        last7DaysReviewCount = last7DaysReviewCount,
        last7DaysAveragePerDay = last7DaysAveragePerDay,
        baseline = ReviewPaceBaseline(
            usualReviewsPerDay = usualReviewsPerDay,
            // Math.round in the reference rounds halves up; roundToInt does the same.
            percentChange = minOf(((ratio - 1.0) * 100.0).roundToInt(), reviewPaceMaximumPercentChange),
            ringProgress = minOf(ratio, reviewPaceMaximumRingLaps)
        )
    )
}
