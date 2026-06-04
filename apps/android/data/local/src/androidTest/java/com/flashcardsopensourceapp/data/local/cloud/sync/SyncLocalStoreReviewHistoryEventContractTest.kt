package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryEvent
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.time.Instant
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreReviewHistoryEventContractTest {
    private lateinit var runtime: SyncLocalStoreTestRuntime
    private val database: AppDatabase
        get() = runtime.database
    private val syncLocalStore: SyncLocalStore
        get() = runtime.syncLocalStore

    @Before
    fun setUp(): Unit {
        runtime = createSyncLocalStoreTestRuntime()
    }

    @After
    fun tearDown(): Unit {
        if (::runtime.isInitialized) {
            closeSyncLocalStoreTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun migrateLocalShellEmitsReviewHistoryChangedEventWhenReviewLogsAreDeleted(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        insertSyncContractCard(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = "card-1"
        )
        database.reviewLogDao().insertReviewLog(
            ReviewLogEntity(
                reviewLogId = "review-log-1",
                workspaceId = syncLocalStoreContractWorkspaceId,
                cardId = "card-1",
                replicaId = "replica-1",
                clientEventId = "client-event-1",
                rating = ReviewRating.GOOD,
                reviewedAtMillis = 1_000L,
                reviewedAtServerIso = "2026-03-27T19:05:00Z"
            )
        )

        val eventDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000L) {
                syncLocalStore.observeReviewHistoryChangedEvents().first()
            }
        }

        syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Replacement",
                createdAtMillis = 2_000L,
                isSelected = true
            ),
            remoteWorkspaceIsEmpty = false
        )

        val event = eventDeferred.await()

        assertEquals(setOf(syncLocalStoreContractWorkspaceId), event.workspaceIds)
        assertNull(event.latestReviewedAtMillis)
        assertEquals(0, database.reviewLogDao().countReviewLogs())
    }

    @Test
    fun reviewHistoryBatchFlushEmitsSingleMergedEventOnlyAfterFlush(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        insertSyncContractCard(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = "card-1"
        )
        syncLocalStore.beginReviewHistoryChangeBatch()

        val eventDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000L) {
                syncLocalStore.observeReviewHistoryChangedEvents().first()
            }
        }

        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-1",
                    reviewedAtClient = "2026-03-27T08:00:00Z"
                )
            )
        )
        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-2",
                    reviewedAtClient = "2026-03-27T22:00:00Z"
                )
            )
        )

        assertFalse(eventDeferred.isCompleted)

        syncLocalStore.flushReviewHistoryChangeBatch()

        val event = eventDeferred.await()

        assertEquals(setOf(syncLocalStoreContractWorkspaceId), event.workspaceIds)
        assertEquals(
            Instant.parse("2026-03-27T22:00:00Z").toEpochMilli(),
            event.latestReviewedAtMillis
        )
    }

    @Test
    fun reviewHistoryBatchFlushReplaysMergedEventToLateSubscribers(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        insertSyncContractCard(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = "card-1"
        )
        syncLocalStore.beginReviewHistoryChangeBatch()

        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-1",
                    reviewedAtClient = "2026-03-27T08:00:00Z"
                )
            )
        )
        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-2",
                    reviewedAtClient = "2026-03-27T22:00:00Z"
                )
            )
        )
        syncLocalStore.flushReviewHistoryChangeBatch()

        val event = withTimeout(5_000L) {
            syncLocalStore.observeReviewHistoryChangedEvents().first()
        }

        assertEquals(setOf(syncLocalStoreContractWorkspaceId), event.workspaceIds)
        assertEquals(
            Instant.parse("2026-03-27T22:00:00Z").toEpochMilli(),
            event.latestReviewedAtMillis
        )
    }
}

private fun makeRemoteReviewHistoryEvent(
    reviewEventId: String,
    reviewedAtClient: String
): RemoteReviewHistoryEvent {
    return RemoteReviewHistoryEvent(
        reviewEventId = reviewEventId,
        workspaceId = syncLocalStoreContractWorkspaceId,
        cardId = "card-1",
        replicaId = "replica-1",
        clientEventId = "client-event-$reviewEventId",
        rating = ReviewRating.GOOD.ordinal,
        reviewedAtClient = reviewedAtClient,
        reviewedAtServer = reviewedAtClient
    )
}
