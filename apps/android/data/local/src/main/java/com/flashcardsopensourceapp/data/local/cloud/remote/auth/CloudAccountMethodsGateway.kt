package com.flashcardsopensourceapp.data.local.cloud.remote.auth

import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionAction
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionResponse

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodReceipt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodProof
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPurpose

data class CloudAccountMethodSession(val authBaseUrl: String, val authorizationHeader: String)

interface CloudAccountMethodsGateway {
    suspend fun accountConnection(session: CloudAccountMethodSession, verifier: String, action: CloudConnectionAction): CloudConnectionResponse
    suspend fun loadAccountMethods(session: CloudAccountMethodSession): CloudAccountMethods
    suspend fun beginEmailReauthentication(session: CloudAccountMethodSession, codeChallenge: String): CloudAccountMethodAttempt
    suspend fun completeEmailReauthentication(session: CloudAccountMethodSession, attempt: String, codeVerifier: String, code: String): CloudAccountMethodReceipt
    suspend fun beginAccountProvider(session: CloudAccountMethodSession, provider: CloudSocialProvider, intent: CloudAccountMethodIntent,
        codeChallenge: String, proof: CloudAccountMethodProof?, target: CloudProviderMethodTarget?): CloudAccountMethodAttempt
    suspend fun submitAccountGoogle(session: CloudAccountMethodSession, intent: CloudAccountMethodIntent, attempt: String,
        codeVerifier: String, identityToken: String): CloudAccountMethodResult
    suspend fun sendAccountMailbox(session: CloudAccountMethodSession, purpose: CloudAccountMethodPurpose, attempt: String, codeVerifier: String, email: String)
    suspend fun verifyAccountMailbox(session: CloudAccountMethodSession, purpose: CloudAccountMethodPurpose, attempt: String, codeVerifier: String, code: String): CloudAccountMethodReceipt
    suspend fun redeemAccountLink(session: CloudAccountMethodSession, completion: String, codeVerifier: String)
    suspend fun resumeAppleReenable(session: CloudAccountMethodSession, attempt: String, codeVerifier: String)
    suspend fun unlinkAccountProvider(session: CloudAccountMethodSession, target: CloudProviderMethodTarget, proof: CloudAccountMethodProof)
}
