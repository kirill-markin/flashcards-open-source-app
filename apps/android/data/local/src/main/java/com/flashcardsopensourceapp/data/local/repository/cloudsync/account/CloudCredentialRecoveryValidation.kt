package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import java.util.Locale

internal fun invalidStoredRecoveryLinkContext(
    credentials: StoredCloudCredentials
): CloudWorkspaceLinkContext {
    return CloudWorkspaceLinkContext(
        userId = "",
        email = null,
        credentials = credentials,
        workspaces = emptyList(),
        postAuthRoute = CloudWorkspacePostAuthRoute.INVALID_STORED_STATE,
        guestUpgradeMode = null,
        preferredWorkspaceId = null
    )
}

internal fun blockedPostAuthRecoveryCredentials(): StoredCloudCredentials {
    return StoredCloudCredentials(
        refreshToken = "",
        idToken = "",
        idTokenExpiresAtMillis = 0L
    )
}

internal fun requirePostAuthRouteAllowsCloudLinkCompletion(
    linkContext: CloudWorkspaceLinkContext,
    recoveryState: CloudCredentialRecoveryState?,
    selection: CloudWorkspaceLinkSelection
) {
    when (linkContext.postAuthRoute) {
        CloudWorkspacePostAuthRoute.NONE -> {
            if (recoveryState != null) {
                throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
            }
        }

        CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE -> {
            val linkedRecoveryState: CloudCredentialRecoveryState = requireActiveCloudCredentialRecoveryState(
                recoveryState = recoveryState
            )
            if (linkedRecoveryState.reason != CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING) {
                throw CloudCredentialRecoveryRequiredException(recoveryState = linkedRecoveryState)
            }
            requireWorkspaceSelectionMatchesCredentialRecoveryBeforeSideEffects(
                recoveryState = linkedRecoveryState,
                selection = selection
            )
        }

        CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY -> {
            requireGuestLocalRecoveryAllowsCreateNewCompletion(
                recoveryState = requireActiveCloudCredentialRecoveryState(
                    recoveryState = recoveryState
                ),
                selection = selection
            )
        }

        CloudWorkspacePostAuthRoute.PENDING_GUEST_UPGRADE_RECOVERY,
        CloudWorkspacePostAuthRoute.INVALID_STORED_STATE -> {
            throw CloudCredentialRecoveryRequiredException(
                recoveryState = requireActiveCloudCredentialRecoveryState(
                    recoveryState = recoveryState
                )
            )
        }
    }
}

internal fun requireActiveCloudCredentialRecoveryState(
    recoveryState: CloudCredentialRecoveryState?
): CloudCredentialRecoveryState {
    return requireNotNull(recoveryState) {
        "Cloud credential recovery state changed during sign-in. Start sign-in again."
    }
}

internal fun requireGuestLocalRecoveryAllowsCreateNewCompletion(
    recoveryState: CloudCredentialRecoveryState,
    selection: CloudWorkspaceLinkSelection
) {
    if (
        recoveryState.reason != CloudCredentialRecoveryReason.GUEST_SESSION_MISSING ||
        recoveryState.previousCloudState != CloudAccountState.GUEST
    ) {
        throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
    }
    if (selection != CloudWorkspaceLinkSelection.CreateNew) {
        throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
    }
}

internal fun requireCloudLinkMatchesCredentialRecoveryBeforeSideEffects(
    recoveryState: CloudCredentialRecoveryState?,
    authenticatedSession: AuthenticatedCloudSession
) {
    when (recoveryState?.reason) {
        null -> return
        CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING -> {
            if (
                linkedCredentialRecoveryConfigurationMatches(
                    recoveryState = recoveryState,
                    configuration = authenticatedSession.configuration
                ).not() ||
                linkedCredentialRecoveryIdentityMatches(
                    recoveryState = recoveryState,
                    userId = authenticatedSession.accountSnapshot.userId,
                    email = authenticatedSession.accountSnapshot.email
                ).not()
            ) {
                throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
            }
        }

        CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
        CloudCredentialRecoveryReason.INVALID_STORED_STATE -> {
            throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
        }
    }
}

internal fun resolveLinkedCredentialRecoveryPreferredWorkspaceIdOrNull(
    recoveryState: CloudCredentialRecoveryState,
    configuration: CloudServiceConfiguration,
    accountSnapshot: CloudAccountSnapshot
): String? {
    if (
        recoveryState.reason != CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING ||
        recoveryState.previousCloudState != CloudAccountState.LINKED ||
        linkedCredentialRecoveryConfigurationMatches(
            recoveryState = recoveryState,
            configuration = configuration
        ).not() ||
        linkedCredentialRecoveryIdentityMatches(
            recoveryState = recoveryState,
            userId = accountSnapshot.userId,
            email = accountSnapshot.email
        ).not()
    ) {
        return null
    }
    val expectedWorkspaceId: String = recoveredWorkspaceId(recoveryState = recoveryState) ?: return null
    return if (accountSnapshot.workspaces.any { workspace -> workspace.workspaceId == expectedWorkspaceId }) {
        expectedWorkspaceId
    } else {
        null
    }
}

internal fun requireWorkspaceSelectionMatchesCredentialRecoveryBeforeSideEffects(
    recoveryState: CloudCredentialRecoveryState?,
    selection: CloudWorkspaceLinkSelection
) {
    if (recoveryState?.reason != CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING) {
        return
    }
    if (recoveryState.previousCloudState != CloudAccountState.LINKED) {
        throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
    }
    val recoveredWorkspaceId: String? = recoveredWorkspaceId(recoveryState = recoveryState)
    if (recoveredWorkspaceId == null) {
        throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
    }

    val selectedWorkspaceId: String = when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> selection.workspaceId
        CloudWorkspaceLinkSelection.CreateNew -> throw CloudCredentialRecoveryRequiredException(
            recoveryState = recoveryState
        )
    }
    if (selectedWorkspaceId != recoveredWorkspaceId) {
        throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
    }
}

internal fun linkedCredentialRecoveryConfigurationMatches(
    recoveryState: CloudCredentialRecoveryState,
    configuration: CloudServiceConfiguration
): Boolean {
    return recoveryState.previousCloudState == CloudAccountState.LINKED &&
        recoveryState.configurationMode == configuration.mode &&
        recoveryState.apiBaseUrl == configuration.apiBaseUrl
}

internal fun linkedCredentialRecoveryIdentityMatches(
    recoveryState: CloudCredentialRecoveryState,
    userId: String,
    email: String?
): Boolean {
    val linkedUserId: String? = recoveryState.linkedUserId?.takeIf { storedUserId -> storedUserId.isNotBlank() }
    if (linkedUserId != null) {
        return userId == linkedUserId
    }

    val linkedEmail: String = normalizedCloudCredentialRecoveryEmail(email = recoveryState.linkedEmail)
        ?: return false
    return normalizedCloudCredentialRecoveryEmail(email = email) == linkedEmail
}

internal fun normalizedCloudCredentialRecoveryEmail(email: String?): String? {
    return email?.trim()
        ?.lowercase(Locale.ROOT)
        ?.takeIf { normalizedEmail -> normalizedEmail.isNotEmpty() }
}

internal fun recoveredWorkspaceId(recoveryState: CloudCredentialRecoveryState): String? {
    return recoveryState.activeWorkspaceId?.takeIf { workspaceId -> workspaceId.isNotBlank() }
        ?: recoveryState.linkedWorkspaceId?.takeIf { workspaceId -> workspaceId.isNotBlank() }
}
