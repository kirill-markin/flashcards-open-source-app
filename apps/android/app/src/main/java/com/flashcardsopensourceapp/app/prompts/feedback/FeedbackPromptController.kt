package com.flashcardsopensourceapp.app.prompts.feedback

import android.content.Context
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidFeedbackPromptAction
import com.flashcardsopensourceapp.core.observability.AndroidFeedbackPromptTrigger
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackTrigger
import com.flashcardsopensourceapp.data.local.model.feedback.cloudFeedbackMessageMaximumLength
import com.flashcardsopensourceapp.data.local.repository.FeedbackRepository
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    private val promptStore: FeedbackPromptStore,
    private val messageController: TransientMessageController,
    private val observability: AppObservability,
    private val appVersion: String,
    private val versionCode: Int,
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
    private val automaticPromptShownEventRecorded = AtomicBoolean(false)

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

    /** Only an automatic showing stamps this clock, so feedback sent from Settings never delays it. */
    fun lastAutomaticPromptShownAtMillis(): Long? {
        return promptStore.loadState(identityKey = feedbackPromptIdentityKeyProvider())
            .lastAutomaticFeedbackPromptShownAtMillis
    }

    fun tryShowAutomaticPrompt(canPresent: () -> Boolean): Boolean {
        if (!canPresent() || isAutomaticPromptContextBlocked(context = contextMutable.value)) {
            return false
        }

        showAutomaticPrompt(identityKey = feedbackPromptIdentityKeyProvider())
        return true
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
            reportAutomaticPromptShown()
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
                feedbackRepository.submitFeedback(
                    trigger = currentUiState.trigger,
                    message = trimmedMessage
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

    private suspend fun reportAutomaticPromptShown() {
        try {
            feedbackRepository.recordAutomaticPromptShownForExistingCloudSession()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            captureAutomaticFeedbackPromptException(
                error = error,
                promptAction = AndroidFeedbackPromptAction.AUTOMATIC_PROMPT_SHOWN_RECORD_FAILED
            )
        }
    }

    private fun captureAutomaticFeedbackPromptException(
        error: Exception,
        promptAction: AndroidFeedbackPromptAction
    ) {
        if (shouldSkipAutomaticFeedbackPromptExceptionCapture(error = error)) {
            return
        }

        observability.captureException(
            event = AndroidExceptionIssueEvent.FeedbackPromptException(
                throwable = error,
                promptAction = promptAction,
                trigger = AndroidFeedbackPromptTrigger.AUTOMATIC,
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }

    private fun validateFeedbackMessage(message: String): String? {
        if (message.isEmpty()) {
            return applicationContext.getString(R.string.feedback_prompt_empty_message)
        }
        if (message.length > cloudFeedbackMessageMaximumLength) {
            return applicationContext.resources.getQuantityString(
                R.plurals.feedback_prompt_message_too_long,
                cloudFeedbackMessageMaximumLength,
                cloudFeedbackMessageMaximumLength
            )
        }

        return null
    }
}

private fun shouldSkipAutomaticFeedbackPromptExceptionCapture(error: Throwable): Boolean {
    var currentError: Throwable? = error
    while (currentError != null) {
        if (
            currentError is CloudRemoteException ||
            currentError is CloudCredentialRecoveryRequiredException ||
            currentError is IOException
        ) {
            return true
        }
        currentError = currentError.cause
    }

    return false
}

private fun isAutomaticPromptContextBlocked(context: FeedbackPromptContext): Boolean {
    return context.isAppResumed.not() || context.isAuthFlowActive || context.isAppModalActive
}
