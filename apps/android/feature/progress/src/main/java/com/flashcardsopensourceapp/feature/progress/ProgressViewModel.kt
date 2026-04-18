package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale

private const val progressHistoryDayCount: Long = 140L
private const val streakWeekCount: Int = 5
private const val daysPerWeek: Int = 7

class ProgressViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow<ProgressUiState>(ProgressUiState.Loading)
    val uiState: StateFlow<ProgressUiState> = uiStateMutable.asStateFlow()
    private val initialCloudStateReady = CompletableDeferred<Unit>()
    private var currentCloudState: CloudAccountState? = null
    private var activeLoadJob: Job? = null
    private var latestLoadRequestId: Long = 0L

    init {
        observeCloudState()
    }

    fun loadProgress() {
        launchProgressLoad()
    }

    private fun observeCloudState() {
        viewModelScope.launch {
            cloudAccountRepository.observeCloudSettings()
                .map { cloudSettings -> cloudSettings.cloudState }
                .distinctUntilChanged()
                .collect { cloudState ->
                    currentCloudState = cloudState
                    if (initialCloudStateReady.isCompleted) {
                        launchProgressLoad()
                        return@collect
                    }

                    initialCloudStateReady.complete(Unit)
                }
        }
    }

    private fun launchProgressLoad() {
        latestLoadRequestId += 1L
        val requestId = latestLoadRequestId
        activeLoadJob?.cancel()
        activeLoadJob = viewModelScope.launch {
            initialCloudStateReady.await()
            loadProgressForCurrentCloudState(
                requestId = requestId
            )
        }
    }

    private suspend fun loadProgressForCurrentCloudState(
        requestId: Long
    ) {
        val cloudState = currentCloudState
            ?: throw IllegalStateException("Cloud state was not observed before loading progress.")
        val unsupportedUiState = unsupportedProgressUiStateForCloudState(
            cloudState = cloudState
        )
        if (unsupportedUiState != null) {
            if (!isLatestLoadRequest(requestId = requestId)) {
                return
            }
            uiStateMutable.value = unsupportedUiState
            return
        }

        val zoneId = ZoneId.systemDefault()
        val today = LocalDate.now(zoneId)
        val progressRequest = createProgressRequest(
            today = today,
            zoneId = zoneId
        )

        uiStateMutable.value = ProgressUiState.Loading

        try {
            // Progress is intentionally sourced from the server-backed account view
            // after syncing the current workspace only. Pending review events from
            // inactive local workspaces remain eventual-consistency data and are
            // reflected here after that workspace becomes active and syncs.
            syncRepository.syncNow()
            val progressSeries = cloudAccountRepository.loadProgressSeries(
                timeZone = progressRequest.timeZone,
                from = progressRequest.from,
                to = progressRequest.to
            )
            if (!isLatestLoadRequest(requestId = requestId)) {
                return
            }
            uiStateMutable.value = progressSeries.toUiState(
                locale = Locale.getDefault(),
                today = today
            )
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }
            if (!isLatestLoadRequest(requestId = requestId)) {
                return
            }
            uiStateMutable.value = ProgressUiState.Error(
                message = createProgressErrorMessage(
                    request = progressRequest,
                    cloudState = cloudState,
                    error = error
                )
            )
        }
    }

    private fun isLatestLoadRequest(
        requestId: Long
    ): Boolean {
        return requestId == latestLoadRequestId
    }
}

internal fun unsupportedProgressUiStateForCloudState(
    cloudState: CloudAccountState
): ProgressUiState? {
    return when (cloudState) {
        CloudAccountState.DISCONNECTED -> ProgressUiState.SignInRequired
        CloudAccountState.LINKING_READY -> ProgressUiState.Unavailable
        CloudAccountState.GUEST,
        CloudAccountState.LINKED -> null
    }
}

private data class ProgressRequest(
    val timeZone: String,
    val from: String,
    val to: String
)

private data class ParsedProgressPoint(
    val date: LocalDate,
    val reviewCount: Int
)

private fun createProgressRequest(
    today: LocalDate,
    zoneId: ZoneId
): ProgressRequest {
    val from = today.minusDays(progressHistoryDayCount - 1L)

    return ProgressRequest(
        timeZone = zoneId.id,
        from = from.toString(),
        to = today.toString()
    )
}

private fun createProgressErrorMessage(
    request: ProgressRequest,
    cloudState: CloudAccountState,
    error: Exception
): String {
    val errorName = error::class.simpleName ?: "Exception"
    val errorDetail = error.message ?: "No error message provided."

    return "Failed to sync and load progress for cloudState=${cloudState.name}, timeZone=${request.timeZone}, from=${request.from}, to=${request.to}: $errorName: $errorDetail"
}

private fun CloudProgressSeries.toUiState(
    locale: Locale,
    today: LocalDate
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
        streakSection = streakSection,
        reviewsSection = reviewsSection
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

fun createProgressViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ProgressViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository
            )
        }
    }
}
