package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.DeckDetailRoute
import com.flashcardsopensourceapp.feature.settings.DeckEditorRoute
import com.flashcardsopensourceapp.feature.settings.DeckListTargetUiState
import com.flashcardsopensourceapp.feature.settings.DecksRoute
import com.flashcardsopensourceapp.feature.settings.SchedulerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceExportRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceOverviewRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceSettingsRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceTagsRoute
import com.flashcardsopensourceapp.feature.settings.createAllCardsDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeckEditorViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDecksViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSchedulerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceExportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceOverviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceTagsViewModelFactory
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
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceOverviewDestination.route) {
            val workspaceOverviewViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceOverviewViewModel>(
                factory = createWorkspaceOverviewViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository,
                    messageController = appGraph.appMessageBus
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
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsWorkspaceDecksDestination.route) {
            val decksViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DecksViewModel>(
                factory = createDecksViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    workspaceRepository = appGraph.workspaceRepository
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
            val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckDetailViewModel>(
                factory = createAllCardsDeckDetailViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository
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
            val deckId = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckDetailDestination.routeArgument)) {
                "Deck detail route requires deckId."
            }
            val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckDetailViewModel>(
                factory = createDeckDetailViewModelFactory(
                    decksRepository = appGraph.decksRepository,
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
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
            val workspaceTagsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceTagsViewModel>(
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

            WorkspaceExportRoute(
                viewModel = workspaceExportViewModel,
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}
