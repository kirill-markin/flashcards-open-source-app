package com.flashcardsopensourceapp.app.widget

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.review.WorkspaceReviewDueForecast
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.WeekFields
import java.util.Locale
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged

/** Today is the first forecast day, from the queue's due count; these are the days after it. */
private const val widgetUpcomingDueDayCount: Int = 6

/** What every widget kind renders from. */
data class WidgetContent(
    val queue: ReviewWidgetContent?,
    val progress: WidgetProgressContent?
)

data class WidgetProgressDay(
    val localDate: LocalDate,
    val reviewCount: Int,
    val againCount: Int,
    val hardCount: Int,
    val goodCount: Int,
    val easyCount: Int,
    val streakState: CloudProgressStreakDayState
)

/**
 * The Progress facts as the Progress screen renders them; widgets never recompute streaks or the
 * schedule. [days] is the Progress history window, oldest first, ending at [todayLocalDate].
 */
data class WidgetProgressContent(
    val todayLocalDate: LocalDate,
    val firstDayOfWeek: DayOfWeek,
    val days: List<WidgetProgressDay>,
    val currentStreakDays: Int,
    /** All-time best, not limited to [days]. */
    val longestStreakDays: Int,
    val availableFreezeCredits: Int,
    val dueForecast: WorkspaceReviewDueForecast,
    /** Null until the review schedule has loaded. */
    val reviewSchedule: List<CloudProgressReviewScheduleBucket>?
)

fun observeWidgetContent(appGraph: AppGraph): Flow<WidgetContent> {
    return combine(
        observeReviewWidgetContent(appGraph = appGraph),
        observeWidgetProgressContent(appGraph = appGraph)
    ) { queue, progress ->
        WidgetContent(
            queue = queue,
            progress = progress?.takeIf { it.dueForecast.workspaceId == queue?.workspaceId }
        )
    }.distinctUntilChanged()
}

/**
 * Null until the series and summary have rendered and while there is no current workspace, which
 * widgets show as their open-the-app state instead of zeros.
 */
fun observeWidgetProgressContent(appGraph: AppGraph): Flow<WidgetProgressContent?> {
    return combine(
        appGraph.progressRepository.observeSeriesSnapshot(),
        appGraph.progressRepository.observeSummarySnapshot(),
        appGraph.progressRepository.observeReviewScheduleSnapshot(),
        appGraph.reviewRepository.observeWorkspaceReviewDueForecast(dayCount = widgetUpcomingDueDayCount)
    ) { seriesSnapshot, summarySnapshot, reviewScheduleSnapshot, dueForecast ->
        if (seriesSnapshot == null || summarySnapshot == null || dueForecast == null) {
            null
        } else {
            makeWidgetProgressContent(
                seriesSnapshot = seriesSnapshot,
                summarySnapshot = summarySnapshot,
                reviewScheduleSnapshot = reviewScheduleSnapshot,
                dueForecast = dueForecast
            )
        }
    }.distinctUntilChanged()
}

private fun makeWidgetProgressContent(
    seriesSnapshot: ProgressSeriesSnapshot,
    summarySnapshot: ProgressSummarySnapshot,
    reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?,
    dueForecast: WorkspaceReviewDueForecast
): WidgetProgressContent {
    val series = seriesSnapshot.renderedSeries
    val summary = summarySnapshot.renderedSummary
    val streakStatesByDate: Map<String, CloudProgressStreakDayState> = series.streakDays.associate { day ->
        day.date to day.state
    }
    return WidgetProgressContent(
        todayLocalDate = LocalDate.parse(seriesSnapshot.scopeKey.to),
        firstDayOfWeek = WeekFields.of(Locale.getDefault()).firstDayOfWeek,
        days = series.dailyReviews.sortedBy { point -> point.date }.map { point ->
            WidgetProgressDay(
                localDate = LocalDate.parse(point.date),
                reviewCount = point.reviewCount,
                againCount = point.againCount,
                hardCount = point.hardCount,
                goodCount = point.goodCount,
                easyCount = point.easyCount,
                streakState = checkNotNull(streakStatesByDate[point.date]) {
                    "Progress series ${series.from}..${series.to} has no streak state for ${point.date}."
                }
            )
        },
        currentStreakDays = summary.currentStreakDays,
        longestStreakDays = summary.longestStreakDays,
        availableFreezeCredits = summary.streakFreeze.availableCredits,
        dueForecast = dueForecast,
        reviewSchedule = reviewScheduleSnapshot?.renderedSchedule?.buckets
    )
}
