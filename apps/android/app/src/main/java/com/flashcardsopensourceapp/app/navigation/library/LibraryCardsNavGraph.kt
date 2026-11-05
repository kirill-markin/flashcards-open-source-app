package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsCardCreateEntryPoint
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.feature.cards.createCardsViewModelFactory
import com.flashcardsopensourceapp.feature.cards.list.CardsRoute
import com.flashcardsopensourceapp.feature.cards.list.CardsViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal fun NavGraphBuilder.registerLibraryCardsDestination(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    composable(route = LibraryCardsDestination.route) {
        val cardsViewModel = viewModel<CardsViewModel>(
            factory = createCardsViewModelFactory(
                cardsRepository = appGraph.cardsRepository,
                workspaceRepository = appGraph.workspaceRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                visibleAppScreenRepository = appGraph.visibleAppScreenController
            )
        )
        val uiState by cardsViewModel.uiState.collectAsStateWithLifecycle()

        CardsRoute(
            uiState = uiState,
            onSearchQueryChange = cardsViewModel::updateSearchQuery,
            onApplyFilter = cardsViewModel::applyFilter,
            onClearFilter = cardsViewModel::clearFilter,
            onCreateCard = {
                appGraph.analytics.track(
                    event = AnalyticsEvent.CardCreateStarted(
                        entryPoint = AnalyticsCardCreateEntryPoint.CARDS,
                        screen = AnalyticsSurface.CARDS
                    )
                )
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = null)
            },
            onOpenCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onDeleteCard = { cardId ->
                coroutineScope.launch {
                    appGraph.cardsRepository.deleteCard(cardId = cardId)
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
