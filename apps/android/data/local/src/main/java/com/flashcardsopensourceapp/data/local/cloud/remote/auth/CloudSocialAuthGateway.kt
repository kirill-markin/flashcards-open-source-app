package com.flashcardsopensourceapp.data.local.cloud.remote.auth

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAuthMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialCredentialResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialLoginSession

interface CloudSocialAuthGateway {
    suspend fun loadAuthMethods(authBaseUrl: String): CloudAuthMethods

    suspend fun beginGoogleLogin(authBaseUrl: String, codeChallenge: String): CloudSocialLoginAttempt

    suspend fun submitGoogleCredential(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        identityToken: String
    ): CloudSocialCredentialResult

    suspend fun requestSocialMailboxCode(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        email: String
    )

    suspend fun verifySocialMailboxCode(
        authBaseUrl: String,
        attempt: String,
        codeVerifier: String,
        code: String
    ): CloudSocialLoginCompletion

    suspend fun redeemSocialLogin(
        authBaseUrl: String,
        completion: String,
        codeVerifier: String
    ): CloudSocialLoginSession
}
