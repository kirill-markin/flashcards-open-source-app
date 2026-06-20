package com.flashcardsopensourceapp.feature.settings.cloud

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import java.io.IOException

private const val maxExpectedSettingsFailureCauseDepth: Int = 8

private val expectedWorkspaceCloudFailureCodes: Set<String> = setOf(
    "ACCOUNT_SIGN_IN_REQUIRED",
    "AUTH_UNAUTHORIZED",
    "RATE_LIMITED",
    "SYNC_WORKSPACE_FORK_REQUIRED",
    "WORKSPACE_DELETE_CONFIRMATION_INVALID",
    "WORKSPACE_DELETE_SHARED",
    "WORKSPACE_ID_INVALID",
    "WORKSPACE_ID_REQUIRED",
    "WORKSPACE_NOT_FOUND",
    "WORKSPACE_OWNER_REQUIRED",
    "WORKSPACE_RESET_PROGRESS_CONFIRMATION_INVALID",
    "WORKSPACE_RESET_SHARED",
    "WORKSPACE_SELECTION_REQUIRED"
)

private val expectedAgentCloudFailureCodes: Set<String> = setOf(
    "ACCOUNT_SIGN_IN_REQUIRED",
    "AGENT_API_KEY_INVALID",
    "AGENT_API_KEY_HUMAN_SESSION_REQUIRED",
    "AGENT_API_KEY_REQUIRED",
    "AGENT_API_KEY_ID_INVALID",
    "AGENT_API_KEY_ID_REQUIRED",
    "AGENT_API_KEY_NOT_FOUND",
    "AUTH_UNAUTHORIZED",
    "RATE_LIMITED"
)

internal fun expectedWorkspaceCloudFailureMessage(
    error: Throwable,
    fallbackMessage: String
): String? {
    expectedSettingsFailureMessage(
        error = error,
        expectedCloudFailureCodes = expectedWorkspaceCloudFailureCodes,
        fallbackMessage = fallbackMessage
    )?.let { message -> return message }
    return null
}

internal fun expectedAgentCloudFailureMessage(
    error: Throwable,
    fallbackMessage: String
): String? {
    expectedSettingsFailureMessage(
        error = error,
        expectedCloudFailureCodes = expectedAgentCloudFailureCodes,
        fallbackMessage = fallbackMessage
    )?.let { message -> return message }
    return null
}

private fun expectedSettingsFailureMessage(
    error: Throwable,
    expectedCloudFailureCodes: Set<String>,
    fallbackMessage: String
): String? {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxExpectedSettingsFailureCauseDepth) {
        expectedSingleSettingsFailureMessage(
            error = currentError,
            expectedCloudFailureCodes = expectedCloudFailureCodes,
            fallbackMessage = fallbackMessage
        )?.let { message -> return message }
        currentError = currentError.cause
        depth += 1
    }
    return null
}

private fun expectedSingleSettingsFailureMessage(
    error: Throwable,
    expectedCloudFailureCodes: Set<String>,
    fallbackMessage: String
): String? {
    if (error is SyncBlockedException) {
        return fallbackMessage
    }
    if (error is IOException && isLikelyTransientNetworkIoException(error = error)) {
        return fallbackMessage
    }

    val remoteError = error as? CloudRemoteException ?: return null
    if (isExpectedSyncConflictCloudFailure(error = remoteError)) {
        return fallbackMessage
    }
    if (remoteError.statusCode == 401 || remoteError.statusCode == 403 || remoteError.statusCode == 429) {
        return fallbackMessage
    }
    val normalizedCode = remoteError.errorCode?.trim()?.uppercase() ?: return null
    return if (expectedCloudFailureCodes.contains(element = normalizedCode)) {
        fallbackMessage
    } else {
        null
    }
}

private fun isExpectedSyncConflictCloudFailure(error: CloudRemoteException): Boolean {
    if (error.syncConflict != null) {
        return true
    }
    return error.errorCode?.trim()?.uppercase() == "SYNC_WORKSPACE_FORK_REQUIRED"
}
