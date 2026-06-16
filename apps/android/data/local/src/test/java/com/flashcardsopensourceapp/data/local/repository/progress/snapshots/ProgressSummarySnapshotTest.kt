package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.repository.progress.createCloudSettings
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressLocalDayCount
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressPendingReviewLocalDate
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
    fun localFallbackSummaryFreezesCompletedMissedDaysBeforeToday() {
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

        assertEquals(4, localFallback.currentStreakDays)
        assertEquals(4, localFallback.longestStreakDays)
        assertEquals(0, localFallback.streakFreeze.availableCredits)
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
            longestStreakDays = 10,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 33,
            streakFreeze = createInitialProgressStreakFreeze(),
            reviewHistoryWatermarks = emptyList()
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 9,
            longestStreakDays = 9,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 32,
            streakFreeze = createInitialProgressStreakFreeze(),
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
    fun summaryServerBaseExtendsLocalTodayAfterFrozenGap() {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localFallback = CloudProgressSummary(
            currentStreakDays = 1,
            longestStreakDays = 1,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 1,
            streakFreeze = createInitialProgressStreakFreeze(),
            reviewHistoryWatermarks = emptyList()
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 3,
            longestStreakDays = 3,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-15",
            activeReviewDays = 30,
            streakFreeze = CloudProgressStreakFreeze(
                availableCredits = 0,
                capacity = 2,
                balanceUnits = 2,
                unitsPerCredit = 10,
                earnedUnitsPerStreakDay = 1,
                nextCreditProgressUnits = 2,
                nextCreditRequiredUnits = 10
            ),
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
        assertEquals(4, snapshot.renderedSummary.currentStreakDays)
        assertEquals(4, snapshot.renderedSummary.longestStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(31, snapshot.renderedSummary.activeReviewDays)
        assertEquals(3, snapshot.renderedSummary.streakFreeze.balanceUnits)
        assertEquals(3, snapshot.renderedSummary.streakFreeze.nextCreditProgressUnits)
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
            longestStreakDays = 200,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 200,
            streakFreeze = createInitialProgressStreakFreeze(),
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
    fun pendingTodayReviewUpdatesServerBaseSummaryAndClampsFreezeCapacity() {
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
        val localFallback = createLocalFallbackSummary(
            scopeKey = summaryScopeKey,
            localDayCounts = emptyList(),
            workspaceIds = listOf("workspace-1"),
            today = LocalDate.parse("2026-04-18")
        )
        val serverWatermarks = createWatermarks(reviewSequenceId = 42L)
        val serverSeries = createSeries(
            scopeKey = seriesScopeKey,
            reviewCountsByDate = emptyMap(),
            reviewHistoryWatermarks = serverWatermarks
        )
        val renderedSeriesContext = createRenderedSeriesContext(
            scopeKey = seriesScopeKey,
            serverBase = serverSeries,
            localFallback = createLocalFallbackSeries(
                scopeKey = seriesScopeKey,
                localDayCounts = emptyList(),
                workspaceIds = listOf("workspace-1")
            ),
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = seriesScopeKey,
                pendingReviewLocalDates = listOf(
                    ProgressPendingReviewLocalDate(
                        workspaceId = "workspace-1",
                        localDate = "2026-04-18",
                        rating = ReviewRating.GOOD
                    )
                ),
                workspaceIds = listOf("workspace-1")
            )
        )
        val serverBase = CloudProgressSummary(
            currentStreakDays = 0,
            longestStreakDays = 0,
            hasReviewedToday = false,
            lastReviewedOn = null,
            activeReviewDays = 0,
            streakFreeze = CloudProgressStreakFreeze(
                availableCredits = 2,
                capacity = 3,
                balanceUnits = 29,
                unitsPerCredit = 10,
                earnedUnitsPerStreakDay = 2,
                nextCreditProgressUnits = 9,
                nextCreditRequiredUnits = 10
            ),
            reviewHistoryWatermarks = serverWatermarks
        )

        val snapshot = createProgressSummarySnapshot(
            scopeKey = summaryScopeKey,
            localFallback = localFallback,
            localFallbackActiveDates = emptySet(),
            serverBase = serverBase,
            renderedSeriesContext = renderedSeriesContext,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(1, snapshot.renderedSummary.currentStreakDays)
        assertEquals(1, snapshot.renderedSummary.longestStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(1, snapshot.renderedSummary.activeReviewDays)
        assertEquals(3, snapshot.renderedSummary.streakFreeze.capacity)
        assertEquals(3, snapshot.renderedSummary.streakFreeze.availableCredits)
        assertEquals(30, snapshot.renderedSummary.streakFreeze.balanceUnits)
        assertEquals(0, snapshot.renderedSummary.streakFreeze.nextCreditProgressUnits)
    }

    @Test
    fun longServerStreakCreditsLocalTodayWithoutRefundingFrozenYesterday() {
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
            longestStreakDays = 200,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 200,
            streakFreeze = createProgressStreakFreezeAfterOneFrozenDay(),
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
        assertEquals(201, snapshot.renderedSummary.currentStreakDays)
        assertEquals(true, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-20", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(201, snapshot.renderedSummary.activeReviewDays)
        assertEquals(1, snapshot.renderedSummary.streakFreeze.availableCredits)
        assertEquals(12, snapshot.renderedSummary.streakFreeze.balanceUnits)
        assertEquals(2, snapshot.renderedSummary.streakFreeze.nextCreditProgressUnits)
    }

    @Test
    fun olderLocalActiveDateDoesNotChangeServerBaseSummary() {
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
            longestStreakDays = 200,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 200,
            streakFreeze = createProgressStreakFreezeAfterOneFrozenDay(),
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

        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(200, snapshot.renderedSummary.currentStreakDays)
        assertEquals(false, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2026-04-18", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(200, snapshot.renderedSummary.activeReviewDays)
        assertEquals(1, snapshot.renderedSummary.streakFreeze.availableCredits)
        assertEquals(11, snapshot.renderedSummary.streakFreeze.balanceUnits)
        assertEquals(1, snapshot.renderedSummary.streakFreeze.nextCreditProgressUnits)
    }

    @Test
    fun localActiveDateOutsideVisibleChartRangeDoesNotChangeServerBaseSummary() {
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
            longestStreakDays = 0,
            hasReviewedToday = false,
            lastReviewedOn = "2025-12-01",
            activeReviewDays = 200,
            streakFreeze = createInitialProgressStreakFreeze(),
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

        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(0, snapshot.renderedSummary.currentStreakDays)
        assertEquals(false, snapshot.renderedSummary.hasReviewedToday)
        assertEquals("2025-12-01", snapshot.renderedSummary.lastReviewedOn)
        assertEquals(200, snapshot.renderedSummary.activeReviewDays)
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
            longestStreakDays = 200,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 200,
            streakFreeze = createInitialProgressStreakFreeze(),
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
    fun disjointVisibleServerAndLocalDatesOnlyApplyTodayStreakDelta() {
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
            longestStreakDays = 0,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-16",
            activeReviewDays = 1,
            streakFreeze = createInitialProgressStreakFreeze(),
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
            longestStreakDays = 1,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 200,
            streakFreeze = createInitialProgressStreakFreeze(),
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
            activeReviewDateSet = createActiveReviewDateSet(
                localFallback = localFallback,
                pendingLocalOverlay = pendingLocalOverlay
            ),
            cloudState = CloudAccountState.LINKED
        ).renderedSeries
        return createProgressRenderedSeriesSummaryContext(
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
            val reviewCount = reviewCountsByDate[localDate] ?: 0
            dailyReviews.add(
                CloudDailyReviewPoint(
                    date = localDate,
                    reviewCount = reviewCount,
                    againCount = 0,
                    hardCount = 0,
                    goodCount = reviewCount,
                    easyCount = 0
                )
            )
            date = date.plusDays(1L)
        }

        return CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = dailyReviews,
            streakDays = createProgressStreakDaysForRange(
                activeReviewDateSet = reviewCountsByDate.filter { entry ->
                    entry.value > 0
                }.keys.toSet(),
                from = scopeKey.from,
                to = scopeKey.to,
                today = LocalDate.parse(scopeKey.to)
            ),
            generatedAt = "2026-04-18T12:00:00Z",
            reviewHistoryWatermarks = reviewHistoryWatermarks,
            summary = null
        )
    }

    private fun createActiveReviewDateSet(
        localFallback: CloudProgressSeries,
        pendingLocalOverlay: CloudProgressSeries
    ): Set<String> {
        return (localFallback.dailyReviews + pendingLocalOverlay.dailyReviews).filter { point ->
            point.reviewCount > 0
        }.map(CloudDailyReviewPoint::date)
            .toSet()
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

    private fun createProgressStreakFreezeAfterOneFrozenDay(): CloudProgressStreakFreeze {
        return CloudProgressStreakFreeze(
            availableCredits = 1,
            capacity = 2,
            balanceUnits = 11,
            unitsPerCredit = 10,
            earnedUnitsPerStreakDay = 1,
            nextCreditProgressUnits = 1,
            nextCreditRequiredUnits = 10
        )
    }
}
