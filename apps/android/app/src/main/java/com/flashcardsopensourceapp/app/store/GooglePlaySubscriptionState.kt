package com.flashcardsopensourceapp.app.store

import com.android.billingclient.api.ProductDetails
import com.flashcardsopensourceapp.data.local.repository.billing.GoogleBillingIdentity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement

internal const val googlePlayPremiumProductId: String = "premium"
internal const val googlePlayPremiumBasePlanId: String = "monthly"
internal const val googlePlayPremiumTrialOfferId: String = "free-trial-7d"

data class GooglePlaySubscriptionPricingPhase(
    val formattedPrice: String,
    val priceAmountMicros: Long,
    val priceCurrencyCode: String,
    val billingPeriod: String,
    val billingCycleCount: Int,
    val recurrenceMode: Int
)

class GooglePlaySubscriptionOffer internal constructor(
    internal val productDetails: ProductDetails,
    internal val offerToken: String,
    val offerId: String?,
    val pricingPhases: List<GooglePlaySubscriptionPricingPhase>
)

sealed interface GooglePlaySubscriptionOfferState {
    data object NotLoaded : GooglePlaySubscriptionOfferState
    data object Loading : GooglePlaySubscriptionOfferState
    data object Unavailable : GooglePlaySubscriptionOfferState
    data class Available(val offer: GooglePlaySubscriptionOffer) : GooglePlaySubscriptionOfferState
    data class Failed(val failure: GooglePlaySubscriptionFailure) : GooglePlaySubscriptionOfferState
}

enum class GooglePlaySubscriptionFailure {
    STORE_UNAVAILABLE,
    OFFER_CHANGED,
    IDENTITY_CHANGED,
    VERIFICATION_FAILED,
    LOCAL_STORAGE_FAILED,
    PURCHASE_FAILED,
    ENTITLEMENT_NOT_GRANTED
}

sealed interface GooglePlaySubscriptionOperationState {
    data object Idle : GooglePlaySubscriptionOperationState
    data object Loading : GooglePlaySubscriptionOperationState
    data class Purchasing(val identity: GoogleBillingIdentity) : GooglePlaySubscriptionOperationState
    data class Pending(val identity: GoogleBillingIdentity) : GooglePlaySubscriptionOperationState
    data class Verifying(val identity: GoogleBillingIdentity) : GooglePlaySubscriptionOperationState
    data class Complete(val identity: GoogleBillingIdentity, val entitlement: CloudEntitlement) : GooglePlaySubscriptionOperationState
    data object NothingToRestore : GooglePlaySubscriptionOperationState
    data class Failed(val failure: GooglePlaySubscriptionFailure, val responseCode: Int?) : GooglePlaySubscriptionOperationState
}

internal fun selectGooglePlaySubscriptionOffer(details: ProductDetails): GooglePlaySubscriptionOffer? {
    val monthlyOffers = details.subscriptionOfferDetails.orEmpty().filter { offer ->
        offer.basePlanId == googlePlayPremiumBasePlanId
    }
    // Play only returns eligible subscription offers. Never infer eligibility from our account.
    val selected = monthlyOffers.firstOrNull { offer -> offer.offerId == googlePlayPremiumTrialOfferId }
        ?: monthlyOffers.firstOrNull { offer -> offer.offerId == null }
        ?: return null
    val phases = selected.pricingPhases.pricingPhaseList
    if (phases.isEmpty()) {
        return null
    }
    return GooglePlaySubscriptionOffer(
        productDetails = details,
        offerToken = selected.offerToken,
        offerId = selected.offerId,
        pricingPhases = phases.map { phase ->
            GooglePlaySubscriptionPricingPhase(
                formattedPrice = phase.formattedPrice,
                priceAmountMicros = phase.priceAmountMicros,
                priceCurrencyCode = phase.priceCurrencyCode,
                billingPeriod = phase.billingPeriod,
                billingCycleCount = phase.billingCycleCount,
                recurrenceMode = phase.recurrenceMode
            )
        }
    )
}
