package com.flashcardsopensourceapp.app.notifications.strict

import android.app.NotificationManager
import android.content.Context
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.await
import com.flashcardsopensourceapp.app.notifications.NotificationDelayRange
import com.flashcardsopensourceapp.app.notifications.NotificationExpectedWorkInfoReadback
import com.flashcardsopensourceapp.app.notifications.calculateNotificationDelayRange
import com.flashcardsopensourceapp.app.notifications.emptyNotificationDelayRange
import com.flashcardsopensourceapp.app.notifications.hasMissingExpectedWorkNames
import com.flashcardsopensourceapp.app.notifications.hasOnlyCancelledOrFailedExpectedWork
import com.flashcardsopensourceapp.app.notifications.loadExpectedWorkInfoReadback
import com.flashcardsopensourceapp.app.notifications.loadWorkInfoStateCountsByTag
import com.flashcardsopensourceapp.app.notifications.strictReminderNotificationKind
import com.flashcardsopensourceapp.app.notifications.reviewNotificationChannelId
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission as hasNotificationPermissionGranted
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidNotificationSchedulingDiagnostic
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWorkInfoStateCounts
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
import com.flashcardsopensourceapp.data.local.notifications.ScheduledStrictReminderPayload
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.notifications.appNotificationWorkLimit
import com.flashcardsopensourceapp.data.local.notifications.buildStrictReminderLocalDateWindow
import com.flashcardsopensourceapp.data.local.notifications.buildStrictReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.isStrictReminderLocalDateCompleted
import com.flashcardsopensourceapp.data.local.notifications.mergeStrictReminderCompletedReviewAtMillis
import com.flashcardsopensourceapp.data.local.notifications.resolveStrictReminderCompletedReviewAtMillis
import com.flashcardsopensourceapp.data.local.notifications.strictReminderWorkLimit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.ClosedSendChannelException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

const val strictReminderRequestIdDataKey: String = "strictReminderRequestId"
const val strictReminderTimeOffsetDataKey: String = "strictReminderTimeOffset"
const val strictReminderWorkTag: String = "strict-reminder-notification"

interface StrictRemindersScheduler {
    fun hasNotificationPermission(): Boolean
    fun clearDeliveredNotifications()
    suspend fun clearScheduledReminders()
    suspend fun scheduleReminder(payload: ScheduledStrictReminderPayload, nowMillis: Long)
    suspend fun loadScheduledWorkStateCounts(): AndroidWorkInfoStateCounts
    suspend fun loadExpectedWorkReadback(requestIds: List<String>): NotificationExpectedWorkInfoReadback
}

private sealed interface StrictRemindersCommand {
    data class Reconcile(
        val trigger: StrictRemindersReconcileTrigger,
        val nowMillis: Long,
        val completion: CompletableDeferred<Unit>?
    ) : StrictRemindersCommand

    data class RecordSuccessfulReview(
        val reviewedAtMillis: Long,
        val nowMillis: Long
    ) : StrictRemindersCommand

    data class RecordImportedReviewHistory(
        val importedReviewAtMillis: Long,
        val nowMillis: Long
    ) : StrictRemindersCommand

    data class ClearIdentityState(
        val completion: CompletableDeferred<Unit>
    ) : StrictRemindersCommand
}

class AndroidStrictRemindersScheduler(
    private val context: Context
) : StrictRemindersScheduler {
    private val workManager: WorkManager = WorkManager.getInstance(context)

    override fun hasNotificationPermission(): Boolean {
        return hasNotificationPermissionGranted(context = context)
    }

    override fun clearDeliveredNotifications() {
        val notificationManager = context.getSystemService(NotificationManager::class.java)
        val deliveredNotifications = notificationManager.activeNotifications.filter { notification ->
            isStrictReminderNotification(notification = notification)
        }
        if (deliveredNotifications.isEmpty()) {
            return
        }

        val compatManager = NotificationManagerCompat.from(context)
        deliveredNotifications.forEach { notification ->
            val tag = notification.tag ?: return@forEach
            compatManager.cancel(tag, notification.id)
        }
    }

    override suspend fun clearScheduledReminders() {
        workManager.cancelAllWorkByTag(strictReminderWorkTag).await()
    }

    override suspend fun scheduleReminder(payload: ScheduledStrictReminderPayload, nowMillis: Long) {
        val delayMillis = maxOf(1L, payload.scheduledAtMillis - nowMillis)
        val inputData = Data.Builder()
            .putString(strictReminderRequestIdDataKey, payload.requestId)
            .putString(strictReminderTimeOffsetDataKey, payload.timeOffset.rawValue)
            .build()
        val request = OneTimeWorkRequestBuilder<StrictReminderWorker>()
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .setInputData(inputData)
            .setConstraints(
                Constraints.Builder()
                    .setRequiresBatteryNotLow(false)
                    .build()
            )
            .addTag(strictReminderWorkTag)
            .build()

        workManager.enqueueUniqueWork(
            payload.requestId,
            ExistingWorkPolicy.REPLACE,
            request
        ).await()
    }

    override suspend fun loadScheduledWorkStateCounts(): AndroidWorkInfoStateCounts {
        return loadWorkInfoStateCountsByTag(
            workManager = workManager,
            workTag = strictReminderWorkTag
        )
    }

    override suspend fun loadExpectedWorkReadback(
        requestIds: List<String>
    ): NotificationExpectedWorkInfoReadback {
        return loadExpectedWorkInfoReadback(
            workManager = workManager,
            expectedUniqueWorkNames = requestIds
        )
    }

    private fun isStrictReminderNotification(notification: StatusBarNotification): Boolean {
        if (notification.packageName != context.packageName) {
            return false
        }
        if (notification.notification.channelId != reviewNotificationChannelId) {
            return false
        }

        val tag = notification.tag ?: return false
        return tag.startsWith(strictReminderNotificationTagPrefix)
    }
}

class StrictRemindersManager(
    private val strictRemindersStore: StrictRemindersStore,
    private val reviewLogDao: ReviewLogDao,
    private val scheduler: StrictRemindersScheduler,
    private val zoneIdProvider: () -> ZoneId,
    private val observability: AppObservability,
    private val appVersion: String?,
    private val versionCode: Int?
) {
    private val scopeJob = SupervisorJob()
    private val scope = CoroutineScope(scopeJob + Dispatchers.Default)
    private val commandChannel = Channel<StrictRemindersCommand>(capacity = Channel.UNLIMITED)
    private val isClosed = AtomicBoolean(false)
    private val processorJob = scope.launch {
        for (command in commandChannel) {
            processCommand(command = command)
        }
    }

    fun reconcileStrictReminders(
        trigger: StrictRemindersReconcileTrigger,
        nowMillis: Long
    ) {
        enqueueCommandIfOpen(
            command = StrictRemindersCommand.Reconcile(
                trigger = trigger,
                nowMillis = nowMillis,
                completion = null
            )
        )
    }

    suspend fun reconcileStrictRemindersAndWait(
        trigger: StrictRemindersReconcileTrigger,
        nowMillis: Long
    ) {
        val completion = CompletableDeferred<Unit>()
        enqueueRequiredCommand(
            command = StrictRemindersCommand.Reconcile(
                trigger = trigger,
                nowMillis = nowMillis,
                completion = completion
            )
        )
        completion.await()
    }

    fun recordSuccessfulReview(
        reviewedAtMillis: Long,
        nowMillis: Long
    ) {
        enqueueCommandIfOpen(
            command = StrictRemindersCommand.RecordSuccessfulReview(
                reviewedAtMillis = reviewedAtMillis,
                nowMillis = nowMillis
            )
        )
    }

    fun recordImportedReviewHistory(
        importedReviewAtMillis: Long,
        nowMillis: Long
    ) {
        enqueueCommandIfOpen(
            command = StrictRemindersCommand.RecordImportedReviewHistory(
                importedReviewAtMillis = importedReviewAtMillis,
                nowMillis = nowMillis
            )
        )
    }

    suspend fun clearForCloudIdentityReset() {
        val completion = CompletableDeferred<Unit>()
        enqueueRequiredCommand(
            command = StrictRemindersCommand.ClearIdentityState(
                completion = completion
            )
        )
        completion.await()
    }

    suspend fun close() {
        if (isClosed.compareAndSet(false, true).not()) {
            return
        }
        commandChannel.close()
        processorJob.cancelAndJoin()
        scopeJob.cancelAndJoin()
    }

    private suspend fun processCommand(command: StrictRemindersCommand) {
        when (command) {
            is StrictRemindersCommand.Reconcile -> {
                runCompletableCommand(completion = command.completion) {
                    reconcileStrictRemindersNow(
                        trigger = command.trigger,
                        nowMillis = command.nowMillis
                    )
                }
            }

            is StrictRemindersCommand.RecordSuccessfulReview -> {
                strictRemindersStore.saveLastCompletedReviewAtMillis(
                    timestampMillis = command.reviewedAtMillis
                )
                reconcileStrictRemindersNow(
                    trigger = StrictRemindersReconcileTrigger.REVIEW_RECORDED,
                    nowMillis = command.nowMillis
                )
            }

            is StrictRemindersCommand.RecordImportedReviewHistory -> {
                val mergedCompletedReviewAtMillis = mergeStrictReminderCompletedReviewAtMillis(
                    existingCompletedReviewAtMillis = strictRemindersStore.loadLastCompletedReviewAtMillis(),
                    candidateCompletedReviewAtMillis = command.importedReviewAtMillis
                )
                if (mergedCompletedReviewAtMillis != null) {
                    strictRemindersStore.saveLastCompletedReviewAtMillis(
                        timestampMillis = mergedCompletedReviewAtMillis
                    )
                }
                reconcileStrictRemindersNow(
                    trigger = StrictRemindersReconcileTrigger.REVIEW_HISTORY_IMPORTED,
                    nowMillis = command.nowMillis
                )
            }

            is StrictRemindersCommand.ClearIdentityState -> {
                runCompletableCommand(completion = command.completion) {
                    clearIdentityStateNow()
                }
            }
        }
    }

    private suspend fun runCompletableCommand(
        completion: CompletableDeferred<Unit>?,
        action: suspend () -> Unit
    ) {
        runCatching {
            action()
        }.onSuccess {
            completion?.complete(Unit)
        }.onFailure { error ->
            completion?.completeExceptionally(error)
            throw error
        }
    }

    private fun enqueueCommandIfOpen(command: StrictRemindersCommand) {
        if (tryEnqueueCommand(command = command)) {
            return
        }

        emitStrictReminderCommandRejectedWarning(command = command)
    }

    private fun enqueueRequiredCommand(command: StrictRemindersCommand) {
        if (tryEnqueueCommand(command = command)) {
            return
        }

        emitStrictReminderCommandRejectedWarning(command = command)
        throw closedManagerException(cause = null)
    }

    private fun tryEnqueueCommand(command: StrictRemindersCommand): Boolean {
        if (isClosed.get()) {
            return false
        }

        val result = commandChannel.trySend(command)
        if (result.isSuccess) {
            return true
        }

        val sendException = result.exceptionOrNull()
        if (isClosed.get() || sendException is ClosedSendChannelException) {
            return false
        }

        throw IllegalStateException(
            "Strict reminders command could not be enqueued.",
            sendException
        )
    }

    private fun closedManagerException(cause: Throwable?): IllegalStateException {
        return IllegalStateException(
            "Strict reminders manager is closed.",
            cause ?: ClosedSendChannelException("Strict reminders manager is closed.")
        )
    }

    private suspend fun reconcileStrictRemindersNow(
        trigger: StrictRemindersReconcileTrigger,
        nowMillis: Long
    ) {
        val storedScheduledCountBefore: Int = strictRemindersStore.loadScheduledStrictReminderPayloads().size
        val settings = strictRemindersStore.loadStrictRemindersSettings()
        val permissionAllowed: Boolean = scheduler.hasNotificationPermission()
        emitStrictReminderSchedulingBreadcrumb(
            diagnostic = makeStrictReminderSchedulingDiagnostic(
                stage = "reconcile_start",
                trigger = trigger.name.lowercase(),
                permissionAllowed = permissionAllowed,
                plannedCount = null,
                storedScheduledCountBefore = storedScheduledCountBefore,
                storedScheduledCountAfter = null,
                tagWorkStateCounts = null,
                expectedWorkReadback = null,
                delayRange = emptyNotificationDelayRange(),
                managerClosed = false,
                enqueueRejected = false
            )
        )

        if (trigger.shouldClearDeliveredStrictReminders) {
            scheduler.clearDeliveredNotifications()
        }

        scheduler.clearScheduledReminders()
        strictRemindersStore.saveScheduledStrictReminderPayloads(payloads = emptyList())
        emitStrictReminderSchedulingBreadcrumb(
            diagnostic = makeStrictReminderSchedulingDiagnostic(
                stage = "after_cancel",
                trigger = trigger.name.lowercase(),
                permissionAllowed = permissionAllowed,
                plannedCount = null,
                storedScheduledCountBefore = storedScheduledCountBefore,
                storedScheduledCountAfter = strictRemindersStore.loadScheduledStrictReminderPayloads().size,
                tagWorkStateCounts = scheduler.loadScheduledWorkStateCounts(),
                expectedWorkReadback = null,
                delayRange = emptyNotificationDelayRange(),
                managerClosed = false,
                enqueueRejected = false
            )
        )

        if (settings.isEnabled.not()) {
            saveEmptyStrictReminderSchedulingAndEmitSkippedDiagnostic(
                stage = "settings_disabled",
                trigger = trigger,
                permissionAllowed = permissionAllowed,
                storedScheduledCountBefore = storedScheduledCountBefore
            )
            return
        }
        if (permissionAllowed.not()) {
            // Keep the internal setting enabled; Android permission alone gates delivery.
            saveEmptyStrictReminderSchedulingAndEmitSkippedDiagnostic(
                stage = "permission_blocked",
                trigger = trigger,
                permissionAllowed = permissionAllowed,
                storedScheduledCountBefore = storedScheduledCountBefore
            )
            return
        }

        val zoneId = zoneIdProvider()
        val lastCompletedReviewAtMillis = loadEffectiveLastCompletedReviewAtMillis(
            nowMillis = nowMillis,
            zoneId = zoneId
        )
        val payloads = buildStrictReminderPayloads(
            nowMillis = nowMillis,
            zoneId = zoneId,
            isLocalDateCompleted = { localDate ->
                isStrictReminderLocalDateCompleted(
                    localDate = localDate,
                    zoneId = zoneId,
                    completedReviewAtMillis = lastCompletedReviewAtMillis
                )
            }
        )

        payloads.forEach { payload ->
            scheduler.scheduleReminder(
                payload = payload,
                nowMillis = nowMillis
            )
        }

        strictRemindersStore.saveScheduledStrictReminderPayloads(payloads = payloads)
        val expectedWorkReadback: NotificationExpectedWorkInfoReadback = scheduler.loadExpectedWorkReadback(
            requestIds = payloads.map { payload ->
                payload.requestId
            }
        )
        val delayRange: NotificationDelayRange = calculateNotificationDelayRange(
            scheduledAtMillisValues = payloads.map { payload ->
                payload.scheduledAtMillis
            },
            nowMillis = nowMillis
        )
        val afterEnqueueDiagnostic: AndroidNotificationSchedulingDiagnostic = makeStrictReminderSchedulingDiagnostic(
            stage = "after_enqueue",
            trigger = trigger.name.lowercase(),
            permissionAllowed = permissionAllowed,
            plannedCount = payloads.size,
            storedScheduledCountBefore = storedScheduledCountBefore,
            storedScheduledCountAfter = strictRemindersStore.loadScheduledStrictReminderPayloads().size,
            tagWorkStateCounts = scheduler.loadScheduledWorkStateCounts(),
            expectedWorkReadback = expectedWorkReadback,
            delayRange = delayRange,
            managerClosed = false,
            enqueueRejected = false
        )
        emitStrictReminderSchedulingBreadcrumb(diagnostic = afterEnqueueDiagnostic)
        emitStrictReminderSchedulingWarningIfNeeded(
            diagnostic = afterEnqueueDiagnostic,
            plannedCount = payloads.size,
            expectedWorkReadback = expectedWorkReadback
        )
    }

    private suspend fun saveEmptyStrictReminderSchedulingAndEmitSkippedDiagnostic(
        stage: String,
        trigger: StrictRemindersReconcileTrigger,
        permissionAllowed: Boolean,
        storedScheduledCountBefore: Int
    ) {
        strictRemindersStore.saveScheduledStrictReminderPayloads(payloads = emptyList())
        emitStrictReminderSchedulingBreadcrumb(
            diagnostic = makeStrictReminderSchedulingDiagnostic(
                stage = stage,
                trigger = trigger.name.lowercase(),
                permissionAllowed = permissionAllowed,
                plannedCount = 0,
                storedScheduledCountBefore = storedScheduledCountBefore,
                storedScheduledCountAfter = strictRemindersStore.loadScheduledStrictReminderPayloads().size,
                tagWorkStateCounts = scheduler.loadScheduledWorkStateCounts(),
                expectedWorkReadback = null,
                delayRange = emptyNotificationDelayRange(),
                managerClosed = false,
                enqueueRejected = false
            )
        )
    }

    private fun makeStrictReminderSchedulingDiagnostic(
        stage: String,
        trigger: String,
        permissionAllowed: Boolean?,
        plannedCount: Int?,
        storedScheduledCountBefore: Int?,
        storedScheduledCountAfter: Int?,
        tagWorkStateCounts: AndroidWorkInfoStateCounts?,
        expectedWorkReadback: NotificationExpectedWorkInfoReadback?,
        delayRange: NotificationDelayRange,
        managerClosed: Boolean?,
        enqueueRejected: Boolean?
    ): AndroidNotificationSchedulingDiagnostic {
        return AndroidNotificationSchedulingDiagnostic(
            notificationKind = strictReminderNotificationKind,
            stage = stage,
            trigger = trigger,
            requestId = null,
            workspaceId = null,
            permissionAllowed = permissionAllowed,
            plannedCount = plannedCount,
            workLimit = strictReminderWorkLimit,
            appNotificationWorkLimit = appNotificationWorkLimit,
            strictReminderWorkLimit = strictReminderWorkLimit,
            strictRemindersEnabled = null,
            plannedCountEqualsWorkLimit = plannedCount?.let { count ->
                count == strictReminderWorkLimit
            },
            storedScheduledCountBefore = storedScheduledCountBefore,
            storedScheduledCountAfter = storedScheduledCountAfter,
            workTag = strictReminderWorkTag,
            tagWorkStateCounts = tagWorkStateCounts,
            expectedWorkStateCounts = expectedWorkReadback?.stateCounts,
            expectedWorkNameCount = expectedWorkReadback?.expectedWorkNameCount,
            missingExpectedWorkNameCount = expectedWorkReadback?.missingExpectedWorkNameCount,
            firstScheduledAtMillis = delayRange.firstScheduledAtMillis,
            lastScheduledAtMillis = delayRange.lastScheduledAtMillis,
            minDelaySeconds = delayRange.minDelaySeconds,
            maxDelaySeconds = delayRange.maxDelaySeconds,
            generation = null,
            managerClosed = managerClosed,
            enqueueRejected = enqueueRejected
        )
    }

    private fun emitStrictReminderSchedulingBreadcrumb(diagnostic: AndroidNotificationSchedulingDiagnostic) {
        observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.NotificationSchedulingBreadcrumb(
                diagnostic = diagnostic,
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }

    private fun emitStrictReminderSchedulingWarningIfNeeded(
        diagnostic: AndroidNotificationSchedulingDiagnostic,
        plannedCount: Int,
        expectedWorkReadback: NotificationExpectedWorkInfoReadback
    ) {
        if (plannedCount == 0) {
            return
        }

        val warningReason: String = when {
            hasMissingExpectedWorkNames(readback = expectedWorkReadback) -> "expected_work_missing"
            hasOnlyCancelledOrFailedExpectedWork(readback = expectedWorkReadback) -> {
                "expected_work_cancelled_or_failed"
            }
            else -> return
        }
        observability.captureWarning(
            event = AndroidWarningIssueEvent.NotificationSchedulingWarning(
                diagnostic = diagnostic,
                warningReason = warningReason,
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }

    private fun emitStrictReminderCommandRejectedWarning(command: StrictRemindersCommand) {
        val diagnostic = makeStrictReminderSchedulingDiagnostic(
            stage = "command_enqueue_rejected",
            trigger = strictReminderCommandTrigger(command = command),
            permissionAllowed = null,
            plannedCount = null,
            storedScheduledCountBefore = null,
            storedScheduledCountAfter = null,
            tagWorkStateCounts = null,
            expectedWorkReadback = null,
            delayRange = emptyNotificationDelayRange(),
            managerClosed = isClosed.get(),
            enqueueRejected = true
        )
        observability.captureWarning(
            event = AndroidWarningIssueEvent.NotificationSchedulingWarning(
                diagnostic = diagnostic,
                warningReason = "command_enqueue_rejected",
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }

    private fun strictReminderCommandTrigger(command: StrictRemindersCommand): String {
        return when (command) {
            is StrictRemindersCommand.Reconcile -> command.trigger.name.lowercase()
            is StrictRemindersCommand.RecordSuccessfulReview -> "record_successful_review"
            is StrictRemindersCommand.RecordImportedReviewHistory -> "record_imported_review_history"
            is StrictRemindersCommand.ClearIdentityState -> "clear_identity_state"
        }
    }

    private suspend fun clearIdentityStateNow() {
        scheduler.clearDeliveredNotifications()
        scheduler.clearScheduledReminders()
        strictRemindersStore.clearStrictRemindersIdentityState()
    }

    private suspend fun loadEffectiveLastCompletedReviewAtMillis(
        nowMillis: Long,
        zoneId: ZoneId
    ): Long? {
        val existingCompletedReviewAtMillis = strictRemindersStore.loadLastCompletedReviewAtMillis()
        val currentLocalDate = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
        val currentLocalDateWindow = buildStrictReminderLocalDateWindow(
            localDate = currentLocalDate,
            zoneId = zoneId
        )
        val hasReviewLogsInCurrentLocalDate = reviewLogDao.hasReviewLogsBetween(
            startMillis = currentLocalDateWindow.startMillis,
            endMillis = currentLocalDateWindow.endMillis
        )
        val resolvedCompletedReviewAtMillis = resolveStrictReminderCompletedReviewAtMillis(
            currentLocalDate = currentLocalDate,
            zoneId = zoneId,
            existingCompletedReviewAtMillis = existingCompletedReviewAtMillis,
            hasReviewLogsInCurrentLocalDate = hasReviewLogsInCurrentLocalDate
        )
        if (resolvedCompletedReviewAtMillis != existingCompletedReviewAtMillis) {
            if (resolvedCompletedReviewAtMillis == null) {
                strictRemindersStore.clearLastCompletedReviewAtMillis()
            } else {
                strictRemindersStore.saveLastCompletedReviewAtMillis(
                    timestampMillis = resolvedCompletedReviewAtMillis
                )
            }
        }

        return resolvedCompletedReviewAtMillis
    }
}
