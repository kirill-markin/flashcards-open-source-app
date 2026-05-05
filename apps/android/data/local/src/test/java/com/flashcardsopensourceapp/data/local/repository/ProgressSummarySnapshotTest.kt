package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ProgressSummarySnapshotTest {
    @Test
    fun missingSummaryServerBaseRendersLocalFallbackAsApproximateLocalOnly() {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.DISCONNECTED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = scopeKey,
            localDayCounts = listOf(
                createProgressLocalDayCount(
                    workspaceId = "workspace-1",
                    localDate = "2026-04-17",
                    reviewCount = 1
                ),
                createProgressLocalDayCount(
                    workspaceId = "workspace-1",
                    localDate = "2026-04-18",
                    reviewCount = 1
                )
            ),
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = null,
            cloudState = CloudAccountState.DISCONNECTED
        )

        assertEquals(ProgressSnapshotSource.LOCAL_ONLY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(2, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(2, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun localFallbackSummaryReturnsZeroStreakWhenLastReviewIsOlderThanYesterday() {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.DISCONNECTED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )

        val localFallback = createLocalFallbackSummary(
            scopeKey = scopeKey,
            localDayCounts = listOf(
                createProgressLocalDayCount(
                    workspaceId = "workspace-1",
                    localDate = "2026-04-14",
                    reviewCount = 1
                ),
                createProgressLocalDayCount(
                    workspaceId = "workspace-1",
                    localDate = "2026-04-15",
                    reviewCount = 1
                )
            ),
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )

        assertEquals(0, localFallback.currentStreakDays)
        assertEquals(false, localFallback.hasReviewedToday)
        assertEquals("2026-04-15", localFallback.lastReviewedOn)
    }

    @Test
    fun summaryServerBaseUsesMergedOverlayWhenLocalHistoryIsAhead() {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localFallback = CloudProgressSummary(
            currentStreakDays = 10,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 33
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 9,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 32
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(10, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(33, snapshot.renderedSummary.activeReviewDays)
    }
}
