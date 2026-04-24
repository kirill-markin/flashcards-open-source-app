package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.feature.ai.AiRoute
import com.flashcardsopensourceapp.feature.ai.createAiViewModelFactory

internal fun NavGraphBuilder.registerAiNavGraph(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = AiDestination.route) {
        val aiViewModel = viewModel<com.flashcardsopensourceapp.feature.ai.AiViewModel>(
            factory = createAiViewModelFactory(
                aiChatRepository = appGraph.aiChatRepository,
                syncRepository = appGraph.syncRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                appVersion = appGraph.appPackageInfo.versionName
            )
        )
        val uiState by aiViewModel.uiState.collectAsStateWithLifecycle()
        val entryPrefillRequest by appGraph.appHandoffCoordinator.observeAiEntryPrefill().collectAsStateWithLifecycle()
        val cardHandoffRequest by appGraph.appHandoffCoordinator.observeAiCardHandoff().collectAsStateWithLifecycle()

        LaunchedEffect(
            entryPrefillRequest?.requestId,
            uiState.canEditDraft,
            uiState.isConsentRequired,
            uiState.isConversationReady
        ) {
            val request = entryPrefillRequest ?: return@LaunchedEffect
            if (
                uiState.canEditDraft.not()
                || uiState.isConsentRequired
                || uiState.isConversationReady.not()
            ) {
                return@LaunchedEffect
            }
            val didApplyRequest = aiViewModel.applyEntryPrefill(prefill = request.prefill)
            if (didApplyRequest) {
                appGraph.appHandoffCoordinator.consumeAiEntryPrefill(requestId = request.requestId)
            }
        }

        LaunchedEffect(
            cardHandoffRequest?.requestId,
            uiState.isCardHandoffReady,
            uiState.dictationState
        ) {
            val request = cardHandoffRequest ?: return@LaunchedEffect
            AiChatDiagnosticsLogger.info(
                event = "ai_nav_handoff_effect_started",
                fields = listOf(
                    "requestId" to request.requestId.toString(),
                    "cardId" to request.cardId,
                    "uiCardHandoffReady" to uiState.isCardHandoffReady.toString(),
                    "uiConsentRequired" to uiState.isConsentRequired.toString(),
                    "uiConversationReady" to uiState.isConversationReady.toString(),
                    "uiConversationLoading" to uiState.isConversationLoading.toString(),
                    "uiDictationState" to uiState.dictationState.name,
                    "uiPendingAttachmentCount" to uiState.pendingAttachments.size.toString(),
                    "uiDraftLength" to uiState.draftMessage.length.toString()
                )
            )
            if (uiState.isCardHandoffReady.not()) {
                AiChatDiagnosticsLogger.info(
                    event = "ai_nav_handoff_effect_deferred",
                    fields = listOf(
                        "requestId" to request.requestId.toString(),
                        "cardId" to request.cardId,
                        "uiCardHandoffReady" to uiState.isCardHandoffReady.toString(),
                        "isConsentRequired" to uiState.isConsentRequired.toString(),
                        "uiConversationReady" to uiState.isConversationReady.toString(),
                        "uiConversationLoading" to uiState.isConversationLoading.toString(),
                        "uiDictationState" to uiState.dictationState.name
                    )
                )
                return@LaunchedEffect
            }
            val didApplyRequest = aiViewModel.handoffCardToChat(
                cardId = request.cardId,
                frontText = request.frontText,
                backText = request.backText,
                tags = request.tags,
                effortLevel = request.effortLevel
            )
            AiChatDiagnosticsLogger.info(
                event = "ai_nav_handoff_effect_finished",
                fields = listOf(
                    "requestId" to request.requestId.toString(),
                    "cardId" to request.cardId,
                    "didApplyRequest" to didApplyRequest.toString()
                )
            )
            if (didApplyRequest) {
                appGraph.appHandoffCoordinator.consumeAiCardHandoff(requestId = request.requestId)
            }
        }

        AiRoute(
            uiState = uiState,
            onAcceptConsent = aiViewModel::acceptConsent,
            onDraftMessageChange = aiViewModel::updateDraftMessage,
            onApplyComposerSuggestion = aiViewModel::applyComposerSuggestion,
            onSendMessage = aiViewModel::sendMessage,
            onCancelStreaming = aiViewModel::cancelStreaming,
            onNewChat = aiViewModel::clearConversation,
            onOpenAccountStatus = {
                navController.navigate(route = SettingsAccountSignInEmailDestination.route)
            },
            onDismissErrorMessage = aiViewModel::dismissErrorMessage,
            onDismissAlert = aiViewModel::dismissAlert,
            onAddPendingAttachment = aiViewModel::addPendingAttachment,
            onRemovePendingAttachment = aiViewModel::removePendingAttachment,
            onStartDictationPermissionRequest = aiViewModel::startDictationPermissionRequest,
            onStartDictationRecording = aiViewModel::startDictationRecording,
            onTranscribeRecordedAudio = aiViewModel::transcribeRecordedAudio,
            onCancelDictation = aiViewModel::cancelDictation,
            onScreenVisible = aiViewModel::onScreenVisible,
            onScreenHidden = aiViewModel::onScreenHidden,
            onWarmUpSessionIfNeeded = aiViewModel::warmUpLinkedSessionIfNeeded,
            onRetryConversationLoad = aiViewModel::retryConversationBootstrap,
            onShowAlert = aiViewModel::showAlert,
            onShowErrorMessage = aiViewModel::showErrorMessage
        )
    }
}
