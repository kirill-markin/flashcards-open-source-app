package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
                pendingReviewOutboxEntries = emptyList(),
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
            pendingReviewOutboxEntries = listOf(
                createPendingReviewOutboxEntry(
                    workspaceId = "workspace-1",
                    outboxEntryId = "outbox-1",
                    reviewedAtClient = "2026-04-18T10:00:00Z"
                )
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
            pendingReviewOutboxEntries = listOf(
                createPendingReviewOutboxEntry(workspaceId = "workspace-1", outboxEntryId = "outbox-1")
            ),
            syncStates = listOf(
                SyncStateEntity(
                    workspaceId = "workspace-1",
                    lastSyncCursor = null,
                    lastReviewSequenceId = 7L,
                    hasHydratedHotState = true,
                    hasHydratedReviewHistory = true,
                    lastSyncAttemptAtMillis = null,
                    lastSuccessfulSyncAtMillis = null,
                    lastSyncError = null
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
            requiresSyncBeforeRemoteLoad = false
        )
        val overlappingRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            requiresSyncBeforeRemoteLoad = false
        )
        val queuedRequiresSyncBeforeRemoteLoad = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val thirdRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            requiresSyncBeforeRemoteLoad = false
        )
        val queuedRetryFromThirdRequest = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val noFurtherRetryQueued = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val nextIndependentRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            requiresSyncBeforeRemoteLoad = false
        )

        assertTrue(initialRefreshStarted)
        assertFalse(overlappingRefreshStarted)
        assertEquals(false, queuedRequiresSyncBeforeRemoteLoad)
        assertFalse(thirdRefreshStarted)
        assertEquals(false, queuedRetryFromThirdRequest)
        assertEquals(null, noFurtherRetryQueued)
        assertTrue(nextIndependentRefreshStarted)
    }

    @Test
    fun overlappingRefreshKeepsQueuedSyncRequirementWhenAnyPendingRequestNeedsIt() = runTest {
        val coordinator = ProgressRefreshCoordinator()

        val initialRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            requiresSyncBeforeRemoteLoad = false
        )
        val syncCompletedRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            requiresSyncBeforeRemoteLoad = false
        )
        val manualRefreshStarted = coordinator.beginRefresh(
            scopeKey = "scope-1",
            requiresSyncBeforeRemoteLoad = true
        )
        val queuedRequiresSyncBeforeRemoteLoad = coordinator.completeRefreshIteration(scopeKey = "scope-1")
        val finalQueuedRefresh = coordinator.completeRefreshIteration(scopeKey = "scope-1")

        assertTrue(initialRefreshStarted)
        assertFalse(syncCompletedRefreshStarted)
        assertFalse(manualRefreshStarted)
        assertEquals(true, queuedRequiresSyncBeforeRemoteLoad)
        assertEquals(null, finalQueuedRefresh)
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

private fun createPendingReviewOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    reviewedAtClient: String = "2026-04-18T10:00:00Z"
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
        attemptCount = 0,
        lastError = null
    )
}
