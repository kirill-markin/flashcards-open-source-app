package com.flashcardsopensourceapp.app

import android.content.Context
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackState
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackTrigger
import com.flashcardsopensourceapp.data.local.model.cloudFeedbackMessageMaximumLength
import com.flashcardsopensourceapp.data.local.repository.FeedbackRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FeedbackPromptUiState(
    val isVisible: Boolean,
    val trigger: CloudFeedbackTrigger,
    val message: String,
    val isSubmitting: Boolean,
    val errorMessage: String?
)

class FeedbackPromptController(
    private val appScope: CoroutineScope,
    context: Context,
    private val feedbackRepository: FeedbackRepository,
    private val reviewRepository: ReviewRepository,
    private val promptStore: FeedbackPromptStore,
    private val messageController: TransientMessageController,
    private val feedbackPromptIdentityKeyProvider: () -> FeedbackPromptIdentityKey
) {
    private val applicationContext = context.applicationContext
    private val initialFeedbackPromptIdentityKey = feedbackPromptIdentityKeyProvider()
    private val activeFeedbackPromptIdentityKeyMutable = MutableStateFlow(initialFeedbackPromptIdentityKey)
    private val uiStateMutable = MutableStateFlow(
        FeedbackPromptUiState(
            isVisible = false,
            trigger = CloudFeedbackTrigger.SETTINGS,
            message = promptStore.loadState(identityKey = initialFeedbackPromptIdentityKey).draftMessage,
            isSubmitting = false,
            errorMessage = null
        )
    )
    private val contextMutable = MutableStateFlow(
        FeedbackPromptContext(
            isAppResumed = false,
            isAuthFlowActive = false,
            isAppModalActive = false
        )
    )
    private val automaticReevaluationRequests = Channel<Unit>(capacity = Channel.CONFLATED)
    private val automaticPromptShownEventRecorded = AtomicBoolean(false)

    init {
        appScope.launch {
            automaticReevaluationRequests.receiveAsFlow().collect {
                reevaluateAutomaticPrompt()
            }
        }
    }

    fun observeUiState(): StateFlow<FeedbackPromptUiState> {
        return uiStateMutable.asStateFlow()
    }

    fun updateAppContext(context: FeedbackPromptContext) {
        contextMutable.value = context
        if (isAutomaticPromptContextBlocked(context = context).not()) {
            return
        }

        val currentUiState = uiStateMutable.value
        if (
            currentUiState.isVisible.not() ||
            currentUiState.trigger != CloudFeedbackTrigger.AUTOMATIC ||
            currentUiState.isSubmitting
        ) {
            return
        }

        promptStore.saveDraftMessage(
            identityKey = activeFeedbackPromptIdentityKeyMutable.value,
            message = currentUiState.message
        )
        uiStateMutable.value = currentUiState.copy(
            isVisible = false,
            errorMessage = null
        )
    }

    fun requestAutomaticReevaluation() {
        automaticReevaluationRequests.trySend(Unit)
    }

    fun openSettingsFeedback() {
        val currentUiState = uiStateMutable.value
        if (currentUiState.isVisible) {
            return
        }

        val identityKey = feedbackPromptIdentityKeyProvider()
        activeFeedbackPromptIdentityKeyMutable.value = identityKey
        uiStateMutable.value = currentUiState.copy(
            isVisible = true,
            trigger = CloudFeedbackTrigger.SETTINGS,
            message = promptStore.loadState(identityKey = identityKey).draftMessage,
            isSubmitting = false,
            errorMessage = null
        )
    }

    fun updateMessage(message: String) {
        val currentUiState = uiStateMutable.value
        if (currentUiState.isVisible.not() || currentUiState.isSubmitting) {
            return
        }

        promptStore.saveDraftMessage(
            identityKey = activeFeedbackPromptIdentityKeyMutable.value,
            message = message
        )
        uiStateMutable.value = currentUiState.copy(
            message = message,
            errorMessage = null
        )
    }

    fun dismiss() {
        val currentUiState = uiStateMutable.value
        if (currentUiState.isVisible.not() || currentUiState.isSubmitting) {
            return
        }

        promptStore.saveDraftMessage(
            identityKey = activeFeedbackPromptIdentityKeyMutable.value,
            message = currentUiState.message
        )
        uiStateMutable.value = currentUiState.copy(
            isVisible = false,
            errorMessage = null
        )
    }

    fun markVisibleDialogShown() {
        val currentUiState = uiStateMutable.value
        if (currentUiState.isVisible.not() || currentUiState.trigger != CloudFeedbackTrigger.AUTOMATIC) {
            return
        }
        if (isAutomaticPromptContextBlocked(context = contextMutable.value)) {
            return
        }
        if (automaticPromptShownEventRecorded.compareAndSet(false, true).not()) {
            return
        }

        val nowMillis = System.currentTimeMillis()
        val identityKey = activeFeedbackPromptIdentityKeyMutable.value
        promptStore.recordAutomaticPromptShown(identityKey = identityKey, nowMillis = nowMillis)
        appScope.launch {
            val feedbackState = recordAutomaticPromptShownOrNull() ?: return@launch
            promptStore.recordFetchedFeedbackState(
                identityKey = identityKey,
                feedbackState = feedbackState,
                nowMillis = System.currentTimeMillis()
            )
        }
    }

    fun submit() {
        val currentUiState = uiStateMutable.value
        if (currentUiState.isVisible.not() || currentUiState.isSubmitting) {
            return
        }

        val trimmedMessage = currentUiState.message.trim()
        val validationError = validateFeedbackMessage(message = trimmedMessage)
        if (validationError != null) {
            uiStateMutable.value = currentUiState.copy(errorMessage = validationError)
            return
        }

        uiStateMutable.value = currentUiState.copy(
            message = trimmedMessage,
            isSubmitting = true,
            errorMessage = null
        )
        val identityKey = activeFeedbackPromptIdentityKeyMutable.value
        promptStore.saveDraftMessage(identityKey = identityKey, message = trimmedMessage)

        appScope.launch {
            try {
                val feedbackState = feedbackRepository.submitFeedback(
                    trigger = currentUiState.trigger,
                    message = trimmedMessage
                )
                promptStore.recordFeedbackSubmitted(
                    identityKey = identityKey,
                    feedbackState = feedbackState,
                    nowMillis = System.currentTimeMillis()
                )
                promptStore.clearDraftMessage(identityKey = identityKey)
                uiStateMutable.value = FeedbackPromptUiState(
                    isVisible = false,
                    trigger = CloudFeedbackTrigger.SETTINGS,
                    message = "",
                    isSubmitting = false,
                    errorMessage = null
                )
                messageController.showMessage(
                    message = applicationContext.getString(R.string.feedback_prompt_submit_success)
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                promptStore.saveDraftMessage(identityKey = identityKey, message = trimmedMessage)
                uiStateMutable.update { state ->
                    state.copy(
                        isSubmitting = false,
                        errorMessage = error.message
                            ?: applicationContext.getString(R.string.feedback_prompt_submit_failed)
                    )
                }
            }
        }
    }

    private suspend fun reevaluateAutomaticPrompt() {
        val nowMillis = System.currentTimeMillis()
        val context = contextMutable.value
        if (uiStateMutable.value.isVisible) {
            return
        }

        val identityKey = feedbackPromptIdentityKeyProvider()
        val localDayWindow = feedbackPromptLocalDayWindow(
            nowMillis = nowMillis,
            zoneId = ZoneId.systemDefault()
        )
        val reviewActivity = reviewRepository.loadFeedbackPromptReviewActivity(
            currentLocalDayStartMillis = localDayWindow.startMillis,
            nextLocalDayStartMillis = localDayWindow.endMillis
        )
        var promptState = promptStore.loadState(identityKey = identityKey)
        if (
            isAutomaticFeedbackPromptLocallyEligible(
                reviewActivity = reviewActivity,
                promptState = promptState,
                nowMillis = nowMillis,
                context = context
            ).not()
        ) {
            return
        }

        if (shouldFetchFeedbackState(promptState = promptState, nowMillis = nowMillis)) {
            if (canAttemptFeedbackStateFetch(promptState = promptState, nowMillis = nowMillis).not()) {
                return
            }
            when (val result = loadFeedbackStateForAutomaticPrompt()) {
                FeedbackStateFetchResult.Failed -> {
                    promptStore.recordFeedbackStateFetchAttempt(
                        identityKey = identityKey,
                        nowMillis = System.currentTimeMillis()
                    )
                    return
                }
                FeedbackStateFetchResult.NoExistingCloudSession -> Unit
                is FeedbackStateFetchResult.Loaded -> {
                    promptStore.recordFetchedFeedbackState(
                        identityKey = identityKey,
                        feedbackState = result.feedbackState,
                        nowMillis = System.currentTimeMillis()
                    )
                    promptState = promptStore.loadState(identityKey = identityKey)
                }
            }
        }

        if (
            isAutomaticFeedbackPromptLocallyEligible(
                reviewActivity = reviewActivity,
                promptState = promptState,
                nowMillis = System.currentTimeMillis(),
                context = contextMutable.value
            ).not()
        ) {
            return
        }
        if (uiStateMutable.value.isVisible) {
            return
        }

        showAutomaticPrompt(identityKey = identityKey)
    }

    private fun showAutomaticPrompt(identityKey: FeedbackPromptIdentityKey) {
        automaticPromptShownEventRecorded.set(false)
        activeFeedbackPromptIdentityKeyMutable.value = identityKey
        uiStateMutable.value = FeedbackPromptUiState(
            isVisible = true,
            trigger = CloudFeedbackTrigger.AUTOMATIC,
            message = promptStore.loadState(identityKey = identityKey).draftMessage,
            isSubmitting = false,
            errorMessage = null
        )
    }

    private suspend fun loadFeedbackStateForAutomaticPrompt(): FeedbackStateFetchResult {
        return try {
            val feedbackState = feedbackRepository.loadFeedbackStateForExistingCloudSession()
            if (feedbackState == null) {
                FeedbackStateFetchResult.NoExistingCloudSession
            } else {
                FeedbackStateFetchResult.Loaded(feedbackState = feedbackState)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            FeedbackStateFetchResult.Failed
        }
    }

    private suspend fun recordAutomaticPromptShownOrNull(): CloudFeedbackState? {
        return try {
            feedbackRepository.recordAutomaticPromptShownForExistingCloudSession()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            null
        }
    }

    private fun validateFeedbackMessage(message: String): String? {
        if (message.isEmpty()) {
            return applicationContext.getString(R.string.feedback_prompt_empty_message)
        }
        if (message.length > cloudFeedbackMessageMaximumLength) {
            return applicationContext.getString(
                R.string.feedback_prompt_message_too_long,
                cloudFeedbackMessageMaximumLength
            )
        }

        return null
    }
}

private fun isAutomaticPromptContextBlocked(context: FeedbackPromptContext): Boolean {
    return context.isAppResumed.not() || context.isAuthFlowActive || context.isAppModalActive
}

private sealed interface FeedbackStateFetchResult {
    data class Loaded(val feedbackState: CloudFeedbackState) : FeedbackStateFetchResult
    data object NoExistingCloudSession : FeedbackStateFetchResult
    data object Failed : FeedbackStateFetchResult
}
