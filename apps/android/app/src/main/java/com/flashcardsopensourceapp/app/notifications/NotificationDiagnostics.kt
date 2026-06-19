package com.flashcardsopensourceapp.app.notifications

import android.app.NotificationManager
import android.content.Context
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.work.WorkManager
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.notifications.review.reviewNotificationWorkTag
import com.flashcardsopensourceapp.app.notifications.review.reviewReminderNotificationTagPrefix
import com.flashcardsopensourceapp.app.notifications.strict.strictReminderNotificationTagPrefix
import com.flashcardsopensourceapp.app.notifications.strict.strictReminderWorkTag
import com.flashcardsopensourceapp.core.observability.AndroidWorkInfoStateCounts
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.notifications.PersistedReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload
import com.flashcardsopensourceapp.data.local.notifications.ScheduledStrictReminderPayload
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersSettings
import com.flashcardsopensourceapp.data.local.notifications.appNotificationWorkLimit
import com.flashcardsopensourceapp.data.local.notifications.reviewNotificationWorkLimit
import com.flashcardsopensourceapp.data.local.notifications.strictReminderWorkLimit
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsChannelUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsDeliveredUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsPermissionUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsReviewFilterUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsReviewPayloadUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsReviewRemindersUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsReviewSettingsUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsSchedulingUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsStrictReminderPayloadUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsStrictReminderSettingsUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsStrictRemindersUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsWorkInfoStateCountsUiState
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsWorkspaceUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

internal suspend fun loadNotificationDiagnosticsUiState(
    context: Context,
    appGraph: AppGraph
): NotificationDiagnosticsUiState.Ready {
    val applicationContext = context.applicationContext
    val workspace: WorkspaceSummary = appGraph.workspaceRepository.observeWorkspace().first()
        ?: throw IllegalStateException(
            "Notification diagnostics require a current workspace before loading stored reminder settings."
        )
    val reviewSettings: ReviewNotificationsSettings = withContext(Dispatchers.IO) {
        appGraph.reviewNotificationsStore.loadSettings(workspaceId = workspace.workspaceId)
    }
    val strictSettings: StrictRemindersSettings = withContext(Dispatchers.IO) {
        appGraph.strictRemindersStore.loadStrictRemindersSettings()
    }
    val reviewPayloads: List<ScheduledReviewNotificationPayload> = withContext(Dispatchers.IO) {
        appGraph.reviewNotificationsStore.loadScheduledPayloads(workspaceId = workspace.workspaceId)
    }
    val strictPayloads: List<ScheduledStrictReminderPayload> = withContext(Dispatchers.IO) {
        appGraph.strictRemindersStore.loadScheduledStrictReminderPayloads()
    }
    val workManager = WorkManager.getInstance(applicationContext)
    val reviewReadback = loadExpectedWorkInfoReadback(
        workManager = workManager,
        expectedUniqueWorkNames = reviewPayloads.map(ScheduledReviewNotificationPayload::requestId)
    )
    val strictReadback = loadExpectedWorkInfoReadback(
        workManager = workManager,
        expectedUniqueWorkNames = strictPayloads.map(ScheduledStrictReminderPayload::requestId)
    )

    return NotificationDiagnosticsUiState.Ready(
        workspace = NotificationDiagnosticsWorkspaceUiState(
            workspaceId = workspace.workspaceId,
            workspaceName = workspace.name
        ),
        permission = NotificationDiagnosticsPermissionUiState(
            isGranted = hasNotificationPermission(context = applicationContext)
        ),
        channel = loadNotificationChannelDiagnostics(context = applicationContext),
        delivered = loadDeliveredNotificationDiagnostics(context = applicationContext),
        reviewReminders = NotificationDiagnosticsReviewRemindersUiState(
            settings = reviewSettings.toNotificationDiagnosticsUiState(strictSettings = strictSettings),
            scheduling = NotificationDiagnosticsSchedulingUiState(
                workTag = reviewNotificationWorkTag,
                tagStateCounts = loadWorkInfoStateCountsByTag(
                    workManager = workManager,
                    workTag = reviewNotificationWorkTag
                ).toNotificationDiagnosticsUiState(),
                expectedWorkNameCount = reviewReadback.expectedWorkNameCount,
                missingExpectedWorkNameCount = reviewReadback.missingExpectedWorkNameCount,
                expectedStateCounts = reviewReadback.stateCounts.toNotificationDiagnosticsUiState()
            ),
            storedPayloads = reviewPayloads.map(ScheduledReviewNotificationPayload::toNotificationDiagnosticsUiState)
        ),
        strictReminders = NotificationDiagnosticsStrictRemindersUiState(
            settings = NotificationDiagnosticsStrictReminderSettingsUiState(
                isEnabled = strictSettings.isEnabled,
                lastCompletedReviewAtMillis = withContext(Dispatchers.IO) {
                    appGraph.strictRemindersStore.loadLastCompletedReviewAtMillis()
                },
                workLimit = strictReminderWorkLimit
            ),
            scheduling = NotificationDiagnosticsSchedulingUiState(
                workTag = strictReminderWorkTag,
                tagStateCounts = loadWorkInfoStateCountsByTag(
                    workManager = workManager,
                    workTag = strictReminderWorkTag
                ).toNotificationDiagnosticsUiState(),
                expectedWorkNameCount = strictReadback.expectedWorkNameCount,
                missingExpectedWorkNameCount = strictReadback.missingExpectedWorkNameCount,
                expectedStateCounts = strictReadback.stateCounts.toNotificationDiagnosticsUiState()
            ),
            storedPayloads = strictPayloads.map(ScheduledStrictReminderPayload::toNotificationDiagnosticsUiState)
        )
    )
}

private fun loadNotificationChannelDiagnostics(context: Context): NotificationDiagnosticsChannelUiState {
    val notificationManager = context.getSystemService(NotificationManager::class.java)
    val channel = notificationManager.getNotificationChannel(reviewNotificationChannelId)

    return NotificationDiagnosticsChannelUiState(
        channelId = reviewNotificationChannelId,
        areAppNotificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
        isCreated = channel != null,
        importance = channel?.importance,
        isEnabled = channel?.let { notificationChannel ->
            notificationChannel.importance != NotificationManager.IMPORTANCE_NONE
        }
    )
}

private fun loadDeliveredNotificationDiagnostics(context: Context): NotificationDiagnosticsDeliveredUiState {
    val notificationManager = context.getSystemService(NotificationManager::class.java)
    val notifications: List<StatusBarNotification> = notificationManager.activeNotifications.toList()
    val reviewReminderCount = notifications.count { notification ->
        notification.isReviewReminderNotification(context = context)
    }
    val strictReminderCount = notifications.count { notification ->
        notification.isStrictReminderNotification()
    }
    val otherReviewChannelCount = notifications.count { notification ->
        notification.packageName == context.packageName &&
            notification.notification.channelId == reviewNotificationChannelId &&
            notification.isReviewReminderNotification(context = context).not() &&
            notification.isStrictReminderNotification().not()
    }

    return NotificationDiagnosticsDeliveredUiState(
        reviewReminderCount = reviewReminderCount,
        strictReminderCount = strictReminderCount,
        otherReviewChannelCount = otherReviewChannelCount
    )
}

private fun StatusBarNotification.isReviewReminderNotification(context: Context): Boolean {
    if (packageName != context.packageName) {
        return false
    }
    if (notification.channelId != reviewNotificationChannelId) {
        return false
    }
    val notificationTag: String = tag ?: return false
    return notificationTag.startsWith(reviewReminderNotificationTagPrefix)
}

private fun StatusBarNotification.isStrictReminderNotification(): Boolean {
    val notificationTag: String = tag ?: return false
    return notificationTag.startsWith(strictReminderNotificationTagPrefix)
}

private fun ReviewNotificationsSettings.toNotificationDiagnosticsUiState(
    strictSettings: StrictRemindersSettings
): NotificationDiagnosticsReviewSettingsUiState {
    return NotificationDiagnosticsReviewSettingsUiState(
        isEnabled = isEnabled,
        selectedMode = selectedMode,
        dailyHour = daily.hour,
        dailyMinute = daily.minute,
        inactivityWindowStartHour = inactivity.windowStartHour,
        inactivityWindowStartMinute = inactivity.windowStartMinute,
        inactivityWindowEndHour = inactivity.windowEndHour,
        inactivityWindowEndMinute = inactivity.windowEndMinute,
        inactivityIdleMinutes = inactivity.idleMinutes,
        showAppIconBadge = showAppIconBadge,
        workLimit = reviewNotificationWorkLimit(strictRemindersSettings = strictSettings),
        appNotificationWorkLimit = appNotificationWorkLimit
    )
}

private fun ScheduledReviewNotificationPayload.toNotificationDiagnosticsUiState(): NotificationDiagnosticsReviewPayloadUiState {
    return NotificationDiagnosticsReviewPayloadUiState(
        requestId = requestId,
        scheduledAtMillis = scheduledAtMillis,
        cardId = cardId,
        reviewFilter = reviewFilter.toNotificationDiagnosticsUiState()
    )
}

private fun PersistedReviewFilter.toNotificationDiagnosticsUiState(): NotificationDiagnosticsReviewFilterUiState {
    return NotificationDiagnosticsReviewFilterUiState(
        kind = kind,
        deckId = deckId,
        effortLevel = effortLevel,
        tag = tag
    )
}

private fun ScheduledStrictReminderPayload.toNotificationDiagnosticsUiState(): NotificationDiagnosticsStrictReminderPayloadUiState {
    return NotificationDiagnosticsStrictReminderPayloadUiState(
        requestId = requestId,
        scheduledAtMillis = scheduledAtMillis,
        timeOffsetRawValue = timeOffset.rawValue
    )
}

private fun AndroidWorkInfoStateCounts.toNotificationDiagnosticsUiState(): NotificationDiagnosticsWorkInfoStateCountsUiState {
    return NotificationDiagnosticsWorkInfoStateCountsUiState(
        enqueued = enqueued,
        running = running,
        blocked = blocked,
        cancelled = cancelled,
        failed = failed,
        succeeded = succeeded
    )
}
