package com.flashcardsopensourceapp.data.local.model.cloud

import kotlinx.serialization.Serializable

@Serializable
enum class CloudSignInMethod { EMAIL, APPLE, GOOGLE }

@Serializable
data class CloudSuccessfulSignInHint(
    val method: CloudSignInMethod,
    val recoveryEmail: String,
    val providerEmail: String?,
    val emailRelationship: CloudSocialEmailRelationship?
) {
    val successfulEmail: String?
        get() = if (method == CloudSignInMethod.EMAIL) recoveryEmail else providerEmail
}

fun CloudProviderSignInHint.successfulHint(): CloudSuccessfulSignInHint = CloudSuccessfulSignInHint(
    method = when (method) {
        CloudSocialProvider.APPLE -> CloudSignInMethod.APPLE
        CloudSocialProvider.GOOGLE -> CloudSignInMethod.GOOGLE
    },
    recoveryEmail = recoveryEmail,
    providerEmail = providerEmail,
    emailRelationship = emailRelationship
)

data class CloudEmailSession(
    val credentials: StoredCloudCredentials,
    val signInHint: CloudSuccessfulSignInHint?
)
