package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState

enum class SettingsAttentionIssue {
    ACCOUNT_NOT_LINKED
}

data class SettingsAttentionSummary(
    val settingsTabCount: Int,
    val accountStatusRowCount: Int,
    val accountStatusPrimaryActionCount: Int
)

fun makeSettingsAttentionIssues(cloudState: CloudAccountState): List<SettingsAttentionIssue> {
    return when (cloudState) {
        CloudAccountState.DISCONNECTED,
        CloudAccountState.LINKING_READY,
        CloudAccountState.GUEST -> listOf(SettingsAttentionIssue.ACCOUNT_NOT_LINKED)
        CloudAccountState.LINKED -> emptyList()
    }
}

fun makeSettingsAttentionSummary(issues: List<SettingsAttentionIssue>): SettingsAttentionSummary {
    val accountNotLinkedCount: Int = issues.count { issue ->
        issue == SettingsAttentionIssue.ACCOUNT_NOT_LINKED
    }

    return SettingsAttentionSummary(
        settingsTabCount = issues.size,
        accountStatusRowCount = accountNotLinkedCount,
        accountStatusPrimaryActionCount = accountNotLinkedCount
    )
}
