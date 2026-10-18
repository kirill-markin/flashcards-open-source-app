package com.flashcardsopensourceapp.app.prompts.guestreview

import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPrompt
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPromptOutcome
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update

data class GuestSignInAfterReviewPromptUiState(
    val isVisible: Boolean,
    val reviewCount: Int
)

class GuestSignInAfterReviewPromptController(
    private val cloudAccountRepository: CloudAccountRepository,
    private val reviewRepository: ReviewRepository,
    private val promptStore: GuestSignInAfterReviewPromptStore,
    private val analytics: Analytics
) {
    private val uiStateMutable = MutableStateFlow(
        GuestSignInAfterReviewPromptUiState(
            isVisible = false,
            reviewCount = 0
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

    suspend fun tryShowAfterReview(canPresent: () -> Boolean): Boolean {
        reevaluate(canPresent = canPresent)
        return uiStateMutable.value.isVisible
    }

    fun dismissForLater() {
        val currentUiState: GuestSignInAfterReviewPromptUiState = uiStateMutable.value
        if (currentUiState.isVisible.not()) {
            return
        }

        promptStore.recordSnoozed(
            nowMillis = System.currentTimeMillis(),
            reviewCount = currentUiState.reviewCount
        )
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

        promptStore.recordAccepted(nowMillis = System.currentTimeMillis())
        uiStateMutable.value = currentUiState.copy(isVisible = false)
        analytics.track(
            event = AnalyticsEvent.PromptAnswered(
                prompt = AnalyticsPrompt.SIGNIN_AFTER_REVIEW_PROMPT,
                outcome = AnalyticsPromptOutcome.ACCEPTED
            )
        )
    }

    private suspend fun reevaluate(canPresent: () -> Boolean) {
        if (!canPresent()) return
        val nowMillis: Long = System.currentTimeMillis()
        val context: GuestSignInAfterReviewPromptContext = contextMutable.value
        val cloudSettings: CloudSettings = cloudAccountRepository.observeCloudSettings().first()
        val reviewCount: Int = reviewRepository.countRecordedReviewsInCurrentWorkspace()
        val promptState: GuestSignInAfterReviewPromptState = promptStore.loadState()
        val shouldShowPrompt: Boolean = isGuestSignInAfterReviewPromptVisible(
            cloudState = cloudSettings.cloudState,
            reviewedCount = reviewCount,
            promptState = promptState,
            nowMillis = nowMillis,
            context = context
        )

        if (shouldShowPrompt.not()) {
            uiStateMutable.update { state ->
                state.copy(
                    isVisible = false,
                    reviewCount = reviewCount
                )
            }
            return
        }

        val currentCloudSettings = cloudAccountRepository.observeCloudSettings().first()
        if (context != contextMutable.value || cloudSettings != currentCloudSettings || !canPresent()
        ) return

        val currentUiState: GuestSignInAfterReviewPromptUiState = uiStateMutable.value
        if (currentUiState.isVisible) {
            uiStateMutable.value = currentUiState.copy(reviewCount = reviewCount)
            return
        }

        promptStore.recordShown(
            nowMillis = nowMillis,
            reviewCount = reviewCount
        )
        uiStateMutable.value = GuestSignInAfterReviewPromptUiState(
            isVisible = true,
            reviewCount = reviewCount
        )
    }
}
