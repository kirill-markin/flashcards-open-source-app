package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodProof
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodReceipt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialMailboxReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPurpose
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingAccountMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodLaunch
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
internal data class PendingCloudAccountMethod(
    val localId: String,
    val epoch: String?,
    val installationId: String,
    val userId: String,
    val workspaceId: String?,
    val activeWorkspaceId: String?,
    val configuration: CloudServiceConfiguration,
    val method: CloudSignInMethod,
    val intent: CloudAccountMethodIntent,
    val phase: CloudAccountMethodPhase,
    val verifier: String,
    val attempt: CloudAccountMethodAttempt?,
    val originalProof: CloudAccountMethodProof?,
    val linkReceipt: CloudAccountMethodReceipt?,
    val googleAudience: String?,
    val mailboxReason: CloudSocialMailboxReason?,
    val providerEmail: String?,
    val mailboxEmail: String?,
    val mailboxCodeRequested: Boolean,
    val target: CloudProviderMethodTarget?,
    val connection: com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountConnection?
) {
    val purpose: CloudAccountMethodPurpose get() = if (intent == CloudAccountMethodIntent.REAUTH)
        CloudAccountMethodPurpose.REAUTH else CloudAccountMethodPurpose.LINK

    fun snapshot(): CloudPendingAccountMethod {
        val launch = if (phase != CloudAccountMethodPhase.PROVIDER || attempt == null) null else when (method) {
            CloudSignInMethod.GOOGLE -> CloudAccountMethodLaunch.Google(requireNotNull(googleAudience), requireNotNull(attempt.nonce))
            CloudSignInMethod.APPLE -> CloudAccountMethodLaunch.Apple(configuration.authBaseUrl + requireNotNull(attempt.browserStart))
            CloudSignInMethod.EMAIL -> null
        }
        val expiry = when (phase) {
            CloudAccountMethodPhase.PROOF_READY -> originalProof?.receipt?.expiresAtMillis
            CloudAccountMethodPhase.LINK_READY -> linkReceipt?.expiresAtMillis
            else -> attempt?.expiresAtMillis
        }
        return CloudPendingAccountMethod(localId, method, intent, phase, launch, mailboxReason, providerEmail, mailboxEmail,
            mailboxCodeRequested, connection?.expiresAtMillis ?: expiry ?: 0L, target, connection, activeWorkspaceId)
    }
}

internal class CloudAccountMethodStore(private val credentialStore: CloudCredentialStore) {
    fun epoch(): String? = credentialStore.load().accountMethodEpoch

    fun load(): PendingCloudAccountMethod? = credentialStore.load().pendingAccountMethod?.let(::decode)

    fun replace(expected: PendingCloudAccountMethod?, replacement: PendingCloudAccountMethod?) {
        credentialStore.update { secrets ->
            val current = secrets.pendingAccountMethod?.let(::decode)
            check(current == expected && secrets.accountMethodEpoch == (replacement?.epoch ?: expected?.epoch)) { "Account proof was cancelled or replaced. Start fresh verification." }
            secrets.copy(pendingAccountMethod = replacement?.let { Json.encodeToString(it) })
        }
    }

    private fun decode(value: String): PendingCloudAccountMethod {
        try {
            val fields = Json.parseToJsonElement(value) as? kotlinx.serialization.json.JsonObject
                ?: throw SerializationException("Account proof must be an object.")
            // Older records also carry a refresh-token sessionBinding; userId is the account binding.
            return Json.decodeFromJsonElement(PendingCloudAccountMethod.serializer(),
                 kotlinx.serialization.json.JsonObject(mapOf("connection" to kotlinx.serialization.json.JsonNull) + fields - "sessionBinding"))
        } catch (_: SerializationException) {
            throw IllegalStateException("Encrypted account proof is invalid. Sign out before trying again.")
        } catch (_: IllegalArgumentException) {
            throw IllegalStateException("Encrypted account proof is unsupported. Sign out before trying again.")
        }
    }
}
