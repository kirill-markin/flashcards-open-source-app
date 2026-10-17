package com.flashcardsopensourceapp.data.local.cloud.wire

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionAction
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionBaseline
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionCommit
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionWorkspace
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import org.json.JSONArray
import org.json.JSONObject

internal fun connectionBody(action: CloudConnectionAction, verifier: String): JSONObject {
    val body = accountBinding(com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPurpose.REAUTH, verifier)
    body.remove("purpose")
    fun operation(value: String) { validateSocialHandle(value); body.put("operation", value) }
    when (action) {
        is CloudConnectionAction.Begin -> { validateSocialHandle(action.completion); body.put("action", "begin")
            .put("sourceCompletion", action.completion).put("capability", "canonical-account-v1") }
        is CloudConnectionAction.Adopt -> { validateSocialHandle(action.suggestion); body.put("action", "adopt")
            .put("suggestion", action.suggestion).put("capability", "canonical-account-v1") }
        is CloudConnectionAction.Load -> { operation(action.operation); body.put("action", "load") }
        is CloudConnectionAction.Cancel -> { operation(action.operation); body.put("action", "cancel") }
        is CloudConnectionAction.ProviderBegin -> { operation(action.operation); validateSocialChallenge(action.challenge)
            body.put("action", "provider_begin").put("provider", action.provider.name.lowercase(java.util.Locale.ROOT))
                .put("codeChallenge", action.challenge) }
        is CloudConnectionAction.GoogleComplete -> { operation(action.operation); validateSocialHandle(action.attempt)
            validateSocialIdentityToken(action.identityToken)
            body.put("action", "provider_complete").put("attempt", action.attempt).put("submission",
                JSONObject().put("provider", "google").put("identityToken", action.identityToken)) }
        is CloudConnectionAction.EmailSend -> { operation(action.operation); validateSocialEmail(action.email)
            body.put("action", "email_send").put("email", action.email) }
        is CloudConnectionAction.EmailVerify -> { operation(action.operation); validateSocialCode(action.code)
            body.put("action", "email_verify").put("code", action.code) }
        is CloudConnectionAction.Preview -> { operation(action.operation); body.put("action", "preview")
            .put("omittedWorkspaceIds", JSONArray(action.omittedWorkspaceIds)) }
        is CloudConnectionAction.Confirm -> { operation(action.operation); body.put("action", "confirm").put("accepted", true)
            .put("omittedWorkspaceIds", JSONArray(action.preview.omittedWorkspaceIds)).put("previewDigest", action.preview.digest) }
    }
    return body
}

internal fun parseConnectionResponse(json: JSONObject, authOrigin: String, action: CloudConnectionAction): CloudConnectionResponse {
    return when (val status = json.requireCloudString("status", "connection.status")) {
        "proof_required", "proved" -> {
            val receipt = json.requireCloudObject("receipt", "connection.receipt")
            val state = receipt.requireCloudString("state", "connection.receipt.state")
            connectionContract(state == if (status == "proved") "proved" else "collecting")
            receipt.requireCloudString("account", "connection.receipt.account")
            receipt.requireCloudNullableString("targetAccount", "connection.receipt.targetAccount")
            connectionContract(receipt.has("outcome") && receipt.isNull("outcome"))
            uuid(receipt.requireCloudString("operationId", "connection.operationId"))
            CloudConnectionResponse.Receipt(handle(receipt, "operation"),
                receipt.requireCloudIsoTimestampMillis("expiresAt", "connection.expiresAt"), status == "proved")
        }
        "provider_required" -> {
            val requested = action as? CloudConnectionAction.ProviderBegin ?: mismatch()
            val proof = json.requireCloudObject("proof", "connection.proof")
            val attempt = handle(proof, "attempt")
            val apple = requested.provider == CloudSocialProvider.APPLE
            val start = json.requireCloudNullableString("browserStart", "connection.browserStart")
            val expected = if (apple) "/api/account/connection/provider-start?operation=" + requested.operation + "&attempt=" + attempt else null
            connectionContract(start == expected)
            connectionContract(authOrigin in setOf("https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"))
            connectionContract(proof.requireCloudNullableString("redirectUri", "connection.redirectUri") ==
                if (apple) "$authOrigin/api/social/apple/callback" else null)
            val nonce = proof.requireCloudString("nonce", "connection.nonce")
            connectionContract(Regex(if (apple) "^[a-f0-9]{64}$" else "^[A-Za-z0-9_-]{43}$").matches(nonce))
            handle(proof, "providerCodeChallenge")
            CloudConnectionResponse.Provider(CloudAccountMethodAttempt(attempt, nonce,
                proof.requireCloudIsoTimestampMillis("expiresAt", "connection.expiresAt"), start))
        }
        "email_required" -> CloudConnectionResponse.Email(
            json.requireCloudString("email", "connection.email").also(::validateSocialEmail),
            json.requireCloudIsoTimestampMillis("expiresAt", "connection.expiresAt"))
        "preview" -> CloudConnectionResponse.Preview(handle(json, "operation"), parseConnectionPreview(json))
        "connected" -> {
            val result = json.requireCloudObject("result", "connection.result")
            val id = uuid(json.requireCloudString("operationId", "connection.operationId"))
            connectionContract(id == uuid(result.requireCloudString("operationId", "connection.result.operationId")))
            CloudConnectionResponse.Connected(CloudConnectionCommit(id,
                result.requireCloudString("sourceUserId", "connection.sourceUserId"),
                result.requireCloudString("canonicalAccountId", "connection.canonicalAccountId"),
                uuid(result.requireCloudString("selectedWorkspaceId", "connection.selectedWorkspaceId")),
                ids(result, "workspaceIds"), ids(result, "suppressedWorkspaceIds")))
        }
        "already_connected" -> CloudConnectionResponse.AlreadyConnected(handle(json, "operation"))
        "cancelled" -> CloudConnectionResponse.Cancelled(handle(json, "operation"))
        else -> mismatch()
    }
}

private fun parseConnectionPreview(json: JSONObject): CloudConnectionPreview {
    val consequences = json.requireCloudObject("consequences", "connection.consequences")
    mapOf("data" to "retained", "memberships" to "union_with_owner_precedence",
        "integrations" to "credentials_keep_ids_and_follow_canonical_account",
        "billing" to "purchases_grants_and_usage_follow_canonical_account",
        "subscriptions" to "provider_subscriptions_unchanged", "trials" to "original_trial_history_retained",
        "primaryEmail" to "retain_genuine_primary_or_use_proved_usable_real_email").forEach { (key, expected) ->
        connectionContract(consequences.requireCloudString(key, "connection.consequences.$key") == expected)
    }
    val choices = json.requireCloudObject("choices", "connection.choices")
    val preview = choices.requireCloudObject("preview", "connection.preview")
    connectionContract(preview.requireCloudString("settingsPolicy", "connection.settingsPolicy") == "target_with_restrictive_privacy")
    connectionContract(preview.requireCloudString("publicProfilePolicy", "connection.publicProfilePolicy") == "target_with_restrictive_visibility")
    val baselines = choices.requireCloudObject("historicalBaselines", "connection.historicalBaselines")
    val historical = baselines.keys().asSequence().associate { key ->
        val value = baselines.requireCloudObject(key, "connection.baseline")
        uuid(key) to CloudConnectionBaseline(value.requireCloudString("workspace", "connection.baseline.workspace"),
            value.requireCloudString("cards", "connection.baseline.cards"))
    }
    val rows = preview.requireCloudArray("workspaces", "connection.workspaces")
    val workspaces = (0 until rows.length()).map { index ->
        val row = rows.get(index) as? JSONObject ?: mismatch()
        val workspace = row.requireCloudObject("workspace", "connection.workspace")
        CloudConnectionWorkspace(uuid(workspace.requireCloudString("workspace_id", "connection.workspace_id")),
            workspace.requireCloudString("name", "connection.name"), workspace.requireCloudString("creation_origin", "connection.creation_origin"),
            row.requireCloudBoolean("unusedStarter", "connection.unusedStarter"),
            workspace.requireCloudNullableString("starter_suppressed_at", "connection.starter_suppressed_at") != null)
    }
    val digest = choices.requireCloudString("digest", "connection.digest")
    connectionContract(Regex("^[a-f0-9]{64}$").matches(digest))
    val omitted = ids(choices, "omittedWorkspaceIds")
    connectionContract(historical.keys == omitted.toSet())
    val retained = ids(preview, "workspaceIds")
    val suppressed = ids(preview, "suppressedWorkspaceIds")
    val selected = uuid(preview.requireCloudString("selectedWorkspaceId", "connection.selectedWorkspaceId"))
    val candidates = ids(json, "omissionCandidateWorkspaceIds")
    connectionContract(workspaces.map { it.id }.distinct().size == workspaces.size &&
        retained.distinct().size == retained.size && selected in retained &&
        retained.all { id -> workspaces.any { it.id == id } } &&
        suppressed.all { id -> workspaces.any { it.id == id } } &&
        candidates.distinct().size == candidates.size && candidates.all { id -> workspaces.any { it.id == id } })
    return CloudConnectionPreview(uuid(choices.requireCloudString("operationId", "connection.operationId")), digest,
        omitted, historical, workspaces, retained, suppressed, selected, candidates)
}

private fun handle(json: JSONObject, key: String): String = json.requireCloudString(key, "connection.$key").also(::validateSocialHandle)
private fun ids(json: JSONObject, key: String): List<String> =
    json.requireCloudArray(key, "connection.$key").toCloudStringList("connection.$key").map(::uuid)
private fun uuid(value: String): String {
    connectionContract(Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").matches(value))
    return value
}
private fun connectionContract(condition: Boolean) { if (!condition) mismatch() }
private fun mismatch(): Nothing = throw CloudContractMismatchException("Account connection response does not match the supported contract.")
