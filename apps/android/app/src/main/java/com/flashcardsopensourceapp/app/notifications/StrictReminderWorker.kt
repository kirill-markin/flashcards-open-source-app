package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.notifications.strict.StrictReminderWorker as StrictReminderWorkflowWorker

/**
 * Compatibility entry point for WorkManager rows persisted before the notification package split.
 */
class StrictReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : StrictReminderWorkflowWorker(appContext, params)
