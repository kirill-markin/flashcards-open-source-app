package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.feature.settings.deck.DeckDetailRoute
import com.flashcardsopensourceapp.feature.settings.deck.DeckEditorRoute
import com.flashcardsopensourceapp.feature.settings.deck.DeckListTargetUiState
import com.flashcardsopensourceapp.feature.settings.deck.DecksRoute
import com.flashcardsopensourceapp.feature.settings.deck.createAllCardsDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.deck.createDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.deck.createDeckEditorViewModelFactory
import com.flashcardsopensourceapp.feature.settings.deck.createDecksViewModelFactory
import com.flashcardsopensourceapp.feature.settings.review.ReviewNotificationsRoute
import com.flashcardsopensourceapp.feature.settings.review.createReviewNotificationsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.scheduler.SchedulerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.scheduler.createSchedulerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceExportRoute
import com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceOverviewRoute
import com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceSettingsRoute
import com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceTagsRoute
import com.flashcardsopensourceapp.feature.settings.workspace.createWorkspaceExportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.createWorkspaceOverviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.createWorkspaceSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.createWorkspaceTagsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun NavGraphBuilder.registerSettingsWorkspaceNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    navigation(
        startDestination = SettingsWorkspaceDestination.route,
        route = SettingsWorkspaceGraph.route
    ) {
        composable(route = SettingsWorkspaceDestination.route) {
            val context = LocalContext.current
            val workspaceSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceSettingsViewModel>(
                factory = createWorkspaceSettingsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    reviewNotificationsStore = appGraph.reviewNotificationsStore,
                    applicationContext = context.applicationContext
                )
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
                onOpenNotifications = {
                    navController.navigate(route = SettingsWorkspaceNotificationsDestination.route)
                },
                onOpenScheduler = {
                    navController.navigate(route = SettingsWorkspaceSchedulerDestination.route)
                },
                onOpenExport = {
                    navController.navigate(route = SettingsWorkspaceExportDestination.route)
                },
                onOpenResetConfirmation = workspaceSettingsViewModel::openResetConfirmation,
                onDismissResetConfirmation = workspaceSettingsViewModel::dismissResetConfirmation,
                onResetConfirmationTextChange = workspaceSettingsViewModel::updateResetConfirmationText,
                onRequestResetProgress = workspaceSettingsViewModel::requestResetProgressAsync,
                onDismissResetPreviewAlert = workspaceSettingsViewModel::dismissResetPreviewAlert,
                onResetProgress = workspaceSettingsViewModel::resetProgressAsync,
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceNotificationsDestination.route) {
            val reviewNotificationsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.review.ReviewNotificationsViewModel>(
                factory = createReviewNotificationsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    reviewNotificationsStore = appGraph.reviewNotificationsStore,
                    strictRemindersStore = appGraph.strictRemindersStore,
                    onReviewSettingsChanged = {
                        appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotifications(
                            trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                            nowMillis = System.currentTimeMillis()
                        )
                    },
                    onStrictRemindersSettingsChanged = {
                        appGraph.strictRemindersManager.reconcileStrictReminders(
                            trigger = StrictRemindersReconcileTrigger.SETTINGS_CHANGED,
                            nowMillis = System.currentTimeMillis()
                        )
                    },
                    onAppIconBadgeDisabled = {
                        appGraph.reviewNotificationsManager.clearDeliveredReviewReminderNotifications()
                    }
                )
            )
            val uiState by reviewNotificationsViewModel.uiState.collectAsStateWithLifecycle()

            ReviewNotificationsRoute(
                uiState = uiState,
                onUpdateEnabled = reviewNotificationsViewModel::updateEnabled,
                onUpdateMode = reviewNotificationsViewModel::updateMode,
                onUpdateDailyTime = reviewNotificationsViewModel::updateDailyTime,
                onUpdateInactivityWindowStart = reviewNotificationsViewModel::updateInactivityWindowStart,
                onUpdateInactivityWindowEnd = reviewNotificationsViewModel::updateInactivityWindowEnd,
                onUpdateIdleMinutes = reviewNotificationsViewModel::updateIdleMinutes,
                onUpdateShowAppIconBadge = reviewNotificationsViewModel::updateShowAppIconBadge,
                onUpdateStrictRemindersEnabled = reviewNotificationsViewModel::updateStrictRemindersEnabled,
                onMarkSystemPermissionRequested = reviewNotificationsViewModel::markSystemPermissionRequested,
                onPermissionGranted = {
                    appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotifications(
                        trigger = ReviewNotificationsReconcileTrigger.PERMISSION_CHANGED,
                        nowMillis = System.currentTimeMillis()
                    )
                    appGraph.strictRemindersManager.reconcileStrictReminders(
                        trigger = StrictRemindersReconcileTrigger.PERMISSION_CHANGED,
                        nowMillis = System.currentTimeMillis()
                    )
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceOverviewDestination.route) {
            val context = LocalContext.current
            val workspaceOverviewViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceOverviewViewModel>(
                factory = createWorkspaceOverviewViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    autoSyncEventRepository = appGraph.autoSyncEventRepository,
                    messageController = appGraph.appMessageBus,
                    visibleAppScreenRepository = appGraph.visibleAppScreenController,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by workspaceOverviewViewModel.uiState.collectAsStateWithLifecycle()

            WorkspaceOverviewRoute(
                uiState = uiState,
                onWorkspaceNameChange = workspaceOverviewViewModel::updateWorkspaceNameDraft,
                onSaveWorkspaceName = workspaceOverviewViewModel::saveWorkspaceNameAsync,
                onRequestDeleteWorkspace = workspaceOverviewViewModel::requestDeleteWorkspaceAsync,
                onDismissDeletePreviewAlert = workspaceOverviewViewModel::dismissDeletePreviewAlert,
                onOpenDeleteConfirmation = workspaceOverviewViewModel::openDeleteConfirmation,
                onDeleteConfirmationTextChange = workspaceOverviewViewModel::updateDeleteConfirmationText,
                onDismissDeleteConfirmation = workspaceOverviewViewModel::dismissDeleteConfirmation,
                onDeleteWorkspace = workspaceOverviewViewModel::deleteWorkspaceAsync,
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceDecksDestination.route) {
            val context = LocalContext.current
            val decksViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.deck.DecksViewModel>(
                factory = createDecksViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by decksViewModel.uiState.collectAsStateWithLifecycle()

            DecksRoute(
                uiState = uiState,
                onSearchQueryChange = decksViewModel::updateSearchQuery,
                onOpenDeck = { deckTarget ->
                    when (deckTarget) {
                        DeckListTargetUiState.AllCards -> {
                            navController.navigate(route = SettingsWorkspaceAllCardsDeckDetailDestination.route)
                        }

                        is DeckListTargetUiState.PersistedDeck -> {
                            navController.navigate(
                                route = SettingsWorkspaceDeckDetailDestination.createRoute(deckId = deckTarget.deckId)
                            )
                        }
                    }
                },
                onCreateDeck = {
                    navController.navigate(route = SettingsWorkspaceDeckEditorDestination.createRoute(deckId = "new"))
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceAllCardsDeckDetailDestination.route) {
            val context = LocalContext.current
            val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.deck.DeckDetailViewModel>(
                factory = createAllCardsDeckDetailViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by deckDetailViewModel.uiState.collectAsStateWithLifecycle()

            DeckDetailRoute(
                uiState = uiState,
                onEditDeck = {},
                onOpenCard = { cardId ->
                    appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
                },
                onDeleteDeck = {},
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = SettingsWorkspaceDeckDetailDestination.routePattern,
            arguments = listOf(navArgument(name = SettingsWorkspaceDeckDetailDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val context = LocalContext.current
            val deckId = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckDetailDestination.routeArgument)) {
                "Deck detail route requires deckId."
            }
            val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.deck.DeckDetailViewModel>(
                factory = createDeckDetailViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    deckId = deckId,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by deckDetailViewModel.uiState.collectAsStateWithLifecycle()

            DeckDetailRoute(
                uiState = uiState,
                onEditDeck = { editingDeckId ->
                    navController.navigate(route = SettingsWorkspaceDeckEditorDestination.createRoute(deckId = editingDeckId))
                },
                onOpenCard = { cardId ->
                    appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
                },
                onDeleteDeck = { deletingDeckId ->
                    coroutineScope.launch {
                        appGraph.decksRepository.deleteDeck(deckId = deletingDeckId)
                        withContext(Dispatchers.Main.immediate) {
                            navController.popBackStack()
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = SettingsWorkspaceDeckEditorDestination.routePattern,
            arguments = listOf(navArgument(name = SettingsWorkspaceDeckEditorDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val context = LocalContext.current
            val editingArgument = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckEditorDestination.routeArgument)) {
                "Deck editor route requires deckId."
            }
            val editingDeckId = if (editingArgument == "new") null else editingArgument
            val deckEditorViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.deck.DeckEditorViewModel>(
                factory = createDeckEditorViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingDeckId = editingDeckId,
                    applicationContext = context.applicationContext
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
                                    navController.popBackStack(
                                        route = SettingsWorkspaceDecksDestination.route,
                                        inclusive = false
                                    )
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
            val workspaceTagsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceTagsViewModel>(
                factory = createWorkspaceTagsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )
            val uiState by workspaceTagsViewModel.uiState.collectAsStateWithLifecycle()

            WorkspaceTagsRoute(
                uiState = uiState,
                onSearchQueryChange = workspaceTagsViewModel::updateSearchQuery,
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceSchedulerDestination.route) {
            val context = LocalContext.current
            val schedulerSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.scheduler.SchedulerSettingsViewModel>(
                factory = createSchedulerSettingsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    applicationContext = context.applicationContext
                )
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
            val context = LocalContext.current
            val workspaceExportViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.WorkspaceExportViewModel>(
                factory = createWorkspaceExportViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    applicationContext = context.applicationContext
                )
            )

            WorkspaceExportRoute(
                viewModel = workspaceExportViewModel,
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}
