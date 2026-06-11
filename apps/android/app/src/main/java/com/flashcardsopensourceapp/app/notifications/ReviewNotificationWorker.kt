package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.notifications.review.ReviewNotificationWorker as ReviewNotificationWorkflowWorker

/**
 * Compatibility entry point for WorkManager rows persisted before the notification package split.
 */
class ReviewNotificationWorker(
    appContext: Context,
    params: WorkerParameters
) : ReviewNotificationWorkflowWorker(appContext, params)
