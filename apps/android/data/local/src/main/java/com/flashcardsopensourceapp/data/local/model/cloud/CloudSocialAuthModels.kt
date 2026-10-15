package com.flashcardsopensourceapp.data.local.model.cloud

enum class CloudSocialProvider {
    APPLE,
    GOOGLE
}

enum class CloudSocialNonce {
    RAW,
    SHA256_LOWERCASE_HEX
}

sealed interface CloudSocialProviderAvailability {
    data object Unavailable : CloudSocialProviderAvailability

    data class Native(
        val audience: String,
        val presenterClientIds: List<String>,
        val nonce: CloudSocialNonce
    ) : CloudSocialProviderAvailability

    data class Browser(
        val audience: String,
        val start: String,
        val callback: String,
        val callbackMethod: String,
        val nativeReturnUri: String,
        val nonce: CloudSocialNonce
    ) : CloudSocialProviderAvailability
}

data class CloudAuthMethods(
    val client: String,
    val authOrigins: List<String>,
    val email: CloudEmailAuthMethod,
    val apple: CloudSocialProviderAvailability,
    val google: CloudSocialProviderAvailability,
    val endpoints: CloudSocialAuthEndpoints,
    val account: CloudSocialAccountEndpoints,
    val completion: CloudSocialCompletionContract
)

data class CloudEmailAuthMethod(
    val available: Boolean,
    val transport: String
)

data class CloudSocialAuthEndpoints(
    val attempt: String,
    val complete: String,
    val browserComplete: String,
    val sendCode: String,
    val verifyCode: String
)

data class CloudSocialAccountEndpoints(
    val methods: String,
    val providerMethod: String,
    val unlink: String,
    val emailReauth: String,
    val nativeAttempt: String,
    val nativeComplete: String,
    val freshProofSeconds: Int,
    val emailRecovery: String
)

data class CloudSocialCompletionContract(
    val codeChallengeMethod: String,
    val tokenEnvelope: String,
    val productAccountProvisioned: Boolean
)

data class CloudSocialLoginAttempt(
    val attempt: String,
    val nonce: String,
    val expiresAtMillis: Long,
    val redirectUri: String?,
    val providerCodeChallenge: String
)

data class CloudSocialLoginCompletion(
    val completion: String,
    val expiresAtMillis: Long
)

enum class CloudSocialMailboxReason {
    MAILBOX_REQUIRED,
    EXISTING_EMAIL,
    HISTORICAL_BINDING
}

sealed interface CloudSocialCredentialResult {
    data class Completed(val result: CloudSocialLoginCompletion) : CloudSocialCredentialResult

    data class VerificationRequired(
        val reason: CloudSocialMailboxReason,
        val providerEmail: String?
    ) : CloudSocialCredentialResult
}

enum class CloudSocialEmailRelationship {
    MATCHES_RECOVERY,
    DIFFERENT_FROM_RECOVERY,
    MISSING
}

data class CloudProviderSignInHint(
    val method: CloudSocialProvider,
    val recoveryEmail: String,
    val providerEmail: String?,
    val emailRelationship: CloudSocialEmailRelationship
)

data class CloudSocialLoginSession(
    val credentials: StoredCloudCredentials,
    val accessToken: String,
    val signInHint: CloudProviderSignInHint
)
