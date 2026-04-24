package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.effectiveAiChatServerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
        if (canStartDictation().not()) {
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
                require(transcript.isNotEmpty()) {
                    context.textProvider.noSpeechRecorded
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
                AiChatDiagnosticsLogger.info(
                    event = "dictation_transcription_cancelled",
                    fields = listOf(
                        "workspaceId" to context.runtimeStateMutable.value.workspaceId,
                        "cloudState" to context.currentCloudState().name,
                        "chatSessionId" to context.runtimeStateMutable.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
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

                val message = makeAiUserFacingErrorMessage(
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
                        activeAlert = context.textProvider.generalError(message = message),
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
