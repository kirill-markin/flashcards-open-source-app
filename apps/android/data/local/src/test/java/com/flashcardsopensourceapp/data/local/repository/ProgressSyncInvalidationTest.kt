package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressSyncInvalidationTest {
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
}
