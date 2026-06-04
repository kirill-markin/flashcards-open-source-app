package com.flashcardsopensourceapp.feature.settings.cloud.signIn

import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthRetryAction

internal data class CloudSignInDraftState(
    val authAttemptId: Long,
    val email: String,
    val code: String,
    val challenge: CloudOtpChallenge?,
    val linkContext: CloudWorkspaceLinkContext?,
    val isSendingCode: Boolean,
    val isVerifyingCode: Boolean,
    val errorMessage: String,
    val errorTechnicalDetails: String?,
    val pendingSelection: CloudWorkspaceLinkSelection?,
    val processingTitle: String,
    val processingMessage: String,
    val postAuthErrorMessage: String,
    val postAuthRecoveryBlocked: Boolean,
    val postAuthResetAllowed: Boolean,
    val retryAction: CloudPostAuthRetryAction?,
    val completionToken: Long?
)

internal data class CloudSignInErrorPresentation(
    val message: String,
    val technicalDetails: String?
)

internal fun initialCloudSignInDraftState(): CloudSignInDraftState {
    return CloudSignInDraftState(
        authAttemptId = 0L,
        email = "",
        code = "",
        challenge = null,
        linkContext = null,
        isSendingCode = false,
        isVerifyingCode = false,
        errorMessage = "",
        errorTechnicalDetails = null,
        pendingSelection = null,
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = "",
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = null,
        completionToken = null
    )
}

internal fun nextCloudAuthAttemptId(state: CloudSignInDraftState): Long {
    return state.authAttemptId + 1L
}

internal fun updateCloudSignInEmail(
    state: CloudSignInDraftState,
    email: String
): CloudSignInDraftState {
    return state.copy(email = email, errorMessage = "", errorTechnicalDetails = null)
}

internal fun updateCloudSignInCode(
    state: CloudSignInDraftState,
    code: String
): CloudSignInDraftState {
    return state.copy(code = code, errorMessage = "", errorTechnicalDetails = null)
}

internal fun startCloudSendCodeAttempt(
    state: CloudSignInDraftState,
    authAttemptId: Long
): CloudSignInDraftState {
    return state.copy(
        authAttemptId = authAttemptId,
        code = "",
        challenge = null,
        linkContext = null,
        isSendingCode = true,
        isVerifyingCode = false,
        errorMessage = "",
        errorTechnicalDetails = null,
        pendingSelection = null,
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = "",
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = null,
        completionToken = null
    )
}

internal fun acceptCloudOtpChallenge(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    challenge: CloudOtpChallenge
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        isSendingCode = false,
        errorMessage = "",
        errorTechnicalDetails = null,
        challenge = challenge,
        linkContext = null,
        pendingSelection = null,
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        completionToken = null
    )
}

internal fun failCloudSendCode(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    errorPresentation: CloudSignInErrorPresentation
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        isSendingCode = false,
        errorMessage = errorPresentation.message,
        errorTechnicalDetails = errorPresentation.technicalDetails
    )
}

internal fun startCloudVerifyCodeAttempt(
    state: CloudSignInDraftState,
    authAttemptId: Long
): CloudSignInDraftState {
    return state.copy(
        authAttemptId = authAttemptId,
        linkContext = null,
        isSendingCode = false,
        isVerifyingCode = true,
        errorMessage = "",
        errorTechnicalDetails = null,
        pendingSelection = null,
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = "",
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = null,
        completionToken = null
    )
}

internal fun failCloudVerifyCode(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    errorPresentation: CloudSignInErrorPresentation
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        isVerifyingCode = false,
        errorMessage = errorPresentation.message,
        errorTechnicalDetails = errorPresentation.technicalDetails
    )
}

internal fun publishCloudVerifiedLinkContext(
    state: CloudSignInDraftState,
    authAttemptId: Long,
    linkContext: CloudWorkspaceLinkContext,
    pendingSelection: CloudWorkspaceLinkSelection?,
    recoveryErrorMessage: String,
    isSendingCode: Boolean,
    isVerifyingCode: Boolean
): CloudSignInDraftState {
    if (state.authAttemptId != authAttemptId) {
        return state
    }
    return state.copy(
        isSendingCode = isSendingCode,
        isVerifyingCode = isVerifyingCode,
        errorMessage = "",
        errorTechnicalDetails = null,
        challenge = null,
        linkContext = linkContext,
        pendingSelection = if (recoveryErrorMessage.isEmpty()) {
            pendingSelection
        } else {
            null
        },
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = recoveryErrorMessage,
        postAuthRecoveryBlocked = recoveryErrorMessage.isNotEmpty(),
        postAuthResetAllowed = isCloudPostAuthResetAllowed(linkContext = linkContext),
        retryAction = null,
        completionToken = null
    )
}

internal fun acknowledgeCloudPostAuthCompletion(state: CloudSignInDraftState): CloudSignInDraftState {
    return state.copy(completionToken = null)
}

internal fun clearCloudPostAuthDraftState(state: CloudSignInDraftState): CloudSignInDraftState {
    return state.copy(
        authAttemptId = nextCloudAuthAttemptId(state = state),
        email = "",
        code = "",
        challenge = null,
        linkContext = null,
        isSendingCode = false,
        isVerifyingCode = false,
        pendingSelection = null,
        processingTitle = "",
        processingMessage = "",
        postAuthErrorMessage = "",
        postAuthRecoveryBlocked = false,
        postAuthResetAllowed = false,
        retryAction = null,
        completionToken = null,
        errorMessage = "",
        errorTechnicalDetails = null
    )
}

private fun isCloudPostAuthResetAllowed(linkContext: CloudWorkspaceLinkContext): Boolean {
    return linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.INVALID_STORED_STATE
}
