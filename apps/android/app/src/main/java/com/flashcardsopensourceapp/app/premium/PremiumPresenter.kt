package com.flashcardsopensourceapp.app.premium

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlementStatus
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState

private const val premiumTierRank: Int = 20

internal sealed interface PremiumReason {
    data object OfferPreview : PremiumReason
    data object Feature : PremiumReason
    data object AiLimitPreview : PremiumReason
    data class AiLimit(val refusal: AiAlertState.AiLimitReached) : PremiumReason
}

internal enum class PremiumResult {
    ACCESS_GRANTED,
    DISMISSED
}

internal class PremiumPresenter {
    var reason: PremiumReason? by mutableStateOf(null)
        private set
    var entitlement: CloudEntitlement? by mutableStateOf(null)
        private set
    private var onFeatureResult: ((PremiumResult) -> Unit)? = null

    fun showOfferPreview() {
        dismiss()
        reason = PremiumReason.OfferPreview
    }

    fun showAiLimitPreview() {
        dismiss()
        reason = PremiumReason.AiLimitPreview
    }

    fun showAiLimit(refusal: AiAlertState.AiLimitReached) {
        dismiss()
        reason = PremiumReason.AiLimit(refusal = refusal)
    }

    fun requestFeature(onResult: (PremiumResult) -> Unit) {
        dismiss()
        // Local features fail open while access is unknown; AI always waits for the server.
        if (entitlement == null || hasPremiumAccess(entitlement = entitlement)) {
            onResult(PremiumResult.ACCESS_GRANTED)
            return
        }
        onFeatureResult = onResult
        reason = PremiumReason.Feature
    }

    fun updateEntitlement(value: CloudEntitlement?) {
        if (value != null) {
            entitlement = value
        }
        if (reason == PremiumReason.Feature && hasPremiumAccess(entitlement = entitlement)) {
            finish(result = PremiumResult.ACCESS_GRANTED)
        }
    }

    fun dismiss() {
        finish(result = PremiumResult.DISMISSED)
    }

    private fun finish(result: PremiumResult) {
        val continuation = onFeatureResult
        onFeatureResult = null
        reason = null
        continuation?.invoke(result)
    }
}

internal fun hasPremiumAccess(entitlement: CloudEntitlement?): Boolean {
    return entitlement != null && entitlement.tierRank >= premiumTierRank &&
        entitlement.status != CloudEntitlementStatus.NONE
}
