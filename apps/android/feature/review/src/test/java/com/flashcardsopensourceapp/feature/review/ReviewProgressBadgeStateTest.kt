package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.progress.createRenderedProgressLeaderboard
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewProgressBadgeStateTest {
    @Test
    fun reviewProgressBadgeStateUsesRenderedSummaryFields() {
        val badgeState = createProgressSummarySnapshot(
            currentStreakDays = 14,
            hasReviewedToday = true
        ).toReviewProgressBadgeState()

        assertEquals(
            ReviewProgressBadgeState(
                streakDays = 14,
                freezeAvailableCredits = 2,
                freezeCapacity = 2,
                hasReviewedToday = true,
                isInteractive = true
            ),
            badgeState
        )
    }

    @Test
    fun reviewProgressBadgeValueUsesOverflowLabelForLargeStreaks() {
        assertEquals("99+", formatReviewProgressBadgeValue(streakDays = 140))
        assertEquals("12", formatReviewProgressBadgeValue(streakDays = 12))
    }

    @Test
    fun initialReviewProgressLoadTriggersOnlyWhenLifecycleIsResumed() {
        assertEquals(
            true,
            shouldTriggerInitialReviewProgressLoad(lifecycleState = Lifecycle.State.RESUMED)
        )
        assertEquals(
            false,
            shouldTriggerInitialReviewProgressLoad(lifecycleState = Lifecycle.State.CREATED)
        )
        assertEquals(
            false,
            shouldTriggerInitialReviewProgressLoad(lifecycleState = Lifecycle.State.STARTED)
        )
    }

    @Test
    fun reviewLeaderboardBadgeUsesProjectedViewerRank() {
        val leaderboard = createProgressLeaderboardForBadgeTest()
        val viewerLocalQualifiedCounts = mapOf(
            ProgressLeaderboardWindowKey.LAST_24_HOURS to 10
        )
        val snapshot = ProgressLeaderboardSnapshot(
            scopeKey = ProgressLeaderboardScopeKey(scopeId = "linked:user-1"),
            cloudState = CloudAccountState.LINKED,
            leaderboard = leaderboard,
            renderedLeaderboard = createRenderedProgressLeaderboard(
                leaderboard = leaderboard,
                viewerLocalQualifiedCounts = viewerLocalQualifiedCounts
            ),
            payloadUpdatedAtMillis = 1_750_000_000_000L,
            viewerLocalQualifiedCounts = viewerLocalQualifiedCounts,
            isRefreshDue = false,
            didLastRemoteLoadFail = false
        )

        val badgeState = snapshot.toReviewLeaderboardBadgeState()

        assertEquals(2, badgeState.rank)
        assertEquals(ProgressLeaderboardWindowKey.LAST_24_HOURS, badgeState.windowKey)
    }
}

private fun createProgressLeaderboardForBadgeTest(): CloudProgressLeaderboard {
    return CloudProgressLeaderboard(
        status = ProgressLeaderboardStatus.READY,
        metric = CloudProgressLeaderboardMetric(
            metricVersion = "qualified_reviews_v1",
            title = "Qualified reviews",
            description = "Hard, Good, and Easy reviews count toward your rank. Again does not."
        ),
        defaultWindowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
        windows = listOf(createProgressLeaderboardWindowForBadgeTest())
    )
}

private fun createProgressLeaderboardWindowForBadgeTest(): CloudProgressLeaderboardWindow {
    val rankingRows = listOf(
        createProgressLeaderboardRankingRowForBadgeTest(
            kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
            publicProfileId = "participant-1",
            anonymousDisplayName = "Silver Bright Harbor",
            qualifiedReviewCount = 10,
            rank = 1
        ),
        createProgressLeaderboardRankingRowForBadgeTest(
            kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
            publicProfileId = "participant-2",
            anonymousDisplayName = "Amber Calm Meadow",
            qualifiedReviewCount = 9,
            rank = 2
        ),
        createProgressLeaderboardRankingRowForBadgeTest(
            kind = CloudProgressLeaderboardRankingRowKind.VIEWER,
            publicProfileId = "viewer-profile",
            anonymousDisplayName = "Misty Quiet Grove",
            qualifiedReviewCount = 7,
            rank = 3
        ),
        createProgressLeaderboardRankingRowForBadgeTest(
            kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
            publicProfileId = "participant-4",
            anonymousDisplayName = "Sunny Brave Cliff",
            qualifiedReviewCount = 6,
            rank = 4
        )
    )
    return CloudProgressLeaderboardWindow(
        windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
        snapshotId = "snapshot-1",
        snapshotGeneratedAt = "2026-04-18T14:00:05.000Z",
        asOfServerHour = "2026-04-18T14:00:00.000Z",
        nextRefreshAfter = "2026-04-18T15:00:00.000Z",
        participantCount = rankingRows.size,
        viewer = CloudProgressLeaderboardViewer(
            publicProfileId = "viewer-profile",
            rank = 3,
            qualifiedReviewCount = 7
        ),
        rows = listOf(
            createProgressLeaderboardRowForBadgeTest(
                kind = ProgressLeaderboardParticipantRowKind.TOP,
                rankingRow = rankingRows[0]
            ),
            createProgressLeaderboardRowForBadgeTest(
                kind = ProgressLeaderboardParticipantRowKind.TOP,
                rankingRow = rankingRows[1]
            ),
            createProgressLeaderboardRowForBadgeTest(
                kind = ProgressLeaderboardParticipantRowKind.VIEWER,
                rankingRow = rankingRows[2]
            ),
            createProgressLeaderboardRowForBadgeTest(
                kind = ProgressLeaderboardParticipantRowKind.NEIGHBOR,
                rankingRow = rankingRows[3]
            )
        ),
        rankingRows = rankingRows
    )
}

private fun createProgressLeaderboardRankingRowForBadgeTest(
    kind: CloudProgressLeaderboardRankingRowKind,
    publicProfileId: String,
    anonymousDisplayName: String,
    qualifiedReviewCount: Int,
    rank: Int
): CloudProgressLeaderboardRankingRow {
    return CloudProgressLeaderboardRankingRow(
        kind = kind,
        publicProfileId = publicProfileId,
        anonymousDisplayName = anonymousDisplayName,
        friendDisplayName = null,
        qualifiedReviewCount = qualifiedReviewCount,
        rank = rank
    )
}

private fun createProgressLeaderboardRowForBadgeTest(
    kind: ProgressLeaderboardParticipantRowKind,
    rankingRow: CloudProgressLeaderboardRankingRow
): CloudProgressLeaderboardRow.Participant {
    return CloudProgressLeaderboardRow.Participant(
        kind = kind,
        publicProfileId = rankingRow.publicProfileId,
        anonymousDisplayName = rankingRow.anonymousDisplayName,
        friendDisplayName = null,
        qualifiedReviewCount = rankingRow.qualifiedReviewCount,
        rank = rankingRow.rank
    )
}

private fun createProgressSummarySnapshot(
    currentStreakDays: Int,
    hasReviewedToday: Boolean
): ProgressSummarySnapshot {
    val renderedSummary = CloudProgressSummary(
        currentStreakDays = currentStreakDays,
        longestStreakDays = currentStreakDays,
        hasReviewedToday = hasReviewedToday,
        lastReviewedOn = "2026-04-18",
        activeReviewDays = 32,
        streakFreeze = CloudProgressStreakFreeze(
            availableCredits = 2,
            capacity = 2,
            balanceUnits = 20,
            unitsPerCredit = 10,
            earnedUnitsPerStreakDay = 1,
            nextCreditProgressUnits = 0,
            nextCreditRequiredUnits = 10
        ),
        reviewHistoryWatermarks = emptyList()
    )

    return ProgressSummarySnapshot(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-04-18"
        ),
        renderedSummary = renderedSummary,
        localFallback = renderedSummary,
        serverBase = renderedSummary,
        source = ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY,
        isApproximate = false
    )
}
