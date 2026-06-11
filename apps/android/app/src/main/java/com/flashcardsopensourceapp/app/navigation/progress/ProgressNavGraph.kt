package com.flashcardsopensourceapp.app.navigation.progress

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.ProgressDestination
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountSignInEmailDestination
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountStatusDestination
import com.flashcardsopensourceapp.feature.progress.ProgressRoute
import com.flashcardsopensourceapp.feature.progress.ProgressViewModel
import com.flashcardsopensourceapp.feature.progress.createProgressViewModelFactory

internal fun NavGraphBuilder.registerProgressNavGraph(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = ProgressDestination.route) {
        val progressViewModel = viewModel<ProgressViewModel>(
            factory = createProgressViewModelFactory(
                progressRepository = appGraph.progressRepository
            )
        )
        val uiState by progressViewModel.uiState.collectAsStateWithLifecycle()

        ProgressRoute(
            uiState = uiState,
            onScreenVisible = progressViewModel::refreshIfInvalidated,
            onRetry = progressViewModel::refreshManually,
            onSelectLeaderboardWindow = progressViewModel::selectLeaderboardWindow,
            onOpenSignIn = {
                navController.navigate(route = SettingsAccountSignInEmailDestination.route)
            },
            onOpenAccountSettings = {
                navController.navigate(route = SettingsAccountStatusDestination.route)
            }
        )
    }
}
