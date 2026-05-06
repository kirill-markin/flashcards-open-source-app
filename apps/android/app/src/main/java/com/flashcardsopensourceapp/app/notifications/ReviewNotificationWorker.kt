package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore

class ReviewNotificationWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (hasNotificationPermission(context = applicationContext).not()) {
            return Result.success()
        }

        val frontText = inputData.getString(reviewNotificationFrontTextDataKey)
            ?: return Result.failure()
        val requestId = inputData.getString(reviewNotificationRequestIdDataKey)
            ?: return Result.failure()
        val workspaceId = inputData.getString(reviewNotificationWorkspaceIdDataKey)
            ?: return Result.failure()

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
}
