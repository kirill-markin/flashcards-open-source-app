package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.cache.ProgressStreakLeaderboardCachedPayload
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressStreakLeaderboardForTest
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressStreakLeaderboardRankingRowForTest
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressStreakLeaderboardSnapshotTest {
    @Test
    fun localCurrentStreakProjectsViewerAboveEqualStreakRows(): Unit {
        val leaderboard = createProgressStreakLeaderboardForTest(
            rankingRows = listOf(
                createProgressStreakLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
                    publicProfileId = "participant-1",
                    anonymousDisplayName = "Silver Bright Harbor",
                    streakDays = 7,
                    rank = 1
                ),
                createProgressStreakLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
                    publicProfileId = "participant-2",
                    anonymousDisplayName = "Amber Calm Meadow",
                    streakDays = 5,
                    rank = 2
                ),
                createProgressStreakLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.VIEWER,
                    publicProfileId = "viewer-profile",
                    anonymousDisplayName = "Misty Quiet Grove",
                    streakDays = 4,
                    rank = 3
                )
            )
        )

        val snapshot = createProgressStreakLeaderboardStoreState(
            inputs = ProgressStreakLeaderboardStoreInputs(
                scopeKey = ProgressStreakLeaderboardScopeKey(scopeId = "linked:user-1"),
                cloudState = CloudAccountState.LINKED,
                serverBase = ProgressStreakLeaderboardCachedPayload(
                    leaderboard = leaderboard,
                    updatedAtMillis = 1L
                ),
                viewerCurrentStreakDays = 5,
                didLastRemoteLoadFail = false,
                currentTimeMillis = Instant.parse("2026-06-10T12:30:00.000Z").toEpochMilli()
            )
        ).snapshot

        val renderedLeaderboard = snapshot.renderedLeaderboard as CloudProgressStreakLeaderboard.Ready
        assertFalse(snapshot.isRefreshDue)
        assertEquals(2, renderedLeaderboard.viewer.rank)
        assertEquals(5, renderedLeaderboard.viewer.streakDays)
        assertEquals(
            listOf("participant-1", "viewer-profile", "participant-2"),
            renderedLeaderboard.rankingRows.map { row -> row.publicProfileId }
        )
    }

    @Test
    fun missingServerRowsRenderViewerOnlyFromCurrentSummary(): Unit {
        val snapshot = createProgressStreakLeaderboardStoreState(
            inputs = ProgressStreakLeaderboardStoreInputs(
                scopeKey = ProgressStreakLeaderboardScopeKey(scopeId = "linked:user-1"),
                cloudState = CloudAccountState.LINKED,
                serverBase = null,
                viewerCurrentStreakDays = 6,
                didLastRemoteLoadFail = false,
                currentTimeMillis = Instant.parse("2026-06-10T12:30:00.000Z").toEpochMilli()
            )
        ).snapshot

        val renderedLeaderboard = snapshot.renderedLeaderboard as CloudProgressStreakLeaderboard.Ready
        assertTrue(snapshot.isRefreshDue)
        assertEquals(null, snapshot.leaderboard)
        assertEquals(1, renderedLeaderboard.viewer.rank)
        assertEquals(6, renderedLeaderboard.viewer.streakDays)
        assertEquals(1, renderedLeaderboard.rankingRows.size)
        assertEquals(CloudProgressLeaderboardRankingRowKind.VIEWER, renderedLeaderboard.rankingRows.single().kind)
    }

    @Test
    fun refreshDueUsesStreakPayloadNextRefreshAfter(): Unit {
        val leaderboard = createProgressStreakLeaderboardForTest(
            rankingRows = listOf(
                createProgressStreakLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.VIEWER,
                    publicProfileId = "viewer-profile",
                    anonymousDisplayName = "Misty Quiet Grove",
                    streakDays = 4,
                    rank = 1
                )
            )
        )

        assertFalse(
            isProgressStreakLeaderboardRefreshDue(
                leaderboard = leaderboard,
                currentTimeMillis = Instant.parse("2026-06-11T11:59:59.999Z").toEpochMilli()
            )
        )
        assertTrue(
            isProgressStreakLeaderboardRefreshDue(
                leaderboard = leaderboard,
                currentTimeMillis = Instant.parse("2026-06-11T12:00:00.000Z").toEpochMilli()
            )
        )
    }
}
