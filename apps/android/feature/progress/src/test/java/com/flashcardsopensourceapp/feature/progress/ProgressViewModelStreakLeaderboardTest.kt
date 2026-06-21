package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
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
class ProgressViewModelStreakLeaderboardTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun streakLeaderboardSnapshotMapsToReadyRows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

            repository.emitSummarySnapshot(snapshot = createProgressSummarySnapshot())
            repository.emitSeriesSnapshot(snapshot = createProgressSeriesSnapshot())
            repository.emitStreakLeaderboardSnapshot(snapshot = createProgressStreakLeaderboardSnapshot())
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val streakLeaderboardSection =
                uiState.streakLeaderboardSection as ProgressStreakLeaderboardSectionUiState.Ready
            assertEquals(3, streakLeaderboardSection.participantCount)
            assertEquals(3, streakLeaderboardSection.rows.size)
            assertTrue(checkNotNull(streakLeaderboardSection.metricDescription).contains("current streak days"))
            assertEquals(1_776_520_805_000L, streakLeaderboardSection.snapshotGeneratedAtMillis)

            val firstRow = streakLeaderboardSection.rows[0] as ProgressStreakLeaderboardRowUiState.Participant
            assertEquals(1, firstRow.rank)
            assertEquals("Streak Participant 1", firstRow.displayName)
            assertEquals(30, firstRow.streakDays)
            assertEquals(false, firstRow.isViewer)
            val viewerRow = streakLeaderboardSection.rows[1] as ProgressStreakLeaderboardRowUiState.Participant
            assertEquals(2, viewerRow.rank)
            assertEquals(12, viewerRow.streakDays)
            assertTrue(viewerRow.isViewer)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun streakLeaderboardUsesViewerOnlyRenderedRowsWhenServerRowsAreUnavailable() {
        val sectionUiState = createProgressStreakLeaderboardSectionUiState(
            snapshot = createProgressStreakLeaderboardSnapshot(
                cloudState = CloudAccountState.LINKED,
                leaderboard = null,
                viewerCurrentStreakDays = 12,
                didLastRemoteLoadFail = false
            )
        ) as ProgressStreakLeaderboardSectionUiState.Ready

        assertEquals(1, sectionUiState.participantCount)
        assertTrue(checkNotNull(sectionUiState.metricDescription).contains("Again, Hard, Good, or Easy"))
        val viewerRow = sectionUiState.rows.single() as ProgressStreakLeaderboardRowUiState.Participant
        assertEquals(1, viewerRow.rank)
        assertEquals(12, viewerRow.streakDays)
        assertTrue(viewerRow.isViewer)
    }

    @Test
    fun guestStreakLeaderboardSnapshotMapsToSignInPlaceholder() {
        val sectionUiState = createProgressStreakLeaderboardSectionUiState(
            snapshot = createProgressStreakLeaderboardSnapshot(
                cloudState = CloudAccountState.GUEST,
                leaderboard = null,
                viewerCurrentStreakDays = null,
                didLastRemoteLoadFail = false
            )
        )

        assertEquals(ProgressStreakLeaderboardSectionUiState.SignInRequired, sectionUiState)
    }

    @Test
    fun participationDisabledStreakLeaderboardMapsToParticipationPlaceholder() {
        val sectionUiState = createProgressStreakLeaderboardSectionUiState(
            snapshot = createProgressStreakLeaderboardSnapshot(
                cloudState = CloudAccountState.LINKED,
                leaderboard = createCloudProgressStreakLeaderboardNonReady(
                    status = ProgressLeaderboardStatus.PARTICIPATION_DISABLED
                ),
                viewerCurrentStreakDays = null,
                didLastRemoteLoadFail = false
            )
        )

        assertEquals(ProgressStreakLeaderboardSectionUiState.ParticipationDisabled, sectionUiState)
    }
}
