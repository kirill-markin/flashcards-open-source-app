package com.flashcardsopensourceapp.app.navigation.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.prompts.feedback.FeedbackPromptDialog
import com.flashcardsopensourceapp.app.prompts.feedback.FeedbackPromptUiState
import com.flashcardsopensourceapp.app.prompts.guestreview.GuestSignInAfterReviewPromptDialog
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermission
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermissionOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.feature.review.HardAnswerReminderDialog
import com.flashcardsopensourceapp.feature.review.NotificationPermissionPromptContinueAction
import com.flashcardsopensourceapp.feature.review.NotificationPermissionPromptDialog
import com.flashcardsopensourceapp.feature.settings.TestReviewPromptPreview

/**
 * Draws the after-review prompt dialogs the test menu previews. A preview shows the real prompt
 * with working buttons but records nothing: no shown state, cooldown, prompt analytics or server
 * prompt event, and the feedback preview sends nothing. Facts a button itself causes, such as the
 * OS permission answer or a sign-in, are kept.
 */
@Composable
internal fun TestReviewPromptPreviewDialogs(
    appGraph: AppGraph,
    preview: TestReviewPromptPreview?,
    onOpenSignIn: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var feedbackMessage by remember(preview) { mutableStateOf("") }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
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
        if (isGranted) {
            val nowMillis = System.currentTimeMillis()
            appGraph.reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotifications(
                trigger = ReviewNotificationsReconcileTrigger.PERMISSION_CHANGED,
                nowMillis = nowMillis
            )
            appGraph.strictRemindersManager.reconcileStrictReminders(
                trigger = StrictRemindersReconcileTrigger.PERMISSION_CHANGED,
                nowMillis = nowMillis
            )
        }
    }

    when (preview) {
        TestReviewPromptPreview.HARD_REMINDER -> HardAnswerReminderDialog(onDismissRequest = onDismiss)
        TestReviewPromptPreview.NOTIFICATIONS_PRE_PROMPT_SYSTEM_DIALOG -> NotificationPermissionPromptDialog(
            continueAction = NotificationPermissionPromptContinueAction.REQUEST_PERMISSION,
            onContinue = {
                onDismiss()
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    throw IllegalStateException(
                        "The notifications permission dialog requires API 33, but the device runs API ${Build.VERSION.SDK_INT}."
                    )
                }
                appGraph.reviewNotificationsStore.savePromptState(
                    state = appGraph.reviewNotificationsStore.loadPromptState().copy(hasRequestedSystemPermission = true)
                )
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            },
            onDismiss = onDismiss
        )
        TestReviewPromptPreview.NOTIFICATIONS_PRE_PROMPT_SETTINGS -> NotificationPermissionPromptDialog(
            continueAction = NotificationPermissionPromptContinueAction.OPEN_NOTIFICATION_SETTINGS,
            onContinue = {
                onDismiss()
                context.startActivity(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                )
            },
            onDismiss = onDismiss
        )
        TestReviewPromptPreview.GUEST_SIGN_IN -> GuestSignInAfterReviewPromptDialog(
            onSignIn = {
                onDismiss()
                onOpenSignIn()
            },
            onLater = onDismiss
        )
        TestReviewPromptPreview.AUTOMATIC_FEEDBACK -> FeedbackPromptDialog(
            uiState = FeedbackPromptUiState(
                isVisible = true,
                trigger = CloudFeedbackTrigger.AUTOMATIC,
                message = feedbackMessage,
                isSubmitting = false,
                errorMessage = null
            ),
            onMessageChange = { message -> feedbackMessage = message },
            onShown = {},
            onSubmit = onDismiss,
            onDismiss = onDismiss
        )
        TestReviewPromptPreview.PAYWALL_INITIAL,
        TestReviewPromptPreview.PAYWALL_SECOND,
        TestReviewPromptPreview.PAYWALL_PERIODIC,
        TestReviewPromptPreview.RATING_REQUEST,
        null -> Unit
    }
}

/**
 * Clears this install's state of every Android after-review prompt. Paywall history stays: it is
 * the server's, and the cached remote config stays too.
 */
internal fun resetReviewPromptLocalState(appGraph: AppGraph) {
    appGraph.reviewPreferencesStore.clearHardAnswerReminderLastShownAt()
    // `hasRequestedSystemPermission` is OS request history, not prompt state.
    appGraph.reviewNotificationsStore.savePromptState(
        state = appGraph.reviewNotificationsStore.loadPromptState().copy(lastShownAtMillis = null)
    )
    appGraph.storeReviewRequestStore.clearRequestAttempt()
    appGraph.guestSignInAfterReviewPromptStore.clearLastShownAt()
    appGraph.feedbackPromptStore.clearAllAutomaticPromptShownAt()
}
