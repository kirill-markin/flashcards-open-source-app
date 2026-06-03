package com.flashcardsopensourceapp.app.prompts.guestreview

import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GuestSignInAfterReviewPromptUiState(
    val isVisible: Boolean,
    val reviewCount: Int
)

class GuestSignInAfterReviewPromptController(
    appScope: CoroutineScope,
    private val cloudAccountRepository: CloudAccountRepository,
    private val reviewRepository: ReviewRepository,
    private val promptStore: GuestSignInAfterReviewPromptStore
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
    private val reevaluationRequests = Channel<Unit>(capacity = Channel.CONFLATED)

    init {
        appScope.launch {
            reevaluationRequests.receiveAsFlow().collect {
                reevaluate()
            }
        }
    }

    fun observeUiState(): StateFlow<GuestSignInAfterReviewPromptUiState> {
        return uiStateMutable.asStateFlow()
    }

    fun updateAppContext(context: GuestSignInAfterReviewPromptContext) {
        contextMutable.value = context
        requestReevaluation()
    }

    fun requestReevaluation() {
        reevaluationRequests.trySend(Unit)
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
    }

    fun acceptPrompt() {
        val currentUiState: GuestSignInAfterReviewPromptUiState = uiStateMutable.value
        if (currentUiState.isVisible.not()) {
            return
        }

        promptStore.recordAccepted(nowMillis = System.currentTimeMillis())
        uiStateMutable.value = currentUiState.copy(isVisible = false)
    }

    private suspend fun reevaluate() {
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
