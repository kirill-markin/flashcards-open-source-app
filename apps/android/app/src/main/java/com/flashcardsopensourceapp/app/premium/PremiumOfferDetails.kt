package com.flashcardsopensourceapp.app.premium

import android.content.res.Resources
import com.android.billingclient.api.ProductDetails
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionOffer
import com.flashcardsopensourceapp.app.store.googlePlaySubscriptionOfferHasFreeTrial
import java.time.Period
import java.time.format.DateTimeParseException

internal data class PremiumOfferDetails(
    val phaseDescriptions: List<String>,
    val purchaseLabel: String,
    val renewalDescription: String
)

internal fun premiumOfferDetails(offer: GooglePlaySubscriptionOffer, resources: Resources): PremiumOfferDetails? {
    val phases = offer.pricingPhases
    val renewal = phases.lastOrNull() ?: return null
    if (renewal.recurrenceMode != ProductDetails.RecurrenceMode.INFINITE_RECURRING ||
        renewal.priceAmountMicros <= 0L
    ) {
        return null
    }
    val descriptions = mutableListOf<String>()
    for (phase in phases) {
        val period = formatOfferPeriod(phase.billingPeriod, resources) ?: return null
        val description = when (phase.recurrenceMode) {
            ProductDetails.RecurrenceMode.INFINITE_RECURRING -> resources.getString(
                R.string.premium_phase_recurring, phase.formattedPrice, period
            )
            ProductDetails.RecurrenceMode.FINITE_RECURRING -> {
                if (phase.billingCycleCount <= 0) return null
                if (phase.priceAmountMicros == 0L) {
                    resources.getString(
                        R.string.premium_phase_free,
                        formatOfferPeriodTotal(phase.billingPeriod, phase.billingCycleCount, resources) ?: return null
                    )
                } else {
                    resources.getQuantityString(
                        R.plurals.premium_phase_finite, phase.billingCycleCount,
                        phase.formattedPrice, period, phase.billingCycleCount
                    )
                }
            }
            ProductDetails.RecurrenceMode.NON_RECURRING -> resources.getString(
                R.string.premium_phase_once, phase.formattedPrice, period
            )
            else -> return null
        }
        descriptions.add(description)
    }
    val firstPhase = phases.first()
    val hasFreeTrial = googlePlaySubscriptionOfferHasFreeTrial(offer)
    val purchaseLabel = if (hasFreeTrial) {
        resources.getString(
            R.string.premium_start_trial,
            formatOfferPeriodTotal(firstPhase.billingPeriod, firstPhase.billingCycleCount, resources) ?: return null
        )
    } else {
        resources.getString(R.string.premium_subscribe, firstPhase.formattedPrice)
    }
    return PremiumOfferDetails(
        phaseDescriptions = descriptions,
        purchaseLabel = purchaseLabel,
        renewalDescription = resources.getString(
            if (hasFreeTrial) R.string.premium_trial_renewal_disclosure else R.string.premium_renewal_disclosure,
            renewal.formattedPrice,
            formatOfferPeriod(renewal.billingPeriod, resources) ?: return null
        )
    )
}

private fun formatOfferPeriod(value: String, resources: Resources): String? {
    return formatOfferPeriodTotal(value, 1, resources)
}

private fun formatOfferPeriodTotal(value: String, cycles: Int, resources: Resources): String? {
    val period = try {
        Period.parse(value).multipliedBy(cycles)
    } catch (_: DateTimeParseException) {
        return null
    } catch (_: ArithmeticException) {
        return null
    }
    if (period.isNegative || period.isZero) return null
    val components = listOf(
        period.years to R.plurals.premium_period_years,
        period.months to R.plurals.premium_period_months,
        period.days to R.plurals.premium_period_days
    ).filter { (amount, _) -> amount > 0 }
    // Play subscription periods have one unit; reject unsupported terms instead of guessing a price.
    val (amount, resourceId) = components.singleOrNull() ?: return null
    return resources.getQuantityString(resourceId, amount, amount)
}
