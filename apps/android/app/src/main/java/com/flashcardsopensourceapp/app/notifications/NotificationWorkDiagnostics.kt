package com.flashcardsopensourceapp.app.notifications

import android.content.Context
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.await
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidNotificationSchedulingDiagnostic
import com.flashcardsopensourceapp.core.observability.AndroidWorkInfoStateCounts
import com.flashcardsopensourceapp.data.local.notifications.appNotificationWorkLimit
import com.flashcardsopensourceapp.data.local.notifications.strictReminderWorkLimit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

internal const val reviewReminderNotificationKind: String = "reviewReminder"
internal const val strictReminderNotificationKind: String = "strictReminder"

data class NotificationExpectedWorkInfoReadback(
    val stateCounts: AndroidWorkInfoStateCounts,
    val expectedWorkNameCount: Int,
    val missingExpectedWorkNameCount: Int
)

internal data class NotificationDelayRange(
    val firstScheduledAtMillis: Long?,
    val lastScheduledAtMillis: Long?,
    val minDelaySeconds: Long?,
    val maxDelaySeconds: Long?
)

internal suspend fun loadWorkInfoStateCountsByTag(
    workManager: WorkManager,
    workTag: String
): AndroidWorkInfoStateCounts {
    return countWorkInfoStates(
        workInfos = loadWorkInfosByTag(
            workManager = workManager,
            workTag = workTag
        )
    )
}

internal suspend fun loadExpectedWorkInfoReadback(
    workManager: WorkManager,
    expectedUniqueWorkNames: List<String>
): NotificationExpectedWorkInfoReadback {
    val distinctWorkNames: List<String> = expectedUniqueWorkNames.distinct()
    val workInfosByName: List<List<WorkInfo>> = distinctWorkNames.map { workName ->
        loadWorkInfosByUniqueWorkName(
            workManager = workManager,
            uniqueWorkName = workName
        )
    }
    val missingExpectedWorkNameCount = workInfosByName.count { workInfos ->
        workInfos.isEmpty()
    }

    return NotificationExpectedWorkInfoReadback(
        stateCounts = countWorkInfoStates(workInfos = workInfosByName.flatten()),
        expectedWorkNameCount = distinctWorkNames.size,
        missingExpectedWorkNameCount = missingExpectedWorkNameCount
    )
}

private suspend fun loadWorkInfosByTag(
    workManager: WorkManager,
    workTag: String
): List<WorkInfo> {
    return withContext(Dispatchers.IO) {
        workManager.getWorkInfosByTag(workTag).get()
    }
}

private suspend fun loadWorkInfosByUniqueWorkName(
    workManager: WorkManager,
    uniqueWorkName: String
): List<WorkInfo> {
    return withContext(Dispatchers.IO) {
        workManager.getWorkInfosForUniqueWork(uniqueWorkName).get()
    }
}

internal fun countWorkInfoStates(workInfos: List<WorkInfo>): AndroidWorkInfoStateCounts {
    val groupedCounts: Map<WorkInfo.State, Int> = workInfos.groupingBy { workInfo ->
        workInfo.state
    }.eachCount()

    return AndroidWorkInfoStateCounts(
        enqueued = groupedCounts[WorkInfo.State.ENQUEUED] ?: 0,
        running = groupedCounts[WorkInfo.State.RUNNING] ?: 0,
        blocked = groupedCounts[WorkInfo.State.BLOCKED] ?: 0,
        cancelled = groupedCounts[WorkInfo.State.CANCELLED] ?: 0,
        failed = groupedCounts[WorkInfo.State.FAILED] ?: 0,
        succeeded = groupedCounts[WorkInfo.State.SUCCEEDED] ?: 0
    )
}

internal fun calculateNotificationDelayRange(
    scheduledAtMillisValues: List<Long>,
    nowMillis: Long
): NotificationDelayRange {
    if (scheduledAtMillisValues.isEmpty()) {
        return NotificationDelayRange(
            firstScheduledAtMillis = null,
            lastScheduledAtMillis = null,
            minDelaySeconds = null,
            maxDelaySeconds = null
        )
    }

    val sortedScheduledAtMillisValues: List<Long> = scheduledAtMillisValues.sorted()
    val delaySecondsValues: List<Long> = sortedScheduledAtMillisValues.map { scheduledAtMillis ->
        TimeUnit.MILLISECONDS.toSeconds(maxOf(0L, scheduledAtMillis - nowMillis))
    }

    return NotificationDelayRange(
        firstScheduledAtMillis = sortedScheduledAtMillisValues.first(),
        lastScheduledAtMillis = sortedScheduledAtMillisValues.last(),
        minDelaySeconds = delaySecondsValues.minOrNull(),
        maxDelaySeconds = delaySecondsValues.maxOrNull()
    )
}

internal fun emptyNotificationDelayRange(): NotificationDelayRange {
    return NotificationDelayRange(
        firstScheduledAtMillis = null,
        lastScheduledAtMillis = null,
        minDelaySeconds = null,
        maxDelaySeconds = null
    )
}

internal fun hasMissingExpectedWorkNames(readback: NotificationExpectedWorkInfoReadback): Boolean {
    return readback.expectedWorkNameCount > 0 && readback.missingExpectedWorkNameCount > 0
}

internal fun hasOnlyCancelledOrFailedExpectedWork(readback: NotificationExpectedWorkInfoReadback): Boolean {
    val counts: AndroidWorkInfoStateCounts = readback.stateCounts
    val observedWorkCount: Int = counts.enqueued +
        counts.running +
        counts.blocked +
        counts.cancelled +
        counts.failed +
        counts.succeeded
    val failedOrCancelledCount: Int = counts.cancelled + counts.failed

    return observedWorkCount > 0 && failedOrCancelledCount == observedWorkCount
}

internal fun addNotificationWorkerBreadcrumb(
    applicationContext: Context,
    notificationKind: String,
    stage: String,
    requestId: String?,
    workspaceId: String?,
    permissionAllowed: Boolean,
    workTag: String,
    workLimit: Int?
) {
    val appGraph: AppGraph = (applicationContext as? FlashcardsApplication)?.appGraphOrNull ?: return
    appGraph.observability.addBreadcrumb(
        event = AndroidBreadcrumbEvent.NotificationSchedulingBreadcrumb(
            diagnostic = AndroidNotificationSchedulingDiagnostic(
                notificationKind = notificationKind,
                stage = stage,
                trigger = "work_manager",
                requestId = requestId,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed,
                plannedCount = null,
                workLimit = workLimit,
                appNotificationWorkLimit = appNotificationWorkLimit,
                strictReminderWorkLimit = strictReminderWorkLimit,
                strictRemindersEnabled = null,
                plannedCountEqualsWorkLimit = null,
                storedScheduledCountBefore = null,
                storedScheduledCountAfter = null,
                workTag = workTag,
                tagWorkStateCounts = null,
                expectedWorkStateCounts = null,
                expectedWorkNameCount = null,
                missingExpectedWorkNameCount = null,
                firstScheduledAtMillis = null,
                lastScheduledAtMillis = null,
                minDelaySeconds = null,
                maxDelaySeconds = null,
                generation = null,
                managerClosed = null,
                enqueueRejected = null
            ),
            appVersion = appGraph.appPackageInfo.versionName,
            clientVersion = appGraph.appPackageInfo.versionName,
            versionCode = appGraph.appPackageInfo.longVersionCode.toInt()
        )
    )
}
