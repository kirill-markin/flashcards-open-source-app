package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.makeAiChatCardAttachment
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import com.flashcardsopensourceapp.feature.ai.aiEntryPrefillPrompt
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class AiChatRuntime(
    scope: CoroutineScope,
    aiChatRepository: AiChatRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    appVersion: String,
    textProvider: AiTextProvider,
    hasConsent: () -> Boolean,
    currentCloudState: () -> CloudAccountState,
    currentServerConfiguration: () -> CloudServiceConfiguration,
    currentSyncStatus: () -> SyncStatus,
    currentUiLocaleTag: () -> String?
) {
    private val context = AiChatRuntimeContext(
        scope = scope,
        aiChatRepository = aiChatRepository,
        autoSyncEventRepository = autoSyncEventRepository,
        appVersion = appVersion,
        textProvider = textProvider,
        hasConsent = hasConsent,
        currentCloudState = currentCloudState,
        currentServerConfiguration = currentServerConfiguration,
        currentSyncStatus = currentSyncStatus,
        currentUiLocaleTag = currentUiLocaleTag
    )
    private lateinit var bootstrapCoordinator: AiChatBootstrapCoordinator
    private lateinit var liveStreamCoordinator: AiChatLiveStreamCoordinator
    private lateinit var lifecycleCoordinator: AiChatRuntimeLifecycleCoordinator
    private lateinit var sessionCoordinator: AiChatSessionCoordinator
    private lateinit var sendCoordinator: AiChatSendCoordinator

    init {
        liveStreamCoordinator = AiChatLiveStreamCoordinator(
            context = context,
            restartConversationBootstrap = { forceReloadState, resumeDiagnostics ->
                bootstrapCoordinator.startConversationBootstrap(
                    forceReloadState = forceReloadState,
                    resumeDiagnostics = resumeDiagnostics
                )
            },
            applyActiveBootstrap = { response ->
                bootstrapCoordinator.applyActiveBootstrap(response = response)
            }
        )
        sessionCoordinator = AiChatSessionCoordinator(
            context = context,
            detachLiveStream = { reason ->
                liveStreamCoordinator.detachLiveStream(reason = reason)
            }
        )
        bootstrapCoordinator = AiChatBootstrapCoordinator(
            context = context,
            attachBootstrapLiveStream = { workspaceId, response, resumeDiagnostics ->
                liveStreamCoordinator.attachBootstrapLiveIfNeeded(
                    workspaceId = workspaceId,
                    response = response,
                    resumeDiagnostics = resumeDiagnostics
                )
            }
        )
        lifecycleCoordinator = AiChatRuntimeLifecycleCoordinator(
            context = context,
            startConversationBootstrap = { forceReloadState, resumeDiagnostics ->
                bootstrapCoordinator.startConversationBootstrap(
                    forceReloadState = forceReloadState,
                    resumeDiagnostics = resumeDiagnostics
                )
            },
            detachLiveStream = { reason ->
                liveStreamCoordinator.detachLiveStream(reason = reason)
            }
        )
        sendCoordinator = AiChatSendCoordinator(
            context = context,
            liveStreamCoordinator = liveStreamCoordinator,
            sessionCoordinator = sessionCoordinator
        )
    }

    private val runtimeStateMutable: MutableStateFlow<AiChatRuntimeState>
        get() = context.runtimeStateMutable

    val state: StateFlow<AiChatRuntimeState> = context.state

    fun updateAccessContext(accessContext: AiAccessContext) {
        lifecycleCoordinator.updateAccessContext(accessContext = accessContext)
    }

    fun updateDraftMessage(draftMessage: String) {
        runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = draftMessage,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentDraft()
    }

    fun applyComposerSuggestion(suggestion: AiChatComposerSuggestion) {
        runtimeStateMutable.update { state ->
            val separator = if (state.draftMessage.isBlank() || state.draftMessage.endsWith(" ")) {
                ""
            } else {
                " "
            }
            state.copy(
                draftMessage = state.draftMessage + separator + suggestion.text,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentDraft()
    }

    fun addPendingAttachment(attachment: AiChatAttachment) {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        runtimeStateMutable.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments + attachment,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentDraft()
    }

    fun removePendingAttachment(attachmentId: String) {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        runtimeStateMutable.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments.filter { attachment ->
                    attachment.id != attachmentId
                },
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentDraft()
    }

    fun startDictationPermissionRequest() {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.REQUESTING_PERMISSION,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun startDictationRecording() {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.RECORDING,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun cancelDictation() {
        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null
            )
        }
    }

    fun transcribeRecordedAudio(
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ) {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.dictationState != AiChatDictationState.RECORDING) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.TRANSCRIBING,
                activeAlert = null,
                errorMessage = ""
            )
        }

        context.scope.launch {
            try {
                val ensuredSession = sessionCoordinator.ensureSessionIdIfNeeded()
                val transcription = context.aiChatRepository.transcribeAudio(
                    workspaceId = runtimeStateMutable.value.workspaceId,
                    sessionId = ensuredSession.sessionId,
                    fileName = fileName,
                    mediaType = mediaType,
                    audioBytes = audioBytes
                )
                require(transcription.sessionId == ensuredSession.sessionId) {
                    "AI dictation returned mismatched sessionId. expectedSessionId=${ensuredSession.sessionId} responseSessionId=${transcription.sessionId}"
                }
                val transcript = transcription.text.trim()

                require(transcript.isNotEmpty()) {
                    context.textProvider.noSpeechRecorded
                }

                runtimeStateMutable.update { state ->
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
                persistCurrentState()
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "dictation_transcription_cancelled",
                    fields = listOf(
                        "workspaceId" to runtimeStateMutable.value.workspaceId,
                        "cloudState" to currentCloudState().name,
                        "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.DICTATION,
                    configuration = currentServerConfiguration(),
                    textProvider = context.textProvider
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = context.textProvider.generalError(message = message),
                        errorMessage = ""
                    )
                }
            }
        }
    }

    fun clearConversation() {
        val currentState = runtimeStateMutable.value
        if (canClearConversation(state = currentState).not()) {
            return
        }

        startFreshConversation(
            draftMessage = "",
            pendingAttachments = emptyList(),
            shouldFocusComposer = false
        )
    }

    fun dismissErrorMessage() {
        runtimeStateMutable.update { state ->
            state.copy(errorMessage = "")
        }
    }

    fun dismissAlert() {
        runtimeStateMutable.update { state ->
            state.copy(activeAlert = null)
        }
    }

    fun stopStreaming() {
        sendCoordinator.stopStreaming()
    }

    fun applyEntryPrefill(prefill: AiEntryPrefill) {
        val currentState = runtimeStateMutable.value
        if (
            currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || currentState.composerPhase != AiComposerPhase.IDLE
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = aiEntryPrefillPrompt(
                    prefill = prefill,
                    textProvider = context.textProvider
                ),
                focusComposerRequestVersion = state.focusComposerRequestVersion + 1L,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentDraft()
    }

    fun handoffCardToChat(
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>,
        effortLevel: EffortLevel
    ): Boolean {
        val currentState = runtimeStateMutable.value
        AiChatDiagnosticsLogger.info(
            event = "ai_runtime_handoff_requested",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cardId" to cardId,
                "conversationBootstrapState" to currentState.conversationBootstrapState.name,
                "dictationState" to currentState.dictationState.name,
                "composerPhase" to currentState.composerPhase.name,
                "chatSessionIdBlank" to currentState.persistedState.chatSessionId.isBlank().toString(),
                "pendingAttachmentCount" to currentState.pendingAttachments.size.toString(),
                "draftLength" to currentState.draftMessage.length.toString(),
                "messageCount" to currentState.persistedState.messages.size.toString()
            )
        )
        if (
            currentState.workspaceId == null
            || currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
            AiChatDiagnosticsLogger.warn(
                event = "ai_runtime_handoff_rejected_not_ready",
                fields = listOf(
                    "workspaceId" to currentState.workspaceId,
                    "cardId" to cardId,
                    "conversationBootstrapState" to currentState.conversationBootstrapState.name,
                    "dictationState" to currentState.dictationState.name
                )
            )
            return false
        }
        if (
            shouldPrepareGuestAccess(
                accessContext = context.activeAccessContext,
                hasConsent = context.hasConsent()
            )
        ) {
            AiChatDiagnosticsLogger.warn(
                event = "ai_runtime_handoff_rejected_access_preparing",
                fields = listOf(
                    "workspaceId" to currentState.workspaceId,
                    "cardId" to cardId,
                    "cloudState" to currentCloudState().name,
                    "conversationBootstrapState" to currentState.conversationBootstrapState.name
                )
            )
            return false
        }
        val pendingCardAttachment = makeAiChatCardAttachment(
            cardId = cardId,
            frontText = frontText,
            backText = backText,
            tags = tags,
            effortLevel = effortLevel
        )

        if (
            requiresManualFreshSessionForCardHandoff(
                state = currentState
            )
        ) {
            AiChatDiagnosticsLogger.warn(
                event = "ai_runtime_handoff_rejected_dirty_state",
                fields = listOf(
                    "workspaceId" to currentState.workspaceId,
                    "cardId" to cardId,
                    "composerPhase" to currentState.composerPhase.name,
                    "pendingAttachmentCount" to currentState.pendingAttachments.size.toString(),
                    "draftLength" to currentState.draftMessage.length.toString(),
                    "messageCount" to currentState.persistedState.messages.size.toString(),
                    "hasActiveRun" to (currentState.activeRun != null).toString()
                )
            )
            runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = context.textProvider.generalError(
                        message = context.textProvider.cardHandoffRequiresNewChat
                    ),
                    errorMessage = ""
                )
            }
            return false
        }

        if (currentState.persistedState.chatSessionId.isBlank()) {
            AiChatDiagnosticsLogger.info(
                event = "ai_runtime_handoff_start_fresh_conversation",
                fields = listOf(
                    "workspaceId" to currentState.workspaceId,
                    "cardId" to cardId
                )
            )
            persistCurrentDraft(snapshot = currentState)
            sessionCoordinator.startFreshConversation(
                draftMessage = "",
                pendingAttachments = listOf(pendingCardAttachment),
                shouldFocusComposer = true
            )
            return true
        }

        runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = "",
                pendingAttachments = listOf(pendingCardAttachment),
                focusComposerRequestVersion = state.focusComposerRequestVersion + 1L,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentDraft()
        AiChatDiagnosticsLogger.info(
            event = "ai_runtime_handoff_applied_to_existing_session",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cardId" to cardId,
                "chatSessionId" to currentState.persistedState.chatSessionId,
                "pendingAttachmentCount" to "1"
            )
        )
        return true
    }

    fun showAlert(alert: AiAlertState) {
        runtimeStateMutable.update { state ->
            state.copy(
                activeAlert = alert,
                errorMessage = ""
            )
        }
    }

    fun showErrorMessage(message: String) {
        runtimeStateMutable.update { state ->
            state.copy(
                activeAlert = context.textProvider.generalError(message = message),
                errorMessage = ""
            )
        }
    }

    fun retryBootstrap() {
        if (hasConsent().not()) {
            return
        }
        if (runtimeStateMutable.value.workspaceId == null) {
            return
        }

        bootstrapCoordinator.startConversationBootstrap(
            forceReloadState = true,
            resumeDiagnostics = null
        )
    }

    fun onScreenVisible() {
        lifecycleCoordinator.onScreenVisible()
    }

    fun onScreenHidden() {
        lifecycleCoordinator.onScreenHidden()
    }
    fun warmUpLinkedSessionIfNeeded(
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
    ) {
        lifecycleCoordinator.warmUpLinkedSessionIfNeeded(resumeDiagnostics = resumeDiagnostics)
    }

    fun sendMessage() {
        sendCoordinator.sendMessage()
    }

    private fun hasConsent(): Boolean {
        return context.hasConsent()
    }

    private fun isConversationDirty(state: AiChatRuntimeState): Boolean {
        return state.persistedState.messages.isNotEmpty()
            || state.draftMessage.trim().isNotEmpty()
            || state.pendingAttachments.isNotEmpty()
    }

    private fun requiresManualFreshSessionForCardHandoff(
        state: AiChatRuntimeState
    ): Boolean {
        return isConversationDirty(state = state)
            || state.activeRun != null
            || state.composerPhase != AiComposerPhase.IDLE
    }

    private fun canClearConversation(state: AiChatRuntimeState): Boolean {
        if (state.activeRun != null) {
            return false
        }
        if (state.composerPhase != AiComposerPhase.IDLE) {
            return false
        }
        if (state.dictationState != AiChatDictationState.IDLE) {
            return false
        }
        return true
    }

    private fun startFreshConversation(
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>,
        shouldFocusComposer: Boolean
    ) {
        sessionCoordinator.startFreshConversation(
            draftMessage = draftMessage,
            pendingAttachments = pendingAttachments,
            shouldFocusComposer = shouldFocusComposer
        )
    }

    private fun currentCloudState(): CloudAccountState {
        return context.currentCloudState()
    }

    private fun currentServerConfiguration(): CloudServiceConfiguration {
        return context.currentServerConfiguration()
    }

    private fun persistCurrentState() {
        context.persistCurrentState()
    }

    private fun persistCurrentDraft(snapshot: AiChatRuntimeState = runtimeStateMutable.value) {
        context.persistDraft(snapshot = snapshot)
    }
}
