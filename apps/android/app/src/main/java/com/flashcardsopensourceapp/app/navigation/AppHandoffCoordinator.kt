package com.flashcardsopensourceapp.app.navigation

import com.flashcardsopensourceapp.app.notifications.AppNotificationTapRequest
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AiEntryPrefillRequest(
    val requestId: Long,
    val prefill: AiEntryPrefill
)

data class AiCardHandoffRequest(
    val requestId: Long,
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>
)

data class CardEditorRequest(
    val requestId: Long,
    val cardId: String?
)

data class ReviewFilterRequest(
    val requestId: Long,
    val reviewFilter: ReviewFilter
)

enum class ProgressNavigationTarget {
    STREAK,
    LEADERBOARD
}

data class ProgressNavigationRequest(
    val requestId: Long,
    val target: ProgressNavigationTarget
)

data class AppNotificationTapHandoffRequest(
    val requestId: Long,
    val request: AppNotificationTapRequest
)

enum class SettingsNavigationTarget {
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
    private val aiCardHandoffState = MutableStateFlow<AiCardHandoffRequest?>(value = null)
    private val cardEditorState = MutableStateFlow<CardEditorRequest?>(value = null)
    private val reviewFilterState = MutableStateFlow<ReviewFilterRequest?>(value = null)
    private val progressNavigationState = MutableStateFlow<ProgressNavigationRequest?>(value = null)
    private val settingsNavigationState = MutableStateFlow<SettingsNavigationRequest?>(value = null)

    fun observeAiEntryPrefill(): StateFlow<AiEntryPrefillRequest?> {
        return aiEntryPrefillState.asStateFlow()
    }

    fun observeAiCardHandoff(): StateFlow<AiCardHandoffRequest?> {
        return aiCardHandoffState.asStateFlow()
    }

    fun observeCardEditor(): StateFlow<CardEditorRequest?> {
        return cardEditorState.asStateFlow()
    }

    fun observeReviewFilter(): StateFlow<ReviewFilterRequest?> {
        return reviewFilterState.asStateFlow()
    }

    fun observeProgressNavigation(): StateFlow<ProgressNavigationRequest?> {
        return progressNavigationState.asStateFlow()
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

    fun requestAiCardHandoff(
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>
    ) {
        aiCardHandoffState.value = AiCardHandoffRequest(
            requestId = nextRequestId.incrementAndGet(),
            cardId = cardId,
            frontText = frontText,
            backText = backText,
            tags = tags
        )
    }

    fun consumeAiCardHandoff(requestId: Long) {
        if (aiCardHandoffState.value?.requestId != requestId) {
            return
        }

        aiCardHandoffState.value = null
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

    fun requestReviewFilter(reviewFilter: ReviewFilter) {
        reviewFilterState.value = ReviewFilterRequest(
            requestId = nextRequestId.incrementAndGet(),
            reviewFilter = reviewFilter
        )
    }

    fun consumeReviewFilter(requestId: Long) {
        if (reviewFilterState.value?.requestId != requestId) {
            return
        }

        reviewFilterState.value = null
    }

    fun requestProgressNavigation(target: ProgressNavigationTarget) {
        progressNavigationState.value = ProgressNavigationRequest(
            requestId = nextRequestId.incrementAndGet(),
            target = target
        )
    }

    fun consumeProgressNavigation(requestId: Long) {
        if (progressNavigationState.value?.requestId != requestId) {
            return
        }

        progressNavigationState.value = null
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
