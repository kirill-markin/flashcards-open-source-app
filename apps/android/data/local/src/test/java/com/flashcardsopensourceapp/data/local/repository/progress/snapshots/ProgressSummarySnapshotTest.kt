package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.repository.progress.createCloudSettings
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressLocalDayCount
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

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
            localFallbackActiveDates = setOf("2026-04-17", "2026-04-18"),
            serverBase = null,
            renderedSeriesContext = null,
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
            activeReviewDays = 33,
            reviewHistoryWatermarks = emptyList()
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 9,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 32,
            reviewHistoryWatermarks = emptyList()
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-18"),
            serverBase = serverBase,
            renderedSeriesContext = null,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(10, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(33, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun longServerStreakExtendsWithLocalToday() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-18",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = mapOf("2026-04-17" to 1),
            reviewHistoryWatermarks = serverWatermarks
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 200,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 200,
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-18"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(201, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(201, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun longServerStreakExtendsThroughConsecutiveLocalDates() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-20"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-20"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-19",
                reviewCount = 1
            ),
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-20",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-20")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = mapOf("2026-04-18" to 1),
            reviewHistoryWatermarks = serverWatermarks
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 200,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 200,
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-19", "2026-04-20"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(202, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-20", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(202, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun longServerStreakExtendsToYesterdayWhenTodayHasNoReview() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-20"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-20"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-19",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-20")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = mapOf("2026-04-18" to 1),
            reviewHistoryWatermarks = serverWatermarks
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 200,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 200,
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-19"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(201, snapshot.renderedSummary.currentStreakDays)
        assertEquals(false, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-19", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(201, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun localActiveDateOutsideVisibleChartRangeExtendsActiveDays() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2025-12-02",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = emptyMap(),
            reviewHistoryWatermarks = serverWatermarks
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 0,
            hasReviewedToday = false,
            lastReviewedOn = "2025-12-01",
            activeReviewDays = 200,
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2025-12-02"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(0, snapshot.renderedSummary.currentStreakDays)
        assertEquals(false, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2025-12-02", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(201, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun serverTodayDoesNotDoubleCountLocalToday() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-18",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = mapOf("2026-04-18" to 1),
            reviewHistoryWatermarks = serverWatermarks
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 200,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 200,
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-18"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(200, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(200, snapshot.renderedSummary.activeReviewDays)
    }

    @Test
    fun disjointVisibleServerAndLocalDatesKeepSummaryConsistentWithRenderedSeries() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-18",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = mapOf("2026-04-16" to 1),
            reviewHistoryWatermarks = serverWatermarks
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 0,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-16",
            activeReviewDays = 1,
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-18"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(1, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(2, snapshot.renderedSummary.activeReviewDays)
        assertEquals(2, renderedSeriesContext.activeDates.size)
    }

    @Test
    fun missingWatermarksApplyOnlyDatesAfterServerLastReviewedOn() {
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localDayCounts = listOf(
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-16",
                reviewCount = 1
            ),
            createProgressLocalDayCount(
                workspaceId = "workspace-1",
                localDate = "2026-04-18",
                reviewCount = 1
            )
        )
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = emptyMap(),
            reviewHistoryWatermarks = emptyList()
        )
        val localFallbackSeries = createLocalFallbackSeries(
            scopeKey = seriesScopeKey,
            localDayCounts = localDayCounts,
            workspaceIds = listOf("workspace-1")
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = localFallbackSeries,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 1,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 200,
            reviewHistoryWatermarks = emptyList()
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = setOf("2026-04-16", "2026-04-18"),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(2, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(201, snapshot.renderedSummary.activeReviewDays)
    }

    private fun createRenderedSeriesContext(
        scopeKey: ProgressSeriesScopeKey,
        serverBase: CloudProgressSeries,
        localFallback: CloudProgressSeries,
        pendingLocalOverlay: CloudProgressSeries
    ): ProgressRenderedSeriesSummaryContext {
        val renderedSeries = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            cloudState = CloudAccountState.LINKED
        ).renderedSeries
        return createProgressRenderedSeriesSummaryContext(
            serverBase = serverBase,
            scopeKey = scopeKey,
            renderedSeries = renderedSeries
        )
    }

    private fun createSeries(
        scopeKey: ProgressSeriesScopeKey,
        reviewCountsByDate: Map<String, Int>,
        reviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>
    ): CloudProgressSeries {
        val dailyReviews = mutableListOf<CloudDailyReviewPoint>()
        var date = LocalDate.parse(scopeKey.from)
        val endDate = LocalDate.parse(scopeKey.to)
        while (date <= endDate) {
            val localDate = date.toString()
            dailyReviews.add(
                CloudDailyReviewPoint(
                    date = localDate,
                    reviewCount = reviewCountsByDate[localDate] ?: 0
                )
            )
            date = date.plusDays(1L)
        }

        return CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = dailyReviews,
            generatedAt = "2026-04-18T12:00:00Z",
            reviewHistoryWatermarks = reviewHistoryWatermarks,
            summary = null
        )
    }

    private fun createWatermarks(
        reviewSequenceId: Long
    ): List<ProgressReviewHistoryWatermark> {
        return listOf(
            ProgressReviewHistoryWatermark(
                workspaceId = "workspace-1",
                reviewSequenceId = reviewSequenceId
            )
        )
    }
}
