package com.flashcardsopensourceapp.data.local.cloud

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.parseIsoTimestamp
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressCacheStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map

data class ReviewHistoryChangedEvent(
    val workspaceIds: Set<String>,
    val latestReviewedAtMillis: Long?
)

private data class PendingReviewHistoryChangedEvent(
    val eventId: Long,
    val event: ReviewHistoryChangedEvent
)

internal class ReviewHistoryChangePublisher {
    private val reviewHistoryChangedEvents = MutableStateFlow<PendingReviewHistoryChangedEvent?>(value = null)
    private var isReviewHistoryChangeBatchActive: Boolean = false
    private var pendingReviewHistoryChangedEvent: ReviewHistoryChangedEvent? = null
    private var nextReviewHistoryChangedEventId: Long = 0L

    fun observeReviewHistoryChangedEvents(): Flow<ReviewHistoryChangedEvent> {
        return reviewHistoryChangedEvents
            .filterNotNull()
            .map { pendingEvent -> pendingEvent.event }
    }

    fun beginReviewHistoryChangeBatch() {
        check(isReviewHistoryChangeBatchActive.not()) {
            "Review history change batch is already active."
        }
        isReviewHistoryChangeBatchActive = true
        pendingReviewHistoryChangedEvent = null
    }

    fun flushReviewHistoryChangeBatch() {
        check(isReviewHistoryChangeBatchActive) {
            "Review history change batch is not active."
        }
        isReviewHistoryChangeBatchActive = false
        val event = pendingReviewHistoryChangedEvent
        pendingReviewHistoryChangedEvent = null
        if (event != null) {
            publishReviewHistoryChangedEvent(event = event)
        }
    }

    fun discardReviewHistoryChangeBatch() {
        check(isReviewHistoryChangeBatchActive) {
            "Review history change batch is not active."
        }
        isReviewHistoryChangeBatchActive = false
        pendingReviewHistoryChangedEvent = null
    }

    fun recordReviewHistoryChangedEvent(event: ReviewHistoryChangedEvent) {
        if (isReviewHistoryChangeBatchActive.not()) {
            publishReviewHistoryChangedEvent(event = event)
            return
        }

        pendingReviewHistoryChangedEvent = mergeReviewHistoryChangedEvents(
            existingEvent = pendingReviewHistoryChangedEvent,
            newEvent = event
        )
    }

    fun publishReviewHistoryChangedEvent(event: ReviewHistoryChangedEvent) {
        nextReviewHistoryChangedEventId += 1L
        reviewHistoryChangedEvents.value = PendingReviewHistoryChangedEvent(
            eventId = nextReviewHistoryChangedEventId,
            event = event
        )
    }

    private fun mergeReviewHistoryChangedEvents(
        existingEvent: ReviewHistoryChangedEvent?,
        newEvent: ReviewHistoryChangedEvent
    ): ReviewHistoryChangedEvent {
        if (existingEvent == null) {
            return newEvent
        }

        return ReviewHistoryChangedEvent(
            workspaceIds = existingEvent.workspaceIds + newEvent.workspaceIds,
            latestReviewedAtMillis = listOfNotNull(
                existingEvent.latestReviewedAtMillis,
                newEvent.latestReviewedAtMillis
            ).maxOrNull()
        )
    }
}

internal class SyncReviewHistoryLocalStore(
    private val database: AppDatabase,
    private val localProgressCacheStore: LocalProgressCacheStore,
    private val reviewHistoryChangePublisher: ReviewHistoryChangePublisher
) {
    suspend fun applyReviewHistory(events: List<RemoteReviewHistoryEvent>) {
        if (events.isEmpty()) {
            return
        }
        val reviewLogs = events.map { event ->
            ReviewLogEntity(
                reviewLogId = event.reviewEventId,
                workspaceId = event.workspaceId,
                cardId = event.cardId,
                replicaId = event.replicaId,
                clientEventId = event.clientEventId,
                rating = ReviewRating.entries[event.rating],
                reviewedAtMillis = parseIsoTimestamp(event.reviewedAtClient),
                reviewedAtServerIso = event.reviewedAtServer
            )
        }
        var newReviewLogs: List<ReviewLogEntity> = emptyList()
        database.withTransaction {
            val existingReviewLogs = database.reviewLogDao().loadReviewLogs(
                reviewLogIds = reviewLogs.map(ReviewLogEntity::reviewLogId)
            )
            val existingReviewLogIds = existingReviewLogs.mapTo(
                destination = mutableSetOf(),
                transform = ReviewLogEntity::reviewLogId
            )
            newReviewLogs = reviewLogs.filter { reviewLog ->
                reviewLog.reviewLogId !in existingReviewLogIds
            }
            database.reviewLogDao().insertReviewLogs(reviewLogs = reviewLogs)
            localProgressCacheStore.applyReviewHistoryInTransaction(
                reviewLogs = reviewLogs,
                existingReviewLogs = existingReviewLogs,
                updatedAtMillis = System.currentTimeMillis()
            )
        }
        if (newReviewLogs.isNotEmpty()) {
            reviewHistoryChangePublisher.recordReviewHistoryChangedEvent(
                event = ReviewHistoryChangedEvent(
                    workspaceIds = newReviewLogs.map(ReviewLogEntity::workspaceId).toSet(),
                    latestReviewedAtMillis = newReviewLogs.maxOf(ReviewLogEntity::reviewedAtMillis)
                )
            )
        }
    }
}
