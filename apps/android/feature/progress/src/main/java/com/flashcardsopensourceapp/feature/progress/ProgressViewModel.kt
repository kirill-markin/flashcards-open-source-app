package com.flashcardsopensourceapp.feature.progress

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.progress.progressHistoryDayCount
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import kotlin.math.ceil
import java.util.Locale

private const val streakWeekCount: Int = 5
private const val daysPerWeek: Int = 7
private const val progressViewModelLogTag: String = "ProgressViewModel"
private const val progressViewModelLogMaxValueLength: Int = 240

class ProgressViewModel(
    private val progressRepository: ProgressRepository
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow<ProgressUiState>(ProgressUiState.Loading)
    val uiState: StateFlow<ProgressUiState> = uiStateMutable.asStateFlow()

    init {
        viewModelScope.launch {
            combine(
                progressRepository.observeSummarySnapshot(),
                progressRepository.observeSeriesSnapshot(),
                progressRepository.observeReviewScheduleSnapshot()
            ) { summarySnapshot, seriesSnapshot, reviewScheduleSnapshot ->
                createProgressUiState(
                    summarySnapshot = summarySnapshot,
                    seriesSnapshot = seriesSnapshot,
                    reviewScheduleSnapshot = reviewScheduleSnapshot
                )
            }.collect { uiState ->
                uiStateMutable.value = uiState
            }
        }
    }

    fun refreshIfInvalidated() {
        launchAndLogFailure(event = "progress_summary_refresh_if_invalidated_failed") {
            progressRepository.refreshSummaryIfInvalidated()
        }
        launchAndLogFailure(event = "progress_series_refresh_if_invalidated_failed") {
            progressRepository.refreshSeriesIfInvalidated()
        }
        launchAndLogFailure(event = "progress_review_schedule_refresh_if_invalidated_failed") {
            progressRepository.refreshReviewScheduleIfInvalidated()
        }
    }

    fun refreshManually() {
        launchAndLogFailure(event = "progress_summary_refresh_manually_failed") {
            progressRepository.refreshSummaryManually()
        }
        launchAndLogFailure(event = "progress_series_refresh_manually_failed") {
            progressRepository.refreshSeriesManually()
        }
        launchAndLogFailure(event = "progress_review_schedule_refresh_manually_failed") {
            progressRepository.refreshReviewScheduleManually()
        }
    }

    // viewModelScope has a SupervisorJob but no CoroutineExceptionHandler, so any
    // uncaught throw from the suspend body would crash the process. This helper
    // re-throws CancellationException to keep structured concurrency intact and
    // logs anything else as a warning. Errors (OOM/StackOverflow) are not caught
    // here on purpose — there is no scope-level handler downstream to recover them.
    private fun launchAndLogFailure(event: String, block: suspend () -> Unit): Job {
        return viewModelScope.launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logProgressViewModelWarning(event = event, error = error)
            }
        }
    }
}

private data class ParsedProgressPoint(
    val date: LocalDate,
    val reviewCount: Int
)

private data class ProgressWeekContext(
    val locale: Locale,
    val firstDayOfWeek: DayOfWeek
)

private fun createProgressUiState(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot?,
    reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?
): ProgressUiState {
    if (seriesSnapshot == null) {
        return ProgressUiState.Loading
    }

    return runCatching {
        createLoadedProgressUiState(
            summarySnapshot = summarySnapshot,
            seriesSnapshot = seriesSnapshot,
            reviewScheduleSnapshot = reviewScheduleSnapshot
        )
    }.getOrElse { error ->
        logProgressUiStateMappingFailure(
            summarySnapshot = summarySnapshot,
            seriesSnapshot = seriesSnapshot,
            reviewScheduleSnapshot = reviewScheduleSnapshot,
            error = error
        )
        ProgressUiState.Error(message = null)
    }
}

private fun createLoadedProgressUiState(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot,
    reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?
): ProgressUiState {
    val today = LocalDate.parse(seriesSnapshot.renderedSeries.to)
    return seriesSnapshot.renderedSeries.toUiState(
        locale = Locale.getDefault(),
        today = today,
        summary = summarySnapshot?.toUiState() ?: ProgressSummaryUiState.Loading,
        reviewSchedule = reviewScheduleSnapshot?.renderedSchedule?.toUiState()
    )
}

private fun CloudProgressSeries.toUiState(
    locale: Locale,
    today: LocalDate,
    summary: ProgressSummaryUiState,
    reviewSchedule: ProgressReviewScheduleSectionUiState?
): ProgressUiState {
    val parsedPoints = dailyReviews
        .map { point ->
            point.toParsedProgressPoint()
        }
        .sortedBy { point -> point.date }
        .takeLast(progressHistoryDayCount.toInt())
    val progressPointsByDate = parsedPoints.associateBy { point -> point.date }
    val weekContext = createProgressWeekContext(locale = locale)
    val reviewsSection = ProgressReviewsSectionUiState(
        pages = parsedPoints.toReviewPages(
            today = today,
            weekContext = weekContext
        ),
    )
    val streakSection = ProgressStreakSectionUiState(
        weekdayLabels = weekContext.createWeekdayLabels(),
        weeks = createStreakWeeks(
            weekContext = weekContext,
            today = today,
            progressPointsByDate = progressPointsByDate
        )
    )

    return ProgressUiState.Loaded(
        summary = summary,
        streakSection = streakSection,
        reviewsSection = reviewsSection,
        reviewScheduleSection = reviewSchedule
    )
}

private fun ProgressSummarySnapshot.toUiState(): ProgressSummaryUiState {
    return ProgressSummaryUiState.Loaded(
        summary = renderedSummary
    )
}

private fun CloudProgressReviewSchedule.toUiState(): ProgressReviewScheduleSectionUiState {
    return ProgressReviewScheduleSectionUiState(
        totalCards = totalCards,
        buckets = buckets.map { bucket ->
            ProgressReviewScheduleBucketUiState(
                key = bucket.key,
                count = bucket.count,
                percentage = if (totalCards == 0) {
                    0f
                } else {
                    bucket.count.toFloat() / totalCards.toFloat()
                }
            )
        },
        hasCards = totalCards > 0
    )
}

private fun CloudDailyReviewPoint.toParsedProgressPoint(): ParsedProgressPoint {
    return ParsedProgressPoint(
        date = parseProgressDate(rawDate = date),
        reviewCount = reviewCount
    )
}

private fun parseProgressDate(
    rawDate: String
): LocalDate {
    return runCatching {
        LocalDate.parse(rawDate)
    }.getOrElse { error ->
        throw IllegalArgumentException(
            "Invalid progress date '$rawDate'.",
            error
        )
    }
}

private fun List<ParsedProgressPoint>.toReviewDays(
    today: LocalDate
): List<ProgressHistoryDayUiState> {
    return map { point ->
        ProgressHistoryDayUiState(
            date = point.date,
            dayOfMonthLabel = point.date.dayOfMonth.toString(),
            reviewCount = point.reviewCount,
            isToday = point.date == today
        )
    }
}

private fun List<ParsedProgressPoint>.toReviewPages(
    today: LocalDate,
    weekContext: ProgressWeekContext
): List<ProgressReviewPageUiState> {
    val reviewDays = toReviewDays(today = today)
    if (reviewDays.isEmpty()) {
        return emptyList()
    }

    val pages = mutableListOf<ProgressReviewPageUiState>()
    var currentPageDays = mutableListOf<ProgressHistoryDayUiState>()
    var currentWeekStart: LocalDate? = null

    for (day in reviewDays) {
        val weekStart = weekContext.startOfWeek(date = day.date)
        val activeWeekStart = currentWeekStart
        if (activeWeekStart != null && activeWeekStart != weekStart) {
            pages.add(
                createReviewPage(
                    weekStart = activeWeekStart,
                    days = currentPageDays,
                    today = today
                )
            )
            currentPageDays = mutableListOf(day)
            currentWeekStart = weekStart
            continue
        }

        currentPageDays.add(day)
        currentWeekStart = weekStart
    }

    val finalWeekStart = currentWeekStart
    if (finalWeekStart != null && currentPageDays.isNotEmpty()) {
        pages.add(
            createReviewPage(
                weekStart = finalWeekStart,
                days = currentPageDays,
                today = today
            )
        )
    }

    return pages
}

private fun createReviewPage(
    weekStart: LocalDate,
    days: List<ProgressHistoryDayUiState>,
    today: LocalDate
): ProgressReviewPageUiState {
    val paddedDays = padReviewPageDaysToFullWeek(
        weekStart = weekStart,
        days = days,
        today = today
    )
    val startDate = paddedDays.first().date
    val endDate = paddedDays.last().date
    val maximumReviewCount = paddedDays.maxOfOrNull { day -> day.reviewCount } ?: 0

    return ProgressReviewPageUiState(
        startDate = startDate,
        endDate = endDate,
        startDateKey = startDate.toString(),
        days = paddedDays,
        upperBound = calculateReviewChartUpperBound(maximumReviewCount = maximumReviewCount)
    )
}

private fun padReviewPageDaysToFullWeek(
    weekStart: LocalDate,
    days: List<ProgressHistoryDayUiState>,
    today: LocalDate
): List<ProgressHistoryDayUiState> {
    val existingByDate = days.associateBy { day -> day.date }

    return (0 until daysPerWeek).map { dayIndex ->
        val date = weekStart.plusDays(dayIndex.toLong())
        existingByDate[date] ?: ProgressHistoryDayUiState(
            date = date,
            dayOfMonthLabel = date.dayOfMonth.toString(),
            reviewCount = 0,
            isToday = date == today
        )
    }
}

private fun calculateReviewChartUpperBound(
    maximumReviewCount: Int
): Int {
    if (maximumReviewCount <= 0) {
        return 1
    }

    return maxOf(1, ceil(maximumReviewCount * 1.1).toInt())
}

private fun ProgressWeekContext.createWeekdayLabels(): List<String> {
    return (0 until daysPerWeek).map { dayIndex ->
        firstDayOfWeek
            .plus(dayIndex.toLong())
            .getDisplayName(TextStyle.NARROW_STANDALONE, locale)
    }
}

private fun createProgressWeekContext(
    locale: Locale
): ProgressWeekContext {
    return ProgressWeekContext(
        locale = locale,
        firstDayOfWeek = WeekFields.of(locale).firstDayOfWeek
    )
}

private fun createStreakWeeks(
    weekContext: ProgressWeekContext,
    today: LocalDate,
    progressPointsByDate: Map<LocalDate, ParsedProgressPoint>
): List<ProgressStreakWeekUiState> {
    val streakWindowStart = weekContext.startOfWeek(date = today)
        .minusDays(((streakWeekCount - 1) * daysPerWeek).toLong())

    return (0 until streakWeekCount).map { weekIndex ->
        val weekStart = streakWindowStart.plusDays((weekIndex * daysPerWeek).toLong())

        ProgressStreakWeekUiState(
            days = (0 until daysPerWeek).map { dayIndex ->
                val date = weekStart.plusDays(dayIndex.toLong())

                if (date.isAfter(today)) {
                    return@map ProgressStreakDayUiState(
                        date = null,
                        dayOfMonthLabel = null,
                        reviewCount = 0,
                        isToday = false,
                        isPlaceholder = true
                    )
                }

                val point = progressPointsByDate[date]

                ProgressStreakDayUiState(
                    date = date,
                    dayOfMonthLabel = date.dayOfMonth.toString(),
                    reviewCount = point?.reviewCount ?: 0,
                    isToday = date == today,
                    isPlaceholder = false
                )
            }
        )
    }
}

private fun ProgressWeekContext.startOfWeek(
    date: LocalDate,
): LocalDate {
    val daysFromStartOfWeek = (date.dayOfWeek.value - firstDayOfWeek.value + daysPerWeek) % daysPerWeek

    return date.minusDays(daysFromStartOfWeek.toLong())
}

private fun ProgressWeekContext.isStartOfWeek(
    date: LocalDate
): Boolean {
    return startOfWeek(date = date) == date
}

private fun logProgressViewModelWarning(
    event: String,
    error: Throwable
) {
    val message = buildProgressViewModelLogMessage(
        event = event,
        fields = emptyList()
    )
    val didLog = runCatching {
        Log.w(progressViewModelLogTag, message, error)
    }.isSuccess
    if (didLog.not()) {
        println("$progressViewModelLogTag W $message")
        println(error.stackTraceToString())
    }
}

private fun logProgressUiStateMappingFailure(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot,
    reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?,
    error: Throwable
) {
    val message = buildProgressViewModelLogMessage(
        event = "progress_ui_state_mapping_failed",
        fields = listOf(
            "summaryScopeId" to summarySnapshot?.scopeKey?.scopeId,
            "seriesScopeId" to seriesSnapshot.scopeKey.scopeId,
            "timeZone" to seriesSnapshot.scopeKey.timeZone,
            "from" to seriesSnapshot.scopeKey.from,
            "to" to seriesSnapshot.scopeKey.to,
            "reviewScheduleScopeId" to reviewScheduleSnapshot?.scopeKey?.scopeId,
            "reviewScheduleSource" to reviewScheduleSnapshot?.source?.name,
            "reviewScheduleTotalCards" to reviewScheduleSnapshot?.renderedSchedule?.totalCards?.toString(),
            "source" to seriesSnapshot.source.name,
            "dailyReviewCount" to seriesSnapshot.renderedSeries.dailyReviews.size.toString()
        )
    )
    val didLog = runCatching {
        Log.e(progressViewModelLogTag, message, error)
    }.isSuccess
    if (didLog.not()) {
        println("$progressViewModelLogTag E $message")
        println(error.stackTraceToString())
    }
}

private fun buildProgressViewModelLogMessage(
    event: String,
    fields: List<Pair<String, String?>>
): String {
    val renderedFields = fields.map { (key, value) ->
        "$key=${sanitizeProgressViewModelLogValue(value = value)}"
    }

    return if (renderedFields.isEmpty()) {
        "event=$event"
    } else {
        "event=$event ${renderedFields.joinToString(separator = " ")}"
    }
}

private fun sanitizeProgressViewModelLogValue(
    value: String?
): String {
    if (value == null) {
        return "null"
    }

    val normalized = value.replace(oldValue = "\n", newValue = "\\n")
    return if (normalized.length <= progressViewModelLogMaxValueLength) {
        normalized
    } else {
        normalized.take(progressViewModelLogMaxValueLength) + "..."
    }
}

fun createProgressViewModelFactory(
    progressRepository: ProgressRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ProgressViewModel(
                progressRepository = progressRepository
            )
        }
    }
}
