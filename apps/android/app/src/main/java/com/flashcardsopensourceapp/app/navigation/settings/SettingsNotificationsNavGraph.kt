package com.flashcardsopensourceapp.app.navigation.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermission
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermissionOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.feature.settings.review.ReviewNotificationsRoute
import com.flashcardsopensourceapp.feature.settings.review.createReviewNotificationsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal fun NavGraphBuilder.registerSettingsNotificationsDestination(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    composable(route = SettingsNotificationsDestination.route) {
        val notificationSchedulingMutex = remember { Mutex() }
        val reviewNotificationsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.review.ReviewNotificationsViewModel>(
            factory = createReviewNotificationsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                reviewNotificationsStore = appGraph.reviewNotificationsStore,
                strictRemindersStore = appGraph.strictRemindersStore,
                onReviewSettingsChanged = {
                    coroutineScope.launch {
                        notificationSchedulingMutex.withLock {
                            val nowMillis = System.currentTimeMillis()
                            appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
                                trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                                nowMillis = nowMillis
                            )
                            appGraph.strictRemindersManager.reconcileStrictRemindersAndWait(
                                trigger = StrictRemindersReconcileTrigger.SETTINGS_CHANGED,
                                nowMillis = nowMillis
                            )
                        }
                    }
                },
                onStrictRemindersSettingsChanged = { isEnabled ->
                    coroutineScope.launch {
                        notificationSchedulingMutex.withLock {
                            val nowMillis = System.currentTimeMillis()
                            if (isEnabled) {
                                appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
                                    trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                                appGraph.strictRemindersManager.reconcileStrictRemindersAndWait(
                                    trigger = StrictRemindersReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                            } else {
                                appGraph.strictRemindersManager.reconcileStrictRemindersAndWait(
                                    trigger = StrictRemindersReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                                appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
                                    trigger = ReviewNotificationsReconcileTrigger.SETTINGS_CHANGED,
                                    nowMillis = nowMillis
                                )
                            }
                        }
                    }
                },
                onAppIconBadgeDisabled = {
                    coroutineScope.launch {
                        appGraph.reviewNotificationsManager.clearDeliveredReviewReminderNotifications()
                    }
                }
            )
        )
        val uiState by reviewNotificationsViewModel.uiState.collectAsStateWithLifecycle()

        ReviewNotificationsRoute(
            uiState = uiState,
            onUpdateEnabled = reviewNotificationsViewModel::updateEnabled,
            onUpdateMode = reviewNotificationsViewModel::updateMode,
            onUpdateDailyTime = reviewNotificationsViewModel::updateDailyTime,
            onUpdateInactivityWindowStart = reviewNotificationsViewModel::updateInactivityWindowStart,
            onUpdateInactivityWindowEnd = reviewNotificationsViewModel::updateInactivityWindowEnd,
            onUpdateIdleMinutes = reviewNotificationsViewModel::updateIdleMinutes,
            onUpdateShowAppIconBadge = reviewNotificationsViewModel::updateShowAppIconBadge,
            onUpdateStrictRemindersEnabled = reviewNotificationsViewModel::updateStrictRemindersEnabled,
            onMarkSystemPermissionRequested = reviewNotificationsViewModel::markSystemPermissionRequested,
            onPermissionGranted = {
                val nowMillis = System.currentTimeMillis()
                appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotifications(
                    trigger = ReviewNotificationsReconcileTrigger.PERMISSION_CHANGED,
                    nowMillis = nowMillis
                )
                appGraph.strictRemindersManager.reconcileStrictReminders(
                    trigger = StrictRemindersReconcileTrigger.PERMISSION_CHANGED,
                    nowMillis = nowMillis
                )
            },
            // The review flow asks for this same permission from its own pre-prompt, and
            // `permission_prompt_answered` carries no property naming the asker: its surface is the
            // event's own `screen`. Each entry point therefore names where its own person is, so a
            // refusal here stays distinguishable from a refusal there.
            onPermissionResult = { isGranted ->
                appGraph.analytics.track(
                    event = AnalyticsEvent.PermissionPromptAnswered(
                        permission = AnalyticsPermission.NOTIFICATIONS,
                        outcome = if (isGranted) {
                            AnalyticsPermissionOutcome.GRANTED
                        } else {
                            AnalyticsPermissionOutcome.DENIED
                        },
                        screen = AnalyticsSurface.SETTINGS
                    )
                )
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
