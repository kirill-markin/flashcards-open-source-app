package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserReturn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAppleBrowserStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialMailboxReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialSignInPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.successfulHint
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
internal data class CloudSocialAttemptBinding(
    val attempt: CloudSocialLoginAttempt,
    val codeVerifier: String
)

@Serializable
internal data class CloudAcceptedSocialSession(
    val credentials: StoredCloudCredentials,
    val hint: CloudProviderSignInHint,
    val connectionSuggestion: com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionSuggestion?
) {
    constructor(credentials: StoredCloudCredentials, hint: CloudProviderSignInHint) : this(credentials, hint, null)
}

@Serializable
internal data class CloudSocialGuestBinding(
    val userId: String,
    val workspaceId: String
)

@Serializable
internal data class CloudAppleBrowserBinding(
    val localId: String,
    val codeVerifier: String,
    val returned: CloudAppleBrowserReturn?
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
    val binding: CloudSocialAttemptBinding?,
    val appleBrowser: CloudAppleBrowserBinding?,
    val originalReauthenticationBinding: CloudSocialAttemptBinding?,
    val mailboxReason: CloudSocialMailboxReason?,
    val mailboxCodeRequested: Boolean,
    val mailboxRequestInFlight: Boolean,
    val providerCredentialObserved: Boolean,
    val providerEmail: String?,
    val completion: CloudSocialLoginCompletion?,
    val acceptedSession: CloudAcceptedSocialSession?,
    val preparedContext: CloudWorkspaceLinkContext?,
    val workspaceSelection: CloudWorkspaceLinkSelection?,
    val completedWorkspace: CloudWorkspaceSummary?,
    val linkingWorkspace: CloudWorkspaceSummary?
) {
    init {
        require((binding == null) != (appleBrowser == null)) { "Sign-in must have exactly one local proof binding." }
        require(appleBrowser == null || provider == CloudSocialProvider.APPLE) { "Browser launch requires Apple." }
    }

    val localId: String get() = binding?.attempt?.attempt ?: requireNotNull(appleBrowser).localId
    val codeVerifier: String get() = binding?.codeVerifier ?: requireNotNull(appleBrowser).codeVerifier
    val serverAttempt: String get() = binding?.attempt?.attempt ?: requireNotNull(appleBrowser?.returned)
        .also { require(it.status == CloudAppleBrowserStatus.VERIFICATION_REQUIRED) }.handle
    val completionHandle: String? get() = completion?.completion ?: appleBrowser?.returned
        ?.takeIf { it.status == CloudAppleBrowserStatus.COMPLETED }?.handle

    fun snapshot(): CloudPendingSocialSignIn {
        return CloudPendingSocialSignIn(
            provider = provider,
            localId = localId,
            attempt = binding?.attempt?.attempt ?: appleBrowser?.returned
                ?.takeIf { it.status != CloudAppleBrowserStatus.COMPLETED }?.handle,
            nonce = binding?.attempt?.nonce,
            redirectUri = binding?.attempt?.redirectUri,
            expiresAtMillis = completion?.expiresAtMillis ?: binding?.attempt?.expiresAtMillis,
            phase = when {
                acceptedSession != null -> CloudSocialSignInPhase.ACCEPTED
                completionHandle != null -> CloudSocialSignInPhase.COMPLETION
                mailboxRequestInFlight -> CloudSocialSignInPhase.INTERRUPTED_MAILBOX
                appleBrowser?.returned?.status == CloudAppleBrowserStatus.DENIED -> CloudSocialSignInPhase.DENIED
                mailboxReason != null || appleBrowser?.returned?.status == CloudAppleBrowserStatus.VERIFICATION_REQUIRED -> CloudSocialSignInPhase.MAILBOX
                else -> CloudSocialSignInPhase.PROVIDER
            },
            mailboxReason = mailboxReason,
            mailboxCodeRequested = mailboxCodeRequested,
            providerEmail = providerEmail,
            workspaceSelection = workspaceSelection
        )
    }
}

@Serializable
internal data class PendingCloudEmailSignIn(
    val configuration: CloudServiceConfiguration,
    val userId: String,
    val hint: CloudSuccessfulSignInHint?
)

@Serializable
internal data class StoredCloudSignInHint(
    val configuration: CloudServiceConfiguration,
    val hint: CloudSuccessfulSignInHint
)

internal class CloudSocialAuthStore(private val credentialStore: CloudCredentialStore) {
    fun loadPending(): PendingCloudSocialSignIn? {
        val value = credentialStore.load().pendingSocialSignIn ?: return null
        return decodePending(value)
    }

    fun savePending(pending: PendingCloudSocialSignIn) {
        credentialStore.update { secrets ->
            secrets.copy(pendingSocialSignIn = Json.encodeToString(pending), pendingAccountMethod = null, accountMethodEpoch = java.util.UUID.randomUUID().toString())
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

    fun clearRejectedDemoOnlyUpgrade(upgrade: PendingGuestUpgradeState) {
        val pending = loadPending() ?: return
        if (pending.configuration != upgrade.configuration ||
            pending.acceptedUserId != upgrade.accountSnapshot.userId ||
            pending.guestBinding != CloudSocialGuestBinding(upgrade.guestSession.userId, upgrade.guestSession.workspaceId) ||
            pending.workspaceSelection != upgrade.selection) {
            return
        }
        savePending(pending.copy(
            workspaceSelection = null,
            preparedContext = pending.preparedContext?.copy(demoOnlyDestinationWorkspaceId = null)
        ))
    }

    fun clearPending() {
        credentialStore.update { secrets -> secrets.copy(pendingSocialSignIn = null) }
    }

    fun loadHint(configuration: CloudServiceConfiguration): CloudSuccessfulSignInHint? {
        val value = credentialStore.load().successfulSignInHint ?: return null
        val stored = decodeSocialAuthState { Json.decodeFromString<StoredCloudSignInHint>(value) }
        return stored.hint.takeIf { stored.configuration == configuration }
    }

    fun completeAcceptedSession(pending: PendingCloudSocialSignIn) {
        completeAcceptedSession(pending, null)
    }

    fun completeAcceptedSession(pending: PendingCloudSocialSignIn, connection: PendingCloudAccountMethod?) {
        val accepted = requireNotNull(pending.acceptedSession) {
            "Remembering a sign-in requires an accepted Nibomo session."
        }
        credentialStore.update { secrets ->
            check(connection == null || (secrets.refreshToken != null && connection.userId == pending.acceptedUserId)) {
                "The completed connection suggestion belongs to a different signed-in account."
            }
            secrets.copy(pendingSocialSignIn = null, pendingEmailSignIn = null,
                pendingAccountMethod = connection?.let { Json.encodeToString(it.copy(epoch = secrets.accountMethodEpoch)) },
                successfulSignInHint =
                Json.encodeToString(StoredCloudSignInHint(pending.configuration, accepted.hint.successfulHint())))
        }
    }

    fun stageEmailSession(pending: PendingCloudEmailSignIn) {
        require(pending.hint == null || pending.hint.method == CloudSignInMethod.EMAIL)
        credentialStore.update { secrets ->
            secrets.copy(pendingEmailSignIn = Json.encodeToString(pending), pendingAccountMethod = null, accountMethodEpoch = java.util.UUID.randomUUID().toString())
        }
    }

    fun completeEmailSession(configuration: CloudServiceConfiguration, userId: String) {
        credentialStore.update { secrets ->
            val value = secrets.pendingEmailSignIn ?: return@update secrets
            val fields = decodeSocialAuthState {
                Json.parseToJsonElement(value) as? JsonObject
                    ?: throw SerializationException("Pending email sign-in must be an object.")
            }
            // A record staged without its account cannot prove which sign-in it belongs to.
            if ("userId" !in fields) return@update secrets
            val pending = decodeSocialAuthState {
                Json.decodeFromJsonElement<PendingCloudEmailSignIn>(JsonObject(fields - "rememberSignIn"))
            }
            if (pending.configuration != configuration || pending.userId != userId || secrets.refreshToken == null) {
                return@update secrets
            }
            secrets.copy(pendingEmailSignIn = null, successfulSignInHint = when {
                pending.hint != null -> Json.encodeToString(StoredCloudSignInHint(configuration, pending.hint))
                else -> secrets.successfulSignInHint
            })
        }
    }
}

private fun <Result> decodeSocialAuthState(decode: () -> Result): Result {
    try {
        return decode()
    } catch (_: SerializationException) {
        // A serialization cause can contain plaintext credentials or email.
        throw IllegalStateException("Encrypted social sign-in state is invalid. Sign out to clear it before trying again.")
    } catch (_: IllegalArgumentException) {
        throw IllegalStateException("Encrypted social sign-in state is unsupported. Sign out to clear it before trying again.")
    }
}

private fun decodePending(value: String): PendingCloudSocialSignIn = decodeSocialAuthState {
    val fields = Json.parseToJsonElement(value) as? JsonObject
        ?: throw SerializationException("Pending social sign-in must be an object.")
    val accepted = fields["acceptedSession"] as? JsonObject
    val compatible = if (accepted == null) fields else JsonObject(fields + ("acceptedSession" to
        JsonObject(mapOf("connectionSuggestion" to JsonNull) + accepted)))
    val pending = Json.decodeFromJsonElement<PendingCloudSocialSignIn>(JsonObject(mapOf(
        "appleBrowser" to JsonNull, "mailboxCodeRequested" to JsonPrimitive(false),
        "mailboxRequestInFlight" to JsonPrimitive(false), "providerCredentialObserved" to JsonPrimitive(false)
    ) + (compatible - "rememberSignIn")))
    // Legacy mailbox records cannot prove whether a one-use request was already launched.
    if ("mailboxRequestInFlight" !in fields && pending.snapshot().phase == CloudSocialSignInPhase.MAILBOX) {
        pending.copy(mailboxRequestInFlight = true)
    } else pending
}
