package com.flashcardsopensourceapp.feature.settings.cloud.postAuth

import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInDraftState

internal sealed interface CloudPostAuthRetryAction {
    data class CompleteCloudLink(
        val authAttemptId: Long,
        val linkContext: CloudWorkspaceLinkContext,
        val selection: CloudWorkspaceLinkSelection
    ) : CloudPostAuthRetryAction

    data class CompleteGuestUpgrade(
        val authAttemptId: Long,
        val linkContext: CloudWorkspaceLinkContext,
        val selection: CloudWorkspaceLinkSelection
    ) : CloudPostAuthRetryAction

    data class CompleteGuestLocalRecovery(
        val authAttemptId: Long,
        val linkContext: CloudWorkspaceLinkContext
    ) : CloudPostAuthRetryAction

    data class SyncOnly(
        val authAttemptId: Long,
        val workspaceTitle: String
    ) : CloudPostAuthRetryAction
}

internal enum class CloudPostAuthFailureAction {
    RESET_INVALID_RECOVERY,
    LOGOUT
}

internal fun canRunCloudPostAuthFailureAction(draft: CloudSignInDraftState): Boolean {
    return resolveCloudPostAuthFailureAction(draft = draft) != null
}

internal fun resolveCloudPostAuthFailureAction(
    draft: CloudSignInDraftState
): CloudPostAuthFailureAction? {
    return when {
        draft.postAuthResetAllowed -> CloudPostAuthFailureAction.RESET_INVALID_RECOVERY
        draft.linkContext?.postAuthRoute == CloudWorkspacePostAuthRoute.NONE &&
            draft.postAuthRecoveryBlocked.not() -> CloudPostAuthFailureAction.LOGOUT
        else -> null
    }
}

internal fun cloudPostAuthFailureActionLabel(
    resetAllowed: Boolean,
    strings: SettingsStringResolver
): String {
    return if (resetAllowed) {
        strings.get(R.string.settings_post_auth_reset_cloud_identity_button)
    } else {
        strings.get(R.string.settings_logout)
    }
}

internal fun isCloudPostAuthProcessing(state: CloudSignInDraftState): Boolean {
    return state.processingTitle.isNotEmpty()
}

internal fun isInvalidCloudCredentialRecovery(error: CloudCredentialRecoveryRequiredException?): Boolean {
    return error?.recoveryState?.reason == CloudCredentialRecoveryReason.INVALID_STORED_STATE
}
