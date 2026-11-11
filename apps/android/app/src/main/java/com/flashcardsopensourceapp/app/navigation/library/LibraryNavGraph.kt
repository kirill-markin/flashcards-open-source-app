package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.LibraryDestination
import com.flashcardsopensourceapp.feature.cards.createLibraryViewModelFactory
import com.flashcardsopensourceapp.feature.cards.library.LibraryImportRoute
import com.flashcardsopensourceapp.feature.cards.library.LibraryRoute
import com.flashcardsopensourceapp.feature.cards.library.LibraryViewModel
import kotlinx.coroutines.CoroutineScope

internal fun NavGraphBuilder.registerLibraryNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    navigation(
        startDestination = LibraryDestination.route,
        route = LibraryRootGraph.route
    ) {
        composable(route = LibraryDestination.route) {
            val libraryViewModel = viewModel<LibraryViewModel>(
                factory = createLibraryViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
            )
            val uiState by libraryViewModel.uiState.collectAsStateWithLifecycle()

            LibraryRoute(
                uiState = uiState,
                onOpenCards = {
                    navController.navigate(route = LibraryCardsDestination.route)
                },
                onOpenTags = {
                    navController.navigate(route = LibraryTagsDestination.route)
                },
                onOpenDecks = {
                    navController.navigate(route = LibraryDecksDestination.route)
                },
                onOpenDeckCatalog = {
                    navController.navigate(route = LibraryDeckCatalogDestination.route)
                },
                onOpenImport = {
                    navController.navigate(route = LibraryImportDestination.route)
                },
                onOpenExport = {
                    navController.navigate(route = LibraryExportDestination.route)
                }
            )
        }
        composable(route = LibraryImportDestination.route) {
            LibraryImportRoute(
                onOpenNibomoImport = {
                    navController.navigate(route = LibraryNibomoImportDestination.route) {
                        launchSingleTop = true
                    }
                },
                onOpenAnkiImport = {
                    navController.navigate(route = LibraryAnkiImportDestination.route) {
                        launchSingleTop = true
                    }
                },
                onOpenSpreadsheetImport = {
                    navController.navigate(route = LibrarySpreadsheetImportGraph.route) {
                        launchSingleTop = true
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }
        registerLibraryAnkiImportDestination(
            appGraph = appGraph,
            navController = navController
        )
        registerLibrarySpreadsheetImportDestinations(
            appGraph = appGraph,
            navController = navController
        )
        registerLibraryCardsDestination(
            appGraph = appGraph,
            navController = navController,
            coroutineScope = coroutineScope
        )
        registerLibraryWorkspaceDestinations(
            appGraph = appGraph,
            navController = navController,
            coroutineScope = coroutineScope
        )
        registerLibraryCatalogDestinations(
            appGraph = appGraph,
            navController = navController
        )
    }
}
