package com.flashcardsopensourceapp.data.local.cloud.remote.auth

import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionAction
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionResponse

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudAccountMethods
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialChallenge
import com.flashcardsopensourceapp.data.local.cloud.wire.parseAccountAttempt
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialHandle
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialCode
import com.flashcardsopensourceapp.data.local.cloud.wire.parseAccountReceipt
import com.flashcardsopensourceapp.data.local.cloud.wire.accountBinding
import com.flashcardsopensourceapp.data.local.cloud.wire.accountProof
import com.flashcardsopensourceapp.data.local.cloud.wire.accountTarget
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialIdentityToken
import com.flashcardsopensourceapp.data.local.cloud.wire.requireAccountMutation
import com.flashcardsopensourceapp.data.local.cloud.wire.parseAccountProviderResult
import com.flashcardsopensourceapp.data.local.cloud.wire.validateSocialEmail
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudSocialMailboxSent
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodReceipt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodProof
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPurpose
import org.json.JSONObject

internal class CloudAccountMethodsRemoteApi(private val httpClient: CloudJsonHttpClient) : CloudAccountMethodsGateway {
    override suspend fun accountConnection(session: CloudAccountMethodSession, verifier: String, action: CloudConnectionAction): CloudConnectionResponse =
        com.flashcardsopensourceapp.data.local.cloud.wire.parseConnectionResponse(
            post(session, "/api/account/connection", com.flashcardsopensourceapp.data.local.cloud.wire.connectionBody(action, verifier)),
            session.authBaseUrl, action)

    override suspend fun loadAccountMethods(session: CloudAccountMethodSession): CloudAccountMethods =
        parseCloudAccountMethods(httpClient.getJson(session.authBaseUrl, "/api/account/login-methods?client=android", session.authorizationHeader))

    override suspend fun beginEmailReauthentication(session: CloudAccountMethodSession, codeChallenge: String): CloudAccountMethodAttempt {
        validateSocialChallenge(codeChallenge)
        return parseAccountAttempt(post(session, "/api/account/reauth/email", JSONObject().put("client", "android")
            .put("action", "begin").put("codeChallenge", codeChallenge)), null, session.authBaseUrl)
    }

    override suspend fun completeEmailReauthentication(session: CloudAccountMethodSession, attempt: String, codeVerifier: String, code: String): CloudAccountMethodReceipt {
        validateSocialHandle(attempt)
        validateSocialCode(code)
        return parseAccountReceipt(post(session, "/api/account/reauth/email", accountBinding(CloudAccountMethodPurpose.REAUTH, codeVerifier)
            .put("action", "complete").put("attempt", attempt).put("code", code)))
    }

    override suspend fun beginAccountProvider(session: CloudAccountMethodSession, provider: CloudSocialProvider, intent: CloudAccountMethodIntent,
        codeChallenge: String, proof: CloudAccountMethodProof?, target: CloudProviderMethodTarget?): CloudAccountMethodAttempt {
        require(intent != CloudAccountMethodIntent.UNLINK)
        validateSocialChallenge(codeChallenge)
        val body = JSONObject().put("client", "android").put("action", "begin")
            .put("purpose", if (intent == CloudAccountMethodIntent.REAUTH) "reauth" else "link")
            .put("provider", provider.name.lowercase(java.util.Locale.ROOT)).put("codeChallenge", codeChallenge)
        if (intent != CloudAccountMethodIntent.REAUTH) body.put("intent", intent.name.lowercase(java.util.Locale.ROOT))
            .put("proof", accountProof(requireNotNull(proof)))
        if (intent == CloudAccountMethodIntent.REENABLE) body.put("target", accountTarget(requireNotNull(target)))
        return parseAccountAttempt(post(session, "/api/account/provider-methods/link", body), provider, session.authBaseUrl)
    }

    override suspend fun submitAccountGoogle(session: CloudAccountMethodSession, intent: CloudAccountMethodIntent, attempt: String,
        codeVerifier: String, identityToken: String): CloudAccountMethodResult {
        validateSocialHandle(attempt)
        validateSocialIdentityToken(identityToken)
        val purpose = if (intent == CloudAccountMethodIntent.REAUTH) CloudAccountMethodPurpose.REAUTH else CloudAccountMethodPurpose.LINK
        val response = complete(session, accountBinding(purpose, codeVerifier).put("action",
            if (intent == CloudAccountMethodIntent.REENABLE) "reenable_provider" else "provider")
            .put("attempt", attempt).put("provider", "google").put("identityToken", identityToken))
        return if (intent == CloudAccountMethodIntent.REENABLE) {
            requireAccountMutation(response)
            CloudAccountMethodResult.Mutated
        } else parseAccountProviderResult(response)
    }

    override suspend fun sendAccountMailbox(session: CloudAccountMethodSession, purpose: CloudAccountMethodPurpose, attempt: String, codeVerifier: String, email: String) {
        validateSocialHandle(attempt)
        validateSocialEmail(email)
        requireCloudSocialMailboxSent(complete(session, accountBinding(purpose, codeVerifier).put("action", "mailbox_send")
            .put("attempt", attempt).put("email", email)))
    }

    override suspend fun verifyAccountMailbox(session: CloudAccountMethodSession, purpose: CloudAccountMethodPurpose, attempt: String, codeVerifier: String, code: String): CloudAccountMethodReceipt {
        validateSocialHandle(attempt)
        validateSocialCode(code)
        val response = complete(session, accountBinding(purpose, codeVerifier).put("action", "mailbox_verify").put("attempt", attempt).put("code", code))
        return (parseAccountProviderResult(response) as? CloudAccountMethodResult.Completed)?.receipt
            ?: throw CloudContractMismatchException("Mailbox verification did not return an account receipt.")
    }

    override suspend fun redeemAccountLink(session: CloudAccountMethodSession, completion: String, codeVerifier: String) {
        validateSocialHandle(completion)
        requireAccountMutation(complete(session, accountBinding(CloudAccountMethodPurpose.LINK, codeVerifier)
            .put("action", "redeem").put("completion", completion)))
    }

    override suspend fun resumeAppleReenable(session: CloudAccountMethodSession, attempt: String, codeVerifier: String) {
        validateSocialHandle(attempt)
        requireAccountMutation(complete(session, accountBinding(CloudAccountMethodPurpose.LINK, codeVerifier)
            .put("action", "resume_reenable").put("attempt", attempt)))
    }

    override suspend fun unlinkAccountProvider(session: CloudAccountMethodSession, target: CloudProviderMethodTarget, proof: CloudAccountMethodProof) {
        val result = post(session, "/api/account/provider-methods/unlink", JSONObject().put("client", "android")
            .put("target", accountTarget(target)).put("proof", accountProof(proof)))
        if (!result.requireCloudBoolean("ok", "account.unlink.ok")) throw CloudContractMismatchException("Account unlink did not succeed.")
    }

    private suspend fun complete(session: CloudAccountMethodSession, body: JSONObject): JSONObject = post(session, "/api/social/complete", body)
    private suspend fun post(session: CloudAccountMethodSession, path: String, body: JSONObject): JSONObject =
        httpClient.postJsonOnce(session.authBaseUrl, path, session.authorizationHeader, body)
}
