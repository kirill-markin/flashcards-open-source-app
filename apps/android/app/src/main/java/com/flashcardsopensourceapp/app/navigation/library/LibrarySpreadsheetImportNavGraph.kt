package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.rememberRouteBackStackEntry
import com.flashcardsopensourceapp.feature.cards.library.importing.SpreadsheetImportRoute
import com.flashcardsopensourceapp.feature.cards.library.importing.SpreadsheetImportTagsRoute
import com.flashcardsopensourceapp.feature.cards.library.importing.SpreadsheetImportViewModel
import com.flashcardsopensourceapp.feature.cards.library.importing.createSpreadsheetImportViewModelFactory

internal fun NavGraphBuilder.registerLibrarySpreadsheetImportDestinations(
    appGraph: AppGraph,
    navController: NavHostController
) {
    navigation(startDestination = LibrarySpreadsheetImportGraph.editorRoute, route = LibrarySpreadsheetImportGraph.route) {
        composable(route = LibrarySpreadsheetImportGraph.editorRoute) { entry ->
            val viewModel = spreadsheetImportViewModel(
                appGraph = appGraph,
                navController = navController,
                entry = entry
            ) ?: return@composable
            SpreadsheetImportRoute(
                viewModel = viewModel,
                onOpenTags = {
                    navController.navigate(route = LibrarySpreadsheetImportGraph.tagsRoute) {
                        launchSingleTop = true
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }
        composable(route = LibrarySpreadsheetImportGraph.tagsRoute) { entry ->
            val viewModel = spreadsheetImportViewModel(
                appGraph = appGraph,
                navController = navController,
                entry = entry
            ) ?: return@composable
            SpreadsheetImportTagsRoute(
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
    }
}

@Composable
private fun spreadsheetImportViewModel(
    appGraph: AppGraph,
    navController: NavHostController,
    entry: NavBackStackEntry
): SpreadsheetImportViewModel? {
    val graphEntry = rememberRouteBackStackEntry(
        navController = navController,
        currentBackStackEntry = entry,
        route = LibrarySpreadsheetImportGraph.route
    ) ?: return null
    return viewModel(
        viewModelStoreOwner = graphEntry,
        factory = createSpreadsheetImportViewModelFactory(
            cardsRepository = appGraph.cardsRepository,
            workspaceRepository = appGraph.workspaceRepository,
            technicalErrorController = appGraph.appMessageBus,
            applicationContext = LocalContext.current.applicationContext
        )
    )
}
