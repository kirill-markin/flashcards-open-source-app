package com.flashcardsopensourceapp.app.notifications.review

import android.content.Context
import android.database.sqlite.SQLiteException
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.notifications.addNotificationWorkerBreadcrumb
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission
import com.flashcardsopensourceapp.app.notifications.reviewReminderNotificationKind
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import kotlinx.coroutines.CancellationException

private const val reviewNotificationWorkerLogTag: String = "ReviewNotificationWorker"

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

        val application = applicationContext as? FlashcardsApplication
        if (application == null) {
            Log.e(
                reviewNotificationWorkerLogTag,
                "event=review_notification_worker_invalid_application " +
                    "request_id=$requestId workspace_id=$workspaceId"
            )
            return Result.failure()
        }
        val appGraph = application.appGraphOrNull
        if (appGraph == null) {
            addWorkerBreadcrumb(
                stage = "worker_app_graph_unavailable",
                requestId = requestId,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed
            )
            if (application.isRuntimeSupported.not()) {
                Log.e(
                    reviewNotificationWorkerLogTag,
                    "event=review_notification_worker_runtime_unsupported " +
                        "request_id=$requestId workspace_id=$workspaceId"
                )
                return Result.failure()
            }
            Log.w(
                reviewNotificationWorkerLogTag,
                "event=review_notification_worker_app_graph_unavailable_retry " +
                    "request_id=$requestId workspace_id=$workspaceId"
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
                workspaceId = workspaceId,
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
                workspaceId = workspaceId,
                error = error
            )
            return Result.retry()
        }
        if (currentWorkspaceId != workspaceId) {
            addWorkerBreadcrumb(
                stage = "worker_stale_workspace",
                requestId = requestId,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed
            )
            return Result.success()
        }

        // Read live immediately before posting so master and badge changes win
        // even when this worker was already running.
        val store = appGraph.reviewNotificationsStore
        store.migrateLegacySettings(currentWorkspaceId = currentWorkspaceId)
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
            val finalSettings = store.loadSettings()
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
            if (finalSettings.isEnabled.not()) {
                addWorkerBreadcrumb(
                    stage = "worker_master_disabled",
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

            showReviewReminderNotification(
                context = applicationContext,
                frontText = frontText,
                requestId = requestId,
                showAppIconBadge = finalSettings.showAppIconBadge
            )
            markDeliveredReviewReminderInsideGate(
                appGraph = appGraph,
                workspaceId = workspaceId,
                requestId = requestId,
                deliveredAtMillis = System.currentTimeMillis()
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

    private fun markDeliveredReviewReminderInsideGate(
        appGraph: AppGraph,
        workspaceId: String,
        requestId: String,
        deliveredAtMillis: Long
    ) {
        appGraph.reviewReminderAttentionController.markDeliveredReviewReminderInsideGate(
            workspaceId = workspaceId,
            requestId = requestId,
            deliveredAtMillis = deliveredAtMillis
        )
    }

    private fun logRecoverableFailure(
        stage: String,
        requestId: String,
        workspaceId: String,
        error: Exception
    ) {
        Log.w(
            reviewNotificationWorkerLogTag,
            "event=review_notification_worker_recoverable_failure " +
                "stage=$stage request_id=$requestId workspace_id=$workspaceId " +
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
