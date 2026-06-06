package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.repository.progress.createCloudSettings
import com.flashcardsopensourceapp.data.local.repository.progress.createPendingReviewOutboxEntry
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressPendingReviewLocalDates
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

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
                com.flashcardsopensourceapp.data.local.repository.progress.createProgressLocalDayCount(
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
        val scopeKey = createLinkedProgressSeriesScopeKey()
        val localFallback = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-17",
                    reviewCount = 3
                ),
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 2
                )
            ),
            generatedAt = null
        )
        val serverBase = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-17",
                    reviewCount = 3
                ),
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 2
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z"
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
    fun staleServerBaseRendersAckedCanonicalLocalReview() {
        val scopeKey = createLinkedProgressSeriesScopeKey()
        val localFallback = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = null
        )
        val serverBase = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 0
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z"
        )
        val pendingLocalOverlay = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 0
                )
            ),
            generatedAt = null
        )

        val snapshot = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(1, snapshot.renderedSeries.dailyReviews.single().reviewCount)
        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals("2026-04-18T12:00:00Z", snapshot.renderedSeries.generatedAt)
        assertEquals(null, snapshot.renderedSeries.summary)
    }

    @Test
    fun serverCatchUpDoesNotDoubleCountCanonicalLocalReview() {
        val scopeKey = createLinkedProgressSeriesScopeKey()
        val localFallback = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = null
        )
        val serverBase = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z"
        )
        val pendingLocalOverlay = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 0
                )
            ),
            generatedAt = null
        )

        val snapshot = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(1, snapshot.renderedSeries.dailyReviews.single().reviewCount)
        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(false, snapshot.isApproximate)
    }

    @Test
    fun mixedServerPendingAndCanonicalLocalCountsUseLargestSafeCount() {
        val scopeKey = createLinkedProgressSeriesScopeKey()
        val localFallback = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 2
                )
            ),
            generatedAt = null
        )
        val serverBase = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 2
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z"
        )
        val pendingLocalOverlay = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = null
        )

        val snapshot = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(3, snapshot.renderedSeries.dailyReviews.single().reviewCount)
        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
    }

    @Test
    fun serverBaseSourceWhenLocalFallbackIsNotAheadAndPendingOverlayIsEmpty() {
        val scopeKey = createLinkedProgressSeriesScopeKey()
        val localFallback = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = null
        )
        val serverBase = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 2
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z"
        )
        val pendingLocalOverlay = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 0
                )
            ),
            generatedAt = null
        )

        val snapshot = createProgressSeriesSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(2, snapshot.renderedSeries.dailyReviews.single().reviewCount)
        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(false, snapshot.isApproximate)
    }

    @Test
    fun seriesMergeRequiresMatchingScopes() {
        val scopeKey = createLinkedProgressSeriesScopeKey()
        val base = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = "2026-04-18T12:00:00Z"
        )
        val pendingLocalOverlay = createSeries(
            scopeKey = scopeKey.copy(timeZone = "UTC"),
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 0
                )
            ),
            generatedAt = null
        )
        val localFallback = createSeries(
            scopeKey = scopeKey,
            dailyReviews = listOf(
                createPoint(
                    date = "2026-04-18",
                    reviewCount = 1
                )
            ),
            generatedAt = null
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            mergeProgressSeries(
                base = base,
                pendingLocalOverlay = pendingLocalOverlay,
                localFallback = localFallback
            )
        }

        assertEquals(
            "Progress series merge inputs must share the same scope. " +
                "Mismatches: timeZone base='Europe/Madrid' pendingLocalOverlay='UTC'.",
            error.message
        )
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

    private fun createLinkedProgressSeriesScopeKey(): ProgressSeriesScopeKey {
        return createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
    }

    private fun createSeries(
        scopeKey: ProgressSeriesScopeKey,
        dailyReviews: List<CloudDailyReviewPoint>,
        generatedAt: String?
    ): CloudProgressSeries {
        return CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = dailyReviews,
            generatedAt = generatedAt,
            reviewHistoryWatermarks = emptyList(),
            summary = null
        )
    }

    private fun createPoint(
        date: String,
        reviewCount: Int
    ): CloudDailyReviewPoint {
        return CloudDailyReviewPoint(
            date = date,
            reviewCount = reviewCount
        )
    }
}
