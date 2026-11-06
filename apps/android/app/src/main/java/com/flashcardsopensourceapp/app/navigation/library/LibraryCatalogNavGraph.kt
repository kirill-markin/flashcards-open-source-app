package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogRoute
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogViewModel
import com.flashcardsopensourceapp.feature.cards.createCatalogViewModelFactory

internal fun NavGraphBuilder.registerLibraryCatalogDestinations(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = LibraryDeckCatalogDestination.route) {
        val catalogViewModel = viewModel<CatalogViewModel>(
            factory = createCatalogViewModelFactory(
                catalogBrowseIndexRepository = appGraph.catalogBrowseIndexRepository,
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

        CatalogRoute(
            uiState = uiState,
            onSearchQueryChange = catalogViewModel::updateSearchQuery,
            onSelectLanguageFilter = catalogViewModel::selectLanguageFilter,
            onSelectSortOrder = catalogViewModel::selectSortOrder,
            onRetry = catalogViewModel::revalidate,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
