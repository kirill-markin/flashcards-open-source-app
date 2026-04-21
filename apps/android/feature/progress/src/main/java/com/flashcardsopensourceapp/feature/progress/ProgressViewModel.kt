package com.flashcardsopensourceapp.feature.progress

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.progressHistoryDayCount
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
                progressRepository.observeSeriesSnapshot()
            ) { summarySnapshot, seriesSnapshot ->
                createProgressUiState(
                    summarySnapshot = summarySnapshot,
                    seriesSnapshot = seriesSnapshot
                )
            }.collect { uiState ->
                uiStateMutable.value = uiState
            }
        }
    }

    fun refreshIfInvalidated() {
        viewModelScope.launch { progressRepository.refreshSummaryIfInvalidated() }
        viewModelScope.launch { progressRepository.refreshSeriesIfInvalidated() }
    }

    fun refreshManually() {
        viewModelScope.launch { progressRepository.refreshSummaryManually() }
        viewModelScope.launch { progressRepository.refreshSeriesManually() }
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
    seriesSnapshot: ProgressSeriesSnapshot?
): ProgressUiState {
    if (seriesSnapshot == null) {
        return ProgressUiState.Loading
    }

    return runCatching {
        createLoadedProgressUiState(
            summarySnapshot = summarySnapshot,
            seriesSnapshot = seriesSnapshot
        )
    }.getOrElse { error ->
        logProgressUiStateMappingFailure(
            summarySnapshot = summarySnapshot,
            seriesSnapshot = seriesSnapshot,
            error = error
        )
        ProgressUiState.Error(message = null)
    }
}

private fun createLoadedProgressUiState(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot
): ProgressUiState {
    val today = LocalDate.parse(seriesSnapshot.renderedSeries.to)
    return seriesSnapshot.renderedSeries.toUiState(
        locale = Locale.getDefault(),
        today = today,
        summary = summarySnapshot?.toUiState() ?: ProgressSummaryUiState.Loading
    )
}

private fun CloudProgressSeries.toUiState(
    locale: Locale,
    today: LocalDate,
    summary: ProgressSummaryUiState
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
        days = parsedPoints.toReviewDays(
            today = today,
            weekContext = weekContext
        ),
        maxReviewCount = parsedPoints.maxOfOrNull { point -> point.reviewCount } ?: 0
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
        reviewsSection = reviewsSection
    )
}

private fun ProgressSummarySnapshot.toUiState(): ProgressSummaryUiState {
    return ProgressSummaryUiState.Loaded(
        summary = renderedSummary
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
    today: LocalDate,
    weekContext: ProgressWeekContext
): List<ProgressHistoryDayUiState> {
    return map { point ->
        ProgressHistoryDayUiState(
            date = point.date,
            dayOfMonthLabel = point.date.dayOfMonth.toString(),
            chartLabel = createChartLabel(
                date = point.date,
                today = today,
                weekContext = weekContext
            ),
            reviewCount = point.reviewCount,
            isToday = point.date == today
        )
    }
}

private fun createChartLabel(
    date: LocalDate,
    today: LocalDate,
    weekContext: ProgressWeekContext
): String? {
    return when {
        date == today -> null
        weekContext.isStartOfWeek(date = date) -> date.dayOfMonth.toString()
        else -> null
    }
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

private fun logProgressUiStateMappingFailure(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot,
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
