package com.flashcardsopensourceapp.data.local.cloud.wire

import android.util.Log
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlementStatus
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import org.json.JSONObject

/*
 Keep aligned with `EntitlementWire` in apps/backend/src/billing/snapshot.ts.
 The stored copy uses the same field names, so one decoder reads both.
 */

private const val entitlementLogTag: String = "FlashcardsEntitlement"

internal fun parseCloudEntitlement(json: JSONObject, fieldPath: String): CloudEntitlement {
    return CloudEntitlement(
        tierRank = json.requireCloudInt("tierRank", "$fieldPath.tierRank"),
        tierDisplayName = json.requireCloudString("tierDisplayName", "$fieldPath.tierDisplayName"),
        status = parseCloudEntitlementStatus(
            rawValue = json.requireCloudString("status", "$fieldPath.status"),
            fieldPath = "$fieldPath.status"
        ),
        untilMillis = json.requireCloudNullableIsoTimestampMillis("until", "$fieldPath.until"),
        isTrial = json.requireCloudBoolean("isTrial", "$fieldPath.isTrial"),
        willRenew = json.requireCloudBoolean("willRenew", "$fieldPath.willRenew")
    )
}

/**
 * A billing-data problem must never cost a person their access or their sync, so an unreadable
 * entitlement is logged and then treated as absent: docs/premium-entitlements.md, "What a client receives".
 */
internal fun logUnreadableCloudEntitlement(source: String, error: Exception) {
    Log.w(entitlementLogTag, "event=unreadableEntitlement source=$source reason=${error.message}", error)
}

internal fun encodeCloudEntitlement(entitlement: CloudEntitlement): JSONObject {
    return JSONObject()
        .put("tierRank", entitlement.tierRank)
        .put("tierDisplayName", entitlement.tierDisplayName)
        .put("status", cloudEntitlementStatusWireValue(status = entitlement.status))
        .putNullableString(key = "until", value = entitlement.untilMillis?.let(::formatIsoTimestamp))
        .put("isTrial", entitlement.isTrial)
        .put("willRenew", entitlement.willRenew)
}

private fun parseCloudEntitlementStatus(rawValue: String, fieldPath: String): CloudEntitlementStatus {
    return when (rawValue) {
        "none" -> CloudEntitlementStatus.NONE
        "active" -> CloudEntitlementStatus.ACTIVE
        "in_grace" -> CloudEntitlementStatus.IN_GRACE
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [none, active, in_grace], got invalid string \"$rawValue\""
        )
    }
}

private fun cloudEntitlementStatusWireValue(status: CloudEntitlementStatus): String {
    return when (status) {
        CloudEntitlementStatus.NONE -> "none"
        CloudEntitlementStatus.ACTIVE -> "active"
        CloudEntitlementStatus.IN_GRACE -> "in_grace"
    }
}
