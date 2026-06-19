package com.flashcardsopensourceapp.app.notifications.review

import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ReviewReminderAttentionState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ReviewReminderAttentionController(
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val reviewLogDao: ReviewLogDao
) {
    private val attentionStateMutable = MutableStateFlow(
        value = reviewNotificationsStore.loadReviewReminderAttentionState()
    )

    val attentionState: StateFlow<ReviewReminderAttentionState?> =
        attentionStateMutable.asStateFlow()

    fun markDeliveredReviewReminder(
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

    fun clearAfterSuccessfulReview() {
        reviewNotificationsStore.clearReviewReminderAttention()
        attentionStateMutable.value = null
    }

    fun reloadFromStore() {
        attentionStateMutable.value = reviewNotificationsStore.loadReviewReminderAttentionState()
    }

    suspend fun reconcileWithReviewHistory() {
        val storedState = reviewNotificationsStore.loadReviewReminderAttentionState()
        if (storedState == null) {
            attentionStateMutable.value = null
            return
        }

        val hasNewerReview = reviewLogDao.hasReviewLogsAfter(
            workspaceId = storedState.workspaceId,
            afterMillis = storedState.deliveredAtMillis
        )
        val currentState = reviewNotificationsStore.loadReviewReminderAttentionState()
        if (currentState != storedState) {
            attentionStateMutable.value = currentState
            return
        }
        if (hasNewerReview.not()) {
            attentionStateMutable.value = storedState
            return
        }

        reviewNotificationsStore.clearReviewReminderAttention()
        attentionStateMutable.value = null
    }
}
