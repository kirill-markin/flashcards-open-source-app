package com.flashcardsopensourceapp.app.premium

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallEntryPoint
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.canUseLocalPremiumFeatures
import com.flashcardsopensourceapp.data.local.model.cloud.hasPremiumAccess
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState

internal sealed interface PremiumReason {
    /** Null only on the test-settings previews, which report no `paywall_shown`. */
    val paywallEntryPoint: AnalyticsPaywallEntryPoint?

    data class OfferPreview(override val paywallEntryPoint: AnalyticsPaywallEntryPoint?) : PremiumReason
    data class Feature(override val paywallEntryPoint: AnalyticsPaywallEntryPoint) : PremiumReason
    data object AiLimitPreview : PremiumReason {
        override val paywallEntryPoint: AnalyticsPaywallEntryPoint? = null
    }
    data class AiLimit(val refusal: AiAlertState.AiLimitReached) : PremiumReason {
        override val paywallEntryPoint: AnalyticsPaywallEntryPoint = AnalyticsPaywallEntryPoint.AI_LIMIT
    }
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
    private var identity: CloudSettings? = null
    private var onFeatureResult: ((PremiumResult) -> Unit)? = null

    fun updateIdentity(settings: CloudSettings) {
        val previous = identity
        identity = settings
        if (previous == null) return
        val isNewGuest = previous.linkedUserId == null && settings.cloudState == CloudAccountState.GUEST &&
            previous.installationId == settings.installationId
        if (!isNewGuest && (previous.linkedUserId != settings.linkedUserId ||
                previous.cloudState != settings.cloudState || previous.installationId != settings.installationId)
        ) {
            dismiss()
            entitlement = null
        }
    }

    fun showOfferPreview(paywallEntryPoint: AnalyticsPaywallEntryPoint?) {
        dismiss()
        reason = PremiumReason.OfferPreview(paywallEntryPoint = paywallEntryPoint)
    }

    fun showAiLimitPreview() {
        dismiss()
        reason = PremiumReason.AiLimitPreview
    }

    fun showAiLimit(refusal: AiAlertState.AiLimitReached) {
        dismiss()
        reason = PremiumReason.AiLimit(refusal = refusal)
    }

    fun requestFeature(paywallEntryPoint: AnalyticsPaywallEntryPoint, onResult: (PremiumResult) -> Unit) {
        dismiss()
        // Local features fail open while access is unknown; AI always waits for the server.
        if (canUseLocalPremiumFeatures(entitlement = entitlement)) {
            onResult(PremiumResult.ACCESS_GRANTED)
            return
        }
        onFeatureResult = onResult
        reason = PremiumReason.Feature(paywallEntryPoint = paywallEntryPoint)
    }

    fun updateEntitlement(value: CloudEntitlement?) {
        val previouslyHadAccess = hasPremiumAccess(entitlement = entitlement)
        val previouslyKnownFree = entitlement != null && !previouslyHadAccess
        if (value != null) {
            entitlement = value
        }
        val shouldReturnToAction = when (reason) {
            is PremiumReason.Feature -> true
            is PremiumReason.OfferPreview -> !previouslyHadAccess
            is PremiumReason.AiLimit -> previouslyKnownFree
            PremiumReason.AiLimitPreview, null -> false
        }
        if (hasPremiumAccess(entitlement = entitlement) && shouldReturnToAction) {
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
