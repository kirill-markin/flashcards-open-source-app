package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings

fun formatWorkspaceSchedulerSummary(settings: WorkspaceSchedulerSettings): String {
    return "${settings.algorithm.uppercase()} ${formatWorkspaceSchedulerDesiredRetention(value = settings.desiredRetention)}"
}

fun formatWorkspaceSchedulerDesiredRetention(value: Double): String {
    return String.format("%.2f", value)
}

fun formatWorkspaceSchedulerUpdatedAtLabel(updatedAtMillis: Long): String {
    if (updatedAtMillis <= 0L) {
        return "Unavailable"
    }

    return updatedAtMillis.toString()
}
