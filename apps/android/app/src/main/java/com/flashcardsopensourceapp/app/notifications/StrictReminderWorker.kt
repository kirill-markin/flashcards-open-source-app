package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.data.local.notifications.StrictReminderTimeOffset

class StrictReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (hasNotificationPermission(context = applicationContext).not()) {
            return Result.success()
        }

        val requestId = inputData.getString(strictReminderRequestIdDataKey)
            ?: return Result.failure()
        val rawTimeOffset = inputData.getString(strictReminderTimeOffsetDataKey)
            ?: return Result.failure()

        val timeOffset = try {
            StrictReminderTimeOffset.fromRawValue(rawValue = rawTimeOffset)
        } catch (_: IllegalArgumentException) {
            return Result.failure()
        }

        showStrictReminderNotification(
            context = applicationContext,
            timeOffset = timeOffset,
            requestId = requestId
        )
        return Result.success()
    }
}
