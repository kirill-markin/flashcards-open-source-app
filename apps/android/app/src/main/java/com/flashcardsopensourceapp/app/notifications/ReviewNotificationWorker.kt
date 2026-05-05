package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore
import java.time.Instant
import java.time.ZoneId

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
        // worker is already mid-flight. Combined with the today-review check below,
        // this is the single source of truth for the badge decision.
        val store = resolveReviewNotificationsStore()
        val liveShowAppIconBadge = store.loadSettings(workspaceId = workspaceId).showAppIconBadge
        val showAppIconBadge = liveShowAppIconBadge && hasReviewedTodayLocally().not()

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

    private suspend fun hasReviewedTodayLocally(): Boolean {
        val app = applicationContext as? FlashcardsApplication ?: return false
        val database = app.appGraphOrNull?.database ?: return false
        val zoneId = ZoneId.systemDefault()
        val nowMillis = System.currentTimeMillis()
        val today = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
        val startMillis = today.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val endMillis = today.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
        return runCatching {
            database.reviewLogDao().hasReviewLogsBetween(
                startMillis = startMillis,
                endMillis = endMillis
            )
        }.onFailure { error ->
            Log.e(
                appNotificationLogTag,
                "hasReviewedTodayLocally: review log lookup failed; defaulting to false",
                error
            )
        }.getOrElse { false }
    }
}
