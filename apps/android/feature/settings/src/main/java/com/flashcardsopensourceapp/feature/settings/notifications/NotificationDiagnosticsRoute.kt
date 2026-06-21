package com.flashcardsopensourceapp.feature.settings.notifications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.SectionTitle
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.formatTimestampLabel
import com.flashcardsopensourceapp.feature.settings.notificationDiagnosticsScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun NotificationDiagnosticsRoute(
    uiState: NotificationDiagnosticsUiState,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_notification_diagnostics_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = notificationDiagnosticsScreenTag)
        ) {
            when (uiState) {
                NotificationDiagnosticsUiState.Loading -> {
                    item {
                        NotificationDiagnosticsLoadingCard()
                    }
                }

                is NotificationDiagnosticsUiState.Failed -> {
                    item {
                        NotificationDiagnosticsErrorCard(message = uiState.message)
                    }
                }

                is NotificationDiagnosticsUiState.Ready -> {
                    item {
                        SectionTitle(text = stringResource(R.string.settings_notification_diagnostics_state_section))
                    }
                    item {
                        NotificationDiagnosticsStateCard(uiState = uiState)
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_notification_diagnostics_review_section))
                    }
                    item {
                        NotificationDiagnosticsReviewSettingsCard(settings = uiState.reviewReminders.settings)
                    }
                    item {
                        NotificationDiagnosticsSchedulingCard(
                            title = stringResource(R.string.settings_notification_diagnostics_review_work_title),
                            scheduling = uiState.reviewReminders.scheduling
                        )
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_notification_diagnostics_review_payloads_title))
                    }
                    if (uiState.reviewReminders.storedPayloads.isEmpty()) {
                        item {
                            NotificationDiagnosticsEmptyCard()
                        }
                    } else {
                        uiState.reviewReminders.storedPayloads.forEachIndexed { index, payload ->
                            item {
                                NotificationDiagnosticsReviewPayloadCard(index = index, payload = payload)
                            }
                        }
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_notification_diagnostics_strict_section))
                    }
                    item {
                        NotificationDiagnosticsStrictReminderSettingsCard(settings = uiState.strictReminders.settings)
                    }
                    item {
                        NotificationDiagnosticsSchedulingCard(
                            title = stringResource(R.string.settings_notification_diagnostics_strict_work_title),
                            scheduling = uiState.strictReminders.scheduling
                        )
                    }
                    item {
                        SectionTitle(text = stringResource(R.string.settings_notification_diagnostics_strict_payloads_title))
                    }
                    if (uiState.strictReminders.storedPayloads.isEmpty()) {
                        item {
                            NotificationDiagnosticsEmptyCard()
                        }
                    } else {
                        uiState.strictReminders.storedPayloads.forEachIndexed { index, payload ->
                            item {
                                NotificationDiagnosticsStrictReminderPayloadCard(index = index, payload = payload)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationDiagnosticsLoadingCard() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_loading),
                style = MaterialTheme.typography.titleMedium
            )
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun NotificationDiagnosticsErrorCard(message: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_notification_diagnostics_load_failed),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error
            )
            SelectionContainer {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
private fun NotificationDiagnosticsStateCard(uiState: NotificationDiagnosticsUiState.Ready) {
    NotificationDiagnosticsInfoCard(
        title = stringResource(R.string.settings_notification_diagnostics_state_title),
        rows = listOf(
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_device_workspace_name_label),
                value = uiState.workspace.workspaceName
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_device_workspace_id_label),
                value = uiState.workspace.workspaceId
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_permission_label),
                value = booleanLabel(value = uiState.permission.isGranted)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_app_notifications_label),
                value = booleanLabel(value = uiState.channel.areAppNotificationsEnabled)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_channel_id_label),
                value = uiState.channel.channelId
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_channel_created_label),
                value = booleanLabel(value = uiState.channel.isCreated)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_channel_importance_label),
                value = uiState.channel.importance?.toString() ?: stringResource(R.string.settings_unavailable)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_channel_enabled_label),
                value = uiState.channel.isEnabled?.let { isEnabled ->
                    booleanLabel(value = isEnabled)
                } ?: stringResource(R.string.settings_unavailable)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_delivered_review_label),
                value = uiState.delivered.reviewReminderCount.toString()
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_delivered_strict_label),
                value = uiState.delivered.strictReminderCount.toString()
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_delivered_other_label),
                value = uiState.delivered.otherReviewChannelCount.toString()
            )
        )
    )
}

@Composable
private fun NotificationDiagnosticsReviewSettingsCard(settings: NotificationDiagnosticsReviewSettingsUiState) {
    NotificationDiagnosticsInfoCard(
        title = stringResource(R.string.settings_notification_diagnostics_review_settings_title),
        rows = listOf(
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_enabled_label),
                value = booleanLabel(value = settings.isEnabled)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_mode_label),
                value = reviewModeLabel(mode = settings.selectedMode)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notifications_daily_title),
                value = timeLabel(hour = settings.dailyHour, minute = settings.dailyMinute)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_inactivity_window_label),
                value = stringResource(
                    R.string.settings_notification_diagnostics_window_format,
                    timeLabel(hour = settings.inactivityWindowStartHour, minute = settings.inactivityWindowStartMinute),
                    timeLabel(hour = settings.inactivityWindowEndHour, minute = settings.inactivityWindowEndMinute)
                )
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_idle_minutes_label),
                value = settings.inactivityIdleMinutes.toString()
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notifications_show_app_icon_badge_title),
                value = booleanLabel(value = settings.showAppIconBadge)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_work_limit_label),
                value = settings.workLimit.toString()
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_app_work_limit_label),
                value = settings.appNotificationWorkLimit.toString()
            )
        )
    )
}

@Composable
private fun NotificationDiagnosticsStrictReminderSettingsCard(
    settings: NotificationDiagnosticsStrictReminderSettingsUiState
) {
    val context = LocalContext.current
    val strings = remember(context) {
        createSettingsStringResolver(context = context)
    }
    NotificationDiagnosticsInfoCard(
        title = stringResource(R.string.settings_notification_diagnostics_strict_settings_title),
        rows = listOf(
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_enabled_label),
                value = booleanLabel(value = settings.isEnabled)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_last_completed_review_label),
                value = formatTimestampLabel(timestampMillis = settings.lastCompletedReviewAtMillis, strings = strings)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_work_limit_label),
                value = settings.workLimit.toString()
            )
        )
    )
}

@Composable
private fun NotificationDiagnosticsSchedulingCard(
    title: String,
    scheduling: NotificationDiagnosticsSchedulingUiState
) {
    NotificationDiagnosticsInfoCard(
        title = title,
        rows = listOf(
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_work_tag_label),
                value = scheduling.workTag
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_tag_state_counts_label),
                value = workInfoStateCountsLabel(counts = scheduling.tagStateCounts)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_expected_work_names_label),
                value = scheduling.expectedWorkNameCount.toString()
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_missing_work_names_label),
                value = scheduling.missingExpectedWorkNameCount.toString()
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_expected_state_counts_label),
                value = workInfoStateCountsLabel(counts = scheduling.expectedStateCounts)
            )
        )
    )
}

@Composable
private fun NotificationDiagnosticsReviewPayloadCard(
    index: Int,
    payload: NotificationDiagnosticsReviewPayloadUiState
) {
    val context = LocalContext.current
    val strings = remember(context) {
        createSettingsStringResolver(context = context)
    }
    NotificationDiagnosticsInfoCard(
        title = stringResource(R.string.settings_notification_diagnostics_payload_title, index + 1),
        rows = listOfNotNull(
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_request_id_label),
                value = payload.requestId
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_scheduled_at_label),
                value = formatTimestampLabel(timestampMillis = payload.scheduledAtMillis, strings = strings)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_card_id_label),
                value = payload.cardId ?: stringResource(R.string.settings_none)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_filter_kind_label),
                value = payload.reviewFilter.kind
            ),
            payload.reviewFilter.deckId?.let { deckId ->
                NotificationDiagnosticsInfoRow(
                    label = stringResource(R.string.settings_notification_diagnostics_filter_deck_label),
                    value = deckId
                )
            },
            payload.reviewFilter.tag?.let { tag ->
                NotificationDiagnosticsInfoRow(
                    label = stringResource(R.string.settings_notification_diagnostics_filter_tag_label),
                    value = tag
                )
            }
        )
    )
}

@Composable
private fun NotificationDiagnosticsStrictReminderPayloadCard(
    index: Int,
    payload: NotificationDiagnosticsStrictReminderPayloadUiState
) {
    val context = LocalContext.current
    val strings = remember(context) {
        createSettingsStringResolver(context = context)
    }
    NotificationDiagnosticsInfoCard(
        title = stringResource(R.string.settings_notification_diagnostics_payload_title, index + 1),
        rows = listOf(
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_request_id_label),
                value = payload.requestId
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_scheduled_at_label),
                value = formatTimestampLabel(timestampMillis = payload.scheduledAtMillis, strings = strings)
            ),
            NotificationDiagnosticsInfoRow(
                label = stringResource(R.string.settings_notification_diagnostics_time_offset_label),
                value = payload.timeOffsetRawValue
            )
        )
    )
}

@Composable
private fun NotificationDiagnosticsEmptyCard() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = stringResource(R.string.settings_none),
            modifier = Modifier.padding(20.dp)
        )
    }
}

private data class NotificationDiagnosticsInfoRow(
    val label: String,
    val value: String
)

@Composable
private fun NotificationDiagnosticsInfoCard(
    title: String,
    rows: List<NotificationDiagnosticsInfoRow>
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )

            rows.forEach { row ->
                NotificationDiagnosticsInfoRowContent(row = row)
            }
        }
    }
}

@Composable
private fun NotificationDiagnosticsInfoRowContent(row: NotificationDiagnosticsInfoRow) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = row.label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        SelectionContainer {
            Text(
                text = row.value,
                style = MaterialTheme.typography.bodyLarge
            )
        }
    }
}

@Composable
private fun booleanLabel(value: Boolean): String {
    return if (value) {
        stringResource(R.string.settings_common_on)
    } else {
        stringResource(R.string.settings_common_off)
    }
}

@Composable
private fun reviewModeLabel(mode: ReviewNotificationMode): String {
    return when (mode) {
        ReviewNotificationMode.DAILY -> stringResource(R.string.settings_notifications_mode_daily)
        ReviewNotificationMode.INACTIVITY -> stringResource(R.string.settings_notifications_mode_inactivity)
    }
}

@Composable
private fun workInfoStateCountsLabel(counts: NotificationDiagnosticsWorkInfoStateCountsUiState): String {
    return stringResource(
        R.string.settings_notification_diagnostics_state_counts_format,
        counts.enqueued,
        counts.running,
        counts.blocked,
        counts.cancelled,
        counts.failed,
        counts.succeeded
    )
}

@Composable
private fun timeLabel(hour: Int, minute: Int): String {
    val locale = LocalContext.current.resources.configuration.locales[0] ?: Locale.getDefault()
    val formatter = remember(locale) {
        DateTimeFormatter.ofPattern("HH:mm", locale)
    }
    return LocalTime.of(hour, minute).format(formatter)
}
