package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.makeIdTokenExpiryTimestampMillis
import org.json.JSONObject

internal class CloudAuthRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        val normalizedEmail = email.trim().lowercase()
        val response = httpClient.postJson(
            baseUrl = authBaseUrl,
            path = "/api/send-code",
            authorizationHeader = null,
            body = JSONObject().put("email", normalizedEmail)
        )
        require(response.requireCloudBoolean("ok", "sendCode.ok")) {
            "Cloud send-code did not return ok=true."
        }

        val idToken = response.optCloudStringOrNull("idToken", "sendCode.idToken")
        val refreshToken = response.optCloudStringOrNull("refreshToken", "sendCode.refreshToken")
        val expiresIn = response.optCloudIntOrNull("expiresIn", "sendCode.expiresIn")
        if (idToken != null && refreshToken != null && expiresIn != null && expiresIn > 0) {
            return CloudSendCodeResult.Verified(
                credentials = buildStoredCloudCredentials(
                    refreshToken = refreshToken,
                    idToken = idToken,
                    expiresInSeconds = expiresIn
                )
            )
        }

        val csrfToken = response.requireCloudString("csrfToken", "sendCode.csrfToken")
        val otpSessionToken = response.requireCloudString("otpSessionToken", "sendCode.otpSessionToken")
        require(csrfToken.isNotBlank()) {
            "Cloud send-code response is missing csrfToken."
        }
        require(otpSessionToken.isNotBlank()) {
            "Cloud send-code response is missing otpSessionToken."
        }

        return CloudSendCodeResult.OtpRequired(
            challenge = CloudOtpChallenge(
                email = normalizedEmail,
                csrfToken = csrfToken,
                otpSessionToken = otpSessionToken
            )
        )
    }

    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials {
        val response = httpClient.postJson(
            baseUrl = authBaseUrl,
            path = "/api/verify-code",
            authorizationHeader = null,
            body = JSONObject()
                .put("code", code.trim())
                .put("csrfToken", challenge.csrfToken)
                .put("otpSessionToken", challenge.otpSessionToken)
        )
        require(response.requireCloudBoolean("ok", "verifyCode.ok")) {
            "Cloud verify-code did not return ok=true."
        }

        val refreshToken = response.requireCloudString("refreshToken", "verifyCode.refreshToken")
        val idToken = response.requireCloudString("idToken", "verifyCode.idToken")
        val expiresIn = response.requireCloudInt("expiresIn", "verifyCode.expiresIn")
        require(refreshToken.isNotBlank()) {
            "Cloud verify-code response is missing refreshToken."
        }
        require(idToken.isNotBlank()) {
            "Cloud verify-code response is missing idToken."
        }
        require(expiresIn > 0) {
            "Cloud verify-code response is missing expiresIn."
        }

        return buildStoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            expiresInSeconds = expiresIn
        )
    }

    suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        val response = httpClient.postJson(
            baseUrl = authBaseUrl,
            path = "/api/refresh-token",
            authorizationHeader = null,
            body = JSONObject().put("refreshToken", refreshToken)
        )
        require(response.requireCloudBoolean("ok", "refreshToken.ok")) {
            "Cloud refresh-token did not return ok=true."
        }

        val idToken = response.requireCloudString("idToken", "refreshToken.idToken")
        val expiresIn = response.requireCloudInt("expiresIn", "refreshToken.expiresIn")
        require(idToken.isNotBlank()) {
            "Cloud refresh-token response is missing idToken."
        }
        require(expiresIn > 0) {
            "Cloud refresh-token response is missing expiresIn."
        }

        return buildStoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            expiresInSeconds = expiresIn
        )
    }

    private fun buildStoredCloudCredentials(
        refreshToken: String,
        idToken: String,
        expiresInSeconds: Int
    ): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            idTokenExpiresAtMillis = makeIdTokenExpiryTimestampMillis(
                nowMillis = System.currentTimeMillis(),
                expiresInSeconds = expiresInSeconds
            )
        )
    }
}
