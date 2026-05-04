package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.util.Locale

@OptIn(ExperimentalCoroutinesApi::class)
class ProgressViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun resumedLifecycleTriggersInitialProgressLoad() {
        val shouldTrigger = shouldTriggerInitialProgressLoad(
            lifecycleState = Lifecycle.State.RESUMED
        )

        assertTrue(shouldTrigger)
    }

    @Test
    fun nonResumedLifecycleDoesNotTriggerInitialProgressLoad() {
        assertEquals(
            false,
            shouldTriggerInitialProgressLoad(lifecycleState = Lifecycle.State.CREATED)
        )
        assertEquals(
            false,
            shouldTriggerInitialProgressLoad(lifecycleState = Lifecycle.State.STARTED)
        )
    }

    @Test
    fun repositorySnapshotsMapToLoadedUiState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot()
            )
            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Loaded)
            val loadedState = uiState as ProgressUiState.Loaded
            assertTrue(loadedState.summary is ProgressSummaryUiState.Loaded)
            val summaryState = loadedState.summary as ProgressSummaryUiState.Loaded
            assertEquals(12, summaryState.summary.currentStreakDays)
            assertEquals(1, loadedState.reviewsSection.pages.size)
            assertEquals(4, loadedState.reviewsSection.pages.single().upperBound)
            val reviewScheduleSection = checkNotNull(loadedState.reviewScheduleSection)
            assertEquals(4, reviewScheduleSection.totalCards)
            assertEquals(
                ProgressReviewScheduleBucketKey.NEW,
                reviewScheduleSection.buckets.first().key
            )
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun reviewScheduleSnapshotDoesNotGateLoadedUiStateAndUpdatesLater() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Loaded)
            val loadedState = uiState as ProgressUiState.Loaded
            assertEquals(null, loadedState.reviewScheduleSection)

            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val updatedUiState = viewModel.uiState.value as ProgressUiState.Loaded
            val reviewScheduleSection = checkNotNull(updatedUiState.reviewScheduleSection)
            assertEquals(4, reviewScheduleSection.totalCards)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshIfInvalidatedDelegatesToProgressRepositoryFlows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )
            advanceUntilIdle()

            viewModel.refreshIfInvalidated()
            advanceUntilIdle()

            assertEquals(1, repository.refreshSummaryIfInvalidatedCallCount)
            assertEquals(1, repository.refreshSeriesIfInvalidatedCallCount)
            assertEquals(1, repository.refreshReviewScheduleIfInvalidatedCallCount)
            assertEquals(0, repository.refreshSummaryManuallyCallCount)
            assertEquals(0, repository.refreshSeriesManuallyCallCount)
            assertEquals(0, repository.refreshReviewScheduleManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshManuallyDelegatesToProgressRepositoryFlows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )
            advanceUntilIdle()

            viewModel.refreshManually()
            advanceUntilIdle()

            assertEquals(0, repository.refreshSummaryIfInvalidatedCallCount)
            assertEquals(0, repository.refreshSeriesIfInvalidatedCallCount)
            assertEquals(0, repository.refreshReviewScheduleIfInvalidatedCallCount)
            assertEquals(1, repository.refreshSummaryManuallyCallCount)
            assertEquals(1, repository.refreshSeriesManuallyCallCount)
            assertEquals(1, repository.refreshReviewScheduleManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun invalidSeriesSnapshotMapsToErrorUiStateInsteadOfThrowing() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            val baseSeriesSnapshot = createProgressSeriesSnapshot()
            repository.emitSeriesSnapshot(
                snapshot = baseSeriesSnapshot.copy(
                    renderedSeries = baseSeriesSnapshot.renderedSeries.copy(
                        to = "invalid-date"
                    )
                )
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Error)
            assertEquals(null, (uiState as ProgressUiState.Error).message)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun loadedUiStateUsesMondayWeekStartForGermanLocaleAcrossStreakAndChart() = runTest(dispatcher) {
        assertLoadedUiStateUsesLocaleWeekStart(
            locale = Locale.GERMANY,
            expectedWeekStart = LocalDate.parse("2026-04-13")
        )
    }

    @Test
    fun loadedUiStateUsesSundayWeekStartForUsLocaleAcrossStreakAndChart() = runTest(dispatcher) {
        assertLoadedUiStateUsesLocaleWeekStart(
            locale = Locale.US,
            expectedWeekStart = LocalDate.parse("2026-04-12")
        )
    }

    @Test
    fun loadedUiStateUsesLocalUpperBoundPerReviewWeekPage() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot(
                    from = "2026-04-13",
                    to = "2026-04-21",
                    dailyReviews = listOf(
                        CloudDailyReviewPoint(date = "2026-04-13", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-14", reviewCount = 40),
                        CloudDailyReviewPoint(date = "2026-04-15", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-16", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-17", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-18", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-19", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-20", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-21", reviewCount = 9)
                    )
                )
            )
            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            assertEquals(2, uiState.reviewsSection.pages.size)
            assertEquals(44, uiState.reviewsSection.pages[0].upperBound)
            assertEquals(10, uiState.reviewsSection.pages[1].upperBound)
        } finally {
            Dispatchers.resetMain()
        }
    }

    private suspend fun TestScope.assertLoadedUiStateUsesLocaleWeekStart(
        locale: Locale,
        expectedWeekStart: LocalDate
    ) {
        Dispatchers.setMain(dispatcher)
        val previousLocale = Locale.getDefault()

        try {
            Locale.setDefault(locale)

            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot(
                    from = "2026-04-11",
                    to = "2026-04-18",
                    dailyReviews = createDailyReviewPoints(
                        from = LocalDate.parse("2026-04-11"),
                        to = LocalDate.parse("2026-04-18")
                    )
                )
            )
            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val latestWeek = uiState.streakSection.weeks.last()
            val latestReviewPage = uiState.reviewsSection.pages.last()

            assertEquals(expectedWeekStart, latestWeek.days.first().date)
            assertEquals(expectedWeekStart, latestReviewPage.startDate)
        } finally {
            Locale.setDefault(previousLocale)
            Dispatchers.resetMain()
        }
    }
}

private class FakeProgressRepository : ProgressRepository {
    private val summarySnapshots = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val seriesSnapshots = MutableStateFlow<ProgressSeriesSnapshot?>(null)
    private val reviewScheduleSnapshots = MutableStateFlow<ProgressReviewScheduleSnapshot?>(null)
    var refreshSummaryIfInvalidatedCallCount: Int = 0
        private set
    var refreshSeriesIfInvalidatedCallCount: Int = 0
        private set
    var refreshReviewScheduleIfInvalidatedCallCount: Int = 0
        private set
    var refreshSummaryManuallyCallCount: Int = 0
        private set
    var refreshSeriesManuallyCallCount: Int = 0
        private set
    var refreshReviewScheduleManuallyCallCount: Int = 0
        private set

    fun emitSummarySnapshot(
        snapshot: ProgressSummarySnapshot
    ) {
        summarySnapshots.value = snapshot
    }

    fun emitSeriesSnapshot(
        snapshot: ProgressSeriesSnapshot
    ) {
        seriesSnapshots.value = snapshot
    }

    fun emitReviewScheduleSnapshot(
        snapshot: ProgressReviewScheduleSnapshot
    ) {
        reviewScheduleSnapshots.value = snapshot
    }

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return summarySnapshots
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return seriesSnapshots
    }

    override fun observeReviewScheduleSnapshot(): Flow<ProgressReviewScheduleSnapshot?> {
        return reviewScheduleSnapshots
    }

    override suspend fun refreshSummaryIfInvalidated() {
        refreshSummaryIfInvalidatedCallCount += 1
    }

    override suspend fun refreshSeriesIfInvalidated() {
        refreshSeriesIfInvalidatedCallCount += 1
    }

    override suspend fun refreshReviewScheduleIfInvalidated() {
        refreshReviewScheduleIfInvalidatedCallCount += 1
    }

    override suspend fun refreshSummaryManually() {
        refreshSummaryManuallyCallCount += 1
    }

    override suspend fun refreshSeriesManually() {
        refreshSeriesManuallyCallCount += 1
    }

    override suspend fun refreshReviewScheduleManually() {
        refreshReviewScheduleManuallyCallCount += 1
    }
}

private fun createProgressSummarySnapshot(): ProgressSummarySnapshot {
    return ProgressSummarySnapshot(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-04-18"
        ),
        renderedSummary = CloudProgressSummary(
            currentStreakDays = 12,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 50
        ),
        localFallback = CloudProgressSummary(
            currentStreakDays = 12,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 50
        ),
        serverBase = CloudProgressSummary(
            currentStreakDays = 12,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 50
        ),
        source = ProgressSnapshotSource.SERVER_BASE,
        isApproximate = false
    )
}

private fun createProgressSeriesSnapshot(): ProgressSeriesSnapshot {
    return createProgressSeriesSnapshot(
        from = "2026-04-18",
        to = "2026-04-18",
        dailyReviews = listOf(
            CloudDailyReviewPoint(
                date = "2026-04-18",
                reviewCount = 3
            )
        )
    )
}

private fun createProgressSeriesSnapshot(
    from: String,
    to: String,
    dailyReviews: List<CloudDailyReviewPoint>
): ProgressSeriesSnapshot {
    val scopeKey = ProgressSeriesScopeKey(
        scopeId = "local:installation-1",
        timeZone = "Europe/Madrid",
        from = from,
        to = to
    )
    val renderedSeries = CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = dailyReviews,
        generatedAt = null,
        summary = null
    )
    return ProgressSeriesSnapshot(
        scopeKey = scopeKey,
        renderedSeries = renderedSeries,
        localFallback = renderedSeries,
        serverBase = null,
        pendingLocalOverlay = CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = dailyReviews.map { point ->
                point.copy(reviewCount = 0)
            },
            generatedAt = null,
            summary = null
        ),
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )
}

private fun createProgressReviewScheduleSnapshot(): ProgressReviewScheduleSnapshot {
    val scopeKey = ProgressReviewScheduleScopeKey(
        scopeId = "local:installation-1",
        timeZone = "Europe/Madrid",
        workspaceMembershipKey = "workspace-1",
        referenceLocalDate = "2026-04-18"
    )
    val schedule = CloudProgressReviewSchedule(
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        totalCards = 4,
        buckets = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
            CloudProgressReviewScheduleBucket(
                key = key,
                count = when (key) {
                    ProgressReviewScheduleBucketKey.NEW -> 2
                    ProgressReviewScheduleBucketKey.TODAY -> 1
                    ProgressReviewScheduleBucketKey.DAYS_1_TO_7 -> 1
                    ProgressReviewScheduleBucketKey.DAYS_8_TO_30,
                    ProgressReviewScheduleBucketKey.DAYS_31_TO_90,
                    ProgressReviewScheduleBucketKey.DAYS_91_TO_360,
                    ProgressReviewScheduleBucketKey.YEARS_1_TO_2,
                    ProgressReviewScheduleBucketKey.LATER -> 0
                }
            )
        }
    )

    return ProgressReviewScheduleSnapshot(
        scopeKey = scopeKey,
        renderedSchedule = schedule,
        localFallback = schedule,
        serverBase = null,
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )
}

private fun createDailyReviewPoints(
    from: LocalDate,
    to: LocalDate
): List<CloudDailyReviewPoint> {
    return generateSequence(from) { date ->
        val nextDate = date.plusDays(1)
        if (nextDate.isAfter(to)) {
            null
        } else {
            nextDate
        }
    }.map { date ->
        CloudDailyReviewPoint(
            date = date.toString(),
            reviewCount = 1
        )
    }.toList()
}
