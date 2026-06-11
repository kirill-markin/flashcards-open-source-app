package com.flashcardsopensourceapp.app.notifications.strict

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.notifications.addNotificationWorkerBreadcrumb
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission
import com.flashcardsopensourceapp.app.notifications.strictReminderNotificationKind
import com.flashcardsopensourceapp.data.local.notifications.StrictReminderTimeOffset
import com.flashcardsopensourceapp.data.local.notifications.strictReminderWorkLimit

open class StrictReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val requestId = inputData.getString(strictReminderRequestIdDataKey)
        val permissionAllowed: Boolean = hasNotificationPermission(context = applicationContext)
        addWorkerBreadcrumb(
            stage = "worker_start",
            requestId = requestId,
            permissionAllowed = permissionAllowed
        )
        if (permissionAllowed.not()) {
            addWorkerBreadcrumb(
                stage = "worker_permission_blocked",
                requestId = requestId,
                permissionAllowed = permissionAllowed
            )
            return Result.success()
        }

        val rawTimeOffset = inputData.getString(strictReminderTimeOffsetDataKey)
        if (requestId == null || rawTimeOffset == null) {
            addWorkerBreadcrumb(
                stage = "worker_invalid_input_failure",
                requestId = requestId,
                permissionAllowed = permissionAllowed
            )
            return Result.failure()
        }

        val timeOffset = try {
            StrictReminderTimeOffset.fromRawValue(rawValue = rawTimeOffset)
        } catch (_: IllegalArgumentException) {
            addWorkerBreadcrumb(
                stage = "worker_invalid_input_failure",
                requestId = requestId,
                permissionAllowed = permissionAllowed
            )
            return Result.failure()
        }

        showStrictReminderNotification(
            context = applicationContext,
            timeOffset = timeOffset,
            requestId = requestId
        )
        addWorkerBreadcrumb(
            stage = "worker_notification_posted",
            requestId = requestId,
            permissionAllowed = permissionAllowed
        )
        return Result.success()
    }

    private fun addWorkerBreadcrumb(
        stage: String,
        requestId: String?,
        permissionAllowed: Boolean
    ) {
        addNotificationWorkerBreadcrumb(
            applicationContext = applicationContext,
            notificationKind = strictReminderNotificationKind,
            stage = stage,
            requestId = requestId,
            workspaceId = null,
            permissionAllowed = permissionAllowed,
            workTag = strictReminderWorkTag,
            workLimit = strictReminderWorkLimit
        )
    }
}
