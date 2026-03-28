package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.cards.CardEditorRoute
import com.flashcardsopensourceapp.feature.cards.CardTagsRoute
import com.flashcardsopensourceapp.feature.cards.CardTextEditorRoute
import com.flashcardsopensourceapp.feature.cards.createCardEditorViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val newCardRouteArgument: String = "new"

internal fun NavGraphBuilder.registerCardEditorNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    composable(
        route = CardEditorDestination.routePattern,
        arguments = listOf(navArgument(name = CardEditorDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val editingArgument = requireNotNull(backStackEntry.arguments?.getString(CardEditorDestination.routeArgument)) {
            "Card editor route requires cardId."
        }
        val editingCardId = resolveEditingCardId(editingArgument = editingArgument)
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
        val editorBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = CardEditorDestination.createRoute(cardId = editingArgument)
        )
        val editorViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardEditorViewModel>(
            viewModelStoreOwner = editorBackStackEntry,
            factory = createCardEditorViewModelFactory(
                cardsRepository = appGraph.cardsRepository,
                workspaceRepository = appGraph.workspaceRepository,
                editingCardId = resolveEditingCardId(editingArgument = editingArgument)
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
        val editorBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = CardEditorDestination.createRoute(cardId = editingArgument)
        )
        val editorViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardEditorViewModel>(
            viewModelStoreOwner = editorBackStackEntry,
            factory = createCardEditorViewModelFactory(
                cardsRepository = appGraph.cardsRepository,
                workspaceRepository = appGraph.workspaceRepository,
                editingCardId = resolveEditingCardId(editingArgument = editingArgument)
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
}

private fun resolveEditingCardId(editingArgument: String): String? {
    return if (editingArgument == newCardRouteArgument) {
        null
    } else {
        editingArgument
    }
}
