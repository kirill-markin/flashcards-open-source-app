package com.flashcardsopensourceapp.app.navigation

import android.Manifest
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.feature.review.ReviewPreviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewRoute
import com.flashcardsopensourceapp.feature.review.createReviewViewModelFactory

internal fun NavGraphBuilder.registerReviewNavGraph(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(route = ReviewDestination.route) {
        val context = LocalContext.current
        val activity = context as? ComponentActivity
        val notificationPermissionLauncher = rememberLauncherForActivityResult(
            contract = ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                appGraph.reviewNotificationsManager.enableDefaultDailyForCurrentWorkspace()
            }
        }
        val reviewViewModel = viewModel<com.flashcardsopensourceapp.feature.review.ReviewViewModel>(
            factory = createReviewViewModelFactory(
                reviewRepository = appGraph.reviewRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                reviewNotificationsStore = appGraph.reviewNotificationsStore,
                resolveReviewNotificationTapPayload = appGraph.reviewNotificationsManager::resolveReviewNotificationTapPayload,
                shouldShowNotificationPermissionPrePrompt = {
                    hasNotificationPermission(context = context).not()
                },
                onReviewNotificationsChanged = {
                    appGraph.reviewNotificationsManager.refreshCurrentWorkspaceScheduling()
                },
                onNotificationPermissionGranted = {
                    appGraph.reviewNotificationsManager.enableDefaultDailyForCurrentWorkspace()
                },
                reviewPreferencesStore = appGraph.reviewPreferencesStore,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                workspaceRepository = appGraph.workspaceRepository
            )
        )
        val uiState by reviewViewModel.uiState.collectAsStateWithLifecycle()
        val reviewNotificationRequest by appGraph.appHandoffCoordinator.observeReviewNotification().collectAsStateWithLifecycle()

        LaunchedEffect(reviewNotificationRequest?.requestId) {
            val request = reviewNotificationRequest ?: return@LaunchedEffect
            reviewViewModel.handleReviewNotificationTap(request = request.request)
            appGraph.appHandoffCoordinator.consumeReviewNotification(requestId = request.requestId)
        }

        ReviewRoute(
            uiState = uiState,
            onSelectFilter = reviewViewModel::selectFilter,
            onOpenPreview = {
                navController.navigate(route = ReviewPreviewDestination.route)
            },
            onOpenCurrentCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onOpenDeckManagement = {
                appGraph.appHandoffCoordinator.requestSettingsNavigation(
                    target = SettingsNavigationTarget.WORKSPACE_DECKS
                )
            },
            onCreateCard = {
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = null)
            },
            onCreateCardWithAi = {
                appGraph.appHandoffCoordinator.requestAiEntryPrefill(prefill = com.flashcardsopensourceapp.feature.ai.AiEntryPrefill.CREATE_CARD)
                navigateToTopLevelDestination(
                    navController = navController,
                    destination = AiDestination
                )
            },
            onSwitchToAllCards = {
                reviewViewModel.selectFilter(reviewFilter = ReviewFilter.AllCards)
            },
            onRevealAnswer = reviewViewModel::revealAnswer,
            onRateAgain = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.AGAIN) },
            onRateHard = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.HARD) },
            onRateGood = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.GOOD) },
            onRateEasy = { reviewViewModel.rateCard(rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.EASY) },
            onDismissErrorMessage = reviewViewModel::dismissErrorMessage,
            onDismissNotificationPermissionPrompt = reviewViewModel::dismissNotificationPermissionPrompt,
            onContinueNotificationPermissionPrompt = {
                reviewViewModel.continueNotificationPermissionPrompt()
                if (activity != null) {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        )
    }

    composable(route = ReviewPreviewDestination.route) { backStackEntry ->
        val reviewBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = ReviewDestination.route
        )
        val reviewViewModel = viewModel<com.flashcardsopensourceapp.feature.review.ReviewViewModel>(
            viewModelStoreOwner = reviewBackStackEntry,
            factory = createReviewViewModelFactory(
                reviewRepository = appGraph.reviewRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                reviewNotificationsStore = appGraph.reviewNotificationsStore,
                resolveReviewNotificationTapPayload = appGraph.reviewNotificationsManager::resolveReviewNotificationTapPayload,
                shouldShowNotificationPermissionPrePrompt = {
                    false
                },
                onReviewNotificationsChanged = {
                    appGraph.reviewNotificationsManager.refreshCurrentWorkspaceScheduling()
                },
                onNotificationPermissionGranted = {
                    appGraph.reviewNotificationsManager.enableDefaultDailyForCurrentWorkspace()
                },
                reviewPreferencesStore = appGraph.reviewPreferencesStore,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                workspaceRepository = appGraph.workspaceRepository
            )
        )
        val uiState by reviewViewModel.uiState.collectAsStateWithLifecycle()

        ReviewPreviewRoute(
            uiState = uiState,
            onStartPreview = reviewViewModel::startPreview,
            onLoadNextPreviewPageIfNeeded = reviewViewModel::loadNextPreviewPageIfNeeded,
            onRetryPreview = reviewViewModel::retryPreview,
            onOpenCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
