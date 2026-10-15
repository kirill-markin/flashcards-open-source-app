package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialMailboxReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialSignInPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
internal data class CloudSocialAttemptBinding(
    val attempt: CloudSocialLoginAttempt,
    val codeVerifier: String
)

@Serializable
internal data class CloudAcceptedSocialSession(
    val credentials: StoredCloudCredentials,
    val hint: CloudProviderSignInHint
)

@Serializable
internal data class CloudSocialGuestBinding(
    val userId: String,
    val workspaceId: String
)

@Serializable
internal data class PendingCloudSocialSignIn(
    val installationId: String,
    val linkedUserId: String?,
    val linkedWorkspaceId: String?,
    val activeWorkspaceId: String?,
    val guestBinding: CloudSocialGuestBinding?,
    val acceptedUserId: String?,
    val configuration: CloudServiceConfiguration,
    val provider: CloudSocialProvider,
    val binding: CloudSocialAttemptBinding,
    // Future management must retain original reauthentication separately from a new link proof.
    val originalReauthenticationBinding: CloudSocialAttemptBinding?,
    val rememberSignIn: Boolean,
    val mailboxReason: CloudSocialMailboxReason?,
    val providerEmail: String?,
    val completion: CloudSocialLoginCompletion?,
    val acceptedSession: CloudAcceptedSocialSession?,
    val preparedContext: CloudWorkspaceLinkContext?,
    val workspaceSelection: CloudWorkspaceLinkSelection?,
    val completedWorkspace: CloudWorkspaceSummary?,
    val linkingWorkspace: CloudWorkspaceSummary?
) {
    fun snapshot(): CloudPendingSocialSignIn {
        return CloudPendingSocialSignIn(
            provider = provider,
            attempt = binding.attempt.attempt,
            nonce = binding.attempt.nonce,
            redirectUri = binding.attempt.redirectUri,
            expiresAtMillis = completion?.expiresAtMillis ?: binding.attempt.expiresAtMillis,
            phase = when {
                acceptedSession != null -> CloudSocialSignInPhase.ACCEPTED
                completion != null -> CloudSocialSignInPhase.COMPLETION
                mailboxReason != null -> CloudSocialSignInPhase.MAILBOX
                else -> CloudSocialSignInPhase.PROVIDER
            },
            mailboxReason = mailboxReason,
            providerEmail = providerEmail
        )
    }
}

@Serializable
internal data class StoredCloudSignInHint(
    val configuration: CloudServiceConfiguration,
    val hint: CloudProviderSignInHint
)

internal class CloudSocialAuthStore(private val credentialStore: CloudCredentialStore) {
    fun loadPending(): PendingCloudSocialSignIn? {
        val value = credentialStore.load().pendingSocialSignIn ?: return null
        return decodeSocialAuthState { Json.decodeFromString<PendingCloudSocialSignIn>(value) }
    }

    fun savePending(pending: PendingCloudSocialSignIn) {
        credentialStore.update { secrets ->
            secrets.copy(pendingSocialSignIn = Json.encodeToString(pending))
        }
    }

    fun retainCompletedGuestUpgrade(
        installationId: String,
        upgrade: PendingGuestUpgradeState,
        workspace: CloudWorkspaceSummary
    ) {
        val pending = loadPending() ?: return
        if (pending.installationId != installationId || pending.configuration != upgrade.configuration ||
            pending.acceptedUserId != upgrade.accountSnapshot.userId ||
            pending.guestBinding != CloudSocialGuestBinding(upgrade.guestSession.userId, upgrade.guestSession.workspaceId) ||
            pending.preparedContext?.guestUpgradeMode != upgrade.guestUpgradeMode ||
            pending.workspaceSelection != upgrade.selection || pending.originalReauthenticationBinding != null
        ) {
            return
        }
        check(pending.acceptedSession != null) { "Guest completion requires the accepted social session." }
        savePending(pending.copy(completedWorkspace = workspace))
    }

    fun clearPending() {
        credentialStore.update { secrets -> secrets.copy(pendingSocialSignIn = null) }
    }

    fun loadHint(configuration: CloudServiceConfiguration): CloudProviderSignInHint? {
        val value = credentialStore.load().successfulSignInHint ?: return null
        val stored = decodeSocialAuthState { Json.decodeFromString<StoredCloudSignInHint>(value) }
        return stored.hint.takeIf { stored.configuration == configuration }
    }

    fun completeAcceptedSession(pending: PendingCloudSocialSignIn) {
        val accepted = requireNotNull(pending.acceptedSession) {
            "Remembering a sign-in requires an accepted Nibomo session."
        }
        credentialStore.update { secrets ->
            secrets.copy(pendingSocialSignIn = null, successfulSignInHint = if (pending.rememberSignIn) {
                Json.encodeToString(StoredCloudSignInHint(pending.configuration, accepted.hint))
            } else {
                null
            })
        }
    }

    fun forgetHint() {
        credentialStore.update { secrets ->
            val pending = secrets.pendingSocialSignIn?.let { value ->
                decodeSocialAuthState { Json.decodeFromString<PendingCloudSocialSignIn>(value) }
            }
            secrets.copy(
                successfulSignInHint = null,
                pendingSocialSignIn = pending?.let { Json.encodeToString(it.copy(rememberSignIn = false)) }
            )
        }
    }
}

private fun <Result> decodeSocialAuthState(decode: () -> Result): Result {
    try {
        return decode()
    } catch (_: SerializationException) {
        // A serialization cause can contain plaintext credentials or email.
        throw IllegalStateException("Encrypted social sign-in state is invalid. Sign out and forget to clear it before trying again.")
    } catch (_: IllegalArgumentException) {
        throw IllegalStateException("Encrypted social sign-in state is unsupported. Sign out and forget to clear it before trying again.")
    }
}
