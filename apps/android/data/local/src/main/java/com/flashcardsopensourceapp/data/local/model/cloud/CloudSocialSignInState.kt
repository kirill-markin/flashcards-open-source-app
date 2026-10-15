package com.flashcardsopensourceapp.data.local.model.cloud

enum class CloudSocialSignInPhase {
    PROVIDER,
    MAILBOX,
    COMPLETION,
    ACCEPTED
}

/** Contains only the data needed by the provider UI; PKCE and credentials stay in encrypted storage. */
data class CloudPendingSocialSignIn(
    val provider: CloudSocialProvider,
    val attempt: String,
    val nonce: String,
    val redirectUri: String?,
    val expiresAtMillis: Long,
    val phase: CloudSocialSignInPhase,
    val mailboxReason: CloudSocialMailboxReason?,
    val providerEmail: String?
)
