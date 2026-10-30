package com.flashcardsopensourceapp.feature.settings.cloud.credentialRecovery

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.buildAutomaticWorkspaceSelection

internal fun buildCloudPostAuthPendingSelection(
    linkContext: CloudWorkspaceLinkContext
): CloudWorkspaceLinkSelection? {
    return when (linkContext.postAuthRoute) {
        CloudWorkspacePostAuthRoute.NONE -> linkContext.demoOnlyDestinationWorkspaceId?.let { workspaceId ->
            CloudWorkspaceLinkSelection.Existing(workspaceId = workspaceId, discardDemoOnly = true)
        } ?: if (linkContext.guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED) {
            buildGuestMergeWorkspaceSelection(workspaces = linkContext.workspaces)
        } else {
            buildAutomaticWorkspaceSelection(
                preferredWorkspaceId = linkContext.preferredWorkspaceId,
                workspaces = linkContext.workspaces
            )
        }

        CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE -> {
            val preferredWorkspaceId = linkContext.preferredWorkspaceId ?: return null
            if (linkContext.workspaces.any { workspace -> workspace.workspaceId == preferredWorkspaceId }) {
                CloudWorkspaceLinkSelection.Existing(workspaceId = preferredWorkspaceId)
            } else {
                null
            }
        }

        CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY -> CloudWorkspaceLinkSelection.CreateNew(name = null)

        CloudWorkspacePostAuthRoute.PENDING_GUEST_UPGRADE_RECOVERY,
        CloudWorkspacePostAuthRoute.INVALID_STORED_STATE -> null
    }
}

/**
 * A guest merge never follows the preferred or server-selected workspace unasked:
 * it continues automatically only when the account offers no or exactly one workspace.
 */
private fun buildGuestMergeWorkspaceSelection(
    workspaces: List<CloudWorkspaceSummary>
): CloudWorkspaceLinkSelection? {
    val visibleWorkspaces = workspaces.filter(CloudWorkspaceSummary::isVisible)
    return when (visibleWorkspaces.size) {
        0 -> CloudWorkspaceLinkSelection.CreateNew(name = null)
        1 -> CloudWorkspaceLinkSelection.Existing(workspaceId = visibleWorkspaces.single().workspaceId)
        else -> null
    }
}

internal fun cloudPostAuthRecoveryErrorMessage(
    linkContext: CloudWorkspaceLinkContext,
    pendingSelection: CloudWorkspaceLinkSelection?,
    strings: SettingsStringResolver
): String {
    return when (linkContext.postAuthRoute) {
        CloudWorkspacePostAuthRoute.NONE -> ""
        CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE -> {
            if (pendingSelection == null) {
                strings.get(R.string.settings_post_auth_linked_recovery_blocked)
            } else {
                ""
            }
        }
        CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY -> {
            ""
        }
        CloudWorkspacePostAuthRoute.PENDING_GUEST_UPGRADE_RECOVERY -> {
            strings.get(R.string.settings_post_auth_pending_guest_upgrade_recovery_required)
        }
        CloudWorkspacePostAuthRoute.INVALID_STORED_STATE -> {
            strings.get(R.string.settings_post_auth_invalid_recovery_state)
        }
    }
}

internal fun cloudPostAuthRecoveryExceptionMessage(
    error: CloudCredentialRecoveryRequiredException,
    strings: SettingsStringResolver
): String {
    return when (error.recoveryState.reason) {
        CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING -> {
            if (error.recoveryState.previousCloudState == CloudAccountState.GUEST) {
                strings.get(R.string.settings_post_auth_pending_guest_upgrade_recovery_required)
            } else {
                strings.get(R.string.settings_post_auth_linked_recovery_blocked)
            }
        }

        CloudCredentialRecoveryReason.GUEST_SESSION_MISSING -> {
            strings.get(R.string.settings_post_auth_guest_local_recovery_required)
        }

        CloudCredentialRecoveryReason.INVALID_STORED_STATE -> {
            strings.get(R.string.settings_post_auth_invalid_recovery_state)
        }
    }
}
