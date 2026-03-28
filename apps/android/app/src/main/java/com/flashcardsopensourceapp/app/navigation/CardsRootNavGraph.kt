package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.cards.CardsRoute
import com.flashcardsopensourceapp.feature.cards.createCardsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal fun NavGraphBuilder.registerCardsRootDestination(
    appGraph: AppGraph,
    coroutineScope: CoroutineScope
) {
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
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = null)
            },
            onOpenCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onOpenDecks = {
                appGraph.appHandoffCoordinator.requestSettingsNavigation(
                    target = SettingsNavigationTarget.WORKSPACE_DECKS
                )
            },
            onOpenTags = {
                appGraph.appHandoffCoordinator.requestSettingsNavigation(
                    target = SettingsNavigationTarget.WORKSPACE_TAGS
                )
            },
            onDeleteCard = { cardId ->
                coroutineScope.launch {
                    appGraph.cardsRepository.deleteCard(cardId = cardId)
                }
            }
        )
    }
}
