package com.flashcardsopensourceapp.app.navigation.library

import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.navigateToAiChat
import com.flashcardsopensourceapp.data.local.model.ai.aiImportSourceForId
import com.flashcardsopensourceapp.feature.ai.brandimport.BrandImportRoute
import com.flashcardsopensourceapp.feature.ai.brandimport.BrandImportViewModel
import com.flashcardsopensourceapp.feature.ai.brandimport.createBrandImportViewModelFactory

internal fun NavGraphBuilder.registerLibraryBrandImportDestination(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(
        route = LibraryBrandImportDestination.routePattern,
        arguments = listOf(navArgument(name = LibraryBrandImportDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val context = LocalContext.current
        val sourceId = requireNotNull(backStackEntry.arguments?.getString(LibraryBrandImportDestination.routeArgument)) {
            "Brand import route requires sourceId."
        }
        val importViewModel = viewModel<BrandImportViewModel>(
            factory = createBrandImportViewModelFactory(
                applicationContext = context.applicationContext,
                source = aiImportSourceForId(id = sourceId),
                captureImportOrigin = appGraph::captureAiImportOrigin
            )
        )
        BrandImportRoute(
            viewModel = importViewModel,
            onStartImport = { request, origin ->
                appGraph.appHandoffCoordinator.requestAiImport(
                    aiImport = request,
                    origin = origin
                )
                navController.popBackStack(route = LibraryImportDestination.route, inclusive = false)
                navigateToAiChat(navController = navController)
            },
            onBack = { navController.popBackStack() }
        )
    }
}
