package com.flashcardsopensourceapp.data.local.watch

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.refreshExpiredStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore

/** Why the phone answered the watch the way it did; logged with every handled request. */
enum class WatchHandoffReplyReason(
    val wireValue: String
) {
    SIGNED_IN(wireValue = "signed_in"),
    SIGNED_OUT(wireValue = "signed_out"),
    GUEST(wireValue = "guest"),

    /**
     * The contract carries no server configuration, so a custom server's tokens never reach the watch,
     * which talks to the official API only.
     */
    CUSTOM_SERVER(wireValue = "custom_server"),
    CREDENTIAL_RECOVERY_REQUIRED(wireValue = "credential_recovery_required")
}

data class WatchHandoffReplyResult(
    val reply: WatchHandoffReply,
    val reason: WatchHandoffReplyReason,
    val workspaceId: String?
)

class WatchHandoffLinkedUserUnavailableException : IllegalStateException(
    "Watch handoff reply cannot be built: the linked cloud account has no user id"
)

class WatchHandoffLinkedWorkspaceUnavailableException : IllegalStateException(
    "Watch handoff reply cannot be built: the linked cloud account has no active workspace"
)

class WatchHandoffLinkedCredentialsUnavailableException : IllegalStateException(
    "Watch handoff reply cannot be built: the linked cloud account has no stored credentials"
)

class WatchHandoffAccountChangedDuringCredentialRefreshException : IllegalStateException(
    "Watch handoff reply cannot be built: the linked account or workspace changed while its credentials were refreshing"
)

private data class WatchHandoffLinkedAccount(
    val linkedUserId: String,
    val email: String?,
    val workspaceId: String
)

private sealed interface WatchHandoffAccountState {
    data class Linked(
        val account: WatchHandoffLinkedAccount
    ) : WatchHandoffAccountState

    data class SignedOut(
        val reason: WatchHandoffReplyReason
    ) : WatchHandoffAccountState
}

/**
 * Builds the watch's reply from stored state only: it runs while the app may be woken in the background,
 * so it starts no sync and touches no UI state.
 */
class WatchHandoffReplyBuilder(
    private val preferencesStore: CloudPreferencesStore,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator
) {
    suspend fun buildReply(): WatchHandoffReplyResult {
        val accountState = currentAccountState()
        val account = when (accountState) {
            is WatchHandoffAccountState.SignedOut -> return WatchHandoffReplyResult(
                reply = WatchHandoffReply.SignedOut,
                reason = accountState.reason,
                workspaceId = null
            )

            is WatchHandoffAccountState.Linked -> accountState.account
        }

        val credentials = refreshExpiredStoredCloudCredentials(
            storedCredentials = preferencesStore.loadCredentials()
                ?: throw WatchHandoffLinkedCredentialsUnavailableException(),
            authBaseUrl = preferencesStore.currentServerConfiguration().authBaseUrl,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            operationCoordinator = operationCoordinator
        )
        // The refresh suspends, and a sign-out or workspace switch can land in it.
        if (currentAccountState() != accountState) {
            throw WatchHandoffAccountChangedDuringCredentialRefreshException()
        }

        return WatchHandoffReplyResult(
            reply = WatchHandoffReply.SignedIn(
                account = WatchHandoffSignedInAccount(
                    credentials = credentials,
                    linkedUserId = account.linkedUserId,
                    email = account.email,
                    workspaceId = account.workspaceId,
                    reviewFilter = reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = account.workspaceId)
                )
            ),
            reason = WatchHandoffReplyReason.SIGNED_IN,
            workspaceId = account.workspaceId
        )
    }

    private fun currentAccountState(): WatchHandoffAccountState {
        if (preferencesStore.currentServerConfiguration().mode == CloudServiceConfigurationMode.CUSTOM) {
            return WatchHandoffAccountState.SignedOut(reason = WatchHandoffReplyReason.CUSTOM_SERVER)
        }

        val cloudSettings = preferencesStore.currentCloudSettings()
        when (cloudSettings.cloudState) {
            CloudAccountState.GUEST -> {
                return WatchHandoffAccountState.SignedOut(reason = WatchHandoffReplyReason.GUEST)
            }

            CloudAccountState.DISCONNECTED, CloudAccountState.LINKING_READY -> {
                return WatchHandoffAccountState.SignedOut(reason = WatchHandoffReplyReason.SIGNED_OUT)
            }

            CloudAccountState.LINKED -> Unit
        }

        if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
            return WatchHandoffAccountState.SignedOut(reason = WatchHandoffReplyReason.CREDENTIAL_RECOVERY_REQUIRED)
        }
        val linkedUserId = cloudSettings.linkedUserId
        if (linkedUserId.isNullOrEmpty()) {
            throw WatchHandoffLinkedUserUnavailableException()
        }
        val workspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
        if (workspaceId.isNullOrEmpty()) {
            throw WatchHandoffLinkedWorkspaceUnavailableException()
        }

        return WatchHandoffAccountState.Linked(
            account = WatchHandoffLinkedAccount(
                linkedUserId = linkedUserId,
                email = cloudSettings.linkedEmail,
                workspaceId = workspaceId
            )
        )
    }
}
