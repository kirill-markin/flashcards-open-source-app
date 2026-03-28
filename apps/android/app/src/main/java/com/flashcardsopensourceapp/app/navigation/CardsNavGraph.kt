package com.flashcardsopensourceapp.app.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import com.flashcardsopensourceapp.app.di.AppGraph
import kotlinx.coroutines.CoroutineScope

internal fun NavGraphBuilder.registerCardsNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    registerCardsRootDestination(
        appGraph = appGraph,
        coroutineScope = coroutineScope
    )
    registerCardEditorNavGraph(
        appGraph = appGraph,
        navController = navController,
        coroutineScope = coroutineScope
    )
}
