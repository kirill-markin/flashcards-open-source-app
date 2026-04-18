package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.progress.ProgressRoute
import com.flashcardsopensourceapp.feature.progress.ProgressViewModel
import com.flashcardsopensourceapp.feature.progress.createProgressViewModelFactory

internal fun NavGraphBuilder.registerProgressNavGraph(
    appGraph: AppGraph
) {
    composable(route = ProgressDestination.route) {
        val progressViewModel = viewModel<ProgressViewModel>(
            factory = createProgressViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository
            )
        )
        val uiState by progressViewModel.uiState.collectAsStateWithLifecycle()

        ProgressRoute(
            uiState = uiState,
            onScreenVisible = progressViewModel::loadProgress,
            onRetry = progressViewModel::loadProgress
        )
    }
}
