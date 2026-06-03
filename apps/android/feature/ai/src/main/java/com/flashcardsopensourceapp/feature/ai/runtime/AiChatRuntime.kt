package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.effectiveAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeAiChatCardAttachment
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.feature.ai.AiCardHandoffResult
import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import com.flashcardsopensourceapp.feature.ai.aiEntryPrefillPrompt
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiAccessContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canEditAiDraft
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canEditAiDraftText
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canManageAiDraftAttachments
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canPrepareAiDraftInComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.shouldPrepareGuestAccess
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.AiChatBootstrapCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.AiChatDictationCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.AiChatLiveStreamCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.AiChatRuntimeLifecycleCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.AiChatSendCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.AiChatSessionCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatWarning
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatWarning
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

internal class AiChatRuntime(
    scope: CoroutineScope,
    aiChatRepository: AiChatRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    appVersion: String,
    versionCode: Int,
    textProvider: AiTextProvider,
    hasConsent: () -> Boolean,
    currentCloudState: () -> CloudAccountState,
    currentServerConfiguration: () -> CloudServiceConfiguration,
    currentSyncStatus: () -> SyncStatus,
    currentUiLocaleTag: () -> String?,
    observability: AppObservability
) {
    private val context = AiChatRuntimeContext(
        scope = scope,
        aiChatRepository = aiChatRepository,
        autoSyncEventRepository = autoSyncEventRepository,
        appVersion = appVersion,
        versionCode = versionCode,
        textProvider = textProvider,
        hasConsent = hasConsent,
        currentCloudState = currentCloudState,
        currentServerConfiguration = currentServerConfiguration,
        currentSyncStatus = currentSyncStatus,
        currentUiLocaleTag = currentUiLocaleTag,
        observability = observability
    )
    private lateinit var bootstrapCoordinator: AiChatBootstrapCoordinator
    private lateinit var liveStreamCoordinator: AiChatLiveStreamCoordinator
    private lateinit var lifecycleCoordinator: AiChatRuntimeLifecycleCoordinator
    private lateinit var sessionCoordinator: AiChatSessionCoordinator
    private lateinit var sendCoordinator: AiChatSendCoordinator
    private lateinit var dictationCoordinator: AiChatDictationCoordinator

    init {
        liveStreamCoordinator = AiChatLiveStreamCoordinator(
            context = context,
            restartConversationBootstrap = { forceReloadState, resumeDiagnostics ->
                bootstrapCoordinator.startConversationBootstrap(
                    forceReloadState = forceReloadState,
                    resumeDiagnostics = resumeDiagnostics
                )
            },
            applyActiveBootstrap = { response, expectedSessionId ->
                bootstrapCoordinator.applyActiveBootstrap(
                    response = response,
                    expectedSessionId = expectedSessionId
                )
            }
        )
        sessionCoordinator = AiChatSessionCoordinator(
            context = context,
            detachLiveStream = { reason ->
                liveStreamCoordinator.detachLiveStream(reason = reason)
            },
            cancelActiveDictation = { reason ->
                dictationCoordinator.cancelActiveTranscription(reason = reason)
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
            },
            cancelActiveDictation = { reason ->
                dictationCoordinator.cancelActiveTranscription(reason = reason)
            }
        )
        sendCoordinator = AiChatSendCoordinator(
            context = context,
            liveStreamCoordinator = liveStreamCoordinator,
            sessionCoordinator = sessionCoordinator
        )
        dictationCoordinator = AiChatDictationCoordinator(
            context = context,
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
        if (canEditAiDraftText(state = runtimeStateMutable.value).not()) {
            return
        }
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
        if (canEditAiDraft(state = runtimeStateMutable.value).not()) {
            return
        }
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
        val currentState = runtimeStateMutable.value
        val chatConfig = effectiveAiChatServerConfig(currentState.persistedState.lastKnownChatConfig)
        if (
            canManageAiDraftAttachments(state = currentState).not()
            || chatConfig.features.attachmentsEnabled.not()
        ) {
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
        if (canManageAiDraftAttachments(state = runtimeStateMutable.value).not()) {
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
        dictationCoordinator.startDictationPermissionRequest()
    }

    fun startDictationRecording() {
        dictationCoordinator.startDictationRecording()
    }

    fun cancelDictation() {
        dictationCoordinator.cancelDictation()
    }

    fun transcribeRecordedAudio(
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ) {
        dictationCoordinator.transcribeRecordedAudio(
            fileName = fileName,
            mediaType = mediaType,
            audioBytes = audioBytes
        )
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

    fun applyEntryPrefill(prefill: AiEntryPrefill): Boolean {
        val currentState = runtimeStateMutable.value
        if (
            currentState.workspaceId == null
            || context.hasConsent().not()
            || currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || canPrepareAiDraftInComposerPhase(composerPhase = currentState.composerPhase).not()
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
            return false
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
        return true
    }

    fun handoffCardToChat(
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>,
        effortLevel: EffortLevel
    ): AiCardHandoffResult {
        val currentState = runtimeStateMutable.value
        context.observability.recordAiChatBreadcrumb(
            breadcrumb = AiChatBreadcrumb.RuntimeHandoffRequested(
                workspaceId = currentState.workspaceId,
                cardId = cardId,
                conversationBootstrapState = currentState.conversationBootstrapState.name,
                dictationState = currentState.dictationState.name,
                composerPhase = currentState.composerPhase.name,
                chatSessionIdBlank = currentState.persistedState.chatSessionId.isBlank(),
                pendingAttachmentCount = currentState.pendingAttachments.size,
                draftLength = currentState.draftMessage.length,
                messageCount = currentState.persistedState.messages.size
            )
        )
        if (
            currentState.workspaceId == null
            || currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
            context.observability.recordAiChatWarning(
                warning = AiChatWarning.RuntimeHandoffRejectedNotReady(
                    workspaceId = currentState.workspaceId,
                    cardId = cardId,
                    conversationBootstrapState = currentState.conversationBootstrapState.name,
                    dictationState = currentState.dictationState.name
                )
            )
            return AiCardHandoffResult.DEFERRED
        }
        if (canPrepareAiDraftInComposerPhase(composerPhase = currentState.composerPhase).not()) {
            context.observability.recordAiChatWarning(
                warning = AiChatWarning.RuntimeHandoffRejectedLockedPhase(
                    workspaceId = currentState.workspaceId,
                    cardId = cardId,
                    composerPhase = currentState.composerPhase.name
                )
            )
            return AiCardHandoffResult.DEFERRED
        }
        if (
            shouldPrepareGuestAccess(
                accessContext = context.activeAccessContext,
                hasConsent = context.hasConsent()
            )
        ) {
            context.observability.recordAiChatWarning(
                warning = AiChatWarning.RuntimeHandoffRejectedAccessPreparing(
                    workspaceId = currentState.workspaceId,
                    cardId = cardId,
                    cloudState = currentCloudState().name,
                    conversationBootstrapState = currentState.conversationBootstrapState.name
                )
            )
            return AiCardHandoffResult.DEFERRED
        }
        val pendingCardAttachment = makeAiChatCardAttachment(
            cardId = cardId,
            frontText = frontText,
            backText = backText,
            tags = tags,
            effortLevel = effortLevel
        )

        if (currentState.composerPhase == AiComposerPhase.RUNNING) {
            runtimeStateMutable.update { state ->
                state.copy(
                    pendingAttachments = state.pendingAttachments + pendingCardAttachment,
                    focusComposerRequestVersion = state.focusComposerRequestVersion + 1L,
                    activeAlert = null,
                    errorMessage = ""
                )
            }
            persistCurrentDraft()
            context.observability.recordAiChatBreadcrumb(
                breadcrumb = AiChatBreadcrumb.RuntimeHandoffAppliedToRunningDraft(
                    workspaceId = currentState.workspaceId,
                    cardId = cardId,
                    chatSessionId = currentState.persistedState.chatSessionId,
                    pendingAttachmentCount = currentState.pendingAttachments.size + 1
                )
            )
            return AiCardHandoffResult.APPLIED
        }

        if (
            requiresManualFreshSessionForCardHandoff(
                state = currentState
            )
        ) {
            runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = context.textProvider.generalError(
                        message = context.textProvider.cardHandoffRequiresNewChat
                    ),
                    errorMessage = ""
                )
            }
            return AiCardHandoffResult.REQUIRES_FRESH_CHAT
        }

        if (currentState.persistedState.chatSessionId.isBlank()) {
            context.observability.recordAiChatBreadcrumb(
                breadcrumb = AiChatBreadcrumb.RuntimeHandoffStartFreshConversation(
                    workspaceId = currentState.workspaceId,
                    cardId = cardId
                )
            )
            persistCurrentDraft(snapshot = currentState)
            sessionCoordinator.startFreshConversation(
                draftMessage = "",
                pendingAttachments = listOf(pendingCardAttachment),
                shouldFocusComposer = true
            )
            return AiCardHandoffResult.APPLIED
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
        context.observability.recordAiChatBreadcrumb(
            breadcrumb = AiChatBreadcrumb.RuntimeHandoffAppliedToExistingSession(
                workspaceId = currentState.workspaceId,
                cardId = cardId,
                chatSessionId = currentState.persistedState.chatSessionId,
                pendingAttachmentCount = 1
            )
        )
        return AiCardHandoffResult.APPLIED
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

    private fun persistCurrentDraft(snapshot: AiChatRuntimeState = runtimeStateMutable.value) {
        context.persistDraft(snapshot = snapshot)
    }
}
