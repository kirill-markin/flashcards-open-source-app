package com.flashcardsopensourceapp.data.local.model.cloud

import kotlinx.serialization.Serializable

@Serializable
data class CloudProviderMethodTarget(val provider: CloudSocialProvider, val providerSubject: String, val generation: String)

@Serializable
data class CloudAccountProviderMethod(val target: CloudProviderMethodTarget, val active: Boolean, val revocationPending: Boolean)

data class CloudAccountMethods(val methods: List<CloudAccountProviderMethod>, val verifiedRecoveryEmails: List<String>)

@Serializable
enum class CloudAccountMethodPurpose { REAUTH, LINK }

@Serializable
enum class CloudAccountMethodIntent { REAUTH, LINK, REENABLE, UNLINK }

@Serializable
enum class CloudAccountMethodPhase { PROVIDER, EMAIL_CODE, MAILBOX, PROOF_READY, LINK_READY, APPLE_PROVED, SUBMITTING, MUTATED, DENIED, RESTART_REQUIRED }

@Serializable
data class CloudAccountMethodAttempt(
    val attempt: String,
    val nonce: String?,
    val expiresAtMillis: Long,
    val browserStart: String?
)

@Serializable
data class CloudAccountMethodReceipt(val completion: String, val expiresAtMillis: Long)

@Serializable
data class CloudAccountMethodProof(val receipt: CloudAccountMethodReceipt, val codeVerifier: String)

sealed interface CloudAccountMethodResult {
    data class Completed(val receipt: CloudAccountMethodReceipt) : CloudAccountMethodResult
    data class Mailbox(val reason: CloudSocialMailboxReason, val providerEmail: String?) : CloudAccountMethodResult
    data object Mutated : CloudAccountMethodResult
}

sealed interface CloudAccountMethodLaunch {
    data class Google(val serverClientId: String, val rawServerNonce: String) : CloudAccountMethodLaunch
    data class Apple(val url: String) : CloudAccountMethodLaunch
}

data class CloudPendingAccountMethod(
    val localId: String,
    val method: CloudSignInMethod,
    val intent: CloudAccountMethodIntent,
    val phase: CloudAccountMethodPhase,
    val launch: CloudAccountMethodLaunch?,
    val mailboxReason: CloudSocialMailboxReason?,
    val providerEmail: String?,
    val mailboxEmail: String?,
    val mailboxCodeRequested: Boolean,
    val expiresAtMillis: Long,
    val target: CloudProviderMethodTarget?
)
