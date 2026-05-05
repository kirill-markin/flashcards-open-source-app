package com.flashcardsopensourceapp.data.local.repository.cloudsync

import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary

internal fun validateWorkspaceSelection(
    linkContext: CloudWorkspaceLinkContext,
    selection: CloudWorkspaceLinkSelection
): CloudWorkspaceLinkSelection {
    return when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> {
            require(linkContext.workspaces.any { workspace -> workspace.workspaceId == selection.workspaceId }) {
                "Selected workspace is unavailable for this sign-in attempt. Start sign-in again."
            }
            selection
        }

        CloudWorkspaceLinkSelection.CreateNew -> CloudWorkspaceLinkSelection.CreateNew
    }
}

internal fun resolvePreferredPostAuthWorkspaceId(
    workspaces: List<CloudWorkspaceSummary>
): String? {
    if (workspaces.size == 1) {
        return workspaces.first().workspaceId
    }
    val selectedWorkspaceIds = workspaces.filter(CloudWorkspaceSummary::isSelected)
        .map(CloudWorkspaceSummary::workspaceId)
        .distinct()
    return if (selectedWorkspaceIds.size == 1) {
        selectedWorkspaceIds.single()
    } else {
        null
    }
}

internal fun CloudWorkspaceLinkSelection.toGuestUpgradeSelection(): CloudGuestUpgradeSelection {
    return when (this) {
        is CloudWorkspaceLinkSelection.Existing -> CloudGuestUpgradeSelection.Existing(workspaceId = workspaceId)
        CloudWorkspaceLinkSelection.CreateNew -> CloudGuestUpgradeSelection.CreateNew
    }
}
