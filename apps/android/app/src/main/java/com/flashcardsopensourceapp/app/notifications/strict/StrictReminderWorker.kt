package com.flashcardsopensourceapp.app.notifications.strict

import android.content.Context
import android.database.sqlite.SQLiteException
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.notifications.addNotificationWorkerBreadcrumb
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission
import com.flashcardsopensourceapp.app.notifications.strictReminderNotificationKind
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import com.flashcardsopensourceapp.data.local.notifications.StrictReminderTimeOffset
import com.flashcardsopensourceapp.data.local.notifications.isStrictReminderRequestIdValid
import com.flashcardsopensourceapp.data.local.notifications.strictReminderWorkLimit
import kotlinx.coroutines.CancellationException

private const val strictReminderWorkerLogTag: String = "StrictReminderWorker"

open class StrictReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val requestId = inputData.getString(strictReminderRequestIdDataKey)
        val scheduledWorkspaceId = inputData.getString(strictReminderWorkspaceIdDataKey)
        val permissionAllowed: Boolean = hasNotificationPermission(context = applicationContext)
        addWorkerBreadcrumb(
            stage = "worker_start",
            requestId = requestId,
            workspaceId = scheduledWorkspaceId,
            permissionAllowed = permissionAllowed
        )
        if (permissionAllowed.not()) {
            addWorkerBreadcrumb(
                stage = "worker_permission_blocked",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.success()
        }

        val rawTimeOffset = inputData.getString(strictReminderTimeOffsetDataKey)
        if (requestId == null || rawTimeOffset == null) {
            addWorkerBreadcrumb(
                stage = "worker_invalid_input_failure",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
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
                workspaceId = scheduledWorkspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.failure()
        }
        if (
            isStrictReminderRequestIdValid(
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                timeOffset = timeOffset
            ).not()
        ) {
            addWorkerBreadcrumb(
                stage = "worker_invalid_input_failure",
                requestId = requestId,
                workspaceId = null,
                permissionAllowed = permissionAllowed
            )
            return Result.failure()
        }

        val application = applicationContext as? FlashcardsApplication
        if (application == null) {
            Log.e(
                strictReminderWorkerLogTag,
                "event=strict_reminder_worker_invalid_application " +
                    "request_id=$requestId workspace_id=${scheduledWorkspaceId ?: "legacy"}"
            )
            return Result.failure()
        }
        val appGraph = application.appGraphOrNull
        if (appGraph == null) {
            addWorkerBreadcrumb(
                stage = "worker_app_graph_unavailable",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                permissionAllowed = permissionAllowed
            )
            if (application.isRuntimeSupported.not()) {
                Log.e(
                    strictReminderWorkerLogTag,
                    "event=strict_reminder_worker_runtime_unsupported " +
                        "request_id=$requestId workspace_id=${scheduledWorkspaceId ?: "legacy"}"
                )
                return Result.failure()
            }
            Log.w(
                strictReminderWorkerLogTag,
                "event=strict_reminder_worker_app_graph_unavailable_retry " +
                    "request_id=$requestId workspace_id=${scheduledWorkspaceId ?: "legacy"}"
            )
            return Result.retry()
        }
        try {
            appGraph.awaitStartup()
        } catch (error: CancellationException) {
            throw error
        } catch (error: IllegalStateException) {
            logRecoverableFailure(
                stage = "worker_startup_unavailable_retry",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                error = error
            )
            return Result.retry()
        }
        val currentWorkspaceId = try {
            appGraph.loadActiveNotificationWorkspaceIdOrNull()
        } catch (error: CancellationException) {
            throw error
        } catch (error: SQLiteException) {
            logRecoverableFailure(
                stage = "worker_workspace_read_retry",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                error = error
            )
            return Result.retry()
        }
        if (currentWorkspaceId == null) {
            addWorkerBreadcrumb(
                stage = "worker_current_workspace_unavailable",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.success()
        }
        if (scheduledWorkspaceId != null && currentWorkspaceId != scheduledWorkspaceId) {
            addWorkerBreadcrumb(
                stage = "worker_stale_workspace",
                requestId = requestId,
                workspaceId = scheduledWorkspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.success()
        }
        val workspaceId = scheduledWorkspaceId ?: currentWorkspaceId
        appGraph.reviewNotificationsStore.migrateLegacySettings(currentWorkspaceId = currentWorkspaceId)
        return appGraph.notificationDeliveryGate.runExclusive {
            val finalWorkspaceId = try {
                appGraph.loadActiveNotificationWorkspaceIdOrNull()
            } catch (error: CancellationException) {
                throw error
            } catch (error: SQLiteException) {
                logRecoverableFailure(
                    stage = "worker_final_workspace_read_retry",
                    requestId = requestId,
                    workspaceId = workspaceId,
                    error = error
                )
                return@runExclusive Result.retry()
            }
            val finalMasterEnabled = appGraph.reviewNotificationsStore.loadSettings().isEnabled
            val finalStreakEnabled = appGraph.strictRemindersStore.loadStrictRemindersSettings().isEnabled
            val finalPermissionAllowed = hasNotificationPermission(context = applicationContext)
            if (finalWorkspaceId != workspaceId) {
                addWorkerBreadcrumb(
                    stage = "worker_workspace_changed",
                    requestId = requestId,
                    workspaceId = workspaceId,
                    permissionAllowed = finalPermissionAllowed
                )
                return@runExclusive Result.success()
            }
            if (finalMasterEnabled.not() || finalStreakEnabled.not()) {
                addWorkerBreadcrumb(
                    stage = "worker_settings_disabled",
                    requestId = requestId,
                    workspaceId = workspaceId,
                    permissionAllowed = finalPermissionAllowed
                )
                return@runExclusive Result.success()
            }
            if (finalPermissionAllowed.not()) {
                addWorkerBreadcrumb(
                    stage = "worker_permission_changed",
                    requestId = requestId,
                    workspaceId = workspaceId,
                    permissionAllowed = false
                )
                return@runExclusive Result.success()
            }

            showStrictReminderNotification(
                context = applicationContext,
                timeOffset = timeOffset,
                requestId = requestId
            )
            addWorkerBreadcrumb(
                stage = "worker_notification_posted",
                requestId = requestId,
                workspaceId = workspaceId,
                permissionAllowed = finalPermissionAllowed
            )
            Result.success()
        }
    }

    private fun logRecoverableFailure(
        stage: String,
        requestId: String,
        workspaceId: String?,
        error: Exception
    ) {
        Log.w(
            strictReminderWorkerLogTag,
            "event=strict_reminder_worker_recoverable_failure " +
                "stage=$stage request_id=$requestId workspace_id=${workspaceId ?: "legacy"} " +
                renderSanitizedThrowableLogFields(error = error)
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
            notificationKind = strictReminderNotificationKind,
            stage = stage,
            requestId = requestId,
            workspaceId = workspaceId,
            permissionAllowed = permissionAllowed,
            workTag = strictReminderWorkTag,
            workLimit = strictReminderWorkLimit
        )
    }
}
