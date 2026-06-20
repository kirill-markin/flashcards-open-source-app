package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.isExpectedTransientProgressSyncBeforeRemoteLoadError
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.shouldSuppressProgressReviewScheduleRemoteLoadWarning
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.shouldSuppressProgressSeriesRemoteLoadWarning
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.shouldSuppressProgressSummaryRemoteLoadWarning
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressReviewScheduleStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressSeriesStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressSummaryStoreState
import java.net.UnknownHostException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressRemoteLoadWarningSuppressionTest {
    @Test
    fun syncBeforeRemoteLoadWarningIsSuppressedOnlyForExpectedTransientFailures(): Unit {
        assertTrue(
            isExpectedTransientProgressSyncBeforeRemoteLoadError(
                error = CloudRemoteException(
                    message = "Gateway timeout",
                    statusCode = 504,
                    responseBody = "",
                    errorCode = null,
                    requestId = "request-1",
                    syncConflict = null,
                    androidObservationAlreadyCaptured = false
                )
            )
        )
        assertTrue(
            isExpectedTransientProgressSyncBeforeRemoteLoadError(
                error = IllegalStateException(
                    "Wrapped network error",
                    UnknownHostException("Unable to resolve host")
                )
            )
        )
        assertFalse(
            isExpectedTransientProgressSyncBeforeRemoteLoadError(
                error = CloudRemoteException(
                    message = "Invalid sync request",
                    statusCode = 400,
                    responseBody = """{"code":"SYNC_INVALID_INPUT"}""",
                    errorCode = "SYNC_INVALID_INPUT",
                    requestId = "request-2",
                    syncConflict = null,
                    androidObservationAlreadyCaptured = false
                )
            )
        )
        assertFalse(
            isExpectedTransientProgressSyncBeforeRemoteLoadError(
                error = IllegalStateException("Progress sync invariant failed.")
            )
        )
    }

    @Test
    fun summaryRemoteLoadWarningIsSuppressedOnlyForStaleState(): Unit {
        val refreshStoreState: ProgressSummaryStoreState = createSummaryStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = true
        )
        val validLatestStoreState: ProgressSummaryStoreState = createSummaryStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = true
        )
        val changedScopeStoreState: ProgressSummaryStoreState = createSummaryStoreState(
            scopeId = "linked:user-2",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = true
        )
        val disconnectedStoreState: ProgressSummaryStoreState = createSummaryStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.DISCONNECTED,
            isLocalCacheReady = true
        )
        val linkingStoreState: ProgressSummaryStoreState = createSummaryStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKING_READY,
            isLocalCacheReady = true
        )
        val unreadyCacheStoreState: ProgressSummaryStoreState = createSummaryStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = false
        )

        assertFalse(
            shouldSuppressProgressSummaryRemoteLoadWarning(
                latestStoreState = validLatestStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSummaryRemoteLoadWarning(
                latestStoreState = null,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSummaryRemoteLoadWarning(
                latestStoreState = changedScopeStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSummaryRemoteLoadWarning(
                latestStoreState = disconnectedStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSummaryRemoteLoadWarning(
                latestStoreState = linkingStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSummaryRemoteLoadWarning(
                latestStoreState = unreadyCacheStoreState,
                refreshStoreState = refreshStoreState
            )
        )
    }

    @Test
    fun seriesRemoteLoadWarningIsSuppressedOnlyForStaleState(): Unit {
        val refreshStoreState: ProgressSeriesStoreState = createSeriesStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = true
        )
        val validLatestStoreState: ProgressSeriesStoreState = createSeriesStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = true
        )
        val changedScopeStoreState: ProgressSeriesStoreState = createSeriesStoreState(
            scopeId = "linked:user-2",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = true
        )
        val disconnectedStoreState: ProgressSeriesStoreState = createSeriesStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.DISCONNECTED,
            isLocalCacheReady = true
        )
        val linkingStoreState: ProgressSeriesStoreState = createSeriesStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKING_READY,
            isLocalCacheReady = true
        )
        val unreadyCacheStoreState: ProgressSeriesStoreState = createSeriesStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED,
            isLocalCacheReady = false
        )

        assertFalse(
            shouldSuppressProgressSeriesRemoteLoadWarning(
                latestStoreState = validLatestStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSeriesRemoteLoadWarning(
                latestStoreState = null,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSeriesRemoteLoadWarning(
                latestStoreState = changedScopeStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSeriesRemoteLoadWarning(
                latestStoreState = disconnectedStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSeriesRemoteLoadWarning(
                latestStoreState = linkingStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressSeriesRemoteLoadWarning(
                latestStoreState = unreadyCacheStoreState,
                refreshStoreState = refreshStoreState
            )
        )
    }

    @Test
    fun reviewScheduleRemoteLoadWarningIsSuppressedOnlyForStaleState(): Unit {
        val refreshStoreState: ProgressReviewScheduleStoreState = createReviewScheduleStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED
        )
        val validLatestStoreState: ProgressReviewScheduleStoreState = createReviewScheduleStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKED
        )
        val changedScopeStoreState: ProgressReviewScheduleStoreState = createReviewScheduleStoreState(
            scopeId = "linked:user-2",
            cloudState = CloudAccountState.LINKED
        )
        val disconnectedStoreState: ProgressReviewScheduleStoreState = createReviewScheduleStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.DISCONNECTED
        )
        val linkingStoreState: ProgressReviewScheduleStoreState = createReviewScheduleStoreState(
            scopeId = "linked:user-1",
            cloudState = CloudAccountState.LINKING_READY
        )

        assertFalse(
            shouldSuppressProgressReviewScheduleRemoteLoadWarning(
                latestStoreState = validLatestStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressReviewScheduleRemoteLoadWarning(
                latestStoreState = null,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressReviewScheduleRemoteLoadWarning(
                latestStoreState = changedScopeStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressReviewScheduleRemoteLoadWarning(
                latestStoreState = linkingStoreState,
                refreshStoreState = refreshStoreState
            )
        )
        assertTrue(
            shouldSuppressProgressReviewScheduleRemoteLoadWarning(
                latestStoreState = disconnectedStoreState,
                refreshStoreState = refreshStoreState
            )
        )
    }

}

private fun createSummaryStoreState(
    scopeId: String,
    cloudState: CloudAccountState,
    isLocalCacheReady: Boolean
): ProgressSummaryStoreState {
    return ProgressSummaryStoreState(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = scopeId,
            timeZone = testTimeZone,
            referenceLocalDate = testDate
        ),
        cloudState = cloudState,
        snapshot = null,
        isLocalCacheReady = isLocalCacheReady,
        reviewHistoryFingerprint = testFingerprint,
        syncStatus = createTestSyncStatus()
    )
}

private fun createSeriesStoreState(
    scopeId: String,
    cloudState: CloudAccountState,
    isLocalCacheReady: Boolean
): ProgressSeriesStoreState {
    return ProgressSeriesStoreState(
        scopeKey = ProgressSeriesScopeKey(
            scopeId = scopeId,
            timeZone = testTimeZone,
            from = "2026-05-19",
            to = testDate
        ),
        cloudState = cloudState,
        snapshot = null,
        isLocalCacheReady = isLocalCacheReady,
        reviewHistoryFingerprint = testFingerprint,
        syncStatus = createTestSyncStatus()
    )
}

private fun createReviewScheduleStoreState(
    scopeId: String,
    cloudState: CloudAccountState
): ProgressReviewScheduleStoreState {
    val scopeKey: ProgressReviewScheduleScopeKey = ProgressReviewScheduleScopeKey(
        scopeId = scopeId,
        timeZone = testTimeZone,
        workspaceMembershipKey = "workspace-1",
        referenceLocalDate = testDate
    )
    val localSchedule: CloudProgressReviewSchedule = createReviewSchedule(
        timeZone = testTimeZone,
        newCount = 0,
        todayCount = 0
    )
    val snapshot: ProgressReviewScheduleSnapshot = ProgressReviewScheduleSnapshot(
        scopeKey = scopeKey,
        renderedSchedule = localSchedule,
        localFallback = localSchedule,
        serverBase = null,
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )

    return ProgressReviewScheduleStoreState(
        scopeKey = scopeKey,
        cloudState = cloudState,
        snapshot = snapshot,
        hasPendingScheduleImpactingCardChanges = false,
        reviewScheduleFingerprint = testFingerprint,
        syncStatus = createTestSyncStatus()
    )
}

private fun createTestSyncStatus(): SyncStatusSnapshot {
    return SyncStatusSnapshot(
        status = SyncStatus.Idle,
        lastSuccessfulSyncAtMillis = null,
        lastErrorMessage = ""
    )
}

private const val testTimeZone: String = "Europe/Madrid"
private const val testDate: String = "2026-05-26"
private const val testFingerprint: String = "fingerprint"
