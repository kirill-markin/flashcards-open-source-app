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
    activeWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>
): List<CurrentWorkspaceItemUiState> {
    val selectedWorkspaceId = resolveSelectedWorkspaceId(
        activeWorkspaceId = activeWorkspaceId,
        workspaces = workspaces
    )
    val items = workspaces.sortedByDescending(CloudWorkspaceSummary::createdAtMillis).map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(workspace.createdAtMillis),
            isSelected = workspace.workspaceId == selectedWorkspaceId,
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
    workspaces: List<CloudWorkspaceSummary>
): String? {
    if (activeWorkspaceId == null) {
        return null
    }
    if (workspaces.any { workspace -> workspace.workspaceId == activeWorkspaceId }) {
        return null
    }
    return "The current workspace selection is invalid on this device. Retry the last workspace action or reload linked workspaces."
}

internal fun buildCloudPostAuthWorkspaceItems(
    preferredWorkspaceId: String?,
    workspaces: List<CloudWorkspaceSummary>
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
            subtitle = formatTimestampLabel(workspace.createdAtMillis),
            isSelected = workspace.workspaceId == selectedWorkspaceId,
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
