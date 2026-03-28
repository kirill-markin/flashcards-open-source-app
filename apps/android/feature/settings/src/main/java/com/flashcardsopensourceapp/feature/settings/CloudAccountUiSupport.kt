package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary

internal fun displayCloudAccountStateTitle(cloudState: CloudAccountState): String {
    return when (cloudState) {
        CloudAccountState.DISCONNECTED -> "Disconnected"
        CloudAccountState.LINKING_READY -> "Choose workspace"
        CloudAccountState.GUEST -> "Guest AI"
        CloudAccountState.LINKED -> "Linked"
    }
}

internal fun workspaceSelectionTitle(
    selection: CloudWorkspaceLinkSelection,
    workspaces: List<CloudWorkspaceSummary>
): String {
    return when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> workspaces.firstOrNull { workspace ->
            workspace.workspaceId == selection.workspaceId
        }?.name ?: "Selected workspace"
        CloudWorkspaceLinkSelection.CreateNew -> "New workspace"
    }
}

internal fun buildCurrentWorkspaceItems(
    currentWorkspaceName: String,
    workspaces: List<CloudWorkspaceSummary>
): List<CurrentWorkspaceItemUiState> {
    val items = workspaces.map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(workspace.createdAtMillis),
            isSelected = workspace.isSelected || workspace.name == currentWorkspaceName,
            isCreateNew = false
        )
    }
    return items + CurrentWorkspaceItemUiState(
        workspaceId = "create-new",
        title = "Create new workspace",
        subtitle = "Start a new linked workspace in the cloud",
        isSelected = false,
        isCreateNew = true
    )
}

internal fun buildCloudPostAuthWorkspaceItems(
    workspaces: List<CloudWorkspaceSummary>
): List<CurrentWorkspaceItemUiState> {
    return workspaces.map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(workspace.createdAtMillis),
            isSelected = false,
            isCreateNew = false
        )
    } + CurrentWorkspaceItemUiState(
        workspaceId = "create-new",
        title = "Create new workspace",
        subtitle = "Start a new linked workspace in the cloud",
        isSelected = false,
        isCreateNew = true
    )
}
