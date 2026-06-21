package com.flashcardsopensourceapp.feature.settings.notifications

import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode

sealed interface NotificationDiagnosticsUiState {
    data object Loading : NotificationDiagnosticsUiState

    data class Failed(
        val message: String
    ) : NotificationDiagnosticsUiState

    data class Ready(
        val workspace: NotificationDiagnosticsWorkspaceUiState,
        val permission: NotificationDiagnosticsPermissionUiState,
        val channel: NotificationDiagnosticsChannelUiState,
        val delivered: NotificationDiagnosticsDeliveredUiState,
        val reviewReminders: NotificationDiagnosticsReviewRemindersUiState,
        val strictReminders: NotificationDiagnosticsStrictRemindersUiState
    ) : NotificationDiagnosticsUiState
}

data class NotificationDiagnosticsWorkspaceUiState(
    val workspaceId: String,
    val workspaceName: String
)

data class NotificationDiagnosticsPermissionUiState(
    val isGranted: Boolean
)

data class NotificationDiagnosticsChannelUiState(
    val channelId: String,
    val areAppNotificationsEnabled: Boolean,
    val isCreated: Boolean,
    val importance: Int?,
    val isEnabled: Boolean?
)

data class NotificationDiagnosticsDeliveredUiState(
    val reviewReminderCount: Int,
    val strictReminderCount: Int,
    val otherReviewChannelCount: Int
)

data class NotificationDiagnosticsReviewRemindersUiState(
    val settings: NotificationDiagnosticsReviewSettingsUiState,
    val scheduling: NotificationDiagnosticsSchedulingUiState,
    val storedPayloads: List<NotificationDiagnosticsReviewPayloadUiState>
)

data class NotificationDiagnosticsReviewSettingsUiState(
    val isEnabled: Boolean,
    val selectedMode: ReviewNotificationMode,
    val dailyHour: Int,
    val dailyMinute: Int,
    val inactivityWindowStartHour: Int,
    val inactivityWindowStartMinute: Int,
    val inactivityWindowEndHour: Int,
    val inactivityWindowEndMinute: Int,
    val inactivityIdleMinutes: Int,
    val showAppIconBadge: Boolean,
    val workLimit: Int,
    val appNotificationWorkLimit: Int
)

data class NotificationDiagnosticsStrictRemindersUiState(
    val settings: NotificationDiagnosticsStrictReminderSettingsUiState,
    val scheduling: NotificationDiagnosticsSchedulingUiState,
    val storedPayloads: List<NotificationDiagnosticsStrictReminderPayloadUiState>
)

data class NotificationDiagnosticsStrictReminderSettingsUiState(
    val isEnabled: Boolean,
    val lastCompletedReviewAtMillis: Long?,
    val workLimit: Int
)

data class NotificationDiagnosticsSchedulingUiState(
    val workTag: String,
    val tagStateCounts: NotificationDiagnosticsWorkInfoStateCountsUiState,
    val expectedWorkNameCount: Int,
    val missingExpectedWorkNameCount: Int,
    val expectedStateCounts: NotificationDiagnosticsWorkInfoStateCountsUiState
)

data class NotificationDiagnosticsWorkInfoStateCountsUiState(
    val enqueued: Int,
    val running: Int,
    val blocked: Int,
    val cancelled: Int,
    val failed: Int,
    val succeeded: Int
)

data class NotificationDiagnosticsReviewPayloadUiState(
    val requestId: String,
    val scheduledAtMillis: Long,
    val cardId: String?,
    val reviewFilter: NotificationDiagnosticsReviewFilterUiState
)

data class NotificationDiagnosticsReviewFilterUiState(
    val kind: String,
    val deckId: String?,
    val tag: String?
)

data class NotificationDiagnosticsStrictReminderPayloadUiState(
    val requestId: String,
    val scheduledAtMillis: Long,
    val timeOffsetRawValue: String
)
