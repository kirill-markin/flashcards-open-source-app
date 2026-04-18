package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
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

private fun createProgressUiState(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot?
): ProgressUiState {
    if (seriesSnapshot == null) {
        return ProgressUiState.Loading
    }

    val today = LocalDate.parse(seriesSnapshot.renderedSeries.to)
    return seriesSnapshot.renderedSeries.toUiState(
        locale = Locale.getDefault(),
        today = today,
        source = seriesSnapshot.source,
        isApproximate = seriesSnapshot.isApproximate,
        summary = summarySnapshot?.toUiState() ?: ProgressSummaryUiState.Loading
    )
}

private fun CloudProgressSeries.toUiState(
    locale: Locale,
    today: LocalDate,
    source: ProgressSnapshotSource,
    isApproximate: Boolean,
    summary: ProgressSummaryUiState
): ProgressUiState {
    val parsedPoints = dailyReviews
        .map { point ->
            point.toParsedProgressPoint()
        }
        .sortedBy { point -> point.date }
        .takeLast(progressHistoryDayCount.toInt())
    val progressPointsByDate = parsedPoints.associateBy { point -> point.date }
    val firstDayOfWeek = WeekFields.of(locale).firstDayOfWeek
    val reviewsSection = ProgressReviewsSectionUiState(
        days = parsedPoints.toReviewDays(today = today),
        maxReviewCount = parsedPoints.maxOfOrNull { point -> point.reviewCount } ?: 0
    )
    val streakSection = ProgressStreakSectionUiState(
        weekdayLabels = createWeekdayLabels(locale = locale),
        weeks = createStreakWeeks(
            firstDayOfWeek = firstDayOfWeek,
            today = today,
            progressPointsByDate = progressPointsByDate
        )
    )

    return ProgressUiState.Loaded(
        summary = summary,
        streakSection = streakSection,
        reviewsSection = reviewsSection,
        source = source.toUiState(),
        isApproximate = isApproximate
    )
}

private fun ProgressSummarySnapshot.toUiState(): ProgressSummaryUiState {
    return ProgressSummaryUiState.Loaded(
        summary = renderedSummary,
        source = source.toUiState(),
        isApproximate = isApproximate
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
    val totalCount = size

    return mapIndexed { index, point ->
        val daysFromToday = totalCount - index - 1
        ProgressHistoryDayUiState(
            date = point.date,
            dayOfMonthLabel = point.date.dayOfMonth.toString(),
            chartLabel = createChartLabel(
                date = point.date,
                daysFromToday = daysFromToday,
                today = today
            ),
            reviewCount = point.reviewCount,
            isToday = point.date == today
        )
    }
}

private fun createChartLabel(
    date: LocalDate,
    daysFromToday: Int,
    today: LocalDate
): String? {
    return when {
        date == today -> null
        daysFromToday % daysPerWeek == 0 -> date.dayOfMonth.toString()
        else -> null
    }
}

private fun createWeekdayLabels(
    locale: Locale
): List<String> {
    val firstDayOfWeek = WeekFields.of(locale).firstDayOfWeek

    return (0 until daysPerWeek).map { dayIndex ->
        firstDayOfWeek
            .plus(dayIndex.toLong())
            .getDisplayName(TextStyle.NARROW_STANDALONE, locale)
    }
}

private fun createStreakWeeks(
    firstDayOfWeek: DayOfWeek,
    today: LocalDate,
    progressPointsByDate: Map<LocalDate, ParsedProgressPoint>
): List<ProgressStreakWeekUiState> {
    val streakWindowStart = startOfWeek(
        date = today,
        firstDayOfWeek = firstDayOfWeek
    ).minusDays(((streakWeekCount - 1) * daysPerWeek).toLong())

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

private fun startOfWeek(
    date: LocalDate,
    firstDayOfWeek: DayOfWeek
): LocalDate {
    val daysFromStartOfWeek = (date.dayOfWeek.value - firstDayOfWeek.value + daysPerWeek) % daysPerWeek

    return date.minusDays(daysFromStartOfWeek.toLong())
}

private fun ProgressSnapshotSource.toUiState(): ProgressSourceUiState {
    return when (this) {
        ProgressSnapshotSource.LOCAL_ONLY -> ProgressSourceUiState.LOCAL_ONLY
        ProgressSnapshotSource.SERVER_BASE -> ProgressSourceUiState.SERVER_BASE
        ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY -> {
            ProgressSourceUiState.SERVER_BASE_WITH_LOCAL_OVERLAY
        }
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
