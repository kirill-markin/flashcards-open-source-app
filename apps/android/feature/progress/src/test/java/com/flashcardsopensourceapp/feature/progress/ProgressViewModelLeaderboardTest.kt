package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import java.time.LocalDate
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
class ProgressViewModelLeaderboardTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun leaderboardSnapshotMapsToReadyCompactRowsWithDefaultWindow() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

            repository.emitSummarySnapshot(snapshot = createProgressSummarySnapshot())
            repository.emitSeriesSnapshot(snapshot = createProgressSeriesSnapshot())
            repository.emitLeaderboardSnapshot(snapshot = createProgressLeaderboardSnapshot())
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val leaderboardSection = uiState.leaderboardSection as ProgressLeaderboardSectionUiState.Ready
            assertEquals(ProgressLeaderboardWindowKey.LAST_24_HOURS, leaderboardSection.selectedWindowKey)
            val selectedWindow = checkNotNull(leaderboardSection.selectedWindow)
            assertEquals(128, selectedWindow.participantCount)

            val rows = selectedWindow.rows
            assertEquals(9, rows.size)
            val firstRow = rows[0] as ProgressLeaderboardRowUiState.Participant
            assertEquals(1, firstRow.rank)
            assertEquals("Silver Bright Harbor", firstRow.displayName)
            assertEquals("participant-1", firstRow.publicProfileId)
            assertEquals("Silver Bright Harbor", firstRow.anonymousDisplayName)
            assertEquals(null, firstRow.friendDisplayName)
            assertEquals(51, firstRow.qualifiedReviewCount)
            assertEquals(false, firstRow.isViewer)
            val viewerRow = rows[5] as ProgressLeaderboardRowUiState.Participant
            assertEquals(42, viewerRow.rank)
            assertEquals("viewer-profile", viewerRow.publicProfileId)
            assertTrue(viewerRow.isViewer)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun leaderboardKeepsTopThreeRowsBeforeEllipsisGap() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val topRows = rows.take(3).map { row -> row as ProgressLeaderboardRowUiState.Participant }
        assertEquals(listOf(1, 2, 3), topRows.map(ProgressLeaderboardRowUiState.Participant::rank))
        assertEquals(ProgressLeaderboardRowUiState.Gap, rows[3])
        assertEquals(ProgressLeaderboardRowUiState.Gap, rows[7])
        val lastRow = rows[8] as ProgressLeaderboardRowUiState.Participant
        assertEquals(128, lastRow.rank)
        assertEquals(0, lastRow.qualifiedReviewCount)
    }

    @Test
    fun leaderboardAutoSelectsBestViewerRank() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                leaderboard = createCloudProgressLeaderboard(
                    windows = ProgressLeaderboardWindowKey.orderedEntries.map { windowKey ->
                        createCloudProgressLeaderboardWindow(
                            windowKey = windowKey,
                            viewerRank = when (windowKey) {
                                ProgressLeaderboardWindowKey.LAST_24_HOURS -> 9
                                ProgressLeaderboardWindowKey.LAST_3_DAYS -> 4
                                ProgressLeaderboardWindowKey.LAST_7_DAYS -> 2
                                ProgressLeaderboardWindowKey.LAST_30_DAYS -> 6
                                ProgressLeaderboardWindowKey.ALL_TIME -> 3
                            }
                        )
                    }
                )
            ),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        assertEquals(ProgressLeaderboardWindowKey.LAST_7_DAYS, sectionUiState.selectedWindowKey)
    }

    @Test
    fun guestLeaderboardSnapshotMapsToSignInPlaceholder() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                cloudState = CloudAccountState.GUEST,
                leaderboard = null
            ),
            selectedWindowKey = null
        )

        assertEquals(ProgressLeaderboardSectionUiState.SignInRequired, sectionUiState)
    }

    @Test
    fun participationDisabledLeaderboardMapsToParticipationPlaceholder() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                leaderboard = createCloudProgressLeaderboard(
                    status = ProgressLeaderboardStatus.PARTICIPATION_DISABLED,
                    windows = emptyList()
                )
            ),
            selectedWindowKey = null
        )

        assertEquals(ProgressLeaderboardSectionUiState.ParticipationDisabled, sectionUiState)
    }

    @Test
    fun leaderboardInfoCopyExplainsAgainExclusion() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val infoCopy = checkNotNull(sectionUiState.metricDescription)
        assertTrue(infoCopy.contains("Hard, Good, and Easy"))
        assertTrue(infoCopy.contains("Again does not"))
    }

    @Test
    fun leaderboardLiveProjectionMovesViewerRankAndRows() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                viewerLocalQualifiedCounts = mapOf(
                    ProgressLeaderboardWindowKey.LAST_24_HOURS to 9
                )
            ),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val participants = rows.filterIsInstance<ProgressLeaderboardRowUiState.Participant>()
        val viewerRow = participants.single(ProgressLeaderboardRowUiState.Participant::isViewer)
        assertEquals(9, viewerRow.qualifiedReviewCount)
        assertEquals(41, viewerRow.rank)
        assertEquals(
            listOf(1, 2, 3, 40, 41, 42, 128),
            participants.map(ProgressLeaderboardRowUiState.Participant::rank)
        )
        assertEquals(
            listOf(51, 33, 21, 9, 8, 0),
            participants.filterNot(ProgressLeaderboardRowUiState.Participant::isViewer)
                .map(ProgressLeaderboardRowUiState.Participant::qualifiedReviewCount)
        )
    }

    @Test
    fun leaderboardLiveProjectionNeverLowersServerViewerCount() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                viewerLocalQualifiedCounts = mapOf(
                    ProgressLeaderboardWindowKey.LAST_24_HOURS to 2
                )
            ),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val viewerRow = rows.filterIsInstance<ProgressLeaderboardRowUiState.Participant>()
            .single(ProgressLeaderboardRowUiState.Participant::isViewer)
        assertEquals(7, viewerRow.qualifiedReviewCount)
    }

    @Test
    fun leaderboardRowsIncludeFriendsOutsideCompactViewerWindow() {
        val friendLeaderboard = createCloudProgressLeaderboard(
            windows = listOf(
                createCloudProgressLeaderboardWindow().withFriendRows(
                    friendRows = mapOf(
                        10 to "Kai",
                        100 to "Priya"
                    )
                )
            )
        )
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(leaderboard = friendLeaderboard),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val participants = rows.filterIsInstance<ProgressLeaderboardRowUiState.Participant>()
        assertEquals(
            listOf(1, 2, 3, 10, 41, 42, 43, 100, 128),
            participants.map(ProgressLeaderboardRowUiState.Participant::rank)
        )
        assertEquals("Kai", participants.single { row -> row.rank == 10 }.displayName)
        assertEquals("Priya", participants.single { row -> row.rank == 100 }.displayName)
        assertEquals(4, rows.count { row -> row == ProgressLeaderboardRowUiState.Gap })
    }

    @Test
    fun leaderboardReservedRowsUseMaximumFriendExpandedWindowRowCount() {
        val shortWindow = createCloudProgressLeaderboardWindow(
            windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
            viewerRank = 42
        )
        val friendExpandedWindow = createCloudProgressLeaderboardWindow(
            windowKey = ProgressLeaderboardWindowKey.LAST_3_DAYS,
            viewerRank = 42
        ).withFriendRows(
            friendRows = mapOf(
                10 to "Kai",
                100 to "Priya"
            )
        )
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                leaderboard = createCloudProgressLeaderboard(
                    windows = listOf(shortWindow, friendExpandedWindow)
                )
            ),
            selectedWindowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS
        ) as ProgressLeaderboardSectionUiState.Ready

        val selectedWindow = checkNotNull(sectionUiState.selectedWindow)
        assertEquals(9, selectedWindow.rows.size)
        assertEquals(13, sectionUiState.reservedRowCount)
    }

    @Test
    fun openingLeaderboardProfileLoadsReadySheet() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

            repository.emitSummarySnapshot(snapshot = createProgressSummarySnapshot())
            repository.emitSeriesSnapshot(snapshot = createProgressSeriesSnapshot())
            repository.emitLeaderboardSnapshot(snapshot = createProgressLeaderboardSnapshot())
            advanceUntilIdle()

            val loadedState = viewModel.uiState.value as ProgressUiState.Loaded
            val leaderboardSection = loadedState.leaderboardSection as ProgressLeaderboardSectionUiState.Ready
            val firstRow = checkNotNull(leaderboardSection.selectedWindow)
                .rows
                .first() as ProgressLeaderboardRowUiState.Participant

            viewModel.openLeaderboardProfile(selectedProfile = firstRow.profileIdentity)
            advanceUntilIdle()

            assertEquals(listOf("participant-1"), repository.loadedLeaderboardProfileIds)
            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val sheet = uiState.leaderboardProfileSheet as ProgressLeaderboardProfileSheetUiState.Ready
            assertEquals("participant-1", sheet.selectedProfile.publicProfileId)
            assertEquals("Silver Bright Harbor", sheet.selectedProfile.displayName)
            assertEquals("Kai", sheet.profile.friendDisplayName)
            assertTrue(sheet.profile.isFriend)
            assertEquals(5, sheet.profile.currentStreakDays)
            assertEquals(ProgressLeaderboardWindowKey.LAST_24_HOURS, sheet.profile.bestRatingPlacement?.windowKey)
            assertEquals(1, sheet.profile.bestRatingPlacement?.rank)
            assertEquals(30, sheet.profile.reviewActivityDays.size)
            assertEquals(LocalDate.parse("2026-05-01"), sheet.profile.joinedDate)
            assertEquals(72, sheet.profile.totalCards)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun openingLeaderboardProfileMapsUnavailableSheet() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            repository.leaderboardProfileResponse = createCloudProgressLeaderboardProfileNonReady(
                status = ProgressLeaderboardProfileStatus.PROFILE_UNAVAILABLE
            )
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

            repository.emitSummarySnapshot(snapshot = createProgressSummarySnapshot())
            repository.emitSeriesSnapshot(snapshot = createProgressSeriesSnapshot())
            repository.emitLeaderboardSnapshot(snapshot = createProgressLeaderboardSnapshot())
            advanceUntilIdle()

            val loadedState = viewModel.uiState.value as ProgressUiState.Loaded
            val leaderboardSection = loadedState.leaderboardSection as ProgressLeaderboardSectionUiState.Ready
            val firstRow = checkNotNull(leaderboardSection.selectedWindow)
                .rows
                .first() as ProgressLeaderboardRowUiState.Participant

            viewModel.openLeaderboardProfile(selectedProfile = firstRow.profileIdentity)
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val sheet = uiState.leaderboardProfileSheet as ProgressLeaderboardProfileSheetUiState.Unavailable
            assertEquals(ProgressLeaderboardProfileStatus.PROFILE_UNAVAILABLE, sheet.status)
            assertEquals("participant-1", sheet.selectedProfile.publicProfileId)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun leaderboardProfileFailureMapsErrorAndRetryReloads() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            repository.leaderboardProfileError = IllegalStateException("Synthetic profile load failure.")
            val viewModel = createProgressViewModelForTest(progressRepository = repository)

            repository.emitSummarySnapshot(snapshot = createProgressSummarySnapshot())
            repository.emitSeriesSnapshot(snapshot = createProgressSeriesSnapshot())
            repository.emitLeaderboardSnapshot(snapshot = createProgressLeaderboardSnapshot())
            advanceUntilIdle()

            val loadedState = viewModel.uiState.value as ProgressUiState.Loaded
            val leaderboardSection = loadedState.leaderboardSection as ProgressLeaderboardSectionUiState.Ready
            val firstRow = checkNotNull(leaderboardSection.selectedWindow)
                .rows
                .first() as ProgressLeaderboardRowUiState.Participant

            viewModel.openLeaderboardProfile(selectedProfile = firstRow.profileIdentity)
            advanceUntilIdle()

            val failedState = viewModel.uiState.value as ProgressUiState.Loaded
            val errorSheet = failedState.leaderboardProfileSheet as ProgressLeaderboardProfileSheetUiState.Error
            assertEquals("participant-1", errorSheet.selectedProfile.publicProfileId)

            repository.leaderboardProfileError = null
            viewModel.retryLeaderboardProfile()
            advanceUntilIdle()

            assertEquals(listOf("participant-1", "participant-1"), repository.loadedLeaderboardProfileIds)
            val retriedState = viewModel.uiState.value as ProgressUiState.Loaded
            assertTrue(retriedState.leaderboardProfileSheet is ProgressLeaderboardProfileSheetUiState.Ready)
        } finally {
            Dispatchers.resetMain()
        }
    }
}
