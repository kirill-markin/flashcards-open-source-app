package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
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
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

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
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Loaded)
            val loadedState = uiState as ProgressUiState.Loaded
            assertTrue(loadedState.summary is ProgressSummaryUiState.Loaded)
            val summaryState = loadedState.summary as ProgressSummaryUiState.Loaded
            assertEquals(12, summaryState.summary.currentStreakDays)
            assertEquals(3, loadedState.reviewsSection.maxReviewCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshIfInvalidatedDelegatesToBothRepositoryFlows() = runTest(dispatcher) {
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
            assertEquals(0, repository.refreshSummaryManuallyCallCount)
            assertEquals(0, repository.refreshSeriesManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshManuallyDelegatesToBothRepositoryFlows() = runTest(dispatcher) {
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
            assertEquals(1, repository.refreshSummaryManuallyCallCount)
            assertEquals(1, repository.refreshSeriesManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }
}

private class FakeProgressRepository : ProgressRepository {
    private val summarySnapshots = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val seriesSnapshots = MutableStateFlow<ProgressSeriesSnapshot?>(null)
    var refreshSummaryIfInvalidatedCallCount: Int = 0
        private set
    var refreshSeriesIfInvalidatedCallCount: Int = 0
        private set
    var refreshSummaryManuallyCallCount: Int = 0
        private set
    var refreshSeriesManuallyCallCount: Int = 0
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

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return summarySnapshots
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return seriesSnapshots
    }

    override suspend fun refreshSummaryIfInvalidated() {
        refreshSummaryIfInvalidatedCallCount += 1
    }

    override suspend fun refreshSeriesIfInvalidated() {
        refreshSeriesIfInvalidatedCallCount += 1
    }

    override suspend fun refreshSummaryManually() {
        refreshSummaryManuallyCallCount += 1
    }

    override suspend fun refreshSeriesManually() {
        refreshSeriesManuallyCallCount += 1
    }
}

private fun createProgressSummarySnapshot(): ProgressSummarySnapshot {
    return ProgressSummarySnapshot(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid"
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
    val scopeKey = ProgressSeriesScopeKey(
        scopeId = "local:installation-1",
        timeZone = "Europe/Madrid",
        from = "2026-04-18",
        to = "2026-04-18"
    )
    val renderedSeries = CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = listOf(
            CloudDailyReviewPoint(
                date = scopeKey.to,
                reviewCount = 3
            )
        ),
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
            dailyReviews = listOf(
                CloudDailyReviewPoint(
                    date = scopeKey.to,
                    reviewCount = 0
                )
            ),
            generatedAt = null,
            summary = null
        ),
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )
}
