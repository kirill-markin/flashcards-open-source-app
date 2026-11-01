package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.util.Log
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.applyCloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.emptyCloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.mergeCloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.parseCloudPaywallState
import com.flashcardsopensourceapp.data.local.model.cloud.parseCloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.toJson
import org.json.JSONArray
import org.json.JSONObject

fun paywallIdentity(settings: CloudSettings, apiBaseUrl: String): String? {
    if (settings.cloudState == CloudAccountState.LINKING_READY) return null
    val account = settings.linkedUserId?.let { "user:$it" }
        ?: settings.installationId.takeIf { it.isNotBlank() }?.let { "installation:$it" }
        ?: return null
    return "$apiBaseUrl|$account"
}

class PaywallStateStore(context: Context) {
    private val preferences = context.getSharedPreferences("paywall_state", Context.MODE_PRIVATE)

    @Synchronized
    fun updateIdentity(settings: CloudSettings, apiBaseUrl: String) {
        val nextKey = paywallIdentity(settings, apiBaseUrl) ?: return
        val previousKey = preferences.getString("identity", null)
        if (previousKey != null && previousKey != nextKey &&
            ((preferences.getString("accountKind", null) == CloudAccountState.GUEST.name &&
                settings.cloudState == CloudAccountState.LINKED) ||
                preferences.getString("accountKind", null) == CloudAccountState.DISCONNECTED.name) &&
            preferences.getString("installationId", null) == settings.installationId &&
            preferences.getString("apiBaseUrl", null) == apiBaseUrl
        ) {
            val combined = mergeCloudPaywallState(loadState(previousKey), loadState(nextKey))
            val pending = (loadPending(previousKey) + loadPending(nextKey)).distinctBy { it.presentationId }
            save(nextKey, combined, pending)
            check(preferences.edit().remove("state:$previousKey").remove("pending:$previousKey").commit()) {
                "Could not remove upgraded guest paywall state."
            }
        }
        check(preferences.edit().putString("identity", nextKey)
            .putString("accountKind", settings.cloudState.name).putString("apiBaseUrl", apiBaseUrl)
            .putString("installationId", settings.installationId).commit()) {
            "Could not persist paywall account identity."
        }
    }

    @Synchronized
    fun state(identity: String): CloudPaywallState = loadState(identity)

    @Synchronized
    fun record(identity: String, impression: CloudPaywallImpression) {
        val pending = loadPending(identity)
        if (pending.any { it.presentationId == impression.presentationId }) return
        save(identity, applyCloudPaywallImpression(loadState(identity), impression), pending + impression)
    }

    @Synchronized
    fun pending(identity: String): List<CloudPaywallImpression> = loadPending(identity)

    @Synchronized
    fun merge(identity: String, server: CloudPaywallState, acknowledgedId: String?) {
        val pending = loadPending(identity).filter { it.presentationId != acknowledgedId }
        val merged = pending.fold(mergeCloudPaywallState(loadState(identity), server), ::applyCloudPaywallImpression)
        save(identity, merged, pending)
    }

    @Synchronized
    fun clearForIdentityReset() {
        val identity = preferences.getString("identity", null)
        if (identity != null && preferences.getString("pending:$identity", "[]") != "[]") {
            Log.w("PaywallState", "event=paywall_pending_discarded reason=explicit_identity_reset")
        }
        if (!preferences.edit().clear().commit()) {
            Log.e("PaywallState", "event=paywall_state_clear_failed reason=identity_reset_storage_failure")
        }
    }

    private fun loadState(identity: String): CloudPaywallState = preferences.getString("state:$identity", null)
        ?.let { stored ->
            // State saved by app versions before periodicShownAt lacks the key; the server starts them at null too.
            val json = JSONObject(stored)
            if (!json.has("periodicShownAt")) json.put("periodicShownAt", JSONObject.NULL)
            parseCloudPaywallState(json)
        } ?: emptyCloudPaywallState

    private fun loadPending(identity: String): List<CloudPaywallImpression> {
        val json = JSONArray(preferences.getString("pending:$identity", "[]"))
        return List(json.length()) { parseCloudPaywallImpression(json.getJSONObject(it)) }
    }

    private fun save(identity: String, state: CloudPaywallState, pending: List<CloudPaywallImpression>) {
        val json = JSONArray()
        pending.forEach { json.put(it.toJson()) }
        check(preferences.edit().putString("state:$identity", state.toJson().toString())
            .putString("pending:$identity", json.toString()).commit()) {
            "Could not persist paywall impressions."
        }
    }
}
