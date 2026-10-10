package com.flashcardsopensourceapp.app.navigation.ai

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.analytics.analyticsMediaUploadFailureReason
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.premium.PremiumPresenter
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.app.navigation.AiDestination
import com.flashcardsopensourceapp.app.navigation.rememberRouteBackStackEntry
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountSignInEmailDestination
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermission
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermissionOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.feature.ai.AiCardHandoffResult
import com.flashcardsopensourceapp.feature.ai.AiRoute
import com.flashcardsopensourceapp.feature.ai.AiViewModel
import com.flashcardsopensourceapp.feature.ai.createAiViewModelFactory
import com.flashcardsopensourceapp.feature.ai.history.AiChatHistoryReaderRoute
import com.flashcardsopensourceapp.feature.ai.history.AiChatHistoryReaderState
import com.flashcardsopensourceapp.feature.ai.history.AiChatHistoryRoute
import com.flashcardsopensourceapp.feature.ai.history.AiChatHistoryViewModel
import com.flashcardsopensourceapp.feature.ai.history.createAiChatHistoryViewModelFactory

internal data object AiChatHistoryDestination {
    const val route: String = "ai/history"
}

internal data object AiChatHistoryReaderDestination {
    const val routePrefix: String = "ai/history/chat"
    const val routeArgument: String = "sessionId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(sessionId: String): String {
        return "$routePrefix/$sessionId"
    }
}

internal fun NavGraphBuilder.registerAiNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    premiumPresenter: PremiumPresenter
) {
    composable(route = AiDestination.route) { backStackEntry ->
        val aiViewModel = sharedAiViewModel(
            appGraph = appGraph,
            viewModelStoreOwner = backStackEntry
        )
        val uiState by aiViewModel.uiState.collectAsStateWithLifecycle()
        val quotaRefusal = uiState.activeAlert as? AiAlertState.AiLimitReached
        LaunchedEffect(quotaRefusal?.requestId) {
            val refusal = quotaRefusal ?: return@LaunchedEffect
            aiViewModel.dismissAlert()
            premiumPresenter.showAiLimit(refusal = refusal)
        }
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
            val handoffResult = aiViewModel.handoffCardToChat(
                cardId = request.cardId,
                frontText = request.frontText,
                backText = request.backText,
                tags = request.tags
            )
            AiChatDiagnosticsLogger.info(
                event = "ai_nav_handoff_effect_finished",
                fields = listOf(
                    "requestId" to request.requestId.toString(),
                    "cardId" to request.cardId,
                    "handoffResult" to handoffResult.name
                )
            )
            when (handoffResult) {
                AiCardHandoffResult.APPLIED,
                AiCardHandoffResult.REQUIRES_FRESH_CHAT -> {
                    appGraph.appHandoffCoordinator.consumeAiCardHandoff(requestId = request.requestId)
                }

                AiCardHandoffResult.DEFERRED -> Unit
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
            onOpenHistory = {
                navController.navigate(route = AiChatHistoryDestination.route) {
                    launchSingleTop = true
                }
            },
            onOpenAccountStatus = {
                navController.navigate(
                    route = SettingsAccountSignInEmailDestination.createRoute(origin = AnalyticsSurface.AI)
                )
            },
            onDismissErrorMessage = aiViewModel::dismissErrorMessage,
            onDismissAlert = aiViewModel::dismissAlert,
            onAddPendingAttachment = aiViewModel::addPendingAttachment,
            onImportPendingAttachment = aiViewModel::importPendingAttachment,
            onCancelAttachmentImport = aiViewModel::cancelAttachmentImport,
            onRemovePendingAttachment = aiViewModel::removePendingAttachment,
            // The attachment itself, reported from here for the same reason the permission results
            // below are: this is where the surface the person is on is known.
            onMediaAttached = { source ->
                appGraph.analytics.track(
                    event = AnalyticsEvent.MediaAttached(
                        source = source,
                        screen = AnalyticsSurface.AI
                    )
                )
            },
            onMediaAttachmentFailed = { error ->
                appGraph.analytics.track(
                    event = AnalyticsEvent.MediaUploadFailed(
                        reason = analyticsMediaUploadFailureReason(error = error),
                        screen = AnalyticsSurface.AI
                    )
                )
            },
            onStartDictationPermissionRequest = aiViewModel::startDictationPermissionRequest,
            onStartDictationRecording = aiViewModel::startDictationRecording,
            onTranscribeRecordedAudio = aiViewModel::transcribeRecordedAudio,
            onCancelDictation = aiViewModel::cancelDictation,
            onDictationFailed = { reason ->
                appGraph.analytics.track(event = AnalyticsEvent.DictationFailed(reason = reason))
            },
            // The per-capability screen under settings asks for these same two permissions, and
            // `permission_prompt_answered` carries no property naming the asker: its surface is the
            // event's own `screen`. Each entry point therefore names where its own person is, so an
            // attachment or dictation refusal here stays distinguishable from one made in settings.
            onCameraPermissionResult = { isGranted ->
                reportAiPermissionResult(
                    appGraph = appGraph,
                    permission = AnalyticsPermission.CAMERA,
                    isGranted = isGranted
                )
            },
            onMicrophonePermissionResult = { isGranted ->
                reportAiPermissionResult(
                    appGraph = appGraph,
                    permission = AnalyticsPermission.MICROPHONE,
                    isGranted = isGranted
                )
            },
            onScreenVisible = aiViewModel::onScreenVisible,
            onScreenHidden = aiViewModel::onScreenHidden,
            onWarmUpSessionIfNeeded = aiViewModel::warmUpLinkedSessionIfNeeded,
            onRetryConversationLoad = aiViewModel::retryConversationBootstrap,
            onShowAlert = aiViewModel::showAlert,
            onShowErrorMessage = aiViewModel::showErrorMessage,
            technicalErrorController = appGraph.appMessageBus
        )
    }

    registerAiChatHistoryDestinations(
        appGraph = appGraph,
        navController = navController
    )
}

private fun NavGraphBuilder.registerAiChatHistoryDestinations(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = AiChatHistoryDestination.route) { backStackEntry ->
        val aiBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = AiDestination.route
        ) ?: return@composable
        val aiViewModel = sharedAiViewModel(
            appGraph = appGraph,
            viewModelStoreOwner = aiBackStackEntry
        )
        val aiUiState by aiViewModel.uiState.collectAsStateWithLifecycle()
        val workspaceId = aiUiState.workspaceId ?: return@composable
        val historyViewModel = aiChatHistoryViewModel(
            appGraph = appGraph,
            viewModelStoreOwner = backStackEntry,
            workspaceId = workspaceId
        )
        val historyUiState by historyViewModel.uiState.collectAsStateWithLifecycle()

        // Archiving the live chat continues exactly like New chat, back in the live chat.
        LaunchedEffect(historyUiState.archivedCurrentSessionId) {
            if (historyUiState.archivedCurrentSessionId == null) {
                return@LaunchedEffect
            }
            historyViewModel.consumeArchivedCurrentChat()
            aiViewModel.clearConversation()
            navController.popBackStack(route = AiDestination.route, inclusive = false)
        }

        AiChatHistoryRoute(
            uiState = historyUiState,
            currentSessionId = aiUiState.chatSessionId,
            isCurrentChatArchiveDisabled = aiUiState.isStreaming,
            onSearchQueryChange = historyViewModel::updateSearchQuery,
            onRefresh = historyViewModel::refresh,
            onRetry = historyViewModel::retry,
            onLoadMore = historyViewModel::loadMore,
            onOpenSession = { summary ->
                if (summary.sessionId == aiUiState.chatSessionId) {
                    navController.popBackStack(route = AiDestination.route, inclusive = false)
                } else {
                    navController.navigate(
                        route = AiChatHistoryReaderDestination.createRoute(sessionId = summary.sessionId)
                    ) {
                        launchSingleTop = true
                    }
                }
            },
            onRenameSession = historyViewModel::renameSession,
            onArchiveSession = { summary ->
                historyViewModel.archiveSession(
                    summary = summary,
                    currentSessionId = aiUiState.chatSessionId
                )
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = AiChatHistoryReaderDestination.routePattern,
        arguments = listOf(navArgument(name = AiChatHistoryReaderDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val sessionId = requireNotNull(
            backStackEntry.arguments?.getString(AiChatHistoryReaderDestination.routeArgument)
        ) {
            "AI chat history reader route requires sessionId."
        }
        val historyBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = AiChatHistoryDestination.route
        ) ?: return@composable
        val aiBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = AiDestination.route
        ) ?: return@composable
        val aiViewModel = sharedAiViewModel(
            appGraph = appGraph,
            viewModelStoreOwner = aiBackStackEntry
        )
        val aiUiState by aiViewModel.uiState.collectAsStateWithLifecycle()
        val workspaceId = aiUiState.workspaceId ?: return@composable
        val historyViewModel = aiChatHistoryViewModel(
            appGraph = appGraph,
            viewModelStoreOwner = historyBackStackEntry,
            workspaceId = workspaceId
        )
        val historyUiState by historyViewModel.uiState.collectAsStateWithLifecycle()
        val reader = historyUiState.reader?.takeIf { openedReader -> openedReader.sessionId == sessionId }

        LaunchedEffect(sessionId) {
            historyViewModel.openReader(sessionId = sessionId)
        }

        AiChatHistoryReaderRoute(
            summary = reader?.summary,
            // The effect above opens this route's reader after the first frame.
            readerState = reader?.state ?: AiChatHistoryReaderState.Loading,
            onRetry = {
                historyViewModel.openReader(sessionId = sessionId)
            },
            onOpenAccountStatus = {
                navController.navigate(
                    route = SettingsAccountSignInEmailDestination.createRoute(origin = AnalyticsSurface.AI)
                )
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }
}

/** Every AI destination shares the one live-chat ViewModel owned by the AI root entry. */
@Composable
private fun sharedAiViewModel(
    appGraph: AppGraph,
    viewModelStoreOwner: ViewModelStoreOwner
): AiViewModel {
    return viewModel(
        viewModelStoreOwner = viewModelStoreOwner,
        factory = createAiViewModelFactory(
            aiChatRepository = appGraph.aiChatRepository,
            syncRepository = appGraph.syncRepository,
            autoSyncEventRepository = appGraph.autoSyncEventRepository,
            workspaceRepository = appGraph.workspaceRepository,
            cloudAccountRepository = appGraph.cloudAccountRepository,
            appVersion = appGraph.appPackageInfo.versionName,
            versionCode = appGraph.appPackageInfo.longVersionCode.toInt(),
            observability = appGraph.observability,
            analytics = appGraph.analytics
        )
    )
}

@Composable
private fun aiChatHistoryViewModel(
    appGraph: AppGraph,
    viewModelStoreOwner: ViewModelStoreOwner,
    workspaceId: String
): AiChatHistoryViewModel {
    return viewModel(
        viewModelStoreOwner = viewModelStoreOwner,
        key = "ai_chat_history_$workspaceId",
        factory = createAiChatHistoryViewModelFactory(
            aiChatRepository = appGraph.aiChatRepository,
            workspaceId = workspaceId
        )
    )
}

private fun reportAiPermissionResult(
    appGraph: AppGraph,
    permission: AnalyticsPermission,
    isGranted: Boolean
) {
    appGraph.analytics.track(
        event = AnalyticsEvent.PermissionPromptAnswered(
            permission = permission,
            outcome = if (isGranted) {
                AnalyticsPermissionOutcome.GRANTED
            } else {
                AnalyticsPermissionOutcome.DENIED
            },
            screen = AnalyticsSurface.AI
        )
    )
}
