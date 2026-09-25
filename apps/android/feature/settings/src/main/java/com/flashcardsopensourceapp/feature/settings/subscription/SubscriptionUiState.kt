package com.flashcardsopensourceapp.feature.settings.subscription

import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlementStatus
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

data class SubscriptionUiState(
    /** Settings shows the entry only once Google Play returns the subscription product. */
    val isSubscriptionProductAvailable: Boolean,
    /** Null until a sync pull has delivered an entitlement. */
    val planName: String?,
    val statusText: String
)

/**
 * Renders what the backend resolved and nothing more: [CloudEntitlement.status] is read before
 * [CloudEntitlement.untilMillis], because a missing end means something different under each status
 * (docs/premium-entitlements.md, "What a client receives").
 */
internal fun makeSubscriptionUiState(
    entitlement: CloudEntitlement?,
    isSubscriptionProductAvailable: Boolean,
    strings: SettingsStringResolver
): SubscriptionUiState {
    if (entitlement == null) {
        return SubscriptionUiState(
            isSubscriptionProductAvailable = isSubscriptionProductAvailable,
            planName = null,
            statusText = strings.get(R.string.settings_subscription_status_unknown)
        )
    }

    val statusText: String = subscriptionStatusText(entitlement = entitlement, strings = strings)
    return SubscriptionUiState(
        isSubscriptionProductAvailable = isSubscriptionProductAvailable,
        planName = entitlement.tierDisplayName,
        statusText = if (entitlement.isTrial) {
            strings.get(R.string.settings_subscription_status_trial_format, statusText)
        } else {
            statusText
        }
    )
}

private fun subscriptionStatusText(entitlement: CloudEntitlement, strings: SettingsStringResolver): String {
    val untilMillis: Long? = entitlement.untilMillis
    return when (entitlement.status) {
        CloudEntitlementStatus.NONE -> strings.get(R.string.settings_subscription_status_none)
        CloudEntitlementStatus.ACTIVE -> when {
            untilMillis == null -> strings.get(R.string.settings_subscription_status_active_without_end)
            entitlement.willRenew -> strings.get(
                R.string.settings_subscription_status_active_renews,
                formatSubscriptionDate(untilMillis = untilMillis, strings = strings)
            )

            else -> strings.get(
                R.string.settings_subscription_status_active_ends,
                formatSubscriptionDate(untilMillis = untilMillis, strings = strings)
            )
        }

        // A grace period without a known end is never shown as unlimited access.
        CloudEntitlementStatus.IN_GRACE -> if (untilMillis == null) {
            strings.get(R.string.settings_subscription_status_in_grace_end_unknown)
        } else {
            strings.get(
                R.string.settings_subscription_status_in_grace_until,
                formatSubscriptionDate(untilMillis = untilMillis, strings = strings)
            )
        }
    }
}

private fun formatSubscriptionDate(untilMillis: Long, strings: SettingsStringResolver): String {
    return DateTimeFormatter
        .ofLocalizedDate(FormatStyle.MEDIUM)
        .withLocale(strings.locale())
        .format(Instant.ofEpochMilli(untilMillis).atZone(ZoneId.systemDefault()))
}
