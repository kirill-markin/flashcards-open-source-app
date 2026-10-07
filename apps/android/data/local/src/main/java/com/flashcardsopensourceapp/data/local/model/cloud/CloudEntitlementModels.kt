package com.flashcardsopensourceapp.data.local.model.cloud

enum class CloudEntitlementStatus {
    NONE,
    ACTIVE,
    IN_GRACE
}

/**
 * What the backend resolved for the person, as the sync pull delivers it. Read [status] before
 * [untilMillis]: docs/premium-entitlements.md, "What a client receives".
 */
data class CloudEntitlement(
    val tierRank: Int,
    val tierDisplayName: String,
    val status: CloudEntitlementStatus,
    val untilMillis: Long?,
    val isTrial: Boolean,
    val willRenew: Boolean
)

private const val premiumTierRank: Int = 20

fun hasPremiumAccess(entitlement: CloudEntitlement?): Boolean {
    return entitlement != null && entitlement.tierRank >= premiumTierRank &&
        entitlement.status != CloudEntitlementStatus.NONE
}

/** Local premium features fail open while access is unknown: docs/premium-entitlements.md, "Offline behaviour". */
fun canUseLocalPremiumFeatures(entitlement: CloudEntitlement?): Boolean {
    return entitlement == null || hasPremiumAccess(entitlement = entitlement)
}
