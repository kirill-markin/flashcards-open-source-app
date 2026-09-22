package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.dictation

import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsDictationFailureReason
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.ai.effectiveAiChatServerConfig
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.appendTranscriptToDraft
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canPrepareAiDraftInComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.session.AiChatSessionCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiDictationNoSpeechException
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiErrorSurface
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiErrorAlert
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiUserFacingErrorPresentation
import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val maxAnalyticsDictationFailureCauseDepth: Int = 8

internal class AiChatDictationCoordinator(
    private val context: AiChatRuntimeContext,
    private val sessionCoordinator: AiChatSessionCoordinator
) {
    fun startDictationPermissionRequest() {
        if (canStartDictation().not()) {
            return
        }

        context.runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.REQUESTING_PERMISSION,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun startDictationRecording() {
        // The caller has already started the recorder, so this is where a dictation attempt exists,
        // whether or not this runtime goes on to take it. Reporting the microphone button instead
        // would count a refused permission as a start.
        context.analytics.track(event = AnalyticsEvent.DictationStarted)
        if (canStartDictation().not()) {
            // The recorder is running and the runtime will not adopt it, so the attempt is over
            // before it produced anything: dictation was switched off in a config refresh, or the
            // composer left the phase that can hold a draft, while the permission dialog was up.
            context.analytics.track(
                event = AnalyticsEvent.DictationFailed(
                    reason = AnalyticsDictationFailureReason.SERVER_ERROR
                )
            )
            return
        }

        context.runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.RECORDING,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun cancelDictation() {
        // Reports nothing itself. Every caller that cancels a running recording names its own
        // reason — no speech, a recorder that would not stop, the screen going away — and the
        // transcribing phase reports through the cancelled job below, so a report from here would
        // count one attempt twice.
        cancelActiveTranscription(reason = "AI dictation cancelled.")
        context.runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null
            )
        }
    }

    fun cancelActiveTranscription(reason: String) {
        context.activeDictationJob?.cancel(cause = CancellationException(reason))
        context.activeDictationJob = null
    }

    fun transcribeRecordedAudio(
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ) {
        val currentState = context.runtimeStateMutable.value
        if (currentState.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (currentState.dictationState != AiChatDictationState.RECORDING) {
            return
        }

        val originWorkspaceId = currentState.workspaceId
        context.runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.TRANSCRIBING,
                activeAlert = null,
                errorMessage = ""
            )
        }

        var dictationJob: Job? = null
        dictationJob = context.scope.launch(start = CoroutineStart.LAZY) {
            var targetSessionId: String? = currentState.persistedState.chatSessionId.takeIf(String::isNotBlank)
            try {
                val ensuredSession = sessionCoordinator.ensureSessionIdIfNeeded()
                targetSessionId = ensuredSession.sessionId
                val transcription = context.aiChatRepository.transcribeAudio(
                    workspaceId = originWorkspaceId,
                    sessionId = ensuredSession.sessionId,
                    fileName = fileName,
                    mediaType = mediaType,
                    audioBytes = audioBytes
                )
                val transcript = transcription.text.trim()

                require(transcription.sessionId == ensuredSession.sessionId) {
                    "AI dictation returned mismatched sessionId. expectedSessionId=${ensuredSession.sessionId} responseSessionId=${transcription.sessionId}"
                }
                if (transcript.isEmpty()) {
                    throw AiDictationNoSpeechException(
                        message = context.textProvider.noSpeechRecorded,
                        cause = null
                    )
                }

                var didApplyResult = false
                context.runtimeStateMutable.update { state ->
                    if (
                        canApplyDictationResult(
                            state = state,
                            originWorkspaceId = originWorkspaceId,
                            targetSessionId = ensuredSession.sessionId,
                            dictationJob = dictationJob
                        ).not()
                    ) {
                        return@update state
                    }
                    didApplyResult = true
                    state.copy(
                        persistedState = state.persistedState.copy(chatSessionId = ensuredSession.sessionId),
                        draftMessage = appendTranscriptToDraft(
                            currentDraft = state.draftMessage,
                            transcript = transcript
                        ),
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
                if (didApplyResult) {
                    context.persistCurrentState()
                }
            } catch (error: CancellationException) {
                context.analytics.track(
                    event = AnalyticsEvent.DictationFailed(
                        reason = AnalyticsDictationFailureReason.CANCELLED
                    )
                )
                AiChatDiagnosticsLogger.info(
                    event = "dictation_transcription_cancelled",
                    fields = listOf(
                        "workspaceId" to context.runtimeStateMutable.value.workspaceId,
                        "cloudState" to context.currentCloudState().name,
                        "chatSessionId" to context.runtimeStateMutable.value.persistedState.chatSessionId
                    )
                )
                throw error
            } catch (_: AiDictationNoSpeechException) {
                context.analytics.track(
                    event = AnalyticsEvent.DictationFailed(
                        reason = AnalyticsDictationFailureReason.NO_SPEECH
                    )
                )
                val currentStateSnapshot = context.runtimeStateMutable.value
                if (
                    canApplyDictationResult(
                        state = currentStateSnapshot,
                        originWorkspaceId = originWorkspaceId,
                        targetSessionId = targetSessionId,
                        dictationJob = dictationJob
                    ).not()
                ) {
                    return@launch
                }

                context.runtimeStateMutable.update { state ->
                    if (
                        canApplyDictationResult(
                            state = state,
                            originWorkspaceId = originWorkspaceId,
                            targetSessionId = targetSessionId,
                            dictationJob = dictationJob
                        ).not()
                    ) {
                        return@update state
                    }
                    state.copy(
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = context.textProvider.generalError(
                            message = context.textProvider.noSpeechRecorded
                        ),
                        errorMessage = ""
                    )
                }
            } catch (error: Exception) {
                context.analytics.track(
                    event = AnalyticsEvent.DictationFailed(
                        reason = analyticsDictationFailureReason(error = error)
                    )
                )
                val currentStateSnapshot = context.runtimeStateMutable.value
                if (
                    canApplyDictationResult(
                        state = currentStateSnapshot,
                        originWorkspaceId = originWorkspaceId,
                        targetSessionId = targetSessionId,
                        dictationJob = dictationJob
                    ).not()
                ) {
                    return@launch
                }

                val presentation = makeAiUserFacingErrorPresentation(
                    error = error,
                    surface = AiErrorSurface.DICTATION,
                    configuration = context.currentServerConfiguration(),
                    textProvider = context.textProvider
                )
                context.runtimeStateMutable.update { state ->
                    if (
                        canApplyDictationResult(
                            state = state,
                            originWorkspaceId = originWorkspaceId,
                            targetSessionId = targetSessionId,
                            dictationJob = dictationJob
                        ).not()
                    ) {
                        return@update state
                    }
                    state.copy(
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = makeAiErrorAlert(
                            presentation = presentation,
                            technicalErrorAlreadyObserved = false,
                            textProvider = context.textProvider
                        ),
                        errorMessage = ""
                    )
                }
            } finally {
                if (context.activeDictationJob === dictationJob) {
                    context.activeDictationJob = null
                }
            }
        }
        context.activeDictationJob = dictationJob
        dictationJob.start()
    }

    private fun canStartDictation(): Boolean {
        val currentState = context.runtimeStateMutable.value
        if (currentState.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return false
        }
        if (canPrepareAiDraftInComposerPhase(composerPhase = currentState.composerPhase).not()) {
            return false
        }
        val chatConfig = effectiveAiChatServerConfig(currentState.persistedState.lastKnownChatConfig)
        if (chatConfig.features.dictationEnabled.not()) {
            return false
        }
        return currentState.dictationState == AiChatDictationState.IDLE ||
            currentState.dictationState == AiChatDictationState.REQUESTING_PERMISSION
    }

    private fun canApplyDictationResult(
        state: AiChatRuntimeState,
        originWorkspaceId: String?,
        targetSessionId: String?,
        dictationJob: Job?
    ): Boolean {
        if (context.activeDictationJob !== dictationJob) {
            return false
        }
        if (state.workspaceId != originWorkspaceId) {
            return false
        }
        if (targetSessionId == null) {
            return true
        }
        return state.persistedState.chatSessionId == targetSessionId
    }
}

/**
 * Maps a failed transcription onto the closed reason set the server catalog declares, walking the
 * cause chain exactly as the review mapper does. Everything the client cannot tell apart is a
 * `SERVER_ERROR`, which is that value's reading across all three clients.
 */
private fun analyticsDictationFailureReason(error: Throwable): AnalyticsDictationFailureReason {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxAnalyticsDictationFailureCauseDepth) {
        val inspectedError: Throwable = currentError
        when (inspectedError) {
            is SocketTimeoutException -> return AnalyticsDictationFailureReason.TIMEOUT
            is IOException -> return AnalyticsDictationFailureReason.OFFLINE
            is AiChatRemoteException -> return analyticsDictationHttpFailureReason(
                statusCode = inspectedError.statusCode
            )
            is CloudRemoteException -> return analyticsDictationHttpFailureReason(
                statusCode = inspectedError.statusCode
            )
            else -> Unit
        }
        currentError = inspectedError.cause
        depth += 1
    }
    return AnalyticsDictationFailureReason.SERVER_ERROR
}

private fun analyticsDictationHttpFailureReason(statusCode: Int?): AnalyticsDictationFailureReason {
    return when (statusCode) {
        408, 504 -> AnalyticsDictationFailureReason.TIMEOUT
        else -> AnalyticsDictationFailureReason.SERVER_ERROR
    }
}
