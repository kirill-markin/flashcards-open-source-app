package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Test

class ProgressContextRefreshControllerTest {
    @Test
    fun refreshIfInvalidatedRefreshesSummaryOnlyOutsideProgressScreen() = runBlocking {
        val repository = FakeProgressRepository()
        val appScope = CoroutineScope(context = Dispatchers.Default)
        val controller = ProgressContextRefreshController(
            appScope = appScope,
            progressRepository = repository
        )

        try {
            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.REVIEW)

            awaitUntil { repository.summaryRefreshCallCount == 1 }
        } finally {
            appScope.cancel()
        }

        assertEquals(1, repository.summaryRefreshCallCount)
        assertEquals(0, repository.seriesRefreshCallCount)
        assertEquals(0, repository.reviewScheduleRefreshCallCount)
    }

    @Test
    fun refreshIfInvalidatedRefreshesAllProgressSectionsOnProgressScreen() = runBlocking {
        val repository = FakeProgressRepository()
        val appScope = CoroutineScope(context = Dispatchers.Default)
        val controller = ProgressContextRefreshController(
            appScope = appScope,
            progressRepository = repository
        )

        try {
            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.PROGRESS)

            awaitUntil {
                repository.summaryRefreshCallCount == 1 &&
                    repository.seriesRefreshCallCount == 1 &&
                    repository.reviewScheduleRefreshCallCount == 1
            }
        } finally {
            appScope.cancel()
        }

        assertEquals(1, repository.summaryRefreshCallCount)
        assertEquals(1, repository.seriesRefreshCallCount)
        assertEquals(1, repository.reviewScheduleRefreshCallCount)
    }

    @Test
    fun refreshIfInvalidatedQueuesOneMoreRefreshWhileActive() = runBlocking {
        val repository = FakeProgressRepository(blockFirstSummaryRefresh = true)
        val appScope = CoroutineScope(context = Dispatchers.Default)
        val controller = ProgressContextRefreshController(
            appScope = appScope,
            progressRepository = repository
        )

        try {
            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.REVIEW)
            awaitUntil { repository.summaryRefreshCallCount == 1 }

            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.REVIEW)
            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.REVIEW)
            delay(timeMillis = 50L)

            assertEquals(1, repository.summaryRefreshCallCount)
            assertEquals(0, repository.seriesRefreshCallCount)
            assertEquals(0, repository.reviewScheduleRefreshCallCount)

            repository.releaseFirstSummaryRefresh()

            awaitUntil {
                repository.summaryRefreshCallCount == 2 &&
                    repository.seriesRefreshCallCount == 0 &&
                    repository.reviewScheduleRefreshCallCount == 0
            }
        } finally {
            appScope.cancel()
        }

        assertEquals(2, repository.summaryRefreshCallCount)
        assertEquals(0, repository.seriesRefreshCallCount)
        assertEquals(0, repository.reviewScheduleRefreshCallCount)
    }

    @Test
    fun refreshIfInvalidatedKeepsProcessingRequestsAfterSummaryFailure() = runBlocking {
        val repository = FakeProgressRepository(failFirstSummaryRefresh = true)
        val appScope = CoroutineScope(context = Dispatchers.Default)
        val controller = ProgressContextRefreshController(
            appScope = appScope,
            progressRepository = repository
        )

        try {
            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.PROGRESS)
            awaitUntil {
                repository.summaryRefreshCallCount == 1 &&
                    repository.seriesRefreshCallCount == 1 &&
                    repository.reviewScheduleRefreshCallCount == 1
            }

            controller.refreshIfInvalidated(visibleScreen = VisibleAppScreen.PROGRESS)
            awaitUntil {
                repository.summaryRefreshCallCount == 2 &&
                    repository.seriesRefreshCallCount == 2 &&
                    repository.reviewScheduleRefreshCallCount == 2
            }
        } finally {
            appScope.cancel()
        }

        assertEquals(2, repository.summaryRefreshCallCount)
        assertEquals(2, repository.seriesRefreshCallCount)
        assertEquals(2, repository.reviewScheduleRefreshCallCount)
    }
}

private class FakeProgressRepository(
    private val blockFirstSummaryRefresh: Boolean = false,
    private val failFirstSummaryRefresh: Boolean = false
) : ProgressRepository {
    private val releaseFirstSummaryRefreshSignal = CompletableDeferred<Unit>()

    @Volatile
    var summaryRefreshCallCount: Int = 0

    @Volatile
    var seriesRefreshCallCount: Int = 0

    @Volatile
    var reviewScheduleRefreshCallCount: Int = 0

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return emptyFlow()
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return emptyFlow()
    }

    override fun observeReviewScheduleSnapshot(): Flow<ProgressReviewScheduleSnapshot?> {
        return emptyFlow()
    }

    override suspend fun refreshSummaryIfInvalidated() {
        summaryRefreshCallCount += 1
        if (failFirstSummaryRefresh && summaryRefreshCallCount == 1) {
            throw IllegalStateException("Synthetic summary refresh failure.")
        }
        if (blockFirstSummaryRefresh && summaryRefreshCallCount == 1) {
            releaseFirstSummaryRefreshSignal.await()
        }
    }

    override suspend fun refreshSeriesIfInvalidated() {
        seriesRefreshCallCount += 1
    }

    override suspend fun refreshReviewScheduleIfInvalidated() {
        reviewScheduleRefreshCallCount += 1
    }

    override suspend fun refreshSummaryManually() {
        throw UnsupportedOperationException("Not used in ProgressContextRefreshControllerTest.")
    }

    override suspend fun refreshSeriesManually() {
        throw UnsupportedOperationException("Not used in ProgressContextRefreshControllerTest.")
    }

    override suspend fun refreshReviewScheduleManually() {
        throw UnsupportedOperationException("Not used in ProgressContextRefreshControllerTest.")
    }

    fun releaseFirstSummaryRefresh() {
        releaseFirstSummaryRefreshSignal.complete(value = Unit)
    }
}

private suspend fun awaitUntil(condition: () -> Boolean) {
    withTimeout(timeMillis = 2_000L) {
        while (condition().not()) {
            delay(timeMillis = 10L)
        }
    }
}
