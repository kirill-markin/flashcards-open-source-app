package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class LocalProgressRepositoryTest {
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
    fun localReviewScheduleBucketsUseNonOverlappingCalendarBoundaries() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val today = LocalDate.parse("2026-05-03")
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.DISCONNECTED),
            today = today,
            zoneId = zoneId,
            workspaceIds = listOf("workspace-1")
        )

        val schedule = createLocalFallbackReviewSchedule(
            scopeKey = scopeKey,
            reviewScheduleCards = listOf(
                createReviewScheduleCardDue(
                    cardId = "new",
                    workspaceId = "workspace-1",
                    dueAtMillis = null
                ),
                createReviewScheduleCardDue(
                    cardId = "overdue",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.minusDays(2L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "today-end",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(1L),
                        zoneId = zoneId
                    ) - 1L
                ),
                createReviewScheduleCardDue(
                    cardId = "days-1-start",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(1L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "days-7-end",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(8L),
                        zoneId = zoneId
                    ) - 1L
                ),
                createReviewScheduleCardDue(
                    cardId = "days-8-start",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(8L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "days-30-end",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(31L),
                        zoneId = zoneId
                    ) - 1L
                ),
                createReviewScheduleCardDue(
                    cardId = "days-31-start",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(31L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "days-90-end",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(91L),
                        zoneId = zoneId
                    ) - 1L
                ),
                createReviewScheduleCardDue(
                    cardId = "days-91-start",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(91L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "days-360-end",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(361L),
                        zoneId = zoneId
                    ) - 1L
                ),
                createReviewScheduleCardDue(
                    cardId = "years-1-start",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(361L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "years-2-end",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(721L),
                        zoneId = zoneId
                    ) - 1L
                ),
                createReviewScheduleCardDue(
                    cardId = "later-start",
                    workspaceId = "workspace-1",
                    dueAtMillis = startOfLocalDateMillisForTest(
                        date = today.plusDays(721L),
                        zoneId = zoneId
                    )
                ),
                createReviewScheduleCardDue(
                    cardId = "other-workspace",
                    workspaceId = "workspace-2",
                    dueAtMillis = null
                )
            ),
            workspaceIds = listOf("workspace-1"),
            today = today,
            zoneId = zoneId
        )
        val countsByKey = schedule.buckets.associate { bucket ->
            bucket.key to bucket.count
        }

        assertEquals(14, schedule.totalCards)
        assertEquals(1, countsByKey[ProgressReviewScheduleBucketKey.NEW])
        assertEquals(2, countsByKey[ProgressReviewScheduleBucketKey.TODAY])
        assertEquals(2, countsByKey[ProgressReviewScheduleBucketKey.DAYS_1_TO_7])
        assertEquals(2, countsByKey[ProgressReviewScheduleBucketKey.DAYS_8_TO_30])
        assertEquals(2, countsByKey[ProgressReviewScheduleBucketKey.DAYS_31_TO_90])
        assertEquals(2, countsByKey[ProgressReviewScheduleBucketKey.DAYS_91_TO_360])
        assertEquals(2, countsByKey[ProgressReviewScheduleBucketKey.YEARS_1_TO_2])
        assertEquals(1, countsByKey[ProgressReviewScheduleBucketKey.LATER])
    }

    @Test
    fun reviewScheduleSnapshotUsesServerBaseWhenLocalFallbackDiffersWithoutPendingCardChanges() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )

        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = false,
            pendingCardUpsertOutboxEntries = emptyList(),
            isLocalReviewScheduleScopeHydrated = true,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(false, snapshot.isApproximate)
        assertEquals(serverBase, snapshot.renderedSchedule)
    }

    @Test
    fun missingReviewScheduleServerBaseRendersLocalFallback() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )

        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = null,
            hasPendingScheduleImpactingCardChanges = false,
            pendingCardUpsertOutboxEntries = emptyList(),
            isLocalReviewScheduleScopeHydrated = false,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.LOCAL_ONLY, snapshot.source)
        assertEquals(localFallback, snapshot.renderedSchedule)
    }

    @Test
    fun reviewScheduleSnapshotUsesServerBaseForPendingTextOnlyCardEdit() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-text-edit",
                affectsReviewSchedule = false
            )
        )
        val hasPendingScheduleImpactingCardChanges = hasPendingProgressReviewScheduleCardChanges(
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )

        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = hasPendingScheduleImpactingCardChanges,
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = true,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertFalse(hasPendingScheduleImpactingCardChanges)
        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(serverBase, snapshot.renderedSchedule)
    }

    @Test
    fun reviewScheduleSnapshotUsesLocalOverlayWhenPendingCardChangesExist() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleCreateCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-create",
                cardId = "card-create"
            )
        )
        val hasPendingScheduleImpactingCardChanges = hasPendingProgressReviewScheduleCardChanges(
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            workspaceIds = listOf("workspace-1")
        )

        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = hasPendingScheduleImpactingCardChanges,
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = true,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(localFallback, snapshot.renderedSchedule)
    }

    @Test
    fun reviewScheduleSnapshotUsesLocalOverlayForFullCoveragePendingBucketDecrease() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 1,
            todayCount = 2
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleReviewCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-review",
                cardId = "card-review"
            )
        )
        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = true,
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = true,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(localFallback, snapshot.renderedSchedule)
    }

    @Test
    fun reviewScheduleSnapshotKeepsServerBaseWhenLocalScopeIsNotHydrated() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 1,
            todayCount = 2
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleReviewCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-review",
                cardId = "card-review"
            )
        )
        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = true,
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = false,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(serverBase, snapshot.renderedSchedule)
    }

    @Test
    fun reviewScheduleSnapshotUsesLocalOverlayForFullCoveragePendingDelete() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 0,
            todayCount = 1
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleDeleteCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-delete",
                cardId = "card-delete"
            )
        )
        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = true,
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = true,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY, snapshot.source)
        assertEquals(localFallback, snapshot.renderedSchedule)
    }

    @Test
    fun reviewScheduleSnapshotKeepsServerBaseWhenPendingLocalFallbackWouldDropServerBuckets() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val localFallback = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 2,
            todayCount = 1
        )
        val serverBase = createReviewSchedule(
            timeZone = scopeKey.timeZone,
            newCount = 12,
            todayCount = 5
        )

        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleReviewCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-review",
                cardId = "card-review"
            )
        )

        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = scopeKey,
            localFallback = localFallback,
            serverBase = serverBase,
            hasPendingScheduleImpactingCardChanges = true,
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = true,
            workspaceIds = listOf("workspace-1"),
            cloudState = CloudAccountState.LINKED
        )

        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(true, snapshot.isApproximate)
        assertEquals(serverBase, snapshot.renderedSchedule)
    }

    @Test
    fun pendingReviewScheduleCardChangesOnlyCountScheduleImpactingIncludedWorkspaceCardUpserts() {
        assertTrue(
            hasPendingProgressReviewScheduleCardChanges(
                pendingCardUpsertOutboxEntries = listOf(
                    createPendingCardUpsertOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-card-create",
                        affectsReviewSchedule = true
                    ),
                    createPendingCardUpsertOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-card-delete",
                        affectsReviewSchedule = true
                    ),
                    createPendingCardUpsertOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-card-review",
                        affectsReviewSchedule = true
                    )
                ),
                workspaceIds = listOf("workspace-1")
            )
        )

        assertFalse(
            hasPendingProgressReviewScheduleCardChanges(
                pendingCardUpsertOutboxEntries = listOf(
                    createPendingCardUpsertOutboxEntry(
                        workspaceId = "workspace-2",
                        outboxEntryId = "outbox-card-2",
                        affectsReviewSchedule = true
                    ),
                    createPendingCardUpsertOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-card-text-edit",
                        affectsReviewSchedule = false
                    ),
                    createPendingReviewOutboxEntry(
                        workspaceId = "workspace-1",
                        outboxEntryId = "outbox-review-1",
                        reviewedAtClient = "2026-04-18T10:00:00Z"
                    )
                ),
                workspaceIds = listOf("workspace-1")
            )
        )
    }

    @Test
    fun reviewScheduleScopeKeyIncludesStableSortedWorkspaceMembership() {
        val firstScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-2", "workspace-1")
        )
        val secondScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val reducedMembershipScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )

        assertEquals(firstScopeKey, secondScopeKey)
        assertEquals("workspace-1|workspace-2", firstScopeKey.workspaceMembershipKey)
        assertTrue(
            serializeProgressReviewScheduleScopeKey(scopeKey = firstScopeKey) !=
                serializeProgressReviewScheduleScopeKey(scopeKey = reducedMembershipScopeKey)
        )
    }

    @Test
    fun reviewScheduleServerCacheKeyIgnoresWorkspaceMembership() {
        val firstScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-2", "workspace-1")
        )
        val reducedMembershipScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )

        assertTrue(firstScopeKey != reducedMembershipScopeKey)
        assertTrue(
            serializeProgressReviewScheduleScopeKey(scopeKey = firstScopeKey) !=
                serializeProgressReviewScheduleScopeKey(scopeKey = reducedMembershipScopeKey)
        )
        assertEquals(
            serializeProgressReviewScheduleServerCacheKey(scopeKey = firstScopeKey),
            serializeProgressReviewScheduleServerCacheKey(scopeKey = reducedMembershipScopeKey)
        )
    }

    @Test
    fun reviewScheduleServerBaseCacheIsReusedAcrossWorkspaceMembershipChanges() {
        val cachedScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val currentScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val serverBase = createReviewSchedule(
            timeZone = cachedScopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val cacheEntity = serverBase.toCacheEntity(
            scopeKey = cachedScopeKey,
            updatedAtMillis = 1L
        )

        assertEquals(
            serializeProgressReviewScheduleServerCacheKey(scopeKey = cachedScopeKey),
            cacheEntity.scopeKey
        )
        assertEquals(
            serverBase,
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(cacheEntity),
                scopeKey = currentScopeKey
            )
        )
    }

    @Test
    fun legacyReviewScheduleServerBaseCacheIsReusedAcrossWorkspaceMembershipChanges() {
        val cachedScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val currentScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val serverBase = createReviewSchedule(
            timeZone = cachedScopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val legacyCacheEntity = serverBase.toCacheEntity(
            scopeKey = cachedScopeKey,
            updatedAtMillis = 1L
        ).copy(
            scopeKey = serializeProgressReviewScheduleScopeKey(scopeKey = cachedScopeKey)
        )

        assertEquals(
            serverBase,
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(legacyCacheEntity),
                scopeKey = currentScopeKey
            )
        )
    }

    @Test
    fun reviewScheduleOverlayCoverageUsesCurrentWorkspaceMembershipAfterServerCacheReuse() {
        val cachedScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val currentWorkspaceIds = listOf("workspace-1", "workspace-2")
        val currentScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = currentWorkspaceIds
        )
        val serverBase = createReviewSchedule(
            timeZone = cachedScopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val resolvedServerBase = requireNotNull(
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(
                    serverBase.toCacheEntity(
                        scopeKey = cachedScopeKey,
                        updatedAtMillis = 1L
                    )
                ),
                scopeKey = currentScopeKey
            )
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleReviewCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-review",
                cardId = "card-review"
            )
        )
        val isLocalReviewScheduleScopeHydrated = isProgressReviewScheduleLocalScopeHydrated(
            syncStates = listOf(
                createSyncState(
                    workspaceId = "workspace-1",
                    hasHydratedHotState = true
                )
            ),
            workspaceIds = currentWorkspaceIds
        )
        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = currentScopeKey,
            localFallback = createReviewSchedule(
                timeZone = currentScopeKey.timeZone,
                newCount = 0,
                todayCount = 2
            ),
            serverBase = resolvedServerBase,
            hasPendingScheduleImpactingCardChanges = hasPendingProgressReviewScheduleCardChanges(
                pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
                workspaceIds = currentWorkspaceIds
            ),
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = isLocalReviewScheduleScopeHydrated,
            workspaceIds = currentWorkspaceIds,
            cloudState = CloudAccountState.LINKED
        )

        assertFalse(isLocalReviewScheduleScopeHydrated)
        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(resolvedServerBase, snapshot.renderedSchedule)
    }

    @Test
    fun pendingReviewScheduleCardDrainThenSyncSuccessRequestsRefresh() {
        val scopeKey = "linked:user-1::Europe/Madrid::workspace-1::2026-05-03"
        val pendingResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = null,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::outbox-1",
            hasPendingScheduleImpactingCardChanges = true,
            currentSuccessfulSyncAtMillis = 10L
        )
        val drainedResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = pendingResult.state,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 10L
        )
        val syncedResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = drainedResult.state,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 20L
        )

        assertFalse(pendingResult.shouldRefresh)
        assertFalse(drainedResult.shouldRefresh)
        assertTrue(syncedResult.shouldRefresh)
    }

    @Test
    fun pendingReviewScheduleCardSyncSuccessThenDrainRequestsRefresh() {
        val scopeKey = "linked:user-1::Europe/Madrid::workspace-1::2026-05-03"
        val pendingResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = null,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::outbox-1",
            hasPendingScheduleImpactingCardChanges = true,
            currentSuccessfulSyncAtMillis = 10L
        )
        val syncedWhilePendingResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = pendingResult.state,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::outbox-1",
            hasPendingScheduleImpactingCardChanges = true,
            currentSuccessfulSyncAtMillis = 20L
        )
        val drainedResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = syncedWhilePendingResult.state,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 20L
        )

        assertFalse(pendingResult.shouldRefresh)
        assertFalse(syncedWhilePendingResult.shouldRefresh)
        assertTrue(drainedResult.shouldRefresh)
    }

    @Test
    fun reviewScheduleFingerprintChangeAndSyncSuccessRequestsRefreshWithoutObservedPending() {
        val scopeKey = "linked:user-1::Europe/Madrid::workspace-1::2026-05-03"
        val initialResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = null,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-before::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 10L
        )
        val syncedResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = initialResult.state,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-after::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 20L
        )

        assertFalse(initialResult.shouldRefresh)
        assertTrue(syncedResult.shouldRefresh)
    }

    @Test
    fun reviewScheduleSyncCompletionDoesNotRefreshWhenFingerprintIsUnchanged() {
        val scopeKey = "linked:user-1::Europe/Madrid::workspace-1::2026-05-03"
        val initialResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = null,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 10L
        )
        val syncedResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = initialResult.state,
            serializedScopeKey = scopeKey,
            reviewScheduleFingerprint = "cards-1::",
            hasPendingScheduleImpactingCardChanges = false,
            currentSuccessfulSyncAtMillis = 20L
        )

        assertFalse(syncedResult.shouldRefresh)
        assertFalse(
            didSyncCompleteWithReviewScheduleChange(
                previousSuccessfulSyncAtMillis = 10L,
                currentSuccessfulSyncAtMillis = 20L,
                previousReviewScheduleFingerprint = "cards-1::",
                currentReviewScheduleFingerprint = "cards-1::"
            )
        )
    }

    @Test
    fun syncCompletionInvalidatesOnlyWhenReviewHistoryFingerprintChanges() {
        assertTrue(
            didSyncCompleteWithReviewHistoryChange(
                previousSuccessfulSyncAtMillis = 10L,
                currentSuccessfulSyncAtMillis = 20L,
                previousReviewHistoryFingerprint = "review-1",
                currentReviewHistoryFingerprint = "review-2"
            )
        )
        assertEquals(
            false,
            didSyncCompleteWithReviewHistoryChange(
                previousSuccessfulSyncAtMillis = 10L,
                currentSuccessfulSyncAtMillis = 20L,
                previousReviewHistoryFingerprint = "review-1",
                currentReviewHistoryFingerprint = "review-1"
            )
        )
    }

    @Test
    fun reviewHistoryFingerprintIncludesPendingOutboxAndSyncSequenceState() {
        val fingerprint = createReviewHistoryFingerprint(
            reviewHistoryStates = listOf(
                createProgressReviewHistoryState(
                    workspaceId = "workspace-1",
                    historyVersion = 3L
                )
            ),
            pendingReviewEntries = listOf(
                ProgressPendingReviewFingerprintEntry(
                    workspaceId = "workspace-1",
                    outboxEntryId = "outbox-1"
                )
            ),
            syncStates = listOf(
                SyncStateEntity(
                    workspaceId = "workspace-1",
                    lastSyncCursor = null,
                    lastReviewSequenceId = 7L,
                    hasHydratedHotState = true,
                    hasHydratedReviewHistory = true,
                    pendingReviewHistoryImport = false,
                    lastSyncAttemptAtMillis = null,
                    lastSuccessfulSyncAtMillis = null,
                    lastSyncError = null,
                    blockedInstallationId = null
                )
            ),
            workspaceIds = listOf("workspace-1")
        )

        assertTrue(fingerprint.contains("outbox-1"))
        assertTrue(fingerprint.contains("workspace-1:7"))
        assertTrue(fingerprint.contains("workspace-1:3"))
    }

    @Test
    fun localCacheReadyRequiresMatchingHistoryVersionForCurrentTimeZone() {
        assertTrue(
            isProgressLocalCacheReady(
                reviewHistoryStates = listOf(
                    createProgressReviewHistoryState(
                        workspaceId = "workspace-1",
                        historyVersion = 5L
                    )
                ),
                localCacheStates = listOf(
                    createProgressLocalCacheState(
                        workspaceId = "workspace-1",
                        historyVersion = 5L,
                        timeZone = "Europe/Madrid"
                    )
                ),
                workspaceIds = listOf("workspace-1"),
                timeZone = "Europe/Madrid"
            )
        )

        assertEquals(
            false,
            isProgressLocalCacheReady(
                reviewHistoryStates = listOf(
                    createProgressReviewHistoryState(
                        workspaceId = "workspace-1",
                        historyVersion = 5L
                    )
                ),
                localCacheStates = listOf(
                    createProgressLocalCacheState(
                        workspaceId = "workspace-1",
                        historyVersion = 4L,
                        timeZone = "Europe/Madrid"
                    )
                ),
                workspaceIds = listOf("workspace-1"),
                timeZone = "Europe/Madrid"
            )
        )
    }

    @Test
    fun overlappingRefreshForSameScopeQueuesRetryInsteadOfDroppingIt() = runTest {
        val coordinator = ProgressRefreshCoordinator()

        val initialRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
        )
        val overlappingRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
        )
        val queuedSyncMode = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val thirdRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
        )
        val queuedRetryFromThirdRequest = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val noFurtherRetryQueued = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val nextIndependentRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
        )

        assertTrue(initialRefreshStarted)
        assertFalse(overlappingRefreshStarted)
        assertEquals(ProgressRemoteRefreshSyncMode.SKIP_SYNC, queuedSyncMode)
        assertFalse(thirdRefreshStarted)
        assertEquals(ProgressRemoteRefreshSyncMode.SKIP_SYNC, queuedRetryFromThirdRequest)
        assertEquals(null, noFurtherRetryQueued)
        assertTrue(nextIndependentRefreshStarted)
    }

    @Test
    fun overlappingRefreshKeepsQueuedSyncRequirementWhenAnyPendingRequestNeedsIt() = runTest {
        val coordinator = ProgressRefreshCoordinator()

        val initialRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
        )
        val syncCompletedRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
        )
        val manualRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            syncMode = ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD
        )
        val queuedSyncMode = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val finalQueuedRefresh = coordinator.completeRefreshIteration(scopeKey = "scope-1")

        assertTrue(initialRefreshStarted)
        assertFalse(syncCompletedRefreshStarted)
        assertFalse(manualRefreshStarted)
        assertEquals(ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD, queuedSyncMode)
        assertEquals(null, finalQueuedRefresh)
    }

    @Test
    fun invalidSummaryCacheLastReviewedOnIsIgnored() {
        val cacheEntity = ProgressSummaryCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            generatedAt = "2026-04-18T10:00:00Z",
            currentStreakDays = 2,
            hasReviewedToday = true,
            lastReviewedOn = "not-a-date",
            activeReviewDays = 4,
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressSummaryOrNull())
    }

    @Test
    fun invalidSeriesCacheJsonIsIgnored() {
        val cacheEntity = ProgressSeriesCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            fromLocalDate = "2026-04-01",
            toLocalDate = "2026-04-18",
            generatedAt = "2026-04-18T10:00:00Z",
            dailyReviewsJson = "{not-json}",
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressSeriesOrNull())
    }

    @Test
    fun invalidReviewScheduleCacheBucketOrderIsIgnored() {
        val cacheEntity = ProgressReviewScheduleCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-05-03",
            generatedAt = "2026-05-03T10:00:00Z",
            totalCards = 1,
            bucketsJson = """[{"key":"today","count":1},{"key":"new","count":0}]""",
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressReviewScheduleOrNull())
    }

    @Test
    fun mismatchedReviewScheduleResponseTimeZoneIsRejected() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            validateProgressReviewScheduleResponseTimeZone(
                schedule = createReviewSchedule(
                    timeZone = "UTC",
                    newCount = 0,
                    todayCount = 0
                ),
                scopeKey = scopeKey
            )
        }

        assertTrue(error.message.orEmpty().contains("UTC"))
        assertTrue(error.message.orEmpty().contains("Europe/Madrid"))
    }

    @Test
    fun mismatchedReviewScheduleCacheTimeZoneIsIgnoredForScope() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val cacheEntity = ProgressReviewScheduleCacheEntity(
            scopeKey = serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey),
            scopeId = scopeKey.scopeId,
            timeZone = "UTC",
            referenceLocalDate = scopeKey.referenceLocalDate,
            generatedAt = "2026-05-03T10:00:00Z",
            totalCards = 0,
            bucketsJson = """[]""",
            updatedAtMillis = 1L
        )

        assertEquals(
            null,
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(cacheEntity),
                scopeKey = scopeKey
            )
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
}

private fun createCloudSettings(
    cloudState: CloudAccountState
): CloudSettings {
    return CloudSettings(
        installationId = "installation-1",
        cloudState = cloudState,
        linkedUserId = "user-1",
        linkedWorkspaceId = "workspace-1",
        linkedEmail = "user@example.com",
        activeWorkspaceId = "workspace-1",
        updatedAtMillis = 0L
    )
}

private fun createProgressLocalDayCount(
    workspaceId: String,
    localDate: String,
    reviewCount: Int
): ProgressLocalDayCountEntity {
    return ProgressLocalDayCountEntity(
        timeZone = "Europe/Madrid",
        workspaceId = workspaceId,
        localDate = localDate,
        reviewCount = reviewCount
    )
}

private fun createProgressReviewHistoryState(
    workspaceId: String,
    historyVersion: Long
): ProgressReviewHistoryStateEntity {
    return ProgressReviewHistoryStateEntity(
        workspaceId = workspaceId,
        historyVersion = historyVersion,
        reviewLogCount = historyVersion.toInt(),
        maxReviewedAtMillis = historyVersion
    )
}

private fun createProgressLocalCacheState(
    workspaceId: String,
    historyVersion: Long,
    timeZone: String
): ProgressLocalCacheStateEntity {
    return ProgressLocalCacheStateEntity(
        timeZone = timeZone,
        workspaceId = workspaceId,
        historyVersion = historyVersion,
        updatedAtMillis = historyVersion
    )
}

private fun createSyncState(
    workspaceId: String,
    hasHydratedHotState: Boolean
): SyncStateEntity {
    return SyncStateEntity(
        workspaceId = workspaceId,
        lastSyncCursor = null,
        lastReviewSequenceId = 0L,
        hasHydratedHotState = hasHydratedHotState,
        hasHydratedReviewHistory = true,
        pendingReviewHistoryImport = false,
        lastSyncAttemptAtMillis = null,
        lastSuccessfulSyncAtMillis = null,
        lastSyncError = null,
        blockedInstallationId = null
    )
}

private fun createReviewScheduleCardDue(
    cardId: String,
    workspaceId: String,
    dueAtMillis: Long?
): ProgressReviewScheduleCardDueEntity {
    return ProgressReviewScheduleCardDueEntity(
        cardId = cardId,
        workspaceId = workspaceId,
        dueAtMillis = dueAtMillis
    )
}

private fun startOfLocalDateMillisForTest(
    date: LocalDate,
    zoneId: ZoneId
): Long {
    return date.atStartOfDay(zoneId).toInstant().toEpochMilli()
}

private fun createReviewSchedule(
    timeZone: String,
    newCount: Int,
    todayCount: Int
): CloudProgressReviewSchedule {
    val buckets = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
        CloudProgressReviewScheduleBucket(
            key = key,
            count = when (key) {
                ProgressReviewScheduleBucketKey.NEW -> newCount
                ProgressReviewScheduleBucketKey.TODAY -> todayCount
                ProgressReviewScheduleBucketKey.DAYS_1_TO_7,
                ProgressReviewScheduleBucketKey.DAYS_8_TO_30,
                ProgressReviewScheduleBucketKey.DAYS_31_TO_90,
                ProgressReviewScheduleBucketKey.DAYS_91_TO_360,
                ProgressReviewScheduleBucketKey.YEARS_1_TO_2,
                ProgressReviewScheduleBucketKey.LATER -> 0
            }
        )
    }

    return CloudProgressReviewSchedule(
        timeZone = timeZone,
        generatedAt = null,
        totalCards = buckets.sumOf(CloudProgressReviewScheduleBucket::count),
        buckets = buckets
    )
}

private fun createPendingReviewOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    reviewedAtClient: String
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = "installation-1",
        entityType = "review_event",
        entityId = "review-1",
        operationType = "append",
        payloadJson = """{"reviewEventId":"review-1","cardId":"card-1","clientEventId":"client-1","rating":2,"reviewedAtClient":"$reviewedAtClient"}""",
        clientUpdatedAtIso = "2026-04-18T10:00:00Z",
        createdAtMillis = 0L,
        affectsReviewSchedule = false,
        attemptCount = 0,
        lastError = null
    )
}

private fun createPendingCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    affectsReviewSchedule: Boolean
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = "installation-1",
        entityType = "card",
        entityId = "card-1",
        operationType = "upsert",
        payloadJson = """{"cardId":"card-1","frontText":"Front","backText":"Back","dueAt":null,"deletedAt":null,"tags":[]}""",
        clientUpdatedAtIso = "2026-04-18T10:00:00Z",
        createdAtMillis = 0L,
        affectsReviewSchedule = affectsReviewSchedule,
        attemptCount = 0,
        lastError = null
    )
}

private fun createPendingScheduleCreateCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String
): OutboxEntryEntity {
    return createPendingScheduleCardUpsertOutboxEntry(
        workspaceId = workspaceId,
        outboxEntryId = outboxEntryId,
        cardId = cardId,
        createdAt = "2026-04-18T10:00:00Z",
        clientUpdatedAt = "2026-04-18T10:00:00Z",
        deletedAt = null
    )
}

private fun createPendingScheduleReviewCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String
): OutboxEntryEntity {
    return createPendingScheduleCardUpsertOutboxEntry(
        workspaceId = workspaceId,
        outboxEntryId = outboxEntryId,
        cardId = cardId,
        createdAt = "2026-04-01T10:00:00Z",
        clientUpdatedAt = "2026-04-18T10:00:00Z",
        deletedAt = null
    )
}

private fun createPendingScheduleDeleteCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String
): OutboxEntryEntity {
    return createPendingScheduleCardUpsertOutboxEntry(
        workspaceId = workspaceId,
        outboxEntryId = outboxEntryId,
        cardId = cardId,
        createdAt = "2026-04-01T10:00:00Z",
        clientUpdatedAt = "2026-04-18T10:00:00Z",
        deletedAt = "2026-04-18T10:00:00Z"
    )
}

private fun createPendingScheduleCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String,
    createdAt: String,
    clientUpdatedAt: String,
    deletedAt: String?
): OutboxEntryEntity {
    val deletedAtJson = deletedAt?.let { value -> "\"$value\"" } ?: "null"
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = "installation-1",
        entityType = "card",
        entityId = cardId,
        operationType = "upsert",
        payloadJson = """{"cardId":"$cardId","createdAt":"$createdAt","deletedAt":$deletedAtJson}""",
        clientUpdatedAtIso = clientUpdatedAt,
        createdAtMillis = 0L,
        affectsReviewSchedule = true,
        attemptCount = 0,
        lastError = null
    )
}
