package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class ProgressSeriesSnapshotTest {
    @Test
    fun missingSeriesServerBaseRendersLocalFallbackAsApproximateLocalOnly() {
        val scopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.DISCONNECTED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localFallback = createLocalFallbackSeries(
            scopeKey = scopeKey,
            localDayCounts = listOf(
                createProgressLocalDayCount(
                    workspaceId = "workspace-1",
                    localDate = Instant.parse("2026-04-18T10:00:00Z")
                        .atZone(ZoneId.of("Europe/Madrid"))
                        .toLocalDate()
                        .toString(),
                    reviewCount = 1
                )
            ),
            workspaceIds = listOf("workspace-1")
        )

        val snapshot = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = null,
            pendingLocalOverlay = createPendingLocalOverlaySeries(
                scopeKey = scopeKey,
                pendingReviewLocalDates = emptyList(),
                workspaceIds = listOf("workspace-1")
            ),
            cloudState = CloudAccountState.DISCONNECTED
        )

        assertEquals(ProgressSnapshotSource.LOCAL_ONLY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(localFallback, snapshot.renderedSeries)
    }

    @Test
    fun pendingOverlayCountsUnsyncedLocalReviewsDirectly() {
        val scopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val localFallback = CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = listOf(
                CloudDailyReviewPoint(
                    date = "2026-04-17",
                    reviewCount = 5
                ),
                CloudDailyReviewPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = null,
            summary = null
        )
        val serverBase = CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = listOf(
                CloudDailyReviewPoint(
                    date = "2026-04-17",
                    reviewCount = 3
                ),
                CloudDailyReviewPoint(
                    date = "2026-04-18",
                    reviewCount = 2
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z",
            summary = null
        )

        val overlay = createPendingLocalOverlaySeries(
            scopeKey = scopeKey,
            pendingReviewLocalDates = createProgressPendingReviewLocalDates(
                pendingReviewOutboxEntries = listOf(
                    createPendingReviewOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-1",
                        reviewedAtClient = "2026-04-18T10:00:00Z"
                    )
                ),
                workspaceIds = listOf("workspace-1"),
                timeZone = scopeKey.timeZone
            ),
            workspaceIds = listOf("workspace-1")
        )
        val snapshot = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            pendingLocalOverlay = overlay,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(0, overlay.dailyReviews.first().reviewCount)
        assertEquals(1, overlay.dailyReviews.last().reviewCount)
        assertEquals(3, snapshot.renderedSeries.dailyReviews.first().reviewCount)
        assertEquals(3, snapshot.renderedSeries.dailyReviews.last().reviewCount)
        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
    }

    @Test
    fun invalidPendingReviewOutboxEntryIsSkippedFromOverlay() {
        val scopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )

        val overlay = createPendingLocalOverlaySeries(
            scopeKey = scopeKey,
            pendingReviewLocalDates = createProgressPendingReviewLocalDates(
                pendingReviewOutboxEntries = listOf(
                    createPendingReviewOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-valid",
                        reviewedAtClient = "2026-04-18T10:00:00Z"
                    ),
                    createPendingReviewOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-invalid",
                        reviewedAtClient = "not-an-instant"
                    )
                ),
                workspaceIds = listOf("workspace-1"),
                timeZone = scopeKey.timeZone
            ),
            workspaceIds = listOf("workspace-1")
        )

        assertEquals(
            1,
            overlay.dailyReviews.last { point -> point.date == scopeKey.to }.reviewCount
        )
    }
}
