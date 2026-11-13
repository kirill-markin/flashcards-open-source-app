package com.flashcardsopensourceapp.app.notifications

import android.util.Log
import com.flashcardsopensourceapp.app.notifications.review.ReviewNotificationsManager
import com.flashcardsopensourceapp.app.notifications.strict.StrictRemindersManager
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import com.flashcardsopensourceapp.data.local.cloud.sync.ReviewHistoryChangedEvent
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

private const val notificationReconciliationLogTag: String = "AppGraph"
private const val notificationsWorkspaceReconcileInitialRetryDelayMillis: Long = 250L
private const val notificationsWorkspaceReconcileMaximumRetryDelayMillis: Long = 4_000L

private data class NotificationsWorkspaceObservation(
    val activeWorkspaceId: String?,
    val hasMatchingLocalWorkspace: Boolean
)

internal class NotificationReconciliation(
    private val appScope: CoroutineScope,
    private val localWorkspaces: Flow<List<WorkspaceEntity>>,
    private val cloudSettings: Flow<CloudSettings>,
    private val reviewHistoryChangedEvents: Flow<ReviewHistoryChangedEvent>,
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val reviewNotificationsManager: ReviewNotificationsManager,
    private val strictRemindersManager: StrictRemindersManager
) {
    private var reviewHistoryObserverJob: Job? = null
    private var workspaceObserverJob: Job? = null

    fun startReviewHistoryObserver() {
        reviewHistoryObserverJob?.cancel()
        reviewHistoryObserverJob = appScope.launch {
            reviewHistoryChangedEvents.collect { event ->
                val nowMillis = System.currentTimeMillis()
                val latestReviewedAtMillis = event.latestReviewedAtMillis
                if (latestReviewedAtMillis != null) {
                    strictRemindersManager.recordImportedReviewHistory(
                        importedReviewAtMillis = latestReviewedAtMillis,
                        nowMillis = nowMillis
                    )
                } else {
                    strictRemindersManager.reconcileStrictReminders(
                        trigger = StrictRemindersReconcileTrigger.REVIEW_HISTORY_IMPORTED,
                        nowMillis = nowMillis
                    )
                }
            }
        }
    }

    fun startWorkspaceObserver(initialWorkspaceId: String?) {
        if (initialWorkspaceId != null) {
            reviewNotificationsStore.migrateLegacySettings(currentWorkspaceId = initialWorkspaceId)
        }
        workspaceObserverJob?.cancel()
        workspaceObserverJob = appScope.launch {
            var previousWorkspaceId = initialWorkspaceId
            combine(localWorkspaces, cloudSettings) { workspaces, settings ->
                val activeWorkspaceId = settings.activeWorkspaceId
                NotificationsWorkspaceObservation(
                    activeWorkspaceId = activeWorkspaceId,
                    hasMatchingLocalWorkspace = if (activeWorkspaceId == null) {
                        workspaces.isEmpty()
                    } else {
                        workspaces.any { workspace ->
                            workspace.workspaceId == activeWorkspaceId
                        }
                    }
                )
            }.collectLatest { observation ->
                if (observation.hasMatchingLocalWorkspace.not()) {
                    return@collectLatest
                }

                val workspaceId = observation.activeWorkspaceId
                if (workspaceId == previousWorkspaceId) {
                    return@collectLatest
                }

                reconcileNotificationsForWorkspaceUntilSuccessful(workspaceId = workspaceId)
                previousWorkspaceId = workspaceId
            }
        }
    }

    suspend fun stopObservers() {
        reviewHistoryObserverJob?.cancelAndJoin()
        workspaceObserverJob?.cancelAndJoin()
    }

    private suspend fun reconcileNotificationsForWorkspaceUntilSuccessful(workspaceId: String?) {
        var attempt = 1
        var retryDelayMillis = notificationsWorkspaceReconcileInitialRetryDelayMillis
        while (true) {
            try {
                reconcileNotificationsForWorkspace(workspaceId = workspaceId)
                return
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(
                    notificationReconciliationLogTag,
                    "event=notifications_workspace_reconcile_retry " +
                        "workspace_id=${workspaceId ?: "none"} " +
                        "attempt=$attempt retry_delay_ms=$retryDelayMillis " +
                        renderSanitizedThrowableLogFields(error = error)
                )
                delay(timeMillis = retryDelayMillis)
                retryDelayMillis = minOf(
                    retryDelayMillis * 2L,
                    notificationsWorkspaceReconcileMaximumRetryDelayMillis
                )
                if (attempt < Int.MAX_VALUE) {
                    attempt += 1
                }
            }
        }
    }

    private suspend fun reconcileNotificationsForWorkspace(workspaceId: String?) {
        if (workspaceId != null) {
            reviewNotificationsStore.migrateLegacySettings(currentWorkspaceId = workspaceId)
        }
        val nowMillis = System.currentTimeMillis()
        reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
            trigger = ReviewNotificationsReconcileTrigger.WORKSPACE_CHANGED,
            nowMillis = nowMillis
        )
        strictRemindersManager.reconcileStrictRemindersAndWait(
            trigger = StrictRemindersReconcileTrigger.WORKSPACE_CHANGED,
            nowMillis = nowMillis
        )
    }
}
