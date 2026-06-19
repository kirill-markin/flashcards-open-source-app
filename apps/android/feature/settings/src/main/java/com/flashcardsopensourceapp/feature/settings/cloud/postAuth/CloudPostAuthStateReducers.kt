package com.flashcardsopensourceapp.feature.settings.cloud.postAuth

import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInDraftState

internal fun prepareCloudPostAuthWorkspaceCompletion(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    linkContext: CloudWorkspaceLinkContext,
    selection: CloudWorkspaceLinkSelection,
    strings: SettingsStringResolver
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    val isGuestUpgrade = linkContext.guestUpgradeMode != null
    return state.copy(
        pendingSelection = null,
        processingTitle = if (isGuestUpgrade) {
            strings.get(R.string.settings_post_auth_upgrading_title)
        } else {
            strings.get(R.string.settings_post_auth_linking_title)
        },
        processingMessage = if (isGuestUpgrade) {
            strings.get(R.string.settings_post_auth_upgrading_body)
        } else {
            strings.get(R.string.settings_post_auth_linking_body)
        },
        postAuthErrorMessage = "",
        postAuthErrorTechnicalDetails = null,
        postAuthErrorTechnicalDetailsReportId = null,
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = if (requiresCloudGuestUpgrade(linkContext = linkContext)) {
            CloudPostAuthRetryAction.CompleteGuestUpgrade(
                authAttemptId = authAttemptId,
                linkContext = linkContext,
                selection = selection
            )
        } else {
            CloudPostAuthRetryAction.CompleteCloudLink(
                authAttemptId = authAttemptId,
                linkContext = linkContext,
                selection = selection
            )
        }
    )
}

internal fun prepareCloudPostAuthGuestLocalRecovery(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    linkContext: CloudWorkspaceLinkContext,
    strings: SettingsStringResolver
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        pendingSelection = null,
        processingTitle = strings.get(R.string.settings_post_auth_recovering_local_data_title),
        processingMessage = strings.get(R.string.settings_post_auth_recovering_local_data_body),
        postAuthErrorMessage = "",
        postAuthErrorTechnicalDetails = null,
        postAuthErrorTechnicalDetailsReportId = null,
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = CloudPostAuthRetryAction.CompleteGuestLocalRecovery(
            authAttemptId = authAttemptId,
            linkContext = linkContext
        )
    )
}

internal fun prepareCloudPostAuthSyncOnly(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    workspaceTitle: String,
    strings: SettingsStringResolver
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        processingTitle = strings.get(R.string.settings_post_auth_syncing_title),
        processingMessage = strings.get(R.string.settings_post_auth_syncing_body),
        postAuthErrorMessage = "",
        postAuthErrorTechnicalDetails = null,
        postAuthErrorTechnicalDetailsReportId = null,
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = CloudPostAuthRetryAction.SyncOnly(
            authAttemptId = authAttemptId,
            workspaceTitle = workspaceTitle
        )
    )
}

internal fun failCloudPostAuth(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    errorMessage: String,
    errorTechnicalDetails: String?,
    errorTechnicalDetailsReportId: String?,
    recoveryErrorBlocked: Boolean,
    postAuthResetAllowed: Boolean
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = errorMessage,
        postAuthErrorTechnicalDetails = errorTechnicalDetails,
        postAuthErrorTechnicalDetailsReportId = errorTechnicalDetailsReportId,
        postAuthRecoveryBlocked = recoveryErrorBlocked,
        postAuthResetAllowed = postAuthResetAllowed,
        retryAction = if (recoveryErrorBlocked) {
            null
        } else {
            state.retryAction
        }
    )
}

internal fun finishCloudPostAuthSuccess(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    completionToken: Long
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        email = "",
        code = "",
        challenge = null,
        linkContext = null,
        pendingSelection = null,
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = "",
        postAuthErrorTechnicalDetails = null,
        postAuthErrorTechnicalDetailsReportId = null,
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = null,
        completionToken = completionToken
    )
}

internal fun requiresCloudGuestUpgrade(linkContext: CloudWorkspaceLinkContext): Boolean {
    return linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.NONE &&
        linkContext.guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED
}
