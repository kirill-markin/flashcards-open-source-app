package com.flashcardsopensourceapp.data.local.repository.progress

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressRefreshCoordinatorTest {
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
}
