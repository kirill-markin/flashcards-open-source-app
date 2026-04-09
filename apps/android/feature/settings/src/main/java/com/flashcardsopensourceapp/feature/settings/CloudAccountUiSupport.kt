package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary

internal fun displayCloudAccountStateTitle(
    cloudState: CloudAccountState,
    strings: SettingsStringResolver
): String {
    return when (cloudState) {
        CloudAccountState.DISCONNECTED -> strings.get(R.string.settings_cloud_status_disconnected)
        CloudAccountState.LINKING_READY -> strings.get(R.string.settings_cloud_status_choose_workspace)
        CloudAccountState.GUEST -> strings.get(R.string.settings_cloud_status_guest_ai)
        CloudAccountState.LINKED -> strings.get(R.string.settings_cloud_status_linked)
    }
}

internal fun workspaceSelectionTitle(
    selection: CloudWorkspaceLinkSelection,
    workspaces: List<CloudWorkspaceSummary>,
    strings: SettingsStringResolver
): String {
    return when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> workspaces.firstOrNull { workspace ->
            workspace.workspaceId == selection.workspaceId
        }?.name ?: strings.get(R.string.settings_current_workspace_selected)
        CloudWorkspaceLinkSelection.CreateNew -> strings.get(R.string.settings_current_workspace_new_title)
    }
}

internal fun buildCurrentWorkspaceItems(
    activeWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>,
    strings: SettingsStringResolver
): List<CurrentWorkspaceItemUiState> {
    val selectedWorkspaceId = resolveSelectedWorkspaceId(
        activeWorkspaceId = activeWorkspaceId,
        workspaces = workspaces
    )
    val items = workspaces.sortedByDescending(CloudWorkspaceSummary::createdAtMillis).map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(
                timestampMillis = workspace.createdAtMillis,
                strings = strings
            ),
            isSelected = workspace.workspaceId == selectedWorkspaceId,
            isCreateNew = false
        )
    }
    return items + CurrentWorkspaceItemUiState(
        workspaceId = "create-new",
        title = strings.get(R.string.settings_current_workspace_create_new_title),
        subtitle = strings.get(R.string.settings_current_workspace_create_new_summary),
        isSelected = false,
        isCreateNew = true
    )
}

internal fun resolveSelectedWorkspaceId(
    activeWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>
): String? {
    if (activeWorkspaceId != null) {
        return if (workspaces.any { workspace -> workspace.workspaceId == activeWorkspaceId }) {
            activeWorkspaceId
        } else {
            null
        }
    }

    return workspaces.firstOrNull { workspace -> workspace.isSelected }?.workspaceId
}

internal fun currentWorkspaceSelectionErrorMessage(
    activeWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>,
    strings: SettingsStringResolver
): String? {
    if (activeWorkspaceId == null) {
        return null
    }
    if (workspaces.any { workspace -> workspace.workspaceId == activeWorkspaceId }) {
        return null
    }
    return strings.get(R.string.settings_current_workspace_invalid_selection)
}

internal fun buildCloudPostAuthWorkspaceItems(
    preferredWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>,
    strings: SettingsStringResolver
): List<CurrentWorkspaceItemUiState> {
    val selectedWorkspaceId = when (
        val selection = buildAutomaticWorkspaceSelection(
            preferredWorkspaceId = preferredWorkspaceId,
            workspaces = workspaces
        )
    ) {
        is CloudWorkspaceLinkSelection.Existing -> selection.workspaceId
        CloudWorkspaceLinkSelection.CreateNew,
        null -> null
    }
    return workspaces.sortedByDescending(CloudWorkspaceSummary::createdAtMillis).map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(
                timestampMillis = workspace.createdAtMillis,
                strings = strings
            ),
            isSelected = workspace.workspaceId == selectedWorkspaceId,
            isCreateNew = false
        )
    } + CurrentWorkspaceItemUiState(
        workspaceId = "create-new",
        title = strings.get(R.string.settings_current_workspace_create_new_title),
        subtitle = strings.get(R.string.settings_current_workspace_create_new_summary),
        isSelected = false,
        isCreateNew = true
    )
}

/**
 * Post-auth linking should auto-continue only when Android can identify one
 * concrete workspace by id. Same-name workspaces are legal and must stay on
 * the chooser until a unique workspace id is known.
 */
internal fun buildAutomaticWorkspaceSelection(
    preferredWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>
): CloudWorkspaceLinkSelection? {
    if (workspaces.isEmpty()) {
        return CloudWorkspaceLinkSelection.CreateNew
    }

    if (workspaces.size == 1) {
        return CloudWorkspaceLinkSelection.Existing(
            workspaceId = workspaces.first().workspaceId
        )
    }

    if (preferredWorkspaceId != null) {
        return if (workspaces.any { workspace -> workspace.workspaceId == preferredWorkspaceId }) {
            CloudWorkspaceLinkSelection.Existing(workspaceId = preferredWorkspaceId)
        } else {
            null
        }
    }

    val selectedWorkspaceIds = workspaces.filter(CloudWorkspaceSummary::isSelected)
        .map(CloudWorkspaceSummary::workspaceId)
        .distinct()
    if (selectedWorkspaceIds.size == 1) {
        return CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspaceIds.single())
    }

    return null
}
