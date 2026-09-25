package com.flashcardsopensourceapp.data.local.cloud

import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.encodeCloudEntitlement
import com.flashcardsopensourceapp.data.local.cloud.wire.logUnreadableCloudEntitlement
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONException
import org.json.JSONObject

private const val entitlementKey: String = "entitlement"

/**
 * The last entitlement a sync pull delivered for the linked user. A pull without one leaves it in
 * place, because an absent entitlement means unknown and must downgrade nobody.
 */
internal class CloudEntitlementStore(
    private val metadataPreferences: SharedPreferences
) {
    private val entitlementState = MutableStateFlow(loadEntitlement())

    fun observeEntitlement(): StateFlow<CloudEntitlement?> {
        return entitlementState.asStateFlow()
    }

    fun saveEntitlement(entitlement: CloudEntitlement) {
        metadataPreferences.edit(commit = true) {
            putString(entitlementKey, encodeCloudEntitlement(entitlement = entitlement).toString())
        }
        entitlementState.value = entitlement
    }

    fun clearEntitlement() {
        metadataPreferences.edit(commit = true) {
            remove(entitlementKey)
        }
        entitlementState.value = null
    }

    private fun loadEntitlement(): CloudEntitlement? {
        val rawValue = metadataPreferences.getString(entitlementKey, null) ?: return null
        return try {
            parseCloudEntitlement(json = JSONObject(rawValue), fieldPath = "storedEntitlement")
        } catch (error: JSONException) {
            discardUnreadableEntitlement(error = error)
        } catch (error: CloudContractMismatchException) {
            discardUnreadableEntitlement(error = error)
        }
    }

    private fun discardUnreadableEntitlement(error: Exception): CloudEntitlement? {
        logUnreadableCloudEntitlement(source = "storedEntitlement", error = error)
        metadataPreferences.edit(commit = true) {
            remove(entitlementKey)
        }
        return null
    }
}
