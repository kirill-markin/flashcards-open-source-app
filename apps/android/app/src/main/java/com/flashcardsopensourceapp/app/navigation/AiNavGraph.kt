package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
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
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                appVersion = appGraph.appPackageInfo.versionName
            )
        )
        val uiState by aiViewModel.uiState.collectAsStateWithLifecycle()
        val entryPrefillRequest by appGraph.appHandoffCoordinator.observeAiEntryPrefill().collectAsStateWithLifecycle()

        LaunchedEffect(entryPrefillRequest?.requestId) {
            val request = entryPrefillRequest ?: return@LaunchedEffect
            aiViewModel.applyEntryPrefill(prefill = request.prefill)
            appGraph.appHandoffCoordinator.consumeAiEntryPrefill(requestId = request.requestId)
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
