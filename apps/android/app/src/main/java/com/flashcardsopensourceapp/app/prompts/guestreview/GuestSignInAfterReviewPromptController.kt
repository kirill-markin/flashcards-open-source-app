package com.flashcardsopensourceapp.app.prompts.guestreview

import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPrompt
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPromptOutcome
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update

data class GuestSignInAfterReviewPromptUiState(
    val isVisible: Boolean,
    /** The config version that chose the visible prompt, for its `screen_viewed`. */
    val reviewPromptConfigVersion: String?
)

class GuestSignInAfterReviewPromptController(
    private val cloudAccountRepository: CloudAccountRepository,
    private val promptStore: GuestSignInAfterReviewPromptStore,
    private val analytics: Analytics
) {
    private val uiStateMutable = MutableStateFlow(
        GuestSignInAfterReviewPromptUiState(
            isVisible = false,
            reviewPromptConfigVersion = null
        )
    )
    private val contextMutable = MutableStateFlow(
        GuestSignInAfterReviewPromptContext(
            isAuthFlowActive = false,
            isAppModalActive = false
        )
    )
    fun observeUiState(): StateFlow<GuestSignInAfterReviewPromptUiState> {
        return uiStateMutable.asStateFlow()
    }

    fun updateAppContext(context: GuestSignInAfterReviewPromptContext) {
        contextMutable.value = context
        if (context.isAuthFlowActive || context.isAppModalActive) {
            uiStateMutable.update { it.copy(isVisible = false) }
        }
    }

    /** Every showing starts the cooldown, whether or not the person answers it. */
    fun lastShownAtMillis(): Long? {
        return promptStore.loadLastShownAtMillis()
    }

    suspend fun tryShowAfterReview(canPresent: () -> Boolean, reviewPromptConfigVersion: String): Boolean {
        if (!canPresent()) return false
        val cloudSettings: CloudSettings = cloudAccountRepository.observeCloudSettings().first()
        if (
            isGuestSignInAfterReviewPromptAllowed(
                cloudState = cloudSettings.cloudState,
                context = contextMutable.value
            ).not() ||
            !canPresent()
        ) {
            return false
        }

        promptStore.recordShown(nowMillis = System.currentTimeMillis())
        uiStateMutable.value = GuestSignInAfterReviewPromptUiState(
            isVisible = true,
            reviewPromptConfigVersion = reviewPromptConfigVersion
        )
        return true
    }

    fun dismissForLater() {
        val currentUiState: GuestSignInAfterReviewPromptUiState = uiStateMutable.value
        if (currentUiState.isVisible.not()) {
            return
        }

        uiStateMutable.value = currentUiState.copy(isVisible = false)
        analytics.track(
            event = AnalyticsEvent.PromptAnswered(
                prompt = AnalyticsPrompt.SIGNIN_AFTER_REVIEW_PROMPT,
                outcome = AnalyticsPromptOutcome.SNOOZED
            )
        )
    }

    fun acceptPrompt() {
        val currentUiState: GuestSignInAfterReviewPromptUiState = uiStateMutable.value
        if (currentUiState.isVisible.not()) {
            return
        }

        uiStateMutable.value = currentUiState.copy(isVisible = false)
        analytics.track(
            event = AnalyticsEvent.PromptAnswered(
                prompt = AnalyticsPrompt.SIGNIN_AFTER_REVIEW_PROMPT,
                outcome = AnalyticsPromptOutcome.ACCEPTED
            )
        )
    }
}
