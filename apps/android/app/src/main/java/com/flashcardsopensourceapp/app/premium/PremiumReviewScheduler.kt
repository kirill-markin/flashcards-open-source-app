package com.flashcardsopensourceapp.app.premium

import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallPresentation
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsReviewPaywallTrigger
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlementStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPaywallImpression
import com.flashcardsopensourceapp.data.local.repository.billing.LocalPaywallRepository
import java.time.Duration
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
    private val reviewLogDao: ReviewLogDao,
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

    suspend fun consumeReviewOpportunity(): Boolean {
        return try {
            consumeAvailableReviewOpportunity()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            reportFailure("review_paywall_evaluation_failed", error)
            true
        }
    }

    private suspend fun consumeAvailableReviewOpportunity(): Boolean {
        if (!isAppAvailable || isReviewSurfaceBusy || isStoreReviewInProgress || presenter.reason != null) return true
        val identity = repository.currentIdentity() ?: return false
        val entitlement = preferencesStore.observeEntitlement().value ?: return false
        if (entitlement.status != CloudEntitlementStatus.NONE || entitlement.isTrial) return false
        val zone = ZoneId.systemDefault()
        val now = Instant.now()
        val date = now.atZone(zone).toLocalDate()
        val total = reviewLogDao.countReviewLogs()
        val today = reviewLogDao.countReviewLogsBetween(
            date.atStartOfDay(zone).toInstant().toEpochMilli(),
            date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        )
        val state = repository.state(identity)
        val trigger = when {
            state.introShownAt == null && total >= 3 -> AnalyticsReviewPaywallTrigger.INITIAL
            state.introShownAt == null -> null
            state.followUpShownAt == null && today >= 2 &&
                date >= requireNotNull(state.introLocalDate).plusDays(2) -> AnalyticsReviewPaywallTrigger.DAY3
            state.followUpShownAt == null -> null
            today >= 2 && state.lastShownAt != null &&
                Duration.between(state.lastShownAt, now) >= Duration.ofDays(7) -> AnalyticsReviewPaywallTrigger.WEEKLY
            else -> null
        }
        requestSynchronization()
        if (!isAppAvailable || isReviewSurfaceBusy || isStoreReviewInProgress || presenter.reason != null || repository.currentIdentity() != identity) return true
        if (preferencesStore.observeEntitlement().value != entitlement) return true
        if (trigger == null) return false
        presenter.showReviewOffer(trigger, identity)
        return true
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
