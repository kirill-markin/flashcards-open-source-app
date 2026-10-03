package com.flashcardsopensourceapp.app.store

import android.util.AtomicFile
import com.flashcardsopensourceapp.data.local.repository.billing.GoogleBillingAccount
import com.flashcardsopensourceapp.data.local.repository.billing.GoogleBillingIdentity
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.GooglePurchaseIntent
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

internal class GooglePlayPendingPurchase(
    val token: String,
    val identity: GoogleBillingIdentity,
    val intent: GooglePurchaseIntent
)

internal class GooglePlayPendingState(
    val launch: GoogleBillingAccount?,
    val pendingLaunchToken: String?,
    val purchases: List<GooglePlayPendingPurchase>
)

internal class GooglePlaySubscriptionStorageException : IllegalStateException(
    "Google Play purchase recovery could not be saved or read. Retry or use Restore."
)

// noBackupFilesDir prevents purchase tokens and an old install identity from migrating together.
internal class GooglePlaySubscriptionPendingStore(noBackupDirectory: File) {
    private val file = AtomicFile(File(noBackupDirectory, "google-play-subscription.json"))

    fun load(): GooglePlayPendingState {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) {
            return GooglePlayPendingState(launch = null, pendingLaunchToken = null, purchases = emptyList())
        }
        try {
            val json = JSONObject(file.readFully().toString(Charsets.UTF_8))
            val launch = if (json.isNull("launch")) null else json.getJSONObject("launch").let { value ->
                GoogleBillingAccount(identity = decodeIdentity(value), obfuscatedAccountId = value.getString("accountId"))
            }
            val purchases = json.getJSONArray("purchases")
            return GooglePlayPendingState(
                launch = launch,
                pendingLaunchToken = if (json.isNull("pendingLaunchToken")) null else json.getString("pendingLaunchToken"),
                purchases = List(purchases.length()) { index ->
                    val value = purchases.getJSONObject(index)
                    GooglePlayPendingPurchase(
                        token = value.getString("token"),
                        identity = decodeIdentity(value),
                        intent = GooglePurchaseIntent.valueOf(value.getString("intent"))
                    )
                }
            )
        } catch (error: Exception) {
            throw GooglePlaySubscriptionStorageException()
        }
    }

    fun save(state: GooglePlayPendingState) {
        val json = JSONObject()
            .put("launch", state.launch?.let { launch ->
                encodeIdentity(launch.identity).put("accountId", launch.obfuscatedAccountId)
            } ?: JSONObject.NULL)
            .put("pendingLaunchToken", state.pendingLaunchToken ?: JSONObject.NULL)
            .put("purchases", JSONArray().also { values ->
                state.purchases.forEach { purchase ->
                    values.put(encodeIdentity(purchase.identity).put("token", purchase.token).put("intent", purchase.intent.name))
                }
            })
        try {
            val stream = file.startWrite()
            try {
                stream.write(json.toString().toByteArray(Charsets.UTF_8))
                file.finishWrite(stream)
            } catch (error: Exception) {
                file.failWrite(stream)
                throw error
            }
        } catch (error: Exception) {
            throw GooglePlaySubscriptionStorageException()
        }
    }
}

private fun encodeIdentity(identity: GoogleBillingIdentity): JSONObject {
    return JSONObject().put("apiBaseUrl", identity.apiBaseUrl).put("userId", identity.userId)
}

private fun decodeIdentity(json: JSONObject): GoogleBillingIdentity {
    return GoogleBillingIdentity(apiBaseUrl = json.getString("apiBaseUrl"), userId = json.getString("userId"))
}
