package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

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

        showReviewReminderNotification(
            context = applicationContext,
            frontText = frontText,
            requestId = requestId
        )
        return Result.success()
    }
}
