package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
class ProgressViewModelStateMappingTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun repositorySnapshotsMapToLoadedUiState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

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
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

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
    fun invalidSeriesSnapshotMapsToErrorUiStateInsteadOfThrowing() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

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
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot(
                    from = "2026-04-13",
                    to = "2026-04-21",
                    dailyReviews = listOf(
                        createDailyReviewPoint(date = "2026-04-13", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-14", reviewCount = 40),
                        createDailyReviewPoint(date = "2026-04-15", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-16", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-17", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-18", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-19", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-20", reviewCount = 0),
                        createDailyReviewPoint(date = "2026-04-21", reviewCount = 9)
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
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

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
