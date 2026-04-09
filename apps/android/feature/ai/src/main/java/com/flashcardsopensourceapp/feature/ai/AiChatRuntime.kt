package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.aiChatConsentRequiredMessage
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaButtonTitle
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaReachedMessage
import com.flashcardsopensourceapp.data.local.model.isSendableAiChatAttachment
import com.flashcardsopensourceapp.data.local.model.makeAiChatCardAttachment
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

private const val noSpeechRecordedMessage: String = "No speech was recorded."

internal class AiChatRuntime(
    scope: CoroutineScope,
    aiChatRepository: AiChatRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    appVersion: String,
    hasConsent: () -> Boolean,
    currentCloudState: () -> CloudAccountState,
    currentServerConfiguration: () -> CloudServiceConfiguration,
    currentSyncStatus: () -> SyncStatus
) {
    private val context = AiChatRuntimeContext(
        scope = scope,
        aiChatRepository = aiChatRepository,
        autoSyncEventRepository = autoSyncEventRepository,
        appVersion = appVersion,
        hasConsent = hasConsent,
        currentCloudState = currentCloudState,
        currentServerConfiguration = currentServerConfiguration,
        currentSyncStatus = currentSyncStatus
    )
    private lateinit var bootstrapCoordinator: AiChatBootstrapCoordinator
    private lateinit var liveStreamCoordinator: AiChatLiveStreamCoordinator
    private lateinit var lifecycleCoordinator: AiChatRuntimeLifecycleCoordinator

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
                val transcription = context.aiChatRepository.transcribeAudio(
                    workspaceId = runtimeStateMutable.value.workspaceId,
                    sessionId = runtimeStateMutable.value.persistedState.chatSessionId.ifBlank { null },
                    fileName = fileName,
                    mediaType = mediaType,
                    audioBytes = audioBytes
                )
                val transcript = transcription.text.trim()

                require(transcript.isNotEmpty()) {
                    noSpeechRecordedMessage
                }

                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(chatSessionId = transcription.sessionId),
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
                    configuration = currentServerConfiguration()
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = AiAlertState.GeneralError(message = message),
                        errorMessage = ""
                    )
                }
            }
        }
    }

    fun clearConversation() {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.IDLE) {
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
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.RUNNING) {
            return
        }

        val sessionId = runtimeStateMutable.value.persistedState.chatSessionId
        val workspaceId = runtimeStateMutable.value.workspaceId

        runtimeStateMutable.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.STOPPING,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentState()

        context.scope.launch {
            try {
                if (sessionId.isNotBlank()) {
                    val response = context.aiChatRepository.stopRun(
                        workspaceId = workspaceId,
                        sessionId = sessionId
                    )
                    if (response.stopped && response.stillRunning.not()) {
                        liveStreamCoordinator.finalizeStoppedConversation()
                        return@launch
                    }
                    if (
                        context.activeSendJob?.isActive != true
                        && context.activeLiveJob?.isActive != true
                        && runtimeStateMutable.value.activeRun == null
                    ) {
                        liveStreamCoordinator.finalizeStoppedConversation()
                    }
                    return@launch
                }
                liveStreamCoordinator.finalizeStoppedConversation()
            } catch (_: CancellationException) {
                throw CancellationException("Stop run cancelled.")
            } catch (_: Exception) {
                liveStreamCoordinator.finalizeStoppedConversation()
            }
        }
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
                draftMessage = aiEntryPrefillPrompt(prefill = prefill),
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
        if (
            currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
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
            requiresFreshSessionForCardHandoff(
                state = currentState,
                nowMillis = System.currentTimeMillis()
            ) || currentState.persistedState.chatSessionId.isBlank()
        ) {
            persistCurrentDraft(snapshot = currentState)
            startFreshConversation(
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
                activeAlert = AiAlertState.GeneralError(message = message),
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
        val currentState = runtimeStateMutable.value
        if (canSendMessage(state = currentState).not()) {
            if (hasConsent().not()) {
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeAlert = AiAlertState.GeneralError(message = aiChatConsentRequiredMessage),
                        errorMessage = ""
                    )
                }
            }
            return
        }

        val outgoingContent = makeUserContent(
            draftMessage = currentState.draftMessage,
            pendingAttachments = currentState.pendingAttachments
        )
        if (outgoingContent.isEmpty()) {
            return
        }

        AiChatDiagnosticsLogger.info(
            event = "ui_send_message_requested",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to currentState.persistedState.chatSessionId,
                "messageCount" to currentState.persistedState.messages.size.toString(),
                "pendingAttachmentCount" to currentState.pendingAttachments.size.toString(),
                "outgoingContentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = outgoingContent)
            )
        )

        runtimeStateMutable.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.PREPARING_SEND,
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }

        val previousPersistedState = runtimeStateMutable.value.persistedState
        val draftMessageBackup = runtimeStateMutable.value.draftMessage
        val pendingAttachmentsBackup = runtimeStateMutable.value.pendingAttachments

        context.activeSendJob?.cancel()
        context.activeSendJob = context.scope.launch {
            var didAcceptRun = false
            var didAppendOptimisticMessages = false
            try {
                // AI send is blocked on a direct sync so the backend run never starts
                // from stale local writes that are still sitting in the outbox.
                context.aiChatRepository.ensureReadyForSend(workspaceId = runtimeStateMutable.value.workspaceId)
                val nextPersistedState = runtimeStateMutable.value.persistedState.copy(
                    messages = runtimeStateMutable.value.persistedState.messages + listOf(
                        makeUserMessage(
                            content = outgoingContent,
                            timestampMillis = System.currentTimeMillis()
                        ),
                        makeAssistantStatusMessage(
                            timestampMillis = System.currentTimeMillis()
                        )
                    )
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = setPendingToolRunPostSync(
                            state = nextPersistedState,
                            pendingToolRunPostSync = false
                        ),
                        composerPhase = AiComposerPhase.STARTING_RUN,
                        runHadToolCalls = false
                    )
                }
                persistCurrentState()
                didAppendOptimisticMessages = true

                val response = context.aiChatRepository.startRun(
                    workspaceId = runtimeStateMutable.value.workspaceId,
                    state = nextPersistedState,
                    content = outgoingContent
                )
                didAcceptRun = true
                applyAcceptedRunResponse(response = response)
            } catch (error: CancellationException) {
                throw error
            } catch (error: AiChatRemoteException) {
                handleSendFailure(
                    error = error,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    previousPersistedState = previousPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup
                )
            } catch (error: Exception) {
                handleSendFailure(
                    error = error,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    previousPersistedState = previousPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup
                )
            } finally {
                runtimeStateMutable.update { state ->
                    state.copy(
                        composerPhase = when (state.composerPhase) {
                            AiComposerPhase.RUNNING, AiComposerPhase.STOPPING -> state.composerPhase
                            else -> AiComposerPhase.IDLE
                        },
                        isLiveAttached = if (state.composerPhase == AiComposerPhase.RUNNING || state.composerPhase == AiComposerPhase.STOPPING) {
                            state.isLiveAttached
                        } else {
                            false
                        },
                        repairStatus = null
                    )
                }
                persistCurrentState()
                context.activeSendJob = null
            }
        }
    }

    private fun updateComposerSuggestions(
        state: AiChatRuntimeState,
        nextSuggestions: List<AiChatComposerSuggestion>
    ): AiChatRuntimeState {
        return state.copy(serverComposerSuggestions = nextSuggestions)
    }

    private fun canSendMessage(state: AiChatRuntimeState): Boolean {
        if (hasConsent().not()) {
            return false
        }
        if (state.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return false
        }
        if (state.composerPhase != AiComposerPhase.IDLE) {
            return false
        }
        if (state.activeRun != null) {
            return false
        }
        if (state.dictationState != AiChatDictationState.IDLE) {
            return false
        }
        return state.draftMessage.trim().isNotEmpty()
            || state.pendingAttachments.any(::isSendableAiChatAttachment)
    }

    private suspend fun applyAcceptedRunResponse(
        response: com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
    ) {
        // Accepted responses can still mirror older recovered history before the
        // current turn is fully visible. We intentionally keep the accepted-path
        // detection broad here because an occasional zero-diff post-run sync is
        // an acceptable tradeoff for simpler cross-client recovery behavior.
        val runHadToolCalls = snapshotRunHasToolCalls(
            activeRun = response.activeRun,
            messages = response.conversation.messages
        )
        runtimeStateMutable.update { state ->
            updateComposerSuggestions(
                state = state.copy(
                    persistedState = state.persistedState.copy(
                        messages = response.conversation.messages,
                        chatSessionId = response.sessionId,
                        lastKnownChatConfig = response.chatConfig,
                        pendingToolRunPostSync = state.persistedState.pendingToolRunPostSync
                            || runHadToolCalls
                    ),
                    conversationScopeId = response.conversationScopeId,
                    hasOlder = response.conversation.hasOlder,
                    oldestCursor = response.conversation.oldestCursor,
                    activeRun = response.activeRun,
                    runHadToolCalls = runHadToolCalls,
                    isLiveAttached = false,
                    draftMessage = "",
                    pendingAttachments = emptyList(),
                    composerPhase = if (response.activeRun != null) {
                        AiComposerPhase.RUNNING
                    } else {
                        AiComposerPhase.IDLE
                    },
                    dictationState = AiChatDictationState.IDLE,
                    activeAlert = null,
                    errorMessage = ""
                ),
                nextSuggestions = response.composerSuggestions
            )
        }
        if (response.activeRun != null) {
            liveStreamCoordinator.attachAcceptedLiveStreamIfNeeded(
                workspaceId = runtimeStateMutable.value.workspaceId,
                response = response
            )
        } else {
            context.triggerToolRunPostSyncIfNeeded(reason = "accepted_response_terminal")
        }
        persistCurrentState()
    }

    private fun handleSendFailure(
        error: Exception,
        didAcceptRun: Boolean,
        didAppendOptimisticMessages: Boolean,
        previousPersistedState: com.flashcardsopensourceapp.data.local.model.AiChatPersistedState,
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>
    ) {
        val remoteError = error as? AiChatRemoteException
        if (remoteError?.code == "GUEST_AI_LIMIT_REACHED") {
            AiChatDiagnosticsLogger.warn(
                event = "send_failure_guest_quota_reached",
                fields = listOf(
                    "workspaceId" to runtimeStateMutable.value.workspaceId,
                    "cloudState" to currentCloudState().name,
                    "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                    "requestId" to remoteError.requestId,
                    "statusCode" to remoteError.statusCode?.toString(),
                    "code" to remoteError.code,
                    "stage" to remoteError.stage
                )
            )
            runtimeStateMutable.update { state ->
                state.copy(
                    persistedState = appendAssistantAccountUpgradePrompt(
                        state = state.persistedState,
                        message = aiChatGuestQuotaReachedMessage,
                        buttonTitle = aiChatGuestQuotaButtonTitle,
                        timestampMillis = System.currentTimeMillis()
                    ),
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    errorMessage = ""
                )
            }
            return
        }

        if (didAcceptRun.not() && didAppendOptimisticMessages) {
            runtimeStateMutable.update { state ->
                state.copy(
                    persistedState = previousPersistedState,
                    draftMessage = draftMessage,
                    pendingAttachments = pendingAttachments,
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    repairStatus = null
                )
            }
        }

        if (didAcceptRun.not() && remoteError?.code == "CHAT_ACTIVE_RUN_IN_PROGRESS") {
            runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    activeAlert = AiAlertState.GeneralError(
                        message = "A response is already in progress. Wait for it to finish or stop it before sending another message."
                    ),
                    errorMessage = ""
                )
            }
            return
        }

        val message = makeAiUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration()
        )
        val currentState = runtimeStateMutable.value
        AiChatDiagnosticsLogger.error(
            event = "send_failure_handled",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to currentState.persistedState.chatSessionId,
                "messageCount" to currentState.persistedState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )
        runtimeStateMutable.update { state ->
            state.copy(
                activeRun = null,
                isLiveAttached = false,
                composerPhase = AiComposerPhase.IDLE,
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    private fun handleNewChatFailure(error: Exception) {
        val remoteError = error as? AiChatRemoteException
        val message = makeAiUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration()
        )

        AiChatDiagnosticsLogger.error(
            event = "new_chat_failure_handled",
            fields = listOf(
                "workspaceId" to runtimeStateMutable.value.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                "messageCount" to runtimeStateMutable.value.persistedState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )

        runtimeStateMutable.update { state ->
            state.copy(
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    private fun hasConsent(): Boolean {
        return context.hasConsent()
    }

    private fun isConversationDirty(state: AiChatRuntimeState): Boolean {
        return state.persistedState.messages.isNotEmpty()
            || state.draftMessage.trim().isNotEmpty()
            || state.pendingAttachments.isNotEmpty()
    }

    private fun requiresFreshSessionForCardHandoff(
        state: AiChatRuntimeState,
        nowMillis: Long
    ): Boolean {
        return isConversationDirty(state = state)
            || state.activeRun != null
            || state.composerPhase != AiComposerPhase.IDLE
            || isAiChatConversationStale(
                messages = state.persistedState.messages,
                nowMillis = nowMillis
            )
    }

    private fun canApplyFreshSessionEnsureResponse(
        state: AiChatRuntimeState,
        targetSessionId: String
    ): Boolean {
        return state.persistedState.chatSessionId == targetSessionId
            && state.persistedState.messages.isEmpty()
            && state.activeRun == null
            && state.composerPhase == AiComposerPhase.IDLE
    }

    private fun startFreshConversation(
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>,
        shouldFocusComposer: Boolean
    ) {
        val currentState = runtimeStateMutable.value
        persistCurrentDraft(snapshot = currentState)
        initializeFreshConversation(
            workspaceId = currentState.workspaceId,
            targetSessionId = makeClientChatSessionId(),
            draftMessage = draftMessage,
            pendingAttachments = pendingAttachments,
            shouldFocusComposer = shouldFocusComposer
        )
    }

    private fun initializeFreshConversation(
        workspaceId: String?,
        targetSessionId: String,
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>,
        shouldFocusComposer: Boolean
    ) {
        context.scope.launch {
            try {
                context.activeSendJob?.cancelAndJoin()
                context.activeSendJob = null
                context.activeBootstrapJob?.cancel(
                    cause = CancellationException("AI bootstrap cancelled because a new chat was requested.")
                )
                context.activeBootstrapJob = null
                context.activeWarmUpJob?.cancel(
                    cause = CancellationException("AI warm-up cancelled because a new chat was requested.")
                )
                context.activeWarmUpJob = null
                liveStreamCoordinator.detachLiveStream(reason = "AI live stream detached because a new chat was requested.")
                runtimeStateMutable.update { state ->
                    state.copy(
                        workspaceId = workspaceId,
                        persistedState = state.persistedState.copy(
                            messages = emptyList(),
                            chatSessionId = targetSessionId,
                            pendingToolRunPostSync = false
                        ),
                        conversationScopeId = targetSessionId,
                        hasOlder = false,
                        oldestCursor = null,
                        activeRun = null,
                        runHadToolCalls = false,
                        isLiveAttached = false,
                        draftMessage = draftMessage,
                        pendingAttachments = pendingAttachments,
                        focusComposerRequestVersion = if (shouldFocusComposer) {
                            state.focusComposerRequestVersion + 1L
                        } else {
                            state.focusComposerRequestVersion
                        },
                        serverComposerSuggestions = emptyList(),
                        composerPhase = AiComposerPhase.IDLE,
                        dictationState = AiChatDictationState.IDLE,
                        conversationBootstrapState = AiConversationBootstrapState.READY,
                        conversationBootstrapErrorMessage = "",
                        repairStatus = null,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
                persistCurrentState()
                val snapshot = context.aiChatRepository.createNewSession(
                    workspaceId = workspaceId,
                    sessionId = targetSessionId
                )
                if (
                    snapshot.sessionId != targetSessionId
                    || canApplyFreshSessionEnsureResponse(
                        state = runtimeStateMutable.value,
                        targetSessionId = targetSessionId
                    ).not()
                ) {
                    return@launch
                }
                runtimeStateMutable.update { state ->
                    updateComposerSuggestions(
                        state = state.copy(
                            persistedState = state.persistedState.copy(
                                lastKnownChatConfig = snapshot.chatConfig
                            ),
                            conversationScopeId = snapshot.conversationScopeId,
                            activeAlert = null,
                            errorMessage = ""
                        ),
                        nextSuggestions = snapshot.composerSuggestions
                    )
                }
                persistCurrentState()
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "new_chat_cancelled",
                    fields = listOf(
                        "workspaceId" to runtimeStateMutable.value.workspaceId,
                        "cloudState" to currentCloudState().name,
                        "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                handleNewChatFailure(error = error)
            }
        }
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

private fun makeClientChatSessionId(): String {
    return UUID.randomUUID().toString().lowercase()
}
