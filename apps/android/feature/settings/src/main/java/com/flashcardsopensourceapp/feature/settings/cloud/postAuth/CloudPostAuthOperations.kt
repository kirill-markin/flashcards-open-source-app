package com.flashcardsopensourceapp.feature.settings.cloud.postAuth

import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository

internal data class CloudPostAuthWorkspaceCompletion(
    val workspaceTitle: String,
    val requiresInitialSync: Boolean
)

internal suspend fun completeCloudPostAuthWorkspaceSelection(
    cloudAccountRepository: CloudAccountRepository,
    linkContext: CloudWorkspaceLinkContext,
    selection: CloudWorkspaceLinkSelection
): CloudPostAuthWorkspaceCompletion {
    val workspace = if (requiresCloudGuestUpgrade(linkContext = linkContext)) {
        cloudAccountRepository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = selection
        )
    } else {
        cloudAccountRepository.completeCloudLink(
            linkContext = linkContext,
            selection = selection
        )
    }
    return CloudPostAuthWorkspaceCompletion(
        workspaceTitle = workspace.name,
        requiresInitialSync = requiresCloudPostAuthInitialSync(linkContext = linkContext)
    )
}

internal suspend fun completeCloudPostAuthSyncOnly(syncRepository: SyncRepository) {
    syncRepository.syncNow()
}

private fun requiresCloudPostAuthInitialSync(linkContext: CloudWorkspaceLinkContext): Boolean {
    return linkContext.postAuthRoute != CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE &&
        linkContext.postAuthRoute != CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY
}
