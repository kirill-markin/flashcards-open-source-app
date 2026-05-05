package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ProgressReviewScheduleSnapshotTest {
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

}
