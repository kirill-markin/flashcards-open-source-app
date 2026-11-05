package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import com.flashcardsopensourceapp.feature.settings.deck.DeckDetailRoute
import com.flashcardsopensourceapp.feature.settings.deck.DeckEditorSaveResult
import com.flashcardsopensourceapp.feature.settings.deck.DeckEditorRoute
import com.flashcardsopensourceapp.feature.settings.deck.DeckListTargetUiState
import com.flashcardsopensourceapp.feature.settings.deck.DecksRoute
import com.flashcardsopensourceapp.feature.settings.deck.createAllCardsDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.deck.createDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.deck.createDeckEditorViewModelFactory
import com.flashcardsopensourceapp.feature.settings.deck.createDecksViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.export.WorkspaceExportRoute
import com.flashcardsopensourceapp.feature.settings.workspace.export.createWorkspaceExportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.importing.WorkspaceImportRoute
import com.flashcardsopensourceapp.feature.settings.workspace.importing.createWorkspaceImportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.tags.WorkspaceTagsRoute
import com.flashcardsopensourceapp.feature.settings.workspace.tags.createWorkspaceTagsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun NavGraphBuilder.registerLibraryWorkspaceDestinations(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    composable(route = LibraryDecksDestination.route) {
        val context = LocalContext.current
        val decksViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.deck.DecksViewModel>(
            factory = createDecksViewModelFactory(
                decksRepository = appGraph.decksRepository,
                workspaceRepository = appGraph.workspaceRepository,
                applicationContext = context.applicationContext
            )
        )
        val configuration = LocalConfiguration.current
        val resources = LocalResources.current
        LaunchedEffect(configuration, resources) {
            decksViewModel.updateLocale(locale = currentResourceLocale(resources = resources))
        }
        val uiState by decksViewModel.uiState.collectAsStateWithLifecycle()

        DecksRoute(
            uiState = uiState,
            onSearchQueryChange = decksViewModel::updateSearchQuery,
            onOpenDeck = { deckTarget ->
                when (deckTarget) {
                    DeckListTargetUiState.AllCards -> {
                        navController.navigate(route = LibraryAllCardsDeckDetailDestination.route)
                    }

                    is DeckListTargetUiState.PersistedDeck -> {
                        navController.navigate(
                            route = LibraryDeckDetailDestination.createRoute(deckId = deckTarget.deckId)
                        )
                    }
                }
            },
            onCreateDeck = {
                navController.navigate(route = LibraryDeckEditorDestination.createRoute(deckId = "new"))
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = LibraryAllCardsDeckDetailDestination.route) {
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
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = LibraryDeckDetailDestination.routePattern,
        arguments = listOf(navArgument(name = LibraryDeckDetailDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val context = LocalContext.current
        val deckId = requireNotNull(backStackEntry.arguments?.getString(LibraryDeckDetailDestination.routeArgument)) {
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
                navController.navigate(route = LibraryDeckEditorDestination.createRoute(deckId = editingDeckId))
            },
            onReviewDeck = { reviewingDeckId ->
                appGraph.appHandoffCoordinator.requestReviewFilter(
                    reviewFilter = ReviewFilter.Deck(deckId = reviewingDeckId)
                )
            },
            onOpenCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = LibraryDeckEditorDestination.routePattern,
        arguments = listOf(navArgument(name = LibraryDeckEditorDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val context = LocalContext.current
        val editingArgument = requireNotNull(backStackEntry.arguments?.getString(LibraryDeckEditorDestination.routeArgument)) {
            "Deck editor route requires deckId."
        }
        val editingDeckId = if (editingArgument == "new") null else editingArgument
        val deckEditorViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.deck.DeckEditorViewModel>(
            factory = createDeckEditorViewModelFactory(
                decksRepository = appGraph.decksRepository,
                workspaceRepository = appGraph.workspaceRepository,
                editingDeckId = editingDeckId,
                technicalErrorController = appGraph.appMessageBus,
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
                                    route = LibraryDeckDetailDestination.createRoute(deckId = saveResult.deckId)
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
                { deletingDeckId ->
                    coroutineScope.launch {
                        val didDelete = deckEditorViewModel.delete(editingDeckId = deletingDeckId)
                        if (didDelete) {
                            withContext(Dispatchers.Main.immediate) {
                                navController.popBackStack(
                                    route = LibraryDecksDestination.route,
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

    composable(route = LibraryTagsDestination.route) {
        val workspaceTagsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.tags.WorkspaceTagsViewModel>(
            factory = createWorkspaceTagsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
        )
        val uiState by workspaceTagsViewModel.uiState.collectAsStateWithLifecycle()

        WorkspaceTagsRoute(
            uiState = uiState,
            onSearchQueryChange = workspaceTagsViewModel::updateSearchQuery,
            onOpenTagReview = { tag ->
                appGraph.appHandoffCoordinator.requestReviewFilter(
                    reviewFilter = makeReviewTagFilter(tagNames = listOf(tag))
                )
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = LibraryExportDestination.route) {
        val context = LocalContext.current
        val workspaceExportViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.export.WorkspaceExportViewModel>(
            factory = createWorkspaceExportViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
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

    composable(route = LibraryImportDestination.route) {
        val context = LocalContext.current
        val workspaceImportViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.importing.WorkspaceImportViewModel>(
            factory = createWorkspaceImportViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                technicalErrorController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
        )

        WorkspaceImportRoute(
            viewModel = workspaceImportViewModel,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
