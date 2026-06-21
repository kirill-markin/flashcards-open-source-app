package com.flashcardsopensourceapp.app.navigation.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.feature.settings.deck.DeckDetailRoute
import com.flashcardsopensourceapp.feature.settings.deck.DeckEditorSaveResult
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
import com.flashcardsopensourceapp.feature.settings.workspace.delete.DeleteCurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.workspace.export.WorkspaceExportRoute
import com.flashcardsopensourceapp.feature.settings.workspace.export.createWorkspaceExportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.overview.createWorkspaceOverviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.reset.ResetStudyProgressRoute
import com.flashcardsopensourceapp.feature.settings.workspace.settings.createWorkspaceSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.tags.WorkspaceTagsRoute
import com.flashcardsopensourceapp.feature.settings.workspace.tags.createWorkspaceTagsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal fun NavGraphBuilder.registerSettingsWorkspaceNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    composable(route = SettingsWorkspaceResetStudyProgressDestination.route) {
        val context = LocalContext.current
        val workspaceSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.settings.WorkspaceSettingsViewModel>(
            factory = createWorkspaceSettingsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                reviewNotificationsStore = appGraph.reviewNotificationsStore,
                technicalErrorController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
        )
        val uiState by workspaceSettingsViewModel.uiState.collectAsStateWithLifecycle()

        ResetStudyProgressRoute(
            uiState = uiState,
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
        val notificationSchedulingMutex = remember { Mutex() }
        val reviewNotificationsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.review.ReviewNotificationsViewModel>(
            factory = createReviewNotificationsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                reviewNotificationsStore = appGraph.reviewNotificationsStore,
                strictRemindersStore = appGraph.strictRemindersStore,
                onReviewSettingsChanged = {
                    coroutineScope.launch {
                        notificationSchedulingMutex.withLock {
                            appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
                                trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                                nowMillis = System.currentTimeMillis()
                            )
                        }
                    }
                },
                onStrictRemindersSettingsChanged = { isEnabled ->
                    coroutineScope.launch {
                        notificationSchedulingMutex.withLock {
                            val nowMillis = System.currentTimeMillis()
                            if (isEnabled) {
                                appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
                                    trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                                appGraph.strictRemindersManager.reconcileStrictRemindersAndWait(
                                    trigger = StrictRemindersReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                            } else {
                                appGraph.strictRemindersManager.reconcileStrictRemindersAndWait(
                                    trigger = StrictRemindersReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                                appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
                                    trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                            }
                        }
                    }
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

    composable(route = SettingsWorkspaceDeleteCurrentDestination.route) {
        val context = LocalContext.current
        val workspaceOverviewViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.overview.WorkspaceOverviewViewModel>(
            factory = createWorkspaceOverviewViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                technicalErrorController = appGraph.appMessageBus,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                applicationContext = context.applicationContext
            )
        )
        val uiState by workspaceOverviewViewModel.uiState.collectAsStateWithLifecycle()

        DeleteCurrentWorkspaceRoute(
            uiState = uiState,
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
            onReviewDeck = {},
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
            onReviewDeck = { reviewingDeckId ->
                appGraph.appHandoffCoordinator.requestReviewFilter(
                    reviewFilter = ReviewFilter.Deck(deckId = reviewingDeckId)
                )
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
            onToggleTag = deckEditorViewModel::toggleTag,
            onSave = {
                coroutineScope.launch {
                    val saveResult = deckEditorViewModel.save(editingDeckId = editingDeckId)
                    withContext(Dispatchers.Main.immediate) {
                        when (saveResult) {
                            is DeckEditorSaveResult.Created -> {
                                navController.popBackStack()
                                navController.navigate(
                                    route = SettingsWorkspaceDeckDetailDestination.createRoute(deckId = saveResult.deckId)
                                ) {
                                    launchSingleTop = true
                                }
                            }

                            DeckEditorSaveResult.Updated -> {
                                navController.popBackStack()
                            }

                            null -> Unit
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
        val workspaceTagsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.tags.WorkspaceTagsViewModel>(
            factory = createWorkspaceTagsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
        )
        val uiState by workspaceTagsViewModel.uiState.collectAsStateWithLifecycle()

        WorkspaceTagsRoute(
            uiState = uiState,
            onSearchQueryChange = workspaceTagsViewModel::updateSearchQuery,
            onOpenTagReview = { tag ->
                appGraph.appHandoffCoordinator.requestReviewFilter(
                    reviewFilter = ReviewFilter.Tag(tag = tag)
                )
            },
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
                technicalErrorController = appGraph.appMessageBus,
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
        val workspaceExportViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.export.WorkspaceExportViewModel>(
            factory = createWorkspaceExportViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                technicalErrorController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
        )

        WorkspaceExportRoute(
            viewModel = workspaceExportViewModel,
            technicalErrorController = appGraph.appMessageBus,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
