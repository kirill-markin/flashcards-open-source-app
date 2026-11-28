package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.catalogAiPrefillOrigin
import com.flashcardsopensourceapp.app.navigation.navigateToAiChat
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogDeckEvent
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogDeckRoute
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogDeckViewModel
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogRoute
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogViewModel
import com.flashcardsopensourceapp.feature.cards.createCatalogDeckViewModelFactory
import com.flashcardsopensourceapp.feature.cards.createCatalogViewModelFactory
import kotlinx.coroutines.launch

internal fun NavGraphBuilder.registerLibraryCatalogDestinations(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = LibraryDeckCatalogDestination.route) { backStackEntry ->
        val catalogViewModel = viewModel<CatalogViewModel>(
            factory = createCatalogViewModelFactory(
                catalogBrowseIndexRepository = appGraph.catalogBrowseIndexRepository,
                catalogDeckPageRepository = appGraph.catalogDeckPageRepository,
                messageController = appGraph.appMessageBus
            )
        )
        val configuration = LocalConfiguration.current
        val resources = LocalResources.current
        LaunchedEffect(configuration, resources) {
            catalogViewModel.updateLocale(locale = currentResourceLocale(resources = resources))
        }
        LifecycleStartEffect(catalogViewModel) {
            catalogViewModel.revalidate()
            onStopOrDispose {}
        }
        val uiState by catalogViewModel.uiState.collectAsStateWithLifecycle()
        val cloudSettingsFlow = remember(appGraph) { appGraph.cloudAccountRepository.observeCloudSettings() }
        val cloudSettings by cloudSettingsFlow.collectAsStateWithLifecycle(initialValue = null)
        val catalogOrigin = cloudSettings?.catalogAiPrefillOrigin()
        val scope = rememberCoroutineScope()
        var isOpeningAi by remember { mutableStateOf(value = false) }

        CatalogRoute(
            uiState = uiState,
            isOpeningAi = isOpeningAi,
            onSearchQueryChange = catalogViewModel::updateSearchQuery,
            onSelectLanguageFilter = catalogViewModel::selectLanguageFilter,
            onSelectSortOrder = catalogViewModel::selectSortOrder,
            onOpenDeck = { deck ->
                navController.navigate(route = LibraryCatalogDeckDestination.createRoute(packageId = deck.packageId))
            },
            onCreateDeckWithAi = createDeck@{ topic, resultCount ->
                val origin = catalogOrigin ?: return@createDeck
                if (isOpeningAi) {
                    return@createDeck
                }
                isOpeningAi = true
                scope.launch {
                    try {
                        appGraph.requestCatalogAiPrefill(
                            origin = origin,
                            topic = topic,
                            isCatalogCurrent = { navController.currentBackStackEntry == backStackEntry },
                            onEnqueued = {
                                appGraph.analytics.track(event = AnalyticsEvent.CatalogAiDeckClicked(resultCount = resultCount))
                                navigateToAiChat(navController = navController)
                            }
                        )
                    } finally {
                        isOpeningAi = false
                    }
                }
            },
            onDecksShown = catalogViewModel::prefetchDeckPages,
            onRetry = catalogViewModel::revalidate,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = LibraryCatalogDeckDestination.routePattern,
        arguments = listOf(navArgument(name = LibraryCatalogDeckDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val packageId = requireNotNull(backStackEntry.arguments?.getString(LibraryCatalogDeckDestination.routeArgument)) {
            "Catalog deck route requires packageId."
        }
        val catalogDeckViewModel = viewModel<CatalogDeckViewModel>(
            factory = createCatalogDeckViewModelFactory(
                packageId = packageId,
                catalogBrowseIndexRepository = appGraph.catalogBrowseIndexRepository,
                catalogDeckPageRepository = appGraph.catalogDeckPageRepository,
                catalogDeckInstallRepository = appGraph.catalogDeckInstallRepository,
                messageController = appGraph.appMessageBus,
                technicalErrorController = appGraph.appMessageBus,
                requestReviewFilter = appGraph.appHandoffCoordinator::requestReviewFilter
            )
        )
        LaunchedEffect(catalogDeckViewModel) {
            catalogDeckViewModel.events.collect { event ->
                when (event) {
                    CatalogDeckEvent.Close -> navController.popBackStack()
                }
            }
        }
        val uiState by catalogDeckViewModel.uiState.collectAsStateWithLifecycle()

        CatalogDeckRoute(
            uiState = uiState,
            onStudyDeck = catalogDeckViewModel::studyDeck,
            onRetryPage = catalogDeckViewModel::retryPage,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
