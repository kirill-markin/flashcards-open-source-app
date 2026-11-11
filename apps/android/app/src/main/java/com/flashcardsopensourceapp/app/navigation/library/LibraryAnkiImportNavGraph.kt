package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.navigateToAiChat
import com.flashcardsopensourceapp.feature.ai.anki.AnkiImportRoute
import com.flashcardsopensourceapp.feature.ai.anki.AnkiImportViewModel
import com.flashcardsopensourceapp.feature.ai.anki.createAnkiImportViewModelFactory

internal fun NavGraphBuilder.registerLibraryAnkiImportDestination(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = LibraryAnkiImportDestination.route) {
        val context = LocalContext.current
        val importViewModel = viewModel<AnkiImportViewModel>(
            factory = createAnkiImportViewModelFactory(
                applicationContext = context.applicationContext,
                captureImportOrigin = appGraph::captureAiAnkiImportOrigin
            )
        )
        AnkiImportRoute(
            viewModel = importViewModel,
            onStartImport = { request, origin ->
                appGraph.appHandoffCoordinator.requestAiAnkiImport(
                    ankiImport = request,
                    origin = origin
                )
                navController.popBackStack(route = LibraryImportDestination.route, inclusive = false)
                navigateToAiChat(navController = navController)
            },
            onBack = { navController.popBackStack() }
        )
    }
}
