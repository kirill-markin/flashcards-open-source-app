package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProgressViewModelLifecycleTest {
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
    fun progressSectionScrollIndexesMatchLoadedRouteOrder() {
        assertEquals(0, progressStreakItemIndex())
        assertEquals(1, progressLeaderboardItemIndex())
    }

    @Test
    fun refreshIfInvalidatedDelegatesToProgressRepositoryFlows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)
            advanceUntilIdle()

            viewModel.refreshIfInvalidated()
            advanceUntilIdle()

            assertEquals(1, repository.refreshSummaryIfInvalidatedCallCount)
            assertEquals(1, repository.refreshSeriesIfInvalidatedCallCount)
            assertEquals(1, repository.refreshReviewScheduleIfInvalidatedCallCount)
            assertEquals(1, repository.refreshLeaderboardIfInvalidatedCallCount)
            assertEquals(0, repository.refreshSummaryManuallyCallCount)
            assertEquals(0, repository.refreshSeriesManuallyCallCount)
            assertEquals(0, repository.refreshReviewScheduleManuallyCallCount)
            assertEquals(0, repository.refreshLeaderboardManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshManuallyDelegatesToProgressRepositoryFlows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)
            advanceUntilIdle()

            viewModel.refreshManually()
            advanceUntilIdle()

            assertEquals(0, repository.refreshSummaryIfInvalidatedCallCount)
            assertEquals(0, repository.refreshSeriesIfInvalidatedCallCount)
            assertEquals(0, repository.refreshReviewScheduleIfInvalidatedCallCount)
            assertEquals(0, repository.refreshLeaderboardIfInvalidatedCallCount)
            assertEquals(1, repository.refreshSummaryManuallyCallCount)
            assertEquals(1, repository.refreshSeriesManuallyCallCount)
            assertEquals(1, repository.refreshReviewScheduleManuallyCallCount)
            assertEquals(1, repository.refreshLeaderboardManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }
}
