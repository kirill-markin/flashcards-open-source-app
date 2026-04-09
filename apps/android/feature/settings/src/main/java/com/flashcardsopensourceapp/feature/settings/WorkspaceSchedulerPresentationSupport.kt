package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import java.text.NumberFormat

fun formatWorkspaceSchedulerSummary(
    settings: WorkspaceSchedulerSettings,
    strings: SettingsStringResolver
): String {
    return "${settings.algorithm.uppercase()} ${formatWorkspaceSchedulerDesiredRetention(value = settings.desiredRetention, strings = strings)}"
}

fun formatWorkspaceSchedulerDesiredRetention(
    value: Double,
    strings: SettingsStringResolver
): String {
    val formatter = NumberFormat.getNumberInstance(strings.locale())
    formatter.minimumFractionDigits = 2
    formatter.maximumFractionDigits = 2
    return formatter.format(value)
}

fun formatWorkspaceSchedulerUpdatedAtLabel(
    updatedAtMillis: Long,
    strings: SettingsStringResolver
): String {
    if (updatedAtMillis <= 0L) {
        return strings.get(R.string.settings_unavailable)
    }

    return formatTimestampLabel(timestampMillis = updatedAtMillis, strings = strings)
}
