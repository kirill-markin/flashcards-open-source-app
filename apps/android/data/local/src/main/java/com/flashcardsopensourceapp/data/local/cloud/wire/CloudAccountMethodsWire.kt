package com.flashcardsopensourceapp.data.local.cloud.wire

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethods
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountProviderMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudProviderMethodTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodReceipt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPurpose
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodProof
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialMailboxReason
import org.json.JSONObject

internal fun parseCloudAccountMethods(json: JSONObject): CloudAccountMethods {
    accountContract(json.requireCloudString("emailRecovery", "account.emailRecovery") == "read_only", "emailRecovery")
    accountContract(json.has("csrfToken") && json.isNull("csrfToken"), "csrfToken")
    val methods = json.requireCloudArray("methods", "account.methods")
    val parsed = (0 until methods.length()).map { index ->
        val row = methods.get(index) as? JSONObject ?: throw CloudContractMismatchException("Account method must be an object.")
        val provider = when (row.requireCloudString("provider", "account.provider")) {
            "apple" -> CloudSocialProvider.APPLE
            "google" -> CloudSocialProvider.GOOGLE
            else -> throw CloudContractMismatchException("Unsupported account provider.")
        }
        val subject = row.requireCloudString("providerSubject", "account.providerSubject")
        val generation = row.requireCloudString("generation", "account.generation")
        accountContract(subject.length in 1..255 && generation.length in 1..64, "target")
        val status = row.requireCloudString("status", "account.status")
        accountContract(status == "active" || status == "disabled", "status")
        CloudAccountProviderMethod(CloudProviderMethodTarget(provider, subject, generation), status == "active",
            row.requireCloudBoolean("revocationPending", "account.revocationPending"))
    }
    val emails = json.requireCloudArray("verifiedRecoveryEmails", "account.verifiedRecoveryEmails")
        .toCloudStringList("account.verifiedRecoveryEmails")
    emails.forEach(::validateSocialEmail)
    accountContract(parsed.map { it.target.provider to it.target.providerSubject }.distinct().size == parsed.size, "methods")
    return CloudAccountMethods(parsed, emails)
}

internal fun parseAccountAttempt(json: JSONObject, provider: CloudSocialProvider?, expectedAuthOrigin: String): CloudAccountMethodAttempt {
    val handle = accountHandle(json, "attempt")
    val nonce = if (provider == null) null else json.requireCloudString("nonce", "account.nonce").also {
        accountContract(if (provider == CloudSocialProvider.APPLE) Regex("^[a-f0-9]{64}$").matches(it)
            else Regex("^[A-Za-z0-9_-]{43}$").matches(it), "nonce")
    }
    val browserStart = if (provider == null) null else json.requireCloudNullableString("browserStart", "account.browserStart")
    if (provider != null) {
        accountHandle(json, "providerCodeChallenge")
        val redirect = json.requireCloudNullableString("redirectUri", "account.redirectUri")
        if (provider == CloudSocialProvider.APPLE) accountContract(expectedAuthOrigin in setOf(
            "https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"), "authOrigin")
        accountContract(redirect == if (provider == CloudSocialProvider.APPLE)
            "$expectedAuthOrigin/api/social/apple/callback" else null, "redirectUri")
        accountContract(browserStart == if (provider == CloudSocialProvider.APPLE)
            "/api/social/apple/start?client=android&attempt=$handle" else null, "browserStart")
    }
    return CloudAccountMethodAttempt(handle, nonce, json.requireCloudIsoTimestampMillis("expiresAt", "account.expiresAt"), browserStart)
}

internal fun parseAccountReceipt(json: JSONObject): CloudAccountMethodReceipt {
    return CloudAccountMethodReceipt(accountHandle(json, "completion"), json.requireCloudIsoTimestampMillis("expiresAt", "account.expiresAt"))
}

internal fun parseAccountProviderResult(json: JSONObject): CloudAccountMethodResult {
    return when (json.requireCloudString("status", "account.status")) {
        "completed" -> CloudAccountMethodResult.Completed(parseAccountReceipt(json))
        "verification_required" -> {
            val reason = when (json.requireCloudString("reason", "account.reason")) {
                "mailbox_required" -> CloudSocialMailboxReason.MAILBOX_REQUIRED
                "existing_email" -> CloudSocialMailboxReason.EXISTING_EMAIL
                "historical_binding" -> CloudSocialMailboxReason.HISTORICAL_BINDING
                else -> throw CloudContractMismatchException("Unsupported account mailbox reason.")
            }
            val email = json.requireCloudNullableString("providerEmail", "account.providerEmail")
            email?.let(::validateSocialEmail)
            accountContract(reason != CloudSocialMailboxReason.EXISTING_EMAIL || email != null, "providerEmail")
            CloudAccountMethodResult.Mailbox(reason, email)
        }
        else -> throw CloudContractMismatchException("Unsupported account provider result.")
    }
}

internal fun accountBinding(purpose: CloudAccountMethodPurpose, verifier: String): JSONObject {
    require(Regex("^[A-Za-z0-9._~-]{43,128}$").matches(verifier)) { "Account proof requires a valid PKCE verifier." }
    return JSONObject().put("client", "android").put("purpose", purpose.name.lowercase(java.util.Locale.ROOT)).put("codeVerifier", verifier)
}

internal fun accountProof(proof: CloudAccountMethodProof): JSONObject {
    validateSocialHandle(proof.receipt.completion)
    return accountBinding(CloudAccountMethodPurpose.REAUTH, proof.codeVerifier).put("completion", proof.receipt.completion)
}

internal fun accountTarget(target: CloudProviderMethodTarget): JSONObject {
    require(target.providerSubject.length in 1..255 && target.generation.length in 1..64) { "Account provider target is invalid." }
    // generation is an opaque PostgreSQL text value, including its original precision and spaces.
    return JSONObject().put("provider", target.provider.name.lowercase(java.util.Locale.ROOT))
        .put("providerSubject", target.providerSubject).put("generation", target.generation)
}

internal fun requireAccountMutation(json: JSONObject) {
    accountContract(json.requireCloudBoolean("ok", "account.ok") && json.requireCloudString("purpose", "account.purpose") == "link", "mutation")
}

private fun accountHandle(json: JSONObject, key: String): String {
    return json.requireCloudString(key, "account.$key").also(::validateSocialHandle)
}

private fun accountContract(condition: Boolean, field: String) {
    if (!condition) throw CloudContractMismatchException("Cloud account methods contract mismatch for $field.")
}
