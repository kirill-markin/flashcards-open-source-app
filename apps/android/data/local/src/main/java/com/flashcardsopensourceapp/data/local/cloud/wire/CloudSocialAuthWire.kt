package com.flashcardsopensourceapp.data.local.cloud.wire

import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEmailAuthMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialAccountEndpoints
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialAuthEndpoints
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCompletionContract
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialEmailRelationship
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialMailboxReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialNonce
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.makeIdTokenExpiryTimestampMillis
import org.json.JSONObject

private val socialHandlePattern = Regex("^[A-Za-z0-9_-]{43}$")
private val socialVerifierPattern = Regex("^[A-Za-z0-9._~-]{43,128}$")
private val socialEmailPattern = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
private val googleClientPattern = Regex("^\\d+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$")
private val appleClientPattern = Regex("^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+$")
private val socialAuthOrigins = setOf("https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com")

internal fun parseCloudAuthMethods(json: JSONObject): CloudAuthMethods {
    val client = json.socialLiteral("client", "android")
    val origins = json.requireCloudArray("authOrigins", "authMethods.authOrigins").toCloudStringList("authMethods.authOrigins")
    socialContract(origins.size == socialAuthOrigins.size && origins.toSet() == socialAuthOrigins, "authMethods.authOrigins")
    val methods = json.requireCloudObject("methods", "authMethods.methods")
    val email = methods.requireCloudObject("email", "authMethods.methods.email")
    socialContract(email.requireCloudBoolean("available", "authMethods.email.available"), "authMethods.email.available")
    val endpoints = json.requireCloudObject("endpoints", "authMethods.endpoints")
    val account = json.requireCloudObject("account", "authMethods.account")
    val completion = json.requireCloudObject("completion", "authMethods.completion")
    socialContract(account.requireCloudInt("freshProofSeconds", "authMethods.account.freshProofSeconds") == 120, "authMethods.account.freshProofSeconds")
    socialContract(!completion.requireCloudBoolean("productAccountProvisioned", "authMethods.completion.productAccountProvisioned"), "authMethods.completion.productAccountProvisioned")
    return CloudAuthMethods(
        client = client,
        authOrigins = origins,
        email = CloudEmailAuthMethod(true, email.socialLiteral("transport", "email_otp")),
        apple = parseAppleAvailability(methods.requireCloudObject("apple", "authMethods.methods.apple")),
        google = parseGoogleAvailability(methods.requireCloudObject("google", "authMethods.methods.google")),
        endpoints = CloudSocialAuthEndpoints(
            attempt = endpoints.socialLiteral("attempt", "/api/social/attempt"),
            complete = endpoints.socialLiteral("complete", "/api/social/complete"),
            browserComplete = endpoints.socialLiteral("browserComplete", "/api/social/browser/complete"),
            sendCode = endpoints.socialLiteral("sendCode", "/api/send-code"),
            verifyCode = endpoints.socialLiteral("verifyCode", "/api/verify-code")
        ),
        account = CloudSocialAccountEndpoints(
            methods = account.socialLiteral("methods", "/api/account/login-methods"),
            providerMethod = account.socialLiteral("providerMethod", "/api/account/provider-methods/link"),
            unlink = account.socialLiteral("unlink", "/api/account/provider-methods/unlink"),
            emailReauth = account.socialLiteral("emailReauth", "/api/account/reauth/email"),
            nativeAttempt = account.socialLiteral("nativeAttempt", "/api/social/attempt"),
            nativeComplete = account.socialLiteral("nativeComplete", "/api/social/complete"),
            freshProofSeconds = 120,
            emailRecovery = account.socialLiteral("emailRecovery", "read_only")
        ),
        completion = CloudSocialCompletionContract(
            codeChallengeMethod = completion.socialLiteral("codeChallengeMethod", "S256"),
            tokenEnvelope = completion.socialLiteral("tokenEnvelope", "TokenResult"),
            productAccountProvisioned = false
        )
    )
}

private fun parseGoogleAvailability(json: JSONObject): CloudSocialProviderAvailability {
    if (!json.requireCloudBoolean("available", "authMethods.google.available")) {
        return CloudSocialProviderAvailability.Unavailable
    }
    json.socialLiteral("transport", "native")
    json.socialLiteral("nonce", "raw")
    val audience = json.requireCloudString("audience", "authMethods.google.audience")
    val presenters = json.requireCloudArray("presenterClientIds", "authMethods.google.presenterClientIds")
        .toCloudStringList("authMethods.google.presenterClientIds")
    socialContract(googleClientPattern.matches(audience), "authMethods.google.audience")
    socialContract(presenters.size in 1..10 && presenters.distinct().size == presenters.size &&
        presenters.all { googleClientPattern.matches(it) && it != audience }, "authMethods.google.presenterClientIds")
    return CloudSocialProviderAvailability.Native(audience, presenters, CloudSocialNonce.RAW)
}

private fun parseAppleAvailability(json: JSONObject): CloudSocialProviderAvailability {
    if (!json.requireCloudBoolean("available", "authMethods.apple.available")) {
        return CloudSocialProviderAvailability.Unavailable
    }
    json.socialLiteral("transport", "browser")
    json.socialLiteral("nonce", "sha256-lowercase-hex")
    val audience = json.requireCloudString("audience", "authMethods.apple.audience")
    socialContract(appleClientPattern.matches(audience), "authMethods.apple.audience")
    return CloudSocialProviderAvailability.Browser(
        audience = audience,
        start = json.socialLiteral("start", "/api/social/apple/start"),
        callback = json.socialLiteral("callback", "/api/social/apple/callback"),
        callbackMethod = json.socialLiteral("callbackMethod", "POST"),
        nativeReturnUri = json.socialLiteral("nativeReturnUri", "com.nibomo.app:/auth/social/apple"),
        nonce = CloudSocialNonce.SHA256_LOWERCASE_HEX
    )
}

internal fun parseCloudSocialLoginAttempt(json: JSONObject): CloudSocialLoginAttempt {
    val attempt = json.socialHandle("attempt")
    val nonce = json.socialHandle("nonce")
    val challenge = json.socialHandle("providerCodeChallenge")
    val redirectUri = json.requireCloudNullableString("redirectUri", "socialLogin.redirectUri")
    socialContract(redirectUri == null, "socialLogin.redirectUri")
    return CloudSocialLoginAttempt(attempt, nonce, json.socialExpiry(), redirectUri, challenge)
}

internal fun parseCloudSocialCredentialResult(json: JSONObject): CloudSocialCredentialResult {
    return when (json.requireCloudString("status", "socialLogin.status")) {
        "completed" -> CloudSocialCredentialResult.Completed(parseCloudSocialLoginCompletion(json))
        "verification_required" -> {
            val reason = when (json.requireCloudString("reason", "socialLogin.reason")) {
                "mailbox_required" -> CloudSocialMailboxReason.MAILBOX_REQUIRED
                "existing_email" -> CloudSocialMailboxReason.EXISTING_EMAIL
                "historical_binding" -> CloudSocialMailboxReason.HISTORICAL_BINDING
                else -> throw socialMismatch("socialLogin.reason")
            }
            val email = json.socialNullableEmail("providerEmail")
            socialContract(reason != CloudSocialMailboxReason.EXISTING_EMAIL || email != null, "socialLogin.providerEmail")
            CloudSocialCredentialResult.VerificationRequired(reason, email)
        }
        else -> throw socialMismatch("socialLogin.status")
    }
}

internal fun parseCloudSocialLoginCompletion(json: JSONObject): CloudSocialLoginCompletion {
    json.socialLiteral("status", "completed")
    return CloudSocialLoginCompletion(json.socialHandle("completion"), json.socialExpiry())
}

internal fun requireCloudSocialMailboxSent(json: JSONObject) {
    json.socialLiteral("status", "mailbox_code_sent")
}

internal fun parseCloudSocialLoginSession(json: JSONObject): CloudSocialLoginSession {
    socialContract(json.requireCloudBoolean("ok", "socialLogin.ok"), "socialLogin.ok")
    val idToken = json.socialToken("idToken")
    val accessToken = json.socialToken("accessToken")
    val refreshToken = json.socialToken("refreshToken")
    val expiresIn = json.requireCloudInt("expiresIn", "socialLogin.expiresIn")
    socialContract(expiresIn > 0, "socialLogin.expiresIn")
    val hint = parseProviderHint(json.requireCloudObject("signInHint", "socialLogin.signInHint"))
    return CloudSocialLoginSession(
        credentials = StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            idTokenExpiresAtMillis = makeIdTokenExpiryTimestampMillis(System.currentTimeMillis(), expiresIn)
        ),
        accessToken = accessToken,
        signInHint = hint
    )
}

private fun parseProviderHint(json: JSONObject): CloudProviderSignInHint {
    val method = when (json.requireCloudString("method", "socialLogin.signInHint.method")) {
        "google" -> CloudSocialProvider.GOOGLE
        "apple" -> CloudSocialProvider.APPLE
        else -> throw socialMismatch("socialLogin.signInHint.method")
    }
    val recoveryEmail = json.requireCloudString("recoveryEmail", "socialLogin.signInHint.recoveryEmail")
    socialContract(validSocialEmail(recoveryEmail), "socialLogin.signInHint.recoveryEmail")
    val providerEmail = json.socialNullableEmail("providerEmail")
    val relationship = when {
        providerEmail == null -> CloudSocialEmailRelationship.MISSING
        providerEmail == recoveryEmail -> CloudSocialEmailRelationship.MATCHES_RECOVERY
        else -> CloudSocialEmailRelationship.DIFFERENT_FROM_RECOVERY
    }
    val expected = when (relationship) {
        CloudSocialEmailRelationship.MISSING -> "missing"
        CloudSocialEmailRelationship.MATCHES_RECOVERY -> "matches_recovery"
        CloudSocialEmailRelationship.DIFFERENT_FROM_RECOVERY -> "different_from_recovery"
    }
    json.socialLiteral("emailRelationship", expected)
    return CloudProviderSignInHint(method, recoveryEmail, providerEmail, relationship)
}

internal fun socialLoginBinding(codeVerifier: String): JSONObject {
    require(socialVerifierPattern.matches(codeVerifier)) { "Social login requires a 43–128 character PKCE verifier." }
    return JSONObject().put("client", "android").put("purpose", "login").put("codeVerifier", codeVerifier)
}

internal fun validateSocialHandle(value: String) {
    require(socialHandlePattern.matches(value)) { "Social login requires a 43-character base64url handle." }
}

internal fun validateSocialChallenge(value: String) {
    require(socialHandlePattern.matches(value)) { "Social login requires a 43-character S256 PKCE challenge." }
}

internal fun validateSocialIdentityToken(value: String) {
    require(value.length in 1..16_384) { "Social login identity token must contain 1–16384 characters." }
}

internal fun validateSocialEmail(value: String) {
    require(validSocialEmail(value)) { "Social mailbox email must be valid and at most 254 characters." }
}

internal fun validateSocialCode(value: String) {
    require(Regex("^[0-9]{6,8}$").matches(value)) { "Social mailbox code must contain 6–8 digits." }
}

private fun validSocialEmail(value: String): Boolean = value.length in 3..254 && socialEmailPattern.matches(value)

private fun JSONObject.socialLiteral(key: String, expected: String): String {
    val value = requireCloudString(key, "socialAuth.$key")
    socialContract(value == expected, "socialAuth.$key")
    return value
}

private fun JSONObject.socialHandle(key: String): String {
    val value = requireCloudString(key, "socialLogin.$key")
    socialContract(socialHandlePattern.matches(value), "socialLogin.$key")
    return value
}

private fun JSONObject.socialNullableEmail(key: String): String? {
    val value = requireCloudNullableString(key, "socialLogin.$key")
    socialContract(value == null || validSocialEmail(value), "socialLogin.$key")
    return value
}

private fun JSONObject.socialExpiry(): Long {
    val value = requireCloudIsoTimestampMillis("expiresAt", "socialLogin.expiresAt")
    socialContract(value > 0, "socialLogin.expiresAt")
    return value
}

private fun JSONObject.socialToken(key: String): String {
    val value = requireCloudString(key, "socialLogin.$key")
    socialContract(value.isNotBlank() && value.length <= 16_384, "socialLogin.$key")
    return value
}

private fun socialContract(condition: Boolean, field: String) {
    if (!condition) throw socialMismatch(field)
}

private fun socialMismatch(field: String): CloudContractMismatchException {
    return CloudContractMismatchException("Cloud social auth contract mismatch for $field.")
}

internal fun parseCloudEmailSignInHint(response: JSONObject): CloudSuccessfulSignInHint? {
    if (!response.has("signInHint") || response.isNull("signInHint")) return null
    val hint = response.requireCloudObject("signInHint", "emailSession.signInHint")
    if (hint.optString("method") != "email") return null
    val email = hint.requireCloudString("email", "emailSession.signInHint.email")
    socialContract(validSocialEmail(email), "emailSession.signInHint.email")
    return CloudSuccessfulSignInHint(CloudSignInMethod.EMAIL, email, null, null)
}
