package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.ai.registerAiNavGraph
import com.flashcardsopensourceapp.app.navigation.cards.registerCardsNavGraph
import com.flashcardsopensourceapp.app.navigation.progress.registerProgressNavGraph
import com.flashcardsopensourceapp.app.navigation.review.ReviewPreviewDestination
import com.flashcardsopensourceapp.app.navigation.review.ReviewRootGraph
import com.flashcardsopensourceapp.app.navigation.review.registerReviewNavGraph
import com.flashcardsopensourceapp.app.navigation.settings.SettingsCurrentWorkspaceDestination
import com.flashcardsopensourceapp.app.navigation.settings.SettingsWorkspaceDeleteCurrentDestination
import com.flashcardsopensourceapp.app.navigation.settings.registerSettingsNavGraph
import com.flashcardsopensourceapp.app.notifications.AppNotificationTapType
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionLottieConfigurationStore

@Composable
fun AppNavHost(
    appGraph: AppGraph,
    navController: NavHostController,
    reviewReactionLottieConfigurationStore: ReviewReactionLottieConfigurationStore,
    reviewReactionAnimationsEnabled: Boolean,
    isPowerSaveMode: Boolean,
    appNotificationTapRequest: AppNotificationTapHandoffRequest?,
    consumeAppNotificationTap: (Long) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    val reviewReactionAnimationsEnabledState: State<Boolean> = rememberUpdatedState(
        newValue = reviewReactionAnimationsEnabled
    )
    val isPowerSaveModeState: State<Boolean> = rememberUpdatedState(newValue = isPowerSaveMode)
    val cardEditorRequest by appGraph.appHandoffCoordinator.observeCardEditor().collectAsStateWithLifecycle()
    val reviewFilterRequest by appGraph.appHandoffCoordinator.observeReviewFilter().collectAsStateWithLifecycle()
    val settingsNavigationRequest by appGraph.appHandoffCoordinator.observeSettingsNavigation().collectAsStateWithLifecycle()
    val packageInfo = appGraph.appPackageInfo

    LaunchedEffect(cardEditorRequest?.requestId) {
        val request = cardEditorRequest ?: return@LaunchedEffect
        navigateToCardEditor(
            navController = navController,
            cardId = request.cardId
        )
        appGraph.appHandoffCoordinator.consumeCardEditor(requestId = request.requestId)
    }

    LaunchedEffect(reviewFilterRequest?.requestId) {
        if (reviewFilterRequest == null) {
            return@LaunchedEffect
        }
        navigateToTopLevelDestination(
            navController = navController,
            destination = ReviewDestination
        )
    }

    LaunchedEffect(appNotificationTapRequest?.requestId) {
        val request = appNotificationTapRequest ?: return@LaunchedEffect
        when (request.request.type) {
            AppNotificationTapType.REVIEW_REMINDER -> {
                navigateToTopLevelDestination(
                    navController = navController,
                    destination = ReviewDestination
                )
            }

            AppNotificationTapType.STRICT_REMINDER -> {
                navigateToTopLevelDestination(
                    navController = navController,
                    destination = ReviewDestination
                )
            }
        }
        consumeAppNotificationTap(request.requestId)
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
        startDestination = ReviewRootGraph.route
    ) {
        registerReviewNavGraph(
            appGraph = appGraph,
            navController = navController,
            reviewReactionLottieConfigurationStore = reviewReactionLottieConfigurationStore,
            reviewReactionAnimationsEnabledState = reviewReactionAnimationsEnabledState
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
        registerProgressNavGraph(
            appGraph = appGraph,
            navController = navController
        )
        registerSettingsNavGraph(
            appGraph = appGraph,
            navController = navController,
            packageInfo = packageInfo,
            coroutineScope = coroutineScope,
            isPowerSaveModeState = isPowerSaveModeState
        )
    }
}

@Composable
fun currentTopLevelDestination(navController: NavHostController): TopLevelDestination {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val route = backStackEntry?.destination?.route

    return when {
        route == null -> ReviewDestination
        route.isWithinTopLevelDestination(destination = CardsDestination) -> CardsDestination
        route.isWithinTopLevelDestination(destination = AiDestination) -> AiDestination
        route.isWithinTopLevelDestination(destination = ProgressDestination) -> ProgressDestination
        route.isWithinTopLevelDestination(destination = SettingsDestination) -> SettingsDestination
        else -> ReviewDestination
    }
}

@Composable
fun currentVisibleAppScreen(navController: NavHostController): VisibleAppScreen {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val route = backStackEntry?.destination?.route

    return when {
        route == null -> VisibleAppScreen.OTHER
        route == ReviewDestination.route || route == ReviewPreviewDestination.route -> VisibleAppScreen.REVIEW
        route == ProgressDestination.route -> VisibleAppScreen.PROGRESS
        route == CardsDestination.route -> VisibleAppScreen.CARDS
        route == SettingsDestination.route -> VisibleAppScreen.SETTINGS_ROOT
        route == SettingsCurrentWorkspaceDestination.route -> VisibleAppScreen.SETTINGS_CURRENT_WORKSPACE
        route == SettingsWorkspaceDeleteCurrentDestination.route -> VisibleAppScreen.SETTINGS_WORKSPACE_OVERVIEW
        else -> VisibleAppScreen.OTHER
    }
}

/**
 * A tab owns the route when the route is the tab's own route or continues past it at a separator of
 * the app's route grammar: `/` opens a nested path segment or a path argument
 * (`settings/access/detail/{capability}`), `?` opens the optional query arguments
 * (`settings/account/sign-in?origin={origin}`). No tab route declares an argument today, so only
 * `/` occurs here; `?` keeps the check correct if one ever gains one.
 */
private fun String.isWithinTopLevelDestination(destination: TopLevelDestination): Boolean {
    if (!startsWith(prefix = destination.route)) {
        return false
    }
    val boundary = getOrNull(index = destination.route.length) ?: return true
    return boundary == '/' || boundary == '?'
}
