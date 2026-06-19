package com.flashcardsopensourceapp.app.notifications.review

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.notifications.addNotificationWorkerBreadcrumb
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission
import com.flashcardsopensourceapp.app.notifications.reviewReminderNotificationKind
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ReviewReminderAttentionState
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore

open class ReviewNotificationWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val requestId = inputData.getString(reviewNotificationRequestIdDataKey)
        val workspaceId = inputData.getString(reviewNotificationWorkspaceIdDataKey)
        val permissionAllowed: Boolean = hasNotificationPermission(context = applicationContext)
        addWorkerBreadcrumb(
            stage = "worker_start",
            requestId = requestId,
            workspaceId = workspaceId,
            permissionAllowed = permissionAllowed
        )
        if (permissionAllowed.not()) {
            addWorkerBreadcrumb(
                stage = "worker_permission_blocked",
                requestId = requestId,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.success()
        }

        val frontText = inputData.getString(reviewNotificationFrontTextDataKey)
        if (frontText == null || requestId == null || workspaceId == null) {
            addWorkerBreadcrumb(
                stage = "worker_invalid_input_failure",
                requestId = requestId,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.failure()
        }

        // Read live so a toggle-off after schedule time wins immediately, even if a
        // worker is already mid-flight.
        val store = resolveReviewNotificationsStore()
        val showAppIconBadge = store.loadSettings(workspaceId = workspaceId).showAppIconBadge

        showReviewReminderNotification(
            context = applicationContext,
            frontText = frontText,
            requestId = requestId,
            showAppIconBadge = showAppIconBadge
        )
        markDeliveredReviewReminder(
            workspaceId = workspaceId,
            requestId = requestId,
            deliveredAtMillis = System.currentTimeMillis()
        )
        addWorkerBreadcrumb(
            stage = "worker_notification_posted",
            requestId = requestId,
            workspaceId = workspaceId,
            permissionAllowed = permissionAllowed
        )
        return Result.success()
    }

    private fun resolveReviewNotificationsStore(): ReviewNotificationsStore {
        val appGraphStore = (applicationContext as? FlashcardsApplication)
            ?.appGraphOrNull
            ?.reviewNotificationsStore
        if (appGraphStore != null) {
            return appGraphStore
        }
        // Cold-start fallback: the worker can fire before Application.onCreate has published the graph.
        return SharedPreferencesReviewNotificationsStore(context = applicationContext)
    }

    private fun markDeliveredReviewReminder(
        workspaceId: String,
        requestId: String,
        deliveredAtMillis: Long
    ) {
        val appGraph = (applicationContext as? FlashcardsApplication)?.appGraphOrNull
        if (appGraph != null) {
            appGraph.reviewReminderAttentionController.markDeliveredReviewReminder(
                workspaceId = workspaceId,
                requestId = requestId,
                deliveredAtMillis = deliveredAtMillis
            )
            return
        }

        SharedPreferencesReviewNotificationsStore(context = applicationContext).markReviewReminderAttention(
            state = ReviewReminderAttentionState(
                workspaceId = workspaceId,
                requestId = requestId,
                deliveredAtMillis = deliveredAtMillis
            )
        )
    }

    private fun addWorkerBreadcrumb(
        stage: String,
        requestId: String?,
        workspaceId: String?,
        permissionAllowed: Boolean
    ) {
        addNotificationWorkerBreadcrumb(
            applicationContext = applicationContext,
            notificationKind = reviewReminderNotificationKind,
            stage = stage,
            requestId = requestId,
            workspaceId = workspaceId,
            permissionAllowed = permissionAllowed,
            workTag = reviewNotificationWorkTag,
            workLimit = null
        )
    }
}
