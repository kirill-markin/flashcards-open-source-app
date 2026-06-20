package com.flashcardsopensourceapp.feature.progress

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.progress.resolveBestLeaderboardPlacement
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
import java.time.Instant
import java.time.LocalDate
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale
import kotlin.math.ceil

private const val streakWeekCount: Int = 5
private const val daysPerWeek: Int = 7
private const val progressViewModelLogTag: String = "ProgressViewModel"
private const val progressViewModelLogMaxValueLength: Int = 240

class ProgressViewModel(
    private val progressRepository: ProgressRepository
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow<ProgressUiState>(ProgressUiState.Loading)
    val uiState: StateFlow<ProgressUiState> = uiStateMutable.asStateFlow()
    private val selectedLeaderboardWindowMutable = MutableStateFlow<ProgressLeaderboardWindowKey?>(null)

    init {
        viewModelScope.launch {
            combine(
                combine(
                    progressRepository.observeSummarySnapshot(),
                    progressRepository.observeSeriesSnapshot(),
                    progressRepository.observeReviewScheduleSnapshot(),
                    progressRepository.observeLeaderboardSnapshot(),
                    progressRepository.observeStreakLeaderboardSnapshot()
                ) { summarySnapshot, seriesSnapshot, reviewScheduleSnapshot, leaderboardSnapshot, streakLeaderboardSnapshot ->
                    ProgressSnapshotInputs(
                        summarySnapshot = summarySnapshot,
                        seriesSnapshot = seriesSnapshot,
                        reviewScheduleSnapshot = reviewScheduleSnapshot,
                        leaderboardSnapshot = leaderboardSnapshot,
                        streakLeaderboardSnapshot = streakLeaderboardSnapshot
                    )
                },
                selectedLeaderboardWindowMutable
            ) { snapshots, selectedLeaderboardWindow ->
                createProgressUiState(
                    summarySnapshot = snapshots.summarySnapshot,
                    seriesSnapshot = snapshots.seriesSnapshot,
                    reviewScheduleSnapshot = snapshots.reviewScheduleSnapshot,
                    leaderboardSnapshot = snapshots.leaderboardSnapshot,
                    streakLeaderboardSnapshot = snapshots.streakLeaderboardSnapshot,
                    selectedLeaderboardWindowKey = selectedLeaderboardWindow
                )
            }.collect { uiState ->
                uiStateMutable.value = uiState
            }
        }
    }

    fun selectLeaderboardWindow(windowKey: ProgressLeaderboardWindowKey) {
        selectedLeaderboardWindowMutable.value = windowKey
    }

    fun resetLeaderboardWindowSelection() {
        selectedLeaderboardWindowMutable.value = null
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
        launchAndLogFailure(event = "progress_leaderboard_refresh_if_invalidated_failed") {
            progressRepository.refreshLeaderboardIfInvalidated()
        }
        launchAndLogFailure(event = "progress_streak_leaderboard_refresh_if_invalidated_failed") {
            progressRepository.refreshStreakLeaderboardIfInvalidated()
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
        launchAndLogFailure(event = "progress_leaderboard_refresh_manually_failed") {
            progressRepository.refreshLeaderboardManually()
        }
        launchAndLogFailure(event = "progress_streak_leaderboard_refresh_manually_failed") {
            progressRepository.refreshStreakLeaderboardManually()
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

private data class ProgressSnapshotInputs(
    val summarySnapshot: ProgressSummarySnapshot?,
    val seriesSnapshot: ProgressSeriesSnapshot?,
    val reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?,
    val leaderboardSnapshot: ProgressLeaderboardSnapshot?,
    val streakLeaderboardSnapshot: ProgressStreakLeaderboardSnapshot?
)

private data class ParsedProgressPoint(
    val date: LocalDate,
    val reviewCount: Int,
    val againCount: Int,
    val hardCount: Int,
    val goodCount: Int,
    val easyCount: Int
)

private data class ProgressWeekContext(
    val locale: Locale,
    val firstDayOfWeek: DayOfWeek
)

private fun createProgressUiState(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot?,
    reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?,
    leaderboardSnapshot: ProgressLeaderboardSnapshot?,
    streakLeaderboardSnapshot: ProgressStreakLeaderboardSnapshot?,
    selectedLeaderboardWindowKey: ProgressLeaderboardWindowKey?
): ProgressUiState {
    if (seriesSnapshot == null) {
        return ProgressUiState.Loading
    }

    return runCatching {
        createLoadedProgressUiState(
            summarySnapshot = summarySnapshot,
            seriesSnapshot = seriesSnapshot,
            reviewScheduleSnapshot = reviewScheduleSnapshot,
            leaderboardSnapshot = leaderboardSnapshot,
            streakLeaderboardSnapshot = streakLeaderboardSnapshot,
            selectedLeaderboardWindowKey = selectedLeaderboardWindowKey
        )
    }.getOrElse { error ->
        logProgressUiStateMappingFailure(
            summarySnapshot = summarySnapshot,
            seriesSnapshot = seriesSnapshot,
            reviewScheduleSnapshot = reviewScheduleSnapshot,
            leaderboardSnapshot = leaderboardSnapshot,
            streakLeaderboardSnapshot = streakLeaderboardSnapshot,
            error = error
        )
        ProgressUiState.Error(message = null)
    }
}

private fun createLoadedProgressUiState(
    summarySnapshot: ProgressSummarySnapshot?,
    seriesSnapshot: ProgressSeriesSnapshot,
    reviewScheduleSnapshot: ProgressReviewScheduleSnapshot?,
    leaderboardSnapshot: ProgressLeaderboardSnapshot?,
    streakLeaderboardSnapshot: ProgressStreakLeaderboardSnapshot?,
    selectedLeaderboardWindowKey: ProgressLeaderboardWindowKey?
): ProgressUiState {
    val today = LocalDate.parse(seriesSnapshot.renderedSeries.to)
    return seriesSnapshot.renderedSeries.toUiState(
        locale = Locale.getDefault(),
        today = today,
        summary = summarySnapshot?.toUiState() ?: ProgressSummaryUiState.Loading,
        reviewSchedule = reviewScheduleSnapshot?.renderedSchedule?.toUiState(),
        leaderboardSection = createProgressLeaderboardSectionUiState(
            snapshot = leaderboardSnapshot,
            selectedWindowKey = selectedLeaderboardWindowKey
        ),
        streakLeaderboardSection = createProgressStreakLeaderboardSectionUiState(
            snapshot = streakLeaderboardSnapshot
        )
    )
}

internal fun createProgressLeaderboardSectionUiState(
    snapshot: ProgressLeaderboardSnapshot?,
    selectedWindowKey: ProgressLeaderboardWindowKey?
): ProgressLeaderboardSectionUiState {
    if (snapshot == null) {
        return ProgressLeaderboardSectionUiState.Loading
    }
    if (snapshot.cloudState != CloudAccountState.LINKED) {
        return ProgressLeaderboardSectionUiState.SignInRequired
    }

    val leaderboard = snapshot.renderedLeaderboard
    if (leaderboard == null) {
        return if (snapshot.didLastRemoteLoadFail) {
            ProgressLeaderboardSectionUiState.Offline
        } else {
            ProgressLeaderboardSectionUiState.Loading
        }
    }

    return when (leaderboard.status) {
        ProgressLeaderboardStatus.LINKED_ACCOUNT_REQUIRED -> ProgressLeaderboardSectionUiState.SignInRequired
        ProgressLeaderboardStatus.PARTICIPATION_DISABLED -> ProgressLeaderboardSectionUiState.ParticipationDisabled
        ProgressLeaderboardStatus.SNAPSHOT_UNAVAILABLE -> ProgressLeaderboardSectionUiState.SnapshotUnavailable
        ProgressLeaderboardStatus.READY -> {
            val windows = leaderboard.windows.map { window ->
                window.toUiState()
            }
            ProgressLeaderboardSectionUiState.Ready(
                metricDescription = leaderboard.metric.description.takeIf { description ->
                    description.isNotBlank()
                },
                selectedWindowKey = selectedWindowKey
                    ?.takeIf { windowKey -> windows.any { window -> window.windowKey == windowKey } }
                    ?: resolveBestLeaderboardPlacement(snapshot = snapshot)?.windowKey
                    ?: leaderboard.defaultWindowKey,
                windows = windows,
                reservedRowCount = windows.maxOfOrNull { window -> window.rows.size } ?: 0
            )
        }
    }
}

internal fun createProgressStreakLeaderboardSectionUiState(
    snapshot: ProgressStreakLeaderboardSnapshot?
): ProgressStreakLeaderboardSectionUiState {
    if (snapshot == null) {
        return ProgressStreakLeaderboardSectionUiState.Loading
    }
    if (snapshot.cloudState != CloudAccountState.LINKED) {
        return ProgressStreakLeaderboardSectionUiState.SignInRequired
    }

    val leaderboard = snapshot.renderedLeaderboard
    if (leaderboard == null) {
        return if (snapshot.didLastRemoteLoadFail) {
            ProgressStreakLeaderboardSectionUiState.Offline
        } else {
            ProgressStreakLeaderboardSectionUiState.Loading
        }
    }

    return when (leaderboard) {
        is CloudProgressStreakLeaderboard.NonReady -> {
            when (leaderboard.status) {
                ProgressLeaderboardStatus.LINKED_ACCOUNT_REQUIRED -> {
                    ProgressStreakLeaderboardSectionUiState.SignInRequired
                }
                ProgressLeaderboardStatus.PARTICIPATION_DISABLED -> {
                    ProgressStreakLeaderboardSectionUiState.ParticipationDisabled
                }
                ProgressLeaderboardStatus.SNAPSHOT_UNAVAILABLE -> {
                    ProgressStreakLeaderboardSectionUiState.SnapshotUnavailable
                }
                ProgressLeaderboardStatus.READY -> {
                    throw IllegalStateException("Non-ready streak leaderboard must not use ready status.")
                }
            }
        }
        is CloudProgressStreakLeaderboard.Ready -> {
            ProgressStreakLeaderboardSectionUiState.Ready(
                metricDescription = leaderboard.metric.description.takeIf { description ->
                    description.isNotBlank()
                },
                participantCount = leaderboard.participantCount,
                rows = leaderboard.rows.map { row -> row.toUiState() },
                snapshotGeneratedAtMillis = parseLeaderboardSnapshotGeneratedAtMillis(
                    rawInstant = leaderboard.snapshotGeneratedAt,
                    invalidEvent = "progress_streak_leaderboard_snapshot_generated_at_invalid"
                )
            )
        }
    }
}

private fun CloudProgressLeaderboardWindow.toUiState(): ProgressLeaderboardWindowUiState {
    return ProgressLeaderboardWindowUiState(
        windowKey = windowKey,
        participantCount = participantCount,
        rows = rows.map { row ->
            when (row) {
                is CloudProgressLeaderboardRow.Gap -> ProgressLeaderboardRowUiState.Gap
                is CloudProgressLeaderboardRow.Participant -> ProgressLeaderboardRowUiState.Participant(
                    rank = row.rank,
                    displayName = row.friendDisplayName ?: row.anonymousDisplayName,
                    qualifiedReviewCount = row.qualifiedReviewCount,
                    isViewer = row.kind == ProgressLeaderboardParticipantRowKind.VIEWER
                )
            }
        },
        snapshotGeneratedAtMillis = parseLeaderboardSnapshotGeneratedAtMillis(
            rawInstant = snapshotGeneratedAt,
            invalidEvent = "progress_leaderboard_snapshot_generated_at_invalid"
        )
    )
}

private fun CloudProgressStreakLeaderboardRow.toUiState(): ProgressStreakLeaderboardRowUiState {
    return when (this) {
        CloudProgressStreakLeaderboardRow.Gap -> ProgressStreakLeaderboardRowUiState.Gap
        is CloudProgressStreakLeaderboardRow.Participant -> ProgressStreakLeaderboardRowUiState.Participant(
            rank = rank,
            displayName = friendDisplayName ?: anonymousDisplayName,
            streakDays = streakDays,
            isViewer = kind == ProgressLeaderboardParticipantRowKind.VIEWER
        )
    }
}

private fun parseLeaderboardSnapshotGeneratedAtMillis(
    rawInstant: String,
    invalidEvent: String
): Long? {
    return runCatching {
        Instant.parse(rawInstant).toEpochMilli()
    }.getOrElse { error ->
        // A malformed timestamp only suppresses the freshness label, but the
        // contract drift must stay visible in logs instead of failing silently.
        logProgressViewModelWarning(
            event = invalidEvent,
            error = error
        )
        null
    }
}

private fun CloudProgressSeries.toUiState(
    locale: Locale,
    today: LocalDate,
    summary: ProgressSummaryUiState,
    reviewSchedule: ProgressReviewScheduleSectionUiState?,
    leaderboardSection: ProgressLeaderboardSectionUiState,
    streakLeaderboardSection: ProgressStreakLeaderboardSectionUiState
): ProgressUiState {
    val parsedPoints = dailyReviews
        .map { point ->
            point.toParsedProgressPoint()
        }
        .sortedBy { point -> point.date }
        .takeLast(progressHistoryDayCount.toInt())
    val progressPointsByDate = parsedPoints.associateBy { point -> point.date }
    val streakStatesByDate = streakDays.associate { day ->
        parseProgressDate(rawDate = day.date) to day.state
    }
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
            progressPointsByDate = progressPointsByDate,
            streakStatesByDate = streakStatesByDate
        ),
        freezeBankSummary = summary.freezeBankSummaryOrNull()
    )

    return ProgressUiState.Loaded(
        summary = summary,
        streakSection = streakSection,
        reviewsSection = reviewsSection,
        reviewScheduleSection = reviewSchedule,
        leaderboardSection = leaderboardSection,
        streakLeaderboardSection = streakLeaderboardSection
    )
}

private fun ProgressSummarySnapshot.toUiState(): ProgressSummaryUiState {
    return ProgressSummaryUiState.Loaded(
        summary = renderedSummary,
        freezeBankSummary = renderedSummary.toFreezeBankUiState()
    )
}

private fun ProgressSummaryUiState.freezeBankSummaryOrNull(): ProgressFreezeBankUiState? {
    return when (this) {
        ProgressSummaryUiState.Loading -> null
        is ProgressSummaryUiState.Loaded -> freezeBankSummary
    }
}

private fun CloudProgressSummary.toFreezeBankUiState(): ProgressFreezeBankUiState {
    return ProgressFreezeBankUiState(
        availableCredits = streakFreeze.availableCredits,
        capacity = streakFreeze.capacity,
        nextCreditProgressUnits = streakFreeze.nextCreditProgressUnits,
        nextCreditRequiredUnits = streakFreeze.nextCreditRequiredUnits
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
        reviewCount = reviewCount,
        againCount = againCount,
        hardCount = hardCount,
        goodCount = goodCount,
        easyCount = easyCount
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
            againCount = point.againCount,
            hardCount = point.hardCount,
            goodCount = point.goodCount,
            easyCount = point.easyCount,
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
            againCount = 0,
            hardCount = 0,
            goodCount = 0,
            easyCount = 0,
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
    progressPointsByDate: Map<LocalDate, ParsedProgressPoint>,
    streakStatesByDate: Map<LocalDate, CloudProgressStreakDayState>
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
                        state = null,
                        isToday = false,
                        isPlaceholder = true
                    )
                }

                val point = progressPointsByDate[date]
                val reviewCount = point?.reviewCount ?: 0

                ProgressStreakDayUiState(
                    date = date,
                    dayOfMonthLabel = date.dayOfMonth.toString(),
                    reviewCount = reviewCount,
                    state = streakStatesByDate[date] ?: createFallbackStreakDayState(
                        date = date,
                        today = today,
                        reviewCount = reviewCount
                    ),
                    isToday = date == today,
                    isPlaceholder = false
                )
            }
        )
    }
}

private fun createFallbackStreakDayState(
    date: LocalDate,
    today: LocalDate,
    reviewCount: Int
): CloudProgressStreakDayState {
    return when {
        reviewCount > 0 -> CloudProgressStreakDayState.REVIEWED
        date == today -> CloudProgressStreakDayState.PENDING
        else -> CloudProgressStreakDayState.MISSED
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
    leaderboardSnapshot: ProgressLeaderboardSnapshot?,
    streakLeaderboardSnapshot: ProgressStreakLeaderboardSnapshot?,
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
            "leaderboardScopeId" to leaderboardSnapshot?.scopeKey?.scopeId,
            "streakLeaderboardScopeId" to streakLeaderboardSnapshot?.scopeKey?.scopeId,
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
