package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import com.flashcardsopensourceapp.app.di.AppGraph

@Composable
fun AppNavHost(
    appGraph: AppGraph,
    navController: NavHostController
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val cardEditorRequest by appGraph.appHandoffCoordinator.observeCardEditor().collectAsStateWithLifecycle()
    val reviewNotificationRequest by appGraph.appHandoffCoordinator.observeReviewNotification().collectAsStateWithLifecycle()
    val settingsNavigationRequest by appGraph.appHandoffCoordinator.observeSettingsNavigation().collectAsStateWithLifecycle()
    val packageInfo = remember(context) {
        loadPackageInfo(context = context)
    }

    LaunchedEffect(cardEditorRequest?.requestId) {
        val request = cardEditorRequest ?: return@LaunchedEffect
        navigateToCardEditor(
            navController = navController,
            cardId = request.cardId
        )
        appGraph.appHandoffCoordinator.consumeCardEditor(requestId = request.requestId)
    }

    LaunchedEffect(reviewNotificationRequest?.requestId) {
        val request = reviewNotificationRequest ?: return@LaunchedEffect
        navigateToTopLevelDestination(
            navController = navController,
            destination = ReviewDestination
        )
    }

    LaunchedEffect(settingsNavigationRequest?.requestId) {
        val request = settingsNavigationRequest ?: return@LaunchedEffect
        navigateToSettingsNavigationTarget(
            navController = navController,
            target = request.target
        )
        appGraph.appHandoffCoordinator.consumeSettingsNavigation(requestId = request.requestId)
    }

    NavHost(
        navController = navController,
        startDestination = ReviewDestination.route
    ) {
        registerReviewNavGraph(
            appGraph = appGraph,
            navController = navController
        )
        registerCardsNavGraph(
            appGraph = appGraph,
            navController = navController,
            coroutineScope = coroutineScope
        )
        registerAiNavGraph(
            appGraph = appGraph,
            navController = navController
        )
        registerSettingsNavGraph(
            appGraph = appGraph,
            navController = navController,
            packageInfo = packageInfo,
            coroutineScope = coroutineScope
        )
    }
}

@Composable
fun currentTopLevelDestination(navController: NavHostController): TopLevelDestination {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val route = backStackEntry?.destination?.route

    return when {
        route == null -> ReviewDestination
        route.startsWith(CardsDestination.route) -> CardsDestination
        route.startsWith(AiDestination.route) -> AiDestination
        route.startsWith(SettingsDestination.route) -> SettingsDestination
        else -> ReviewDestination
    }
}
