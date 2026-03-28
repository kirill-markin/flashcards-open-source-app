package com.flashcardsopensourceapp.app.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import kotlinx.coroutines.CoroutineScope

internal fun NavGraphBuilder.registerSettingsNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    packageInfo: AppPackageInfo,
    coroutineScope: CoroutineScope
) {
    navigation(
        startDestination = SettingsDestination.route,
        route = SettingsRootGraph.route
    ) {
        registerSettingsRootDestinations(
            appGraph = appGraph,
            navController = navController,
            packageInfo = packageInfo,
            coroutineScope = coroutineScope
        )
        registerSettingsWorkspaceNavGraph(
            appGraph = appGraph,
            navController = navController,
            coroutineScope = coroutineScope
        )
        registerSettingsAccountNavGraph(
            appGraph = appGraph,
            navController = navController,
            coroutineScope = coroutineScope
        )
        registerSettingsAccountAuthNavGraph(
            appGraph = appGraph,
            navController = navController,
            coroutineScope = coroutineScope
        )
        registerSettingsAccessNavGraph(navController = navController)
    }
}
