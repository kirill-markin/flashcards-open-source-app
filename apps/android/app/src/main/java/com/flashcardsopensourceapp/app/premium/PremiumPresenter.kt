package com.flashcardsopensourceapp.app.premium

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallEntryPoint
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallPresentation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.canUseLocalPremiumFeatures
import com.flashcardsopensourceapp.data.local.model.cloud.hasPremiumAccess
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsReviewPaywallTrigger
import java.util.UUID

internal sealed interface PremiumReason {
    val paywallEntryPoint: AnalyticsPaywallEntryPoint?

    data class OfferPreview(override val paywallEntryPoint: AnalyticsPaywallEntryPoint) : PremiumReason
    data object TestOfferPreview : PremiumReason {
        override val paywallEntryPoint: AnalyticsPaywallEntryPoint? = null
    }
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

internal class PremiumPresenter(private val accountIdentityProvider: () -> String?) {
    var reason: PremiumReason? by mutableStateOf(null)
        private set
    var presentation: AnalyticsPaywallPresentation? by mutableStateOf(null)
        private set
    var entitlement: CloudEntitlement? by mutableStateOf(null)
        private set
    var hasReportedShown: Boolean = false
        private set
    var reviewTrigger: AnalyticsReviewPaywallTrigger? = null
        private set
    var reviewPromptConfigVersion: String? = null
        private set
    var presentationIdentity: String? = null
        private set
    private var identity: CloudSettings? = null
    private var onFeatureResult: ((PremiumResult) -> Unit)? = null

    fun updateIdentity(settings: CloudSettings) {
        val previous = identity
        identity = settings
        if (previous == null) return
        val isNewGuest = previous.linkedUserId == null && settings.cloudState == CloudAccountState.GUEST &&
            previous.installationId == settings.installationId
        if (isNewGuest) {
            presentationIdentity = accountIdentityProvider()
        }
        if (!isNewGuest && (previous.linkedUserId != settings.linkedUserId ||
                previous.cloudState != settings.cloudState || previous.installationId != settings.installationId)
        ) {
            dismiss()
            entitlement = null
        }
    }

    fun showOfferPreview(paywallEntryPoint: AnalyticsPaywallEntryPoint?) {
        dismiss()
        presentationIdentity = accountIdentityProvider()
        presentation = paywallEntryPoint?.let { AnalyticsPaywallPresentation(UUID.randomUUID().toString(), it) }
        reason = paywallEntryPoint?.let { PremiumReason.OfferPreview(paywallEntryPoint = it) }
            ?: PremiumReason.TestOfferPreview
    }

    fun showReviewOffer(
        trigger: AnalyticsReviewPaywallTrigger,
        accountIdentity: String,
        reviewPromptConfigVersion: String
    ) {
        if (reason != null) return
        presentationIdentity = accountIdentity
        reviewTrigger = trigger
        this.reviewPromptConfigVersion = reviewPromptConfigVersion
        presentation = AnalyticsPaywallPresentation(UUID.randomUUID().toString(), AnalyticsPaywallEntryPoint.REVIEW)
        reason = PremiumReason.OfferPreview(AnalyticsPaywallEntryPoint.REVIEW)
    }

    fun showAiLimitPreview() {
        dismiss()
        reason = PremiumReason.AiLimitPreview
    }

    fun showAiLimit(refusal: AiAlertState.AiLimitReached) {
        dismiss()
        presentationIdentity = accountIdentityProvider()
        presentation = AnalyticsPaywallPresentation(UUID.randomUUID().toString(), AnalyticsPaywallEntryPoint.AI_LIMIT)
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
        presentationIdentity = accountIdentityProvider()
        presentation = AnalyticsPaywallPresentation(UUID.randomUUID().toString(), paywallEntryPoint)
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
            PremiumReason.TestOfferPreview, PremiumReason.AiLimitPreview, null -> false
        }
        if (hasPremiumAccess(entitlement = entitlement) && shouldReturnToAction) {
            finish(result = PremiumResult.ACCESS_GRANTED)
        }
    }

    fun markVisible(presentationId: String) {
        check(presentation?.id == presentationId) { "Paywall presentation changed before visibility recording." }
        hasReportedShown = true
    }

    fun dismiss() {
        finish(result = PremiumResult.DISMISSED)
    }

    private fun finish(result: PremiumResult) {
        val continuation = onFeatureResult
        onFeatureResult = null
        reason = null
        presentation = null
        hasReportedShown = false
        presentationIdentity = null
        reviewTrigger = null
        reviewPromptConfigVersion = null
        continuation?.invoke(result)
    }
}
