package com.flashcardsopensourceapp.app.notifications

import android.app.NotificationManager
import android.content.Context
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.flashcardsopensourceapp.data.local.database.ReviewLogDao
import com.flashcardsopensourceapp.data.local.notifications.ScheduledStrictReminderPayload
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.notifications.buildStrictReminderLocalDateWindow
import com.flashcardsopensourceapp.data.local.notifications.buildStrictReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.isStrictReminderLocalDateCompleted
import com.flashcardsopensourceapp.data.local.notifications.mergeStrictReminderCompletedReviewAtMillis
import com.flashcardsopensourceapp.data.local.notifications.resolveStrictReminderCompletedReviewAtMillis
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
    fun clearScheduledReminders()
    fun scheduleReminder(payload: ScheduledStrictReminderPayload, nowMillis: Long)
}

private sealed interface StrictRemindersCommand {
    data class Reconcile(
        val trigger: StrictRemindersReconcileTrigger,
        val nowMillis: Long
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
        return hasNotificationPermission(context = context)
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

    override fun clearScheduledReminders() {
        workManager.cancelAllWorkByTag(strictReminderWorkTag)
    }

    override fun scheduleReminder(payload: ScheduledStrictReminderPayload, nowMillis: Long) {
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
    private val zoneIdProvider: () -> ZoneId
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
                nowMillis = nowMillis
            )
        )
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
                reconcileStrictRemindersNow(
                    trigger = command.trigger,
                    nowMillis = command.nowMillis
                )
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
                runCatching {
                    clearIdentityStateNow()
                }.onSuccess {
                    command.completion.complete(Unit)
                }.onFailure { error ->
                    command.completion.completeExceptionally(error)
                    throw error
                }
            }
        }
    }

    private fun enqueueCommandIfOpen(command: StrictRemindersCommand) {
        if (tryEnqueueCommand(command = command)) {
            return
        }
    }

    private fun enqueueRequiredCommand(command: StrictRemindersCommand) {
        if (tryEnqueueCommand(command = command)) {
            return
        }

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
        if (trigger.shouldClearDeliveredStrictReminders) {
            scheduler.clearDeliveredNotifications()
        }

        scheduler.clearScheduledReminders()
        strictRemindersStore.saveScheduledStrictReminderPayloads(payloads = emptyList())

        val settings = strictRemindersStore.loadStrictRemindersSettings()
        if (settings.isEnabled.not() || scheduler.hasNotificationPermission().not()) {
            // Keep the internal setting enabled; Android permission alone gates delivery.
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
    }

    private fun clearIdentityStateNow() {
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
