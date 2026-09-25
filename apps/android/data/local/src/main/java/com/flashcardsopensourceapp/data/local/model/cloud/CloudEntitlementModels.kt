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
