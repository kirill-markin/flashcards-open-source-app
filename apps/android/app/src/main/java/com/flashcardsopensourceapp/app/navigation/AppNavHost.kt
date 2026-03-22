package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.ai.AiRoute
import com.flashcardsopensourceapp.feature.ai.createAiViewModelFactory
import com.flashcardsopensourceapp.feature.cards.CardEditorRoute
import com.flashcardsopensourceapp.feature.cards.CardsRoute
import com.flashcardsopensourceapp.feature.cards.createCardEditorViewModelFactory
import com.flashcardsopensourceapp.feature.cards.createCardsViewModelFactory
import com.flashcardsopensourceapp.feature.review.ReviewRoute
import com.flashcardsopensourceapp.feature.review.createReviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.SettingsPlaceholderRoute
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun AppNavHost(
    appGraph: AppGraph,
    navController: NavHostController
) {
    val coroutineScope = rememberCoroutineScope()

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
                onRevealAnswer = reviewViewModel::revealAnswer,
                onRateAgain = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.AGAIN) },
                onRateHard = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.HARD) },
                onRateGood = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.GOOD) },
                onRateEasy = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.EASY) }
            )
        }

        composable(route = CardsDestination.route) {
            val cardsViewModel = viewModel<com.flashcardsopensourceapp.feature.cards.CardsViewModel>(
                factory = createCardsViewModelFactory(cardsRepository = appGraph.cardsRepository)
            )
            val uiState by cardsViewModel.uiState.collectAsStateWithLifecycle()

            CardsRoute(
                uiState = uiState,
                onSearchQueryChange = cardsViewModel::updateSearchQuery,
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
                    decksRepository = appGraph.decksRepository,
                    editingCardId = editingCardId
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()

            CardEditorRoute(
                uiState = uiState,
                onFrontTextChange = editorViewModel::updateFrontText,
                onBackTextChange = editorViewModel::updateBackText,
                onTagsTextChange = editorViewModel::updateTagsText,
                onDeckChange = editorViewModel::updateDeck,
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

        composable(route = AiDestination.route) {
            val aiViewModel = viewModel<com.flashcardsopensourceapp.feature.ai.AiViewModel>(
                factory = createAiViewModelFactory()
            )
            val uiState by aiViewModel.uiState.collectAsStateWithLifecycle()

            AiRoute(
                uiState = uiState,
                onDraftMessageChange = aiViewModel::updateDraftMessage,
                onSendDraftMessage = aiViewModel::sendDraftMessage
            )
        }

        composable(route = SettingsDestination.route) {
            val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
                factory = createSettingsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )
            val uiState by settingsViewModel.uiState.collectAsStateWithLifecycle()

            SettingsRoute(
                uiState = uiState,
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

        composable(route = SettingsWorkspaceDestination.route) {
            SettingsPlaceholderRoute(
                title = "Workspace",
                body = "TODO: Port workspace management flows from apps/ios/Flashcards/Flashcards/WorkspaceSettingsView.swift."
            )
        }

        composable(route = SettingsAccountDestination.route) {
            SettingsPlaceholderRoute(
                title = "Account",
                body = "TODO: Port account, legal, advanced server, and danger-zone flows from apps/ios/Flashcards/Flashcards/AccountSettingsView.swift."
            )
        }

        composable(route = SettingsDeviceDestination.route) {
            SettingsPlaceholderRoute(
                title = "This device",
                body = "TODO: Port device details and local database diagnostics from apps/ios/Flashcards/Flashcards/ThisDeviceSettingsView.swift."
            )
        }

        composable(route = SettingsAccessDestination.route) {
            SettingsPlaceholderRoute(
                title = "Access",
                body = "TODO: Port access and agent connection flows from apps/ios/Flashcards/Flashcards/AccessSettingsView.swift."
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
