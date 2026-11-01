package com.flashcardsopensourceapp.app.premium

import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallPresentation
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsReviewPaywallTrigger
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlementStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallImpression
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallState
import com.flashcardsopensourceapp.data.local.repository.billing.LocalPaywallRepository
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

internal class PremiumReviewScheduler(
    private val repository: LocalPaywallRepository,
    private val preferencesStore: CloudPreferencesStore,
    private val presenter: PremiumPresenter,
    appScope: CoroutineScope
) {
    var isAppAvailable: Boolean = false
    var isReviewSurfaceBusy: Boolean = true
    var isStoreReviewInProgress: Boolean = false
    private val synchronizationRequests = Channel<Unit>(Channel.CONFLATED)

    init {
        appScope.launch {
            synchronizationRequests.receiveAsFlow().collect {
                try {
                    repository.synchronize()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    reportFailure("paywall_state_sync_failed", error)
                }
            }
        }
    }

    /**
     * The account's latest showing of any review paywall, the shared clock of their cooldowns.
     * Paywalls opened elsewhere do not count, so this is not [CloudPaywallState.lastShownAt].
     */
    fun lastShownAt(): Instant? {
        val state = loadReviewPaywallState() ?: return null
        return listOfNotNull(state.introShownAt, state.followUpShownAt, state.periodicShownAt).maxOrNull()
    }

    /**
     * Shows this review paywall to a known free account. The first two are once per account; the
     * periodic one repeats. Each waits its config cooldown after the latest of the three.
     */
    fun tryShowReviewOffer(
        trigger: AnalyticsReviewPaywallTrigger,
        reviewPromptConfigVersion: String,
        canPresent: () -> Boolean
    ): Boolean {
        if (!canPresent()) return false
        val identity = repository.currentIdentity() ?: return false
        val entitlement = preferencesStore.observeEntitlement().value ?: return false
        if (entitlement.status != CloudEntitlementStatus.NONE || entitlement.isTrial) return false
        val state = loadReviewPaywallState() ?: return false
        val isDue = when (trigger) {
            AnalyticsReviewPaywallTrigger.INITIAL -> state.introShownAt == null
            AnalyticsReviewPaywallTrigger.DAY3 -> state.followUpShownAt == null
            AnalyticsReviewPaywallTrigger.WEEKLY -> true
        }
        requestSynchronization()
        if (!isDue) return false
        presenter.showReviewOffer(trigger, identity, reviewPromptConfigVersion)
        return true
    }

    private fun loadReviewPaywallState(): CloudPaywallState? {
        val identity = repository.currentIdentity() ?: return null
        return try {
            repository.state(identity)
        } catch (error: Exception) {
            reportFailure("review_paywall_evaluation_failed", error)
            null
        }
    }

    fun recordShown(presentation: AnalyticsPaywallPresentation, now: Instant, zone: ZoneId) {
        val identity = presenter.presentationIdentity ?: repository.currentIdentity()
            ?: throw IllegalStateException("Visible offer is missing an account identity.")
        repository.recordShown(identity, CloudPaywallImpression(
            presentationId = presentation.id,
            shownAt = now,
            localDate = now.atZone(zone).toLocalDate(),
            timeZone = zone.id,
            reviewTrigger = presenter.reviewTrigger
        ))
        requestSynchronization()
    }

    fun requestSynchronization() {
        check(synchronizationRequests.trySend(Unit).isSuccess) { "Paywall synchronization channel is closed." }
    }

    private fun reportFailure(event: String, error: Exception) {
        AiChatDiagnosticsLogger.warn(
            event = event,
            fields = listOf("errorType" to error::class.java.name)
        )
    }
}
