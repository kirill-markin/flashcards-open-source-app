package com.flashcardsopensourceapp.app.analytics

import android.database.sqlite.SQLiteFullException
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsCredential
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsCredentialProvider
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsLaunchType
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReason
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean

private const val maxAnalyticsFailureCauseDepth: Int = 8

/**
 * Process-scoped so exactly one launch per process is `cold`. It deliberately does not live in
 * `AppGraph`, which can be torn down and rebuilt inside a running process.
 */
private val hasReportedColdLaunch = AtomicBoolean(false)

/**
 * Whether the process is currently in the foreground, so `app_opened` counts foreground entries
 * rather than observer registrations.
 *
 * `ProcessLifecycleOwner` already ignores configuration changes and intra-app activity
 * transitions, but adding an observer replays the current state to it. The observer is registered
 * once per process from `FlashcardsApplication`, so that replay happens at most once; the flag
 * keeps it a no-op regardless, so only a real background-to-foreground transition produces an
 * event. It is process-scoped for the same reason the observer is: `AppGraph` is rebuilt inside a
 * running process, and `FlashcardsApp` returns early on three branches before the composition
 * reaches any effect.
 */
private val isProcessForegrounded = AtomicBoolean(false)

/**
 * Process-wide kill switch, set by the instrumentation runner before the application exists.
 *
 * Instrumentation signs into a real account in the live-smoke flow, so anything a test run emitted
 * would land in production `product_events` indistinguishable from a real person's rows. This is
 * process-scoped rather than graph-scoped because the graph is rebuilt several times per test and
 * most instrumentation classes never touch the reset rule.
 */
private val productAnalyticsDisabledForProcess = AtomicBoolean(false)

internal fun disableProductAnalyticsForProcess() {
    productAnalyticsDisabledForProcess.set(true)
}

internal fun isProductAnalyticsDisabledForProcess(): Boolean {
    return productAnalyticsDisabledForProcess.get()
}

/** Returns null when the process was already foregrounded, which is not a new app open. */
internal fun consumeAnalyticsForegroundEntry(): AnalyticsLaunchType? {
    if (isProcessForegrounded.compareAndSet(false, true).not()) {
        return null
    }
    return if (hasReportedColdLaunch.compareAndSet(false, true)) {
        AnalyticsLaunchType.COLD
    } else {
        AnalyticsLaunchType.WARM
    }
}

internal fun markAnalyticsProcessBackgrounded() {
    isProcessForegrounded.set(false)
}

/**
 * Supplies the human-authenticated transport the analytics endpoint requires.
 *
 * It deliberately never refreshes a token: analytics may not drive auth traffic. When no usable
 * credential exists the events simply stay queued, which the 14-day queue TTL and the 30-day
 * server window make free for an ordinary sign-up delay.
 */
internal class AppAnalyticsCredentialProvider(
    private val cloudPreferencesStore: CloudPreferencesStore,
    private val guestAiSessionStore: GuestAiSessionStore,
    private val currentTimeMillisProvider: () -> Long = System::currentTimeMillis
) : AnalyticsCredentialProvider {
    override suspend fun currentCredential(): AnalyticsCredential? {
        val configuration: CloudServiceConfiguration = cloudPreferencesStore.currentServerConfiguration()
        val cloudSettings: CloudSettings = cloudPreferencesStore.currentCloudSettings()

        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> bearerCredential(configuration = configuration)
            CloudAccountState.GUEST -> guestCredential(configuration = configuration)
            CloudAccountState.DISCONNECTED, CloudAccountState.LINKING_READY -> null
        }
    }

    private fun bearerCredential(configuration: CloudServiceConfiguration): AnalyticsCredential? {
        val credentials: StoredCloudCredentials = cloudPreferencesStore.loadCredentials() ?: return null
        if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = credentials.idTokenExpiresAtMillis,
                nowMillis = currentTimeMillisProvider()
            )
        ) {
            return null
        }

        return AnalyticsCredential(
            apiBaseUrl = configuration.apiBaseUrl,
            authorizationHeader = "Bearer ${credentials.idToken}"
        )
    }

    private fun guestCredential(configuration: CloudServiceConfiguration): AnalyticsCredential? {
        val guestSession: StoredGuestAiSession = guestAiSessionStore.loadAnySession(
            configuration = configuration
        ) ?: return null

        return AnalyticsCredential(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.guestToken}"
        )
    }
}

/**
 * Maps a Compose navigation route onto the shared cross-platform surface enum. Native destination
 * names are never sent: cross-platform funnel comparison is the only reason the enum is shared.
 *
 * Every destination registered in `navigation/` is covered today, so nothing reachable falls
 * through to `null`: `review` and `review/preview`; `cards`; `ai`; `progress`; the three
 * `cards/editor/…` steps; `settings` and every `settings/…` leaf, of which
 * `settings/decks/detail/{deckId}` and `settings/decks/all-cards` are the two that report
 * `deck_detail` instead of `settings`.
 *
 * `catalog` and `onboarding` have no Android destination today, so no route maps onto them. When a
 * destination is added that belongs on either, map it here: an unmapped route ends the previous
 * surface's visit at the call site, so leaving it unmapped costs the view rather than corrupting
 * the counts, but it still costs it.
 */
internal fun analyticsSurfaceForRoute(route: String?): AnalyticsSurface? {
    val normalizedRoute: String = route?.trim().orEmpty()
    if (normalizedRoute.isEmpty()) {
        return null
    }

    return when {
        normalizedRoute.startsWith(prefix = "cards/editor") -> AnalyticsSurface.CARD_EDITOR
        normalizedRoute.startsWith(prefix = "settings/decks/detail") ||
            normalizedRoute == "settings/decks/all-cards" -> AnalyticsSurface.DECK_DETAIL
        normalizedRoute == "settings" || normalizedRoute.startsWith(prefix = "settings/") -> AnalyticsSurface.SETTINGS
        normalizedRoute == "review" || normalizedRoute.startsWith(prefix = "review/") -> AnalyticsSurface.REVIEW
        normalizedRoute == "cards" -> AnalyticsSurface.CARDS
        normalizedRoute == "ai" -> AnalyticsSurface.AI
        normalizedRoute == "progress" -> AnalyticsSurface.PROGRESS
        else -> null
    }
}

/** Maps a sync failure onto the closed reason set the server catalog declares. */
internal fun analyticsSyncFailureReason(error: Throwable): AnalyticsSyncFailureReason {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxAnalyticsFailureCauseDepth) {
        val inspectedError: Throwable = currentError
        when (inspectedError) {
            is SQLiteFullException -> return AnalyticsSyncFailureReason.STORAGE_FULL
            is SyncBlockedException -> return AnalyticsSyncFailureReason.CONFLICT
            is SocketTimeoutException -> return AnalyticsSyncFailureReason.TIMEOUT
            is IOException -> return AnalyticsSyncFailureReason.OFFLINE
            is CloudRemoteException -> return analyticsCloudSyncFailureReason(error = inspectedError)
            else -> Unit
        }
        currentError = inspectedError.cause
        depth += 1
    }
    return AnalyticsSyncFailureReason.SERVER_ERROR
}

private fun analyticsCloudSyncFailureReason(error: CloudRemoteException): AnalyticsSyncFailureReason {
    if (
        error.syncConflict != null ||
        error.errorCode?.trim()?.uppercase() == "SYNC_WORKSPACE_FORK_REQUIRED"
    ) {
        return AnalyticsSyncFailureReason.CONFLICT
    }

    return when (error.statusCode) {
        401, 403 -> AnalyticsSyncFailureReason.UNAUTHORIZED
        408, 504 -> AnalyticsSyncFailureReason.TIMEOUT
        409 -> AnalyticsSyncFailureReason.CONFLICT
        else -> AnalyticsSyncFailureReason.SERVER_ERROR
    }
}
