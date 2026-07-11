package com.flashcardsopensourceapp.app.notifications.review

import com.flashcardsopensourceapp.app.notifications.NotificationDeliveryGate
import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ReviewReminderAttentionState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ReviewReminderAttentionController(
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val reviewLogDao: ReviewLogDao,
    private val notificationDeliveryGate: NotificationDeliveryGate
) {
    private val attentionStateMutable = MutableStateFlow(
        value = reviewNotificationsStore.loadReviewReminderAttentionState()
    )

    val attentionState: StateFlow<ReviewReminderAttentionState?> =
        attentionStateMutable.asStateFlow()

    internal fun markDeliveredReviewReminderInsideGate(
        workspaceId: String,
        requestId: String,
        deliveredAtMillis: Long
    ) {
        val state = ReviewReminderAttentionState(
            workspaceId = workspaceId,
            requestId = requestId,
            deliveredAtMillis = deliveredAtMillis
        )
        reviewNotificationsStore.markReviewReminderAttention(state = state)
        attentionStateMutable.value = state
    }

    suspend fun clearAfterSuccessfulReview() {
        clear()
    }

    suspend fun clear() {
        notificationDeliveryGate.runExclusive {
            clearInsideGate()
        }
    }

    suspend fun reloadFromStore() {
        notificationDeliveryGate.runExclusive {
            attentionStateMutable.value = reviewNotificationsStore.loadReviewReminderAttentionState()
        }
    }

    suspend fun reconcileWithReviewHistory() {
        val storedState = reviewNotificationsStore.loadReviewReminderAttentionState()
        if (storedState == null) {
            notificationDeliveryGate.runExclusive {
                val currentState = reviewNotificationsStore.loadReviewReminderAttentionState()
                attentionStateMutable.value = currentState
            }
            return
        }

        val hasNewerReview = reviewLogDao.hasReviewLogsAfter(
            workspaceId = storedState.workspaceId,
            afterMillis = storedState.deliveredAtMillis
        )
        notificationDeliveryGate.runExclusive {
            val currentState = reviewNotificationsStore.loadReviewReminderAttentionState()
            if (currentState != storedState) {
                attentionStateMutable.value = currentState
                return@runExclusive
            }
            if (hasNewerReview.not()) {
                attentionStateMutable.value = storedState
                return@runExclusive
            }

            clearInsideGate()
        }
    }

    internal fun clearInsideGate() {
        reviewNotificationsStore.clearReviewReminderAttention()
        attentionStateMutable.value = null
    }
}
