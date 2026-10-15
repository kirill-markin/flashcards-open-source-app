package com.flashcardsopensourceapp.data.local.cloud.remote.auth

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudAuthMethods
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudSocialLoginSession
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudSocialMailboxSent
import com.flashcardsopensourceapp.data.local.cloud.wire.socialLoginBinding
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialChallenge
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialCode
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialEmail
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialHandle
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialIdentityToken
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginSession
import org.json.JSONObject

internal class CloudSocialAuthRemoteApi(
    private val httpClient: CloudJsonHttpClient
) : CloudSocialAuthGateway {
    override suspend fun loadAuthMethods(authBaseUrl: String): CloudAuthMethods {
        return parseCloudAuthMethods(httpClient.getJson(authBaseUrl, "/api/auth-methods?client=android", null))
    }

    override suspend fun beginGoogleLogin(authBaseUrl: String, codeChallenge: String): CloudSocialLoginAttempt {
        validateSocialChallenge(codeChallenge)
        return parseCloudSocialLoginAttempt(httpClient.postJson(
            baseUrl = authBaseUrl,
            path = "/api/social/attempt",
            authorizationHeader = null,
            body = JSONObject().put("client", "android").put("purpose", "login")
                .put("provider", "google").put("codeChallenge", codeChallenge)
        ))
    }

    override suspend fun submitGoogleCredential(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        identityToken: String
    ): CloudSocialCredentialResult {
        validateSocialHandle(attempt)
        validateSocialIdentityToken(identityToken)
        val body = socialLoginBinding(codeVerifier).put("action", "provider")
            .put("attempt", attempt).put("provider", "google").put("identityToken", identityToken)
        return parseCloudSocialCredentialResult(complete(authBaseUrl, body))
    }

    override suspend fun requestSocialMailboxCode(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        email: String
    ) {
        validateSocialHandle(attempt)
        val normalizedEmail = email.trim().lowercase(java.util.Locale.ROOT)
        validateSocialEmail(normalizedEmail)
        val body = socialLoginBinding(codeVerifier).put("action", "mailbox_send")
            .put("attempt", attempt).put("email", normalizedEmail)
        requireCloudSocialMailboxSent(complete(authBaseUrl, body))
    }

    override suspend fun verifySocialMailboxCode(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        code: String
    ): CloudSocialLoginCompletion {
        validateSocialHandle(attempt)
        val normalizedCode = code.trim()
        validateSocialCode(normalizedCode)
        val body = socialLoginBinding(codeVerifier).put("action", "mailbox_verify")
            .put("attempt", attempt).put("code", normalizedCode)
        return parseCloudSocialLoginCompletion(complete(authBaseUrl, body))
    }

    override suspend fun redeemSocialLogin(
        authBaseUrl: String,
        completion: String,
        codeVerifier: String
    ): CloudSocialLoginSession {
        validateSocialHandle(completion)
        val body = socialLoginBinding(codeVerifier).put("action", "redeem").put("completion", completion)
        return parseCloudSocialLoginSession(complete(authBaseUrl, body))
    }

    private suspend fun complete(authBaseUrl: String, body: JSONObject): JSONObject {
        return httpClient.postJson(
            baseUrl = authBaseUrl,
            path = "/api/social/complete",
            authorizationHeader = null,
            body = body
        )
    }
}
