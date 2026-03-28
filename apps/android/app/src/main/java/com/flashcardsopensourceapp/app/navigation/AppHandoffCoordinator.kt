package com.flashcardsopensourceapp.app.navigation

import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import com.flashcardsopensourceapp.feature.review.ReviewNotificationTapPayload
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AiEntryPrefillRequest(
    val requestId: Long,
    val prefill: AiEntryPrefill
)

data class CardEditorRequest(
    val requestId: Long,
    val cardId: String?
)

data class ReviewNotificationRequest(
    val requestId: Long,
    val payload: ReviewNotificationTapPayload
)

enum class SettingsNavigationTarget {
    WORKSPACE,
    WORKSPACE_DECKS,
    WORKSPACE_TAGS
}

data class SettingsNavigationRequest(
    val requestId: Long,
    val target: SettingsNavigationTarget
)

class AppHandoffCoordinator {
    private val nextRequestId = AtomicLong(0L)
    private val aiEntryPrefillState = MutableStateFlow<AiEntryPrefillRequest?>(value = null)
    private val cardEditorState = MutableStateFlow<CardEditorRequest?>(value = null)
    private val reviewNotificationState = MutableStateFlow<ReviewNotificationRequest?>(value = null)
    private val settingsNavigationState = MutableStateFlow<SettingsNavigationRequest?>(value = null)

    fun observeAiEntryPrefill(): StateFlow<AiEntryPrefillRequest?> {
        return aiEntryPrefillState.asStateFlow()
    }

    fun observeCardEditor(): StateFlow<CardEditorRequest?> {
        return cardEditorState.asStateFlow()
    }

    fun observeReviewNotification(): StateFlow<ReviewNotificationRequest?> {
        return reviewNotificationState.asStateFlow()
    }

    fun observeSettingsNavigation(): StateFlow<SettingsNavigationRequest?> {
        return settingsNavigationState.asStateFlow()
    }

    fun requestAiEntryPrefill(prefill: AiEntryPrefill) {
        aiEntryPrefillState.value = AiEntryPrefillRequest(
            requestId = nextRequestId.incrementAndGet(),
            prefill = prefill
        )
    }

    fun consumeAiEntryPrefill(requestId: Long) {
        if (aiEntryPrefillState.value?.requestId != requestId) {
            return
        }

        aiEntryPrefillState.value = null
    }

    fun requestCardEditor(cardId: String?) {
        cardEditorState.value = CardEditorRequest(
            requestId = nextRequestId.incrementAndGet(),
            cardId = cardId
        )
    }

    fun consumeCardEditor(requestId: Long) {
        if (cardEditorState.value?.requestId != requestId) {
            return
        }

        cardEditorState.value = null
    }

    fun requestReviewNotification(payload: ReviewNotificationTapPayload) {
        reviewNotificationState.value = ReviewNotificationRequest(
            requestId = nextRequestId.incrementAndGet(),
            payload = payload
        )
    }

    fun consumeReviewNotification(requestId: Long) {
        if (reviewNotificationState.value?.requestId != requestId) {
            return
        }

        reviewNotificationState.value = null
    }

    fun requestSettingsNavigation(target: SettingsNavigationTarget) {
        settingsNavigationState.value = SettingsNavigationRequest(
            requestId = nextRequestId.incrementAndGet(),
            target = target
        )
    }

    fun consumeSettingsNavigation(requestId: Long) {
        if (settingsNavigationState.value?.requestId != requestId) {
            return
        }

        settingsNavigationState.value = null
    }
}
