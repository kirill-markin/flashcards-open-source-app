package com.flashcardsopensourceapp.app.navigation

import com.flashcardsopensourceapp.app.notifications.AppNotificationTapRequest
import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
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

data class AppNotificationTapHandoffRequest(
    val requestId: Long,
    val request: AppNotificationTapRequest
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
    private val appNotificationTapState = MutableStateFlow<AppNotificationTapHandoffRequest?>(value = null)
    private val settingsNavigationState = MutableStateFlow<SettingsNavigationRequest?>(value = null)

    fun observeAiEntryPrefill(): StateFlow<AiEntryPrefillRequest?> {
        return aiEntryPrefillState.asStateFlow()
    }

    fun observeCardEditor(): StateFlow<CardEditorRequest?> {
        return cardEditorState.asStateFlow()
    }

    fun observeAppNotificationTap(): StateFlow<AppNotificationTapHandoffRequest?> {
        return appNotificationTapState.asStateFlow()
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

    fun requestAppNotificationTap(request: AppNotificationTapRequest) {
        appNotificationTapState.value = AppNotificationTapHandoffRequest(
            requestId = nextRequestId.incrementAndGet(),
            request = request
        )
    }

    fun consumeAppNotificationTap(requestId: Long) {
        if (appNotificationTapState.value?.requestId != requestId) {
            return
        }

        appNotificationTapState.value = null
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
