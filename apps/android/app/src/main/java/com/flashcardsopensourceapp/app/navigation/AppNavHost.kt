package com.flashcardsopensourceapp.app.navigation

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.ai.AiRoute
import com.flashcardsopensourceapp.feature.ai.createAiViewModelFactory
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessDetailRoute
import com.flashcardsopensourceapp.feature.settings.AccessRoute
import com.flashcardsopensourceapp.feature.settings.AccountAdvancedRoute
import com.flashcardsopensourceapp.feature.settings.AccountDangerZoneRoute
import com.flashcardsopensourceapp.feature.settings.AccountLegalSupportRoute
import com.flashcardsopensourceapp.feature.settings.AccountOpenSourceRoute
import com.flashcardsopensourceapp.feature.settings.AccountRoute
import com.flashcardsopensourceapp.feature.settings.AccountStatusRoute
import com.flashcardsopensourceapp.feature.settings.AgentConnectionsRoute
import com.flashcardsopensourceapp.feature.cards.CardEditorRoute
import com.flashcardsopensourceapp.feature.cards.CardTagsRoute
import com.flashcardsopensourceapp.feature.cards.CardTextEditorRoute
import com.flashcardsopensourceapp.feature.cards.CardsRoute
import com.flashcardsopensourceapp.feature.cards.createCardEditorViewModelFactory
import com.flashcardsopensourceapp.feature.cards.createCardsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAccountStatusViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAccountDangerZoneViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAgentConnectionsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createCloudSignInViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createCurrentWorkspaceViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeviceDiagnosticsViewModelFactory
import com.flashcardsopensourceapp.feature.review.ReviewPreviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewRoute
import com.flashcardsopensourceapp.feature.review.createReviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.CloudSignInCodeRoute
import com.flashcardsopensourceapp.feature.settings.CloudSignInEmailRoute
import com.flashcardsopensourceapp.feature.settings.CurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.DeckDetailRoute
import com.flashcardsopensourceapp.feature.settings.DeckEditorRoute
import com.flashcardsopensourceapp.feature.settings.DecksRoute
import com.flashcardsopensourceapp.feature.settings.DeviceDiagnosticsRoute
import com.flashcardsopensourceapp.feature.settings.ServerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.SchedulerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceExportRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceOverviewRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceSettingsRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceTagsRoute
import com.flashcardsopensourceapp.feature.settings.createDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeckEditorViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDecksViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSchedulerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createServerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceOverviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceExportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceTagsViewModelFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun AppNavHost(
    appGraph: AppGraph,
    navController: NavHostController
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val packageInfo = remember(context) {
        loadPackageInfo(context = context)
    }

    NavHost(
        navController = navController,
        startDestination = ReviewDestination.route
    ) {
        composable(route = ReviewDestination.route) {
            val reviewViewModel = viewModel<com.flashcardsopensourceapp.feature.review.ReviewViewModel>(
                factory = createReviewViewModelFactory(reviewRepository = appGraph.reviewRepository)
            )
            val uiState by reviewViewModel.uiState.collectAsStateWithLifecycle()

            ReviewRoute(
                uiState = uiState,
                onSelectFilter = reviewViewModel::selectFilter,
                onOpenPreview = {
                    navController.navigate(route = ReviewPreviewDestination.route)
                },
                onOpenCurrentCard = { cardId ->
                    navController.navigate(route = CardEditorDestination.createRoute(cardId = cardId))
                },
                onOpenDeckManagement = {
                    navController.navigate(route = SettingsWorkspaceDecksDestination.route)
                },
                onRevealAnswer = reviewViewModel::revealAnswer,
                onRateAgain = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.AGAIN) },
                onRateHard = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.HARD) },
                onRateGood = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.GOOD) },
                onRateEasy = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.EASY) },
                onDismissErrorMessage = reviewViewModel::dismissErrorMessage
            )
        }

        composable(route = ReviewPreviewDestination.route) {
            val reviewBackStackEntry = remember(navController) {
                navController.getBackStackEntry(ReviewDestination.route)
            }
            val reviewViewModel = viewModel<com.flashcardsopensourceapp.feature.review.ReviewViewModel>(
                viewModelStoreOwner = reviewBackStackEntry,
                factory = createReviewViewModelFactory(reviewRepository = appGraph.reviewRepository)
            )
            val uiState by reviewViewModel.uiState.collectAsStateWithLifecycle()

            ReviewPreviewRoute(
                uiState = uiState,
                onStartPreview = reviewViewModel::startPreview,
                onLoadNextPreviewPageIfNeeded = reviewViewModel::loadNextPreviewPageIfNeeded,
                onRetryPreview = reviewViewModel::retryPreview,
                onOpenCard = { cardId ->
                    navController.navigate(route = CardEditorDestination.createRoute(cardId = cardId))
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = CardsDestination.route) {
            val cardsViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardsViewModel>(
                factory = createCardsViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository
                )
            )
            val uiState by cardsViewModel.uiState.collectAsStateWithLifecycle()

            CardsRoute(
                uiState = uiState,
                onSearchQueryChange = cardsViewModel::updateSearchQuery,
                onApplyFilter = cardsViewModel::applyFilter,
                onClearFilter = cardsViewModel::clearFilter,
                onCreateCard = {
                    navController.navigate(route = CardEditorDestination.createRoute(cardId = "new"))
                },
                onOpenCard = { cardId ->
                    navController.navigate(route = CardEditorDestination.createRoute(cardId = cardId))
                },
                onDeleteCard = { cardId ->
                    coroutineScope.launch {
                        appGraph.cardsRepository.deleteCard(cardId = cardId)
                    }
                }
            )
        }

        composable(
            route = CardEditorDestination.routePattern,
            arguments = listOf(navArgument(name = CardEditorDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val editingArgument = requireNotNull(backStackEntry.arguments?.getString(CardEditorDestination.routeArgument)) {
                "Card editor route requires cardId."
            }
            val editingCardId = if (editingArgument == "new") null else editingArgument
            val editorViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardEditorViewModel>(
                factory = createCardEditorViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingCardId = editingCardId
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()

            CardEditorRoute(
                uiState = uiState,
                onOpenFrontTextEditor = {
                    navController.navigate(
                        route = CardEditorTextDestination.createRoute(
                            cardId = editingArgument,
                            field = "front"
                        )
                    )
                },
                onOpenBackTextEditor = {
                    navController.navigate(
                        route = CardEditorTextDestination.createRoute(
                            cardId = editingArgument,
                            field = "back"
                        )
                    )
                },
                onOpenTagsEditor = {
                    navController.navigate(route = CardEditorTagsDestination.createRoute(cardId = editingArgument))
                },
                onRemoveTag = editorViewModel::removeTag,
                onEffortLevelChange = editorViewModel::updateEffortLevel,
                onSave = {
                    coroutineScope.launch {
                        val didSave = editorViewModel.save(editingCardId = editingCardId)
                        if (didSave) {
                            withContext(Dispatchers.Main.immediate) {
                                navController.popBackStack()
                            }
                        }
                    }
                },
                onDelete = if (editingCardId == null) {
                    null
                } else {
                    {
                        coroutineScope.launch {
                            val didDelete = editorViewModel.delete(editingCardId = editingCardId)
                            if (didDelete) {
                                withContext(Dispatchers.Main.immediate) {
                                    navController.popBackStack()
                                }
                            }
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = CardEditorTextDestination.routePattern,
            arguments = listOf(
                navArgument(name = CardEditorTextDestination.cardIdArgument) {
                    type = NavType.StringType
                },
                navArgument(name = CardEditorTextDestination.fieldArgument) {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val editingArgument = requireNotNull(
                backStackEntry.arguments?.getString(CardEditorTextDestination.cardIdArgument)
            ) {
                "Card text editor route requires cardId."
            }
            val field = requireNotNull(
                backStackEntry.arguments?.getString(CardEditorTextDestination.fieldArgument)
            ) {
                "Card text editor route requires field."
            }
            val editorBackStackEntry = remember(navController, editingArgument) {
                navController.getBackStackEntry(CardEditorDestination.createRoute(cardId = editingArgument))
            }
            val editorViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardEditorViewModel>(
                viewModelStoreOwner = editorBackStackEntry,
                factory = createCardEditorViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingCardId = if (editingArgument == "new") null else editingArgument
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()

            CardTextEditorRoute(
                title = if (field == "front") "Front" else "Back",
                supportingText = if (field == "front") {
                    "Keep this side focused on the question or review prompt."
                } else {
                    "Keep this side focused on the answer."
                },
                text = if (field == "front") uiState.frontText else uiState.backText,
                onTextChange = if (field == "front") {
                    editorViewModel::updateFrontText
                } else {
                    editorViewModel::updateBackText
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = CardEditorTagsDestination.routePattern,
            arguments = listOf(navArgument(name = CardEditorTagsDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val editingArgument = requireNotNull(
                backStackEntry.arguments?.getString(CardEditorTagsDestination.routeArgument)
            ) {
                "Card tags route requires cardId."
            }
            val editorBackStackEntry = remember(navController, editingArgument) {
                navController.getBackStackEntry(CardEditorDestination.createRoute(cardId = editingArgument))
            }
            val editorViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardEditorViewModel>(
                viewModelStoreOwner = editorBackStackEntry,
                factory = createCardEditorViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingCardId = if (editingArgument == "new") null else editingArgument
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()

            CardTagsRoute(
                uiState = uiState,
                onToggleSuggestedTag = editorViewModel::toggleTag,
                onAddTag = editorViewModel::addTag,
                onRemoveTag = editorViewModel::removeTag,
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = AiDestination.route) {
            val aiViewModel = viewModel<com.flashcardsopensourceapp.feature.ai.AiViewModel>(
                factory = createAiViewModelFactory(
                    aiChatRepository = appGraph.aiChatRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by aiViewModel.uiState.collectAsStateWithLifecycle()

            AiRoute(
                uiState = uiState,
                onAcceptConsent = aiViewModel::acceptConsent,
                onDraftMessageChange = aiViewModel::updateDraftMessage,
                onSendMessage = aiViewModel::sendMessage,
                onSelectModel = aiViewModel::selectModel,
                onNewChat = aiViewModel::clearConversation,
                onOpenSignIn = {
                    navController.navigate(route = SettingsAccountSignInEmailDestination.route)
                },
                onDismissErrorMessage = aiViewModel::dismissErrorMessage,
                onAddPendingAttachment = aiViewModel::addPendingAttachment,
                onRemovePendingAttachment = aiViewModel::removePendingAttachment,
                onStartDictationPermissionRequest = aiViewModel::startDictationPermissionRequest,
                onStartDictationRecording = aiViewModel::startDictationRecording,
                onTranscribeRecordedAudio = aiViewModel::transcribeRecordedAudio,
                onCancelDictation = aiViewModel::cancelDictation,
                onWarmUpSessionIfNeeded = aiViewModel::warmUpLinkedSessionIfNeeded,
                onShowErrorMessage = aiViewModel::showErrorMessage
            )
        }

        composable(route = SettingsDestination.route) {
            val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
                factory = createSettingsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by settingsViewModel.uiState.collectAsStateWithLifecycle()

            SettingsRoute(
                uiState = uiState,
                onOpenCurrentWorkspace = {
                    navController.navigate(route = SettingsCurrentWorkspaceDestination.route)
                },
                onOpenWorkspace = {
                    navController.navigate(route = SettingsWorkspaceDestination.route)
                },
                onOpenAccount = {
                    navController.navigate(route = SettingsAccountDestination.route)
                },
                onOpenDevice = {
                    navController.navigate(route = SettingsDeviceDestination.route)
                },
                onOpenAccess = {
                    navController.navigate(route = SettingsAccessDestination.route)
                }
            )
        }

        composable(route = SettingsCurrentWorkspaceDestination.route) {
            val currentWorkspaceViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CurrentWorkspaceViewModel>(
                factory = createCurrentWorkspaceViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository
                )
            )
            val uiState by currentWorkspaceViewModel.uiState.collectAsStateWithLifecycle()

            CurrentWorkspaceRoute(
                uiState = uiState,
                onReload = {
                    coroutineScope.launch {
                        currentWorkspaceViewModel.loadWorkspaces()
                    }
                },
                onSwitchToExistingWorkspace = { workspaceId ->
                    coroutineScope.launch {
                        currentWorkspaceViewModel.switchWorkspace(
                            selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.Existing(
                                workspaceId = workspaceId
                            )
                        )
                    }
                },
                onCreateWorkspace = {
                    coroutineScope.launch {
                        currentWorkspaceViewModel.switchWorkspace(
                            selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.CreateNew
                        )
                    }
                },
                onOpenSignIn = {
                    navController.navigate(route = SettingsAccountSignInEmailDestination.route)
                }
            )
        }

        composable(route = SettingsWorkspaceDestination.route) {
            val workspaceSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceSettingsViewModel>(
                factory = createWorkspaceSettingsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )
            val uiState by workspaceSettingsViewModel.uiState.collectAsStateWithLifecycle()

            WorkspaceSettingsRoute(
                uiState = uiState,
                onOpenOverview = {
                    navController.navigate(route = SettingsWorkspaceOverviewDestination.route)
                },
                onOpenDecks = {
                    navController.navigate(route = SettingsWorkspaceDecksDestination.route)
                },
                onOpenTags = {
                    navController.navigate(route = SettingsWorkspaceTagsDestination.route)
                },
                onOpenScheduler = {
                    navController.navigate(route = SettingsWorkspaceSchedulerDestination.route)
                },
                onOpenExport = {
                    navController.navigate(route = SettingsWorkspaceExportDestination.route)
                }
            )
        }

        composable(route = SettingsWorkspaceOverviewDestination.route) {
            val workspaceOverviewViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceOverviewViewModel>(
                factory = createWorkspaceOverviewViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository
                )
            )
            val uiState by workspaceOverviewViewModel.uiState.collectAsStateWithLifecycle()

            WorkspaceOverviewRoute(
                uiState = uiState,
                onWorkspaceNameChange = workspaceOverviewViewModel::updateWorkspaceNameDraft,
                onSaveWorkspaceName = {
                    coroutineScope.launch {
                        workspaceOverviewViewModel.saveWorkspaceName()
                    }
                },
                onRequestDeleteWorkspace = {
                    coroutineScope.launch {
                        workspaceOverviewViewModel.requestDeleteWorkspace()
                    }
                },
                onDismissDeletePreviewAlert = workspaceOverviewViewModel::dismissDeletePreviewAlert,
                onOpenDeleteConfirmation = workspaceOverviewViewModel::openDeleteConfirmation,
                onDeleteConfirmationTextChange = workspaceOverviewViewModel::updateDeleteConfirmationText,
                onDismissDeleteConfirmation = workspaceOverviewViewModel::dismissDeleteConfirmation,
                onDeleteWorkspace = {
                    coroutineScope.launch {
                        workspaceOverviewViewModel.deleteWorkspace()
                    }
                }
            )
        }

        composable(route = SettingsWorkspaceDecksDestination.route) {
            val decksViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DecksViewModel>(
                factory = createDecksViewModelFactory(decksRepository = appGraph.decksRepository)
            )
            val uiState by decksViewModel.uiState.collectAsStateWithLifecycle()

            DecksRoute(
                uiState = uiState,
                onSearchQueryChange = decksViewModel::updateSearchQuery,
                onOpenDeck = { deckId ->
                    navController.navigate(route = SettingsWorkspaceDeckDetailDestination.createRoute(deckId = deckId))
                },
                onCreateDeck = {
                    navController.navigate(route = SettingsWorkspaceDeckEditorDestination.createRoute(deckId = "new"))
                }
            )
        }

        composable(
            route = SettingsWorkspaceDeckDetailDestination.routePattern,
            arguments = listOf(navArgument(name = SettingsWorkspaceDeckDetailDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val deckId = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckDetailDestination.routeArgument)) {
                "Deck detail route requires deckId."
            }
            val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckDetailViewModel>(
                factory = createDeckDetailViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    deckId = deckId
                )
            )
            val uiState by deckDetailViewModel.uiState.collectAsStateWithLifecycle()

            DeckDetailRoute(
                uiState = uiState,
                onEditDeck = { editingDeckId ->
                    navController.navigate(route = SettingsWorkspaceDeckEditorDestination.createRoute(deckId = editingDeckId))
                },
                onOpenCard = { cardId ->
                    navController.navigate(route = CardEditorDestination.createRoute(cardId = cardId))
                },
                onDeleteDeck = { deletingDeckId ->
                    coroutineScope.launch {
                        appGraph.decksRepository.deleteDeck(deckId = deletingDeckId)
                        withContext(Dispatchers.Main.immediate) {
                            navController.popBackStack()
                        }
                    }
                }
            )
        }

        composable(
            route = SettingsWorkspaceDeckEditorDestination.routePattern,
            arguments = listOf(navArgument(name = SettingsWorkspaceDeckEditorDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val editingArgument = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckEditorDestination.routeArgument)) {
                "Deck editor route requires deckId."
            }
            val editingDeckId = if (editingArgument == "new") null else editingArgument
            val deckEditorViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckEditorViewModel>(
                factory = createDeckEditorViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingDeckId = editingDeckId
                )
            )
            val uiState by deckEditorViewModel.uiState.collectAsStateWithLifecycle()

            DeckEditorRoute(
                uiState = uiState,
                onNameChange = deckEditorViewModel::updateName,
                onToggleEffortLevel = deckEditorViewModel::toggleEffortLevel,
                onToggleTag = deckEditorViewModel::toggleTag,
                onSave = {
                    coroutineScope.launch {
                        val didSave = deckEditorViewModel.save(editingDeckId = editingDeckId)
                        if (didSave) {
                            withContext(Dispatchers.Main.immediate) {
                                navController.popBackStack()
                            }
                        }
                    }
                },
                onDelete = if (editingDeckId == null) {
                    null
                } else {
                    {
                        coroutineScope.launch {
                            val didDelete = deckEditorViewModel.delete(editingDeckId = editingDeckId)
                            if (didDelete) {
                                withContext(Dispatchers.Main.immediate) {
                                    navController.popBackStack(route = SettingsWorkspaceDecksDestination.route, inclusive = false)
                                }
                            }
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceTagsDestination.route) {
            val workspaceTagsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceTagsViewModel>(
                factory = createWorkspaceTagsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )
            val uiState by workspaceTagsViewModel.uiState.collectAsStateWithLifecycle()

            WorkspaceTagsRoute(
                uiState = uiState,
                onSearchQueryChange = workspaceTagsViewModel::updateSearchQuery
            )
        }

        composable(route = SettingsWorkspaceSchedulerDestination.route) {
            val schedulerSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SchedulerSettingsViewModel>(
                factory = createSchedulerSettingsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )
            val uiState by schedulerSettingsViewModel.uiState.collectAsStateWithLifecycle()

            SchedulerSettingsRoute(
                uiState = uiState,
                onDesiredRetentionChange = schedulerSettingsViewModel::updateDesiredRetention,
                onLearningStepsChange = schedulerSettingsViewModel::updateLearningSteps,
                onRelearningStepsChange = schedulerSettingsViewModel::updateRelearningSteps,
                onMaximumIntervalDaysChange = schedulerSettingsViewModel::updateMaximumIntervalDays,
                onEnableFuzzChange = schedulerSettingsViewModel::updateEnableFuzz,
                onRequestSave = schedulerSettingsViewModel::requestSave,
                onDismissSaveConfirmation = schedulerSettingsViewModel::dismissSaveConfirmation,
                onConfirmSave = {
                    coroutineScope.launch {
                        val didSave = schedulerSettingsViewModel.save()
                        if (didSave) {
                            withContext(Dispatchers.Main.immediate) {
                                navController.popBackStack()
                            }
                        }
                    }
                },
                onResetToDefaults = schedulerSettingsViewModel::resetToDefaults,
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceExportDestination.route) {
            val workspaceExportViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceExportViewModel>(
                factory = createWorkspaceExportViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )

            WorkspaceExportRoute(viewModel = workspaceExportViewModel)
        }

        composable(route = SettingsAccountDestination.route) {
            val settingsBackStackEntry = remember(navController) {
                navController.getBackStackEntry(SettingsDestination.route)
            }
            val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
                viewModelStoreOwner = settingsBackStackEntry,
                factory = createSettingsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by settingsViewModel.uiState.collectAsStateWithLifecycle()

            AccountRoute(
                workspaceName = uiState.workspaceName,
                onOpenStatus = {
                    navController.navigate(route = SettingsAccountStatusDestination.route)
                },
                onOpenLegalSupport = {
                    navController.navigate(route = SettingsAccountLegalSupportDestination.route)
                },
                onOpenOpenSource = {
                    navController.navigate(route = SettingsAccountOpenSourceDestination.route)
                },
                onOpenAdvanced = {
                    navController.navigate(route = SettingsAccountAdvancedDestination.route)
                },
                onOpenAgentConnections = {
                    navController.navigate(route = SettingsAccountAgentConnectionsDestination.route)
                },
                onOpenDangerZone = {
                    navController.navigate(route = SettingsAccountDangerZoneDestination.route)
                }
            )
        }

        composable(route = SettingsAccountStatusDestination.route) {
            val accountStatusViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AccountStatusViewModel>(
                factory = createAccountStatusViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository
                )
            )
            val uiState by accountStatusViewModel.uiState.collectAsStateWithLifecycle()

            AccountStatusRoute(
                uiState = uiState,
                onOpenSignIn = {
                    navController.navigate(route = SettingsAccountSignInEmailDestination.route)
                },
                onSyncNow = {
                    coroutineScope.launch {
                        accountStatusViewModel.syncNow()
                    }
                },
                onLogout = {
                    coroutineScope.launch {
                        accountStatusViewModel.logout()
                    }
                }
            )
        }

        composable(route = SettingsAccountAdvancedDestination.route) {
            AccountAdvancedRoute(
                onOpenServer = {
                    navController.navigate(route = SettingsAccountServerDestination.route)
                }
            )
        }

        composable(route = SettingsAccountServerDestination.route) {
            val serverSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.ServerSettingsViewModel>(
                factory = createServerSettingsViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by serverSettingsViewModel.uiState.collectAsStateWithLifecycle()

            ServerSettingsRoute(
                uiState = uiState,
                onCustomOriginChange = serverSettingsViewModel::updateCustomOrigin,
                onValidateCustomServer = {
                    coroutineScope.launch {
                        serverSettingsViewModel.validateCustomServer()
                    }
                },
                onApplyPreviewConfiguration = {
                    coroutineScope.launch {
                        serverSettingsViewModel.applyPreviewConfiguration()
                    }
                },
                onResetToOfficialServer = {
                    coroutineScope.launch {
                        serverSettingsViewModel.resetToOfficialServer()
                    }
                }
            )
        }

        composable(route = SettingsAccountSignInEmailDestination.route) {
            val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CloudSignInViewModel>(
                factory = createCloudSignInViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by signInViewModel.uiState.collectAsStateWithLifecycle()

            CloudSignInEmailRoute(
                uiState = uiState,
                onEmailChange = signInViewModel::updateEmail,
                onSendCode = {
                    coroutineScope.launch {
                        val didCreateChallenge = signInViewModel.sendCode()
                        if (didCreateChallenge) {
                            navController.navigate(route = SettingsAccountSignInCodeDestination.route)
                        }
                    }
                }
            )
        }

        composable(route = SettingsAccountSignInCodeDestination.route) {
            val emailRouteBackStackEntry = remember(navController) {
                navController.getBackStackEntry(SettingsAccountSignInEmailDestination.route)
            }
            val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CloudSignInViewModel>(
                viewModelStoreOwner = emailRouteBackStackEntry,
                factory = createCloudSignInViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by signInViewModel.uiState.collectAsStateWithLifecycle()

            CloudSignInCodeRoute(
                uiState = uiState,
                onCodeChange = signInViewModel::updateCode,
                onVerifyCode = {
                    coroutineScope.launch {
                        val workspaces = signInViewModel.verifyCode()
                        when {
                            workspaces.isEmpty() -> {
                                appGraph.cloudAccountRepository.switchLinkedWorkspace(
                                    selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.CreateNew
                                )
                                appGraph.syncRepository.syncNow()
                                navController.popBackStack(route = SettingsAccountDestination.route, inclusive = false)
                            }

                            workspaces.size == 1 -> {
                                appGraph.cloudAccountRepository.switchLinkedWorkspace(
                                    selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.Existing(
                                        workspaceId = workspaces.first().workspaceId
                                    )
                                )
                                appGraph.syncRepository.syncNow()
                                navController.popBackStack(route = SettingsAccountDestination.route, inclusive = false)
                            }

                            else -> {
                                navController.navigate(route = SettingsCurrentWorkspaceDestination.route) {
                                    popUpTo(route = SettingsAccountSignInEmailDestination.route) {
                                        inclusive = true
                                    }
                                }
                            }
                        }
                    }
                }
            )
        }

        composable(route = SettingsAccountLegalSupportDestination.route) {
            AccountLegalSupportRoute()
        }

        composable(route = SettingsAccountOpenSourceDestination.route) {
            AccountOpenSourceRoute()
        }

        composable(route = SettingsAccountAgentConnectionsDestination.route) {
            val agentConnectionsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AgentConnectionsViewModel>(
                factory = createAgentConnectionsViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by agentConnectionsViewModel.uiState.collectAsStateWithLifecycle()

            AgentConnectionsRoute(
                uiState = uiState,
                onReload = {
                    coroutineScope.launch {
                        agentConnectionsViewModel.loadConnections()
                    }
                },
                onRevokeConnection = { connectionId ->
                    coroutineScope.launch {
                        agentConnectionsViewModel.revokeConnection(connectionId = connectionId)
                    }
                }
            )
        }

        composable(route = SettingsAccountDangerZoneDestination.route) {
            val accountDangerZoneViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AccountDangerZoneViewModel>(
                factory = createAccountDangerZoneViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository
                )
            )
            val uiState by accountDangerZoneViewModel.uiState.collectAsStateWithLifecycle()

            AccountDangerZoneRoute(
                uiState = uiState,
                onRequestDeleteConfirmation = accountDangerZoneViewModel::requestDeleteConfirmation,
                onDismissDeleteConfirmation = accountDangerZoneViewModel::dismissDeleteConfirmation,
                onConfirmationTextChange = accountDangerZoneViewModel::updateConfirmationText,
                onDeleteAccount = {
                    coroutineScope.launch {
                        accountDangerZoneViewModel.deleteAccount()
                    }
                }
            )
        }

        composable(route = SettingsDeviceDestination.route) {
            val deviceDiagnosticsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeviceDiagnosticsViewModel>(
                factory = createDeviceDiagnosticsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    appVersion = packageInfo.versionName,
                    buildNumber = packageInfo.longVersionCode.toString()
                )
            )
            val uiState by deviceDiagnosticsViewModel.uiState.collectAsStateWithLifecycle()

            DeviceDiagnosticsRoute(uiState = uiState)
        }

        composable(route = SettingsAccessDestination.route) {
            AccessRoute(
                onOpenCapability = { capability ->
                    navController.navigate(
                        route = SettingsAccessDetailDestination.createRoute(capability = capability.name.lowercase())
                    )
                }
            )
        }

        composable(
            route = SettingsAccessDetailDestination.routePattern,
            arguments = listOf(navArgument(name = SettingsAccessDetailDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val capabilityArgument = requireNotNull(
                backStackEntry.arguments?.getString(SettingsAccessDetailDestination.routeArgument)
            ) {
                "Access detail route requires capability."
            }
            val capability = AccessCapability.valueOf(capabilityArgument.uppercase())

            AccessDetailRoute(
                capability = capability,
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}

@Composable
fun currentTopLevelDestination(navController: NavHostController): TopLevelDestination {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val route = backStackEntry?.destination?.route

    return when {
        route == null -> ReviewDestination
        route.startsWith(CardsDestination.route) -> CardsDestination
        route.startsWith(AiDestination.route) -> AiDestination
        route.startsWith(SettingsDestination.route) -> SettingsDestination
        else -> ReviewDestination
    }
}

fun navigateToTopLevelDestination(
    navController: NavHostController,
    destination: TopLevelDestination
) {
    navController.navigate(route = destination.route) {
        popUpTo(id = navController.graph.findStartDestination().id) {
            saveState = true
        }
        launchSingleTop = true
        restoreState = true
    }
}

private data class AppPackageInfo(
    val versionName: String,
    val longVersionCode: Long
)

private fun loadPackageInfo(context: Context): AppPackageInfo {
    val packageInfo = context.packageManager.getPackageInfo(
        context.packageName,
        PackageManager.PackageInfoFlags.of(0L)
    )

    return AppPackageInfo(
        versionName = packageInfo.versionName ?: "Unavailable",
        longVersionCode = packageInfo.longVersionCode
    )
}
